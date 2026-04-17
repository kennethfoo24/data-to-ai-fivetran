"""
ShopStream ML API — Phase 4
Endpoints:
  POST /predict/churn
  POST /predict/recommend
  GET  /api/status   — pipeline health JSON polled by UI every 10s
  GET  /health
"""
import os
import time

import mlflow
import mlflow.tracking
import psycopg2
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.churn import router as churn_router
from routers.recommend import router as recommend_router
from routers.catalog import router as catalog_router
from routers.finance import router as finance_router

MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
DATABASE_URL = os.getenv("DATABASE_URL", "")

app = FastAPI(title="ShopStream ML API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(churn_router)
app.include_router(recommend_router)
app.include_router(catalog_router)
app.include_router(finance_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "shopstream-api"}


def _model_status(client: mlflow.tracking.MlflowClient, model_name: str) -> dict:
    """Return version + metrics for the Production alias of a registered model."""
    try:
        mv = client.get_model_version_by_alias(model_name, "Production")
        run = client.get_run(mv.run_id)
        return {
            "registered": True,
            "version": mv.version,
            "metrics": run.data.metrics,
        }
    except Exception:
        return {"registered": False}


def _postgres_table_count(table: str) -> int | None:
    """Quick row-count from Postgres. Returns None on error."""
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608 — internal only
        count = cur.fetchone()[0]
        conn.close()
        return count
    except Exception:
        return None


@app.get("/api/status")
def api_status():
    mlflow.set_tracking_uri(MLFLOW_URI)
    client = mlflow.tracking.MlflowClient()

    churn_info = _model_status(client, "churn-classifier")
    recommend_info = _model_status(client, "product-recommender")

    customer_count = _postgres_table_count("customers")

    product_count = _postgres_table_count("inventory")

    return {
        "timestamp": int(time.time()),
        "models": {
            "churn_classifier": churn_info,
            "product_recommender": recommend_info,
        },
        "data": {
            "customers": customer_count,
            "products": product_count,
        },
        "endpoints": {
            "churn": "/predict/churn",
            "recommend": "/predict/recommend",
        },
    }
