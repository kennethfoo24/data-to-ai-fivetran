"""
Bronze batch ingestion: Postgres (via PyAirbyte) + CSVs → Iceberg Bronze via PySpark.
Run via Airflow PythonOperator or directly: python batch_ingest.py
"""
import os

WAREHOUSE = os.getenv("SPARK_WAREHOUSE", "/warehouse")
SEED_PATH = os.getenv("SEED_DATA_PATH", "/opt/airflow/seed/data")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_USER = os.getenv("POSTGRES_USER", "admin")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "admin")
POSTGRES_DB = os.getenv("POSTGRES_DB", "shopstream")

ICEBERG_JAR = "/opt/airflow/iceberg-spark-runtime.jar"


def _spark():
    from pyspark.sql import SparkSession
    return (
        SparkSession.builder
        .appName("batch-ingest-bronze")
        .master("local[2]")
        .config("spark.jars", ICEBERG_JAR)
        .config("spark.sql.extensions",
                "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
        .config("spark.sql.catalog.local",
                "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.local.type", "hadoop")
        .config("spark.sql.catalog.local.warehouse", WAREHOUSE)
        .config("spark.sql.defaultCatalog", "local")
        .config("spark.driver.memory", "1g")
        .getOrCreate()
    )


def _write_bronze(spark, table_name: str, df) -> None:
    """Create-or-overwrite an Iceberg table in bronze namespace."""
    spark.sql("CREATE NAMESPACE IF NOT EXISTS local.bronze")
    full_name = f"local.bronze.{table_name}"
    df.writeTo(full_name).using("iceberg").createOrReplace()
    print(f"  bronze.{table_name}: {df.count()} rows written")


def ingest_customers() -> None:
    """Read customers from Postgres via psycopg2 → Bronze."""
    import psycopg2
    import pandas as pd

    conn = psycopg2.connect(
        host=POSTGRES_HOST, dbname=POSTGRES_DB,
        user=POSTGRES_USER, password=POSTGRES_PASSWORD,
    )
    df_pandas = pd.read_sql("SELECT * FROM customers", conn)
    conn.close()

    spark = _spark()
    df = spark.createDataFrame(df_pandas)
    _write_bronze(spark, "customers", df)


def ingest_csv(filename: str, table_name: str) -> None:
    """Read a seed CSV file → Bronze."""
    path = os.path.join(SEED_PATH, filename)
    spark = _spark()
    df = spark.read.option("header", "true").option("inferSchema", "true").csv(path)
    _write_bronze(spark, table_name, df)


def run_all() -> None:
    print("==> Ingesting customers (PyAirbyte → Bronze)...")
    ingest_customers()
    print("==> Ingesting orders (CSV → Bronze)...")
    ingest_csv("orders.csv", "orders")
    print("==> Ingesting products (CSV → Bronze)...")
    ingest_csv("products.csv", "products")
    print("Bronze ingestion complete.")


if __name__ == "__main__":
    run_all()
