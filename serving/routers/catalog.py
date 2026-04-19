"""
GET /api/catalog/{layer}/{table}
Reads Iceberg Parquet files directly via pyarrow — no Spark needed.
Returns schema + 5 sample rows + approximate row count.
"""
import os
import glob
import math

import pyarrow.parquet as pq
from fastapi import APIRouter, HTTPException

router = APIRouter()

WAREHOUSE = os.getenv("WAREHOUSE_PATH", "/warehouse")

# All known tables per layer
LAYER_TABLES = {
    "bronze": ["customers", "orders", "products", "clickstream"],
    "silver": ["orders_clean", "customers_clean", "clickstream_sessions"],
    "gold":   ["customer_features", "product_interactions"],
}


def _parquet_files(layer: str, table: str) -> list[str]:
    """Glob for Parquet data files under the Iceberg table directory."""
    base = os.path.join(WAREHOUSE, layer, table, "data")
    files = glob.glob(os.path.join(base, "**", "*.parquet"), recursive=True)
    files += glob.glob(os.path.join(base, "*.parquet"))
    return sorted(set(files))


@router.get("/api/catalog/{layer}/{table}")
def catalog_table(layer: str, table: str):
    if layer not in LAYER_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown layer: {layer}")
    if table not in LAYER_TABLES[layer]:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table} in layer {layer}")

    files = _parquet_files(layer, table)
    if not files:
        return {
            "layer": layer,
            "table": table,
            "columns": [],
            "rows": [],
            "row_count": None,
            "available": False,
            "message": "No Parquet files found — run the pipeline first (make seed)",
        }

    # Read schema + 5 rows from first file only (fast, no full scan)
    try:
        pf = pq.ParquetFile(files[0])
        schema = pf.schema_arrow

        # Read first batch — at most 5 rows
        batch = next(pf.iter_batches(batch_size=5))
        df = batch.to_pydict()

        columns = [
            {"name": field.name, "type": str(field.type)}
            for field in schema
        ]

        # Build rows as list of dicts, serializing non-JSON-safe types
        row_count_sample = len(next(iter(df.values()))) if df else 0
        rows = []
        for i in range(row_count_sample):
            row = {}
            for col, vals in df.items():
                v = vals[i]
                # Convert non-serializable types to string
                if v is None:
                    row[col] = None
                elif isinstance(v, float) and math.isnan(v):
                    row[col] = None
                elif isinstance(v, (bool, int, float, str)):
                    row[col] = v
                else:
                    row[col] = str(v)
            rows.append(row)

        # Approximate row count: sum metadata row counts across all files
        total_rows = 0
        for f in files:
            try:
                total_rows += pq.read_metadata(f).num_rows
            except Exception:
                pass

        return {
            "layer": layer,
            "table": table,
            "columns": columns,
            "rows": rows,
            "row_count": total_rows if total_rows > 0 else None,
            "available": True,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read table: {e}")


@router.get("/api/catalog")
def catalog_index():
    """List all known layers and tables."""
    return {"layers": LAYER_TABLES}
