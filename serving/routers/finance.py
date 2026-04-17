"""
Finance BI charts endpoint.
Queries Snowflake transformed schema for 4 chart datasets.
Falls back to simulated data if Snowflake env vars are missing or connection fails.
"""
import math
import os

from fastapi import APIRouter

router = APIRouter()

SNOWFLAKE_VARS = [
    "SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA", "SNOWFLAKE_WAREHOUSE",
]


def _snowflake_configured() -> bool:
    return all(os.getenv(v) for v in SNOWFLAKE_VARS)


def _safe(val):
    if val is None:
        return None
    try:
        if math.isnan(float(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


def _query_snowflake() -> dict:
    import snowflake.connector

    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
    )
    cur = conn.cursor()

    cur.execute("""
        SELECT TO_CHAR(month, 'YYYY-MM') AS month, total_revenue, arr
        FROM finance_monthly_summary ORDER BY month LIMIT 12
    """)
    mrr_trend = [{"month": r[0], "revenue": _safe(r[1]), "arr": _safe(r[2])} for r in cur.fetchall()]

    cur.execute("""
        SELECT 'card' AS method, SUM(card_revenue) FROM finance_monthly_summary
        UNION ALL SELECT 'bank', SUM(bank_revenue) FROM finance_monthly_summary
        UNION ALL SELECT 'paypal', SUM(paypal_revenue) FROM finance_monthly_summary
    """)
    payment_methods = [{"method": r[0], "revenue": _safe(r[1])} for r in cur.fetchall()]

    cur.execute("""
        SELECT aging_bucket, COUNT(*) FROM finance_invoice_aging
        GROUP BY aging_bucket ORDER BY aging_bucket
    """)
    invoice_aging = [{"bucket": r[0], "count": r[1]} for r in cur.fetchall()]

    cur.execute("""
        SELECT segment, COUNT(*) FROM finance_customer_segments
        GROUP BY segment ORDER BY COUNT(*) DESC
    """)
    customer_segments = [{"segment": r[0], "count": r[1]} for r in cur.fetchall()]

    cur.close()
    conn.close()

    return {
        "simulated": False,
        "mrr_trend": mrr_trend,
        "payment_methods": payment_methods,
        "invoice_aging": invoice_aging,
        "customer_segments": customer_segments,
    }


def _simulated_data() -> dict:
    return {
        "simulated": True,
        "mrr_trend": [
            {"month": f"2024-{m:02d}", "revenue": 42000 + m * 1800 + (m % 3) * 900, "arr": (42000 + m * 1800) * 12}
            for m in range(1, 13)
        ],
        "payment_methods": [
            {"method": "card",   "revenue": 312400},
            {"method": "bank",   "revenue": 187200},
            {"method": "paypal", "revenue": 94600},
        ],
        "invoice_aging": [
            {"bucket": "paid",       "count": 1420},
            {"bucket": "current",    "count": 210},
            {"bucket": "1-30 days",  "count": 180},
            {"bucket": "31-60 days", "count": 110},
            {"bucket": "60+ days",   "count": 80},
        ],
        "customer_segments": [
            {"segment": "champion", "count": 980},
            {"segment": "at_risk",  "count": 620},
            {"segment": "churned",  "count": 400},
        ],
    }


@router.get("/api/finance/charts")
def finance_charts():
    if not _snowflake_configured():
        return _simulated_data()
    try:
        return _query_snowflake()
    except Exception:
        return _simulated_data()
