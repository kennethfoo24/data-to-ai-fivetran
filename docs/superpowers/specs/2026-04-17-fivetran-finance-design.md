# Fivetran Finance Tab — Design Spec
**Date:** 2026-04-17  
**Status:** Approved  
**Purpose:** Add a "Fivetran Finance" tab to the ShopStream UI showcasing the simplified "after" data stack for a revenue ops use case — contrasting with the complex "before" ShopStream pipeline. Targeted at a Fivetran interview demo.

---

## 1. Overview

### The Story
| | Before (ShopStream tab) | After (Fivetran Finance tab) |
|--|------------------------|------------------------------|
| Ingestion | psycopg2 + PySpark + Airflow DAGs | Fivetran managed connector |
| Streaming | Spark Structured Streaming | Fivetran Kafka connector |
| Transforms | Airflow-triggered dbt + Spark | Fivetran Transformations (dbt, managed, push-down to Snowflake) |
| Storage | Apache Iceberg (medallion lakehouse) | Snowflake (raw + transformed schemas) |
| Orchestration | Airflow | None — Fivetran triggers transforms after every sync |
| Activation | FastAPI → React | Fivetran Reverse ETL → HubSpot CRM |

### Tab Structure (3 tabs)
| Tab key | Label | Component |
|---------|-------|-----------|
| `shopstream` | ShopStream | `LineageGraph` (unchanged) |
| `fivetran-marketing` | Fivetran Marketing | `FivetranGraph` (renamed from current `fivetran`) |
| `fivetran-finance` | Fivetran Finance | `FinanceGraph` (new) |

---

## 2. Finance Seed Data

### Postgres Tables (new)
Added to existing Postgres instance (`shopstream` database). Seeded via extended `seed/generate_data.py` and `seed/seed.sh`.

#### `finance_invoices` (~2,000 rows)
```sql
CREATE TABLE finance_invoices (
  invoice_id   SERIAL PRIMARY KEY,
  customer_id  INT REFERENCES customers(customer_id),
  amount       NUMERIC(10,2),
  status       VARCHAR(20),  -- paid | unpaid | overdue
  issue_date   DATE,
  due_date     DATE
);
```

#### `finance_payments` (~1,800 rows)
```sql
CREATE TABLE finance_payments (
  payment_id    SERIAL PRIMARY KEY,
  invoice_id    INT REFERENCES finance_invoices(invoice_id),
  amount_paid   NUMERIC(10,2),
  payment_date  DATE,
  method        VARCHAR(20)   -- card | bank | paypal
);
```

### Kafka Topic (new): `shopstream.finance`
Real-time revenue events streamed to existing Kafka instance.

| Field | Type | Values |
|-------|------|--------|
| event_id | string (UUID) | auto-generated |
| customer_id | int | 1–2000 |
| event_type | string | subscription_renewal \| churn \| upsell |
| mrr_delta | float | positive (renewal/upsell) or negative (churn) |
| timestamp | ISO8601 | event time |

Producer script: `seed/produce_finance_events.py` — generates 500 events and publishes to `shopstream.finance`.

---

## 3. Fivetran Finance Lineage Graph

### Node Layout (6 columns)

```
Sources       ELT Connector    Snowflake Raw    Fivetran         Snowflake         Reverse ETL    HubSpot
                                                Transforms       Transformed
[Postgres]    [FTV Connector]──►[raw schema] ──►[T1/T2/T3]   ──►[clean schema] ──►[Rev ETL]   ──►[HubSpot]
[Kafka]      ─┘
```

### Node Definitions

| ID | Label | Sublabel | Logo | Tag | URL |
|----|-------|----------|------|-----|-----|
| `pg-source` | Postgres | Finance · Revenue | postgres | source | pgAdmin :5050 |
| `kafka-source` | Kafka | Real-time events | kafka | streaming | Kafka UI :8080 |
| `ftv-connector` | Fivetran ELT | Postgres + Kafka sync | fivetran | connector | fivetran.com/dashboard |
| `snow-raw` | Snowflake Raw | finance_invoices · payments | snowflake | raw | app.snowflake.com |
| `ftv-transforms` | Fivetran Transforms | dbt · managed · push-down | fivetran | dbt · managed | fivetran.com/transformations |
| `snow-transformed` | Snowflake Clean | invoice_aging · segments | snowflake | transformed | app.snowflake.com (clickable → BI modal) |
| `ftv-reverse-etl` | Reverse ETL | Snowflake → HubSpot | fivetran | reverse etl | fivetran.com/reverse-etl |
| `hubspot` | HubSpot CRM | Customer segments | hubspot | destination | app.hubspot.com |

### Edges
```
pg-source        → ftv-connector
kafka-source     → ftv-connector
ftv-connector    → snow-raw
snow-raw         → ftv-transforms
ftv-transforms   → snow-transformed
snow-transformed → ftv-reverse-etl
ftv-reverse-etl  → hubspot
```

All edges use existing `SilkEdge` (animated bezier with particles).

### Key Interview Annotation
The `ftv-transforms` node carries a tag `dbt · managed` and sublabel `"No Airflow. Runs after every sync."` — this is the core contrast with the ShopStream before stack.

---

## 4. Fivetran Transformations (dbt Models)

Three dbt models run **inside Snowflake**, orchestrated by Fivetran after every connector sync. No Airflow, no Spark, no external compute.

### T1: `finance_invoice_aging`
**Input:** `raw.finance_invoices`  
**Output:** `transformed.invoice_aging`
```sql
SELECT
  invoice_id,
  customer_id,
  amount,
  status,
  due_date,
  CURRENT_DATE - due_date AS days_overdue,
  CASE
    WHEN status = 'paid' THEN 'paid'
    WHEN CURRENT_DATE - due_date <= 0  THEN 'current'
    WHEN CURRENT_DATE - due_date <= 30 THEN '1-30 days'
    WHEN CURRENT_DATE - due_date <= 60 THEN '31-60 days'
    ELSE '60+ days'
  END AS aging_bucket
FROM raw.finance_invoices
```

### T2: `finance_customer_segments`
**Input:** `raw.finance_invoices`, `raw.finance_payments`  
**Output:** `transformed.customer_segments`
```sql
WITH payment_stats AS (
  SELECT
    i.customer_id,
    COUNT(i.invoice_id)                              AS total_invoices,
    SUM(CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END) AS paid_invoices,
    SUM(p.amount_paid)                               AS total_paid,
    MAX(p.payment_date)                              AS last_payment_date
  FROM raw.finance_invoices i
  LEFT JOIN raw.finance_payments p ON i.invoice_id = p.invoice_id
  GROUP BY i.customer_id
)
SELECT
  customer_id,
  total_invoices,
  paid_invoices,
  total_paid,
  last_payment_date,
  CASE
    WHEN paid_invoices::float / NULLIF(total_invoices,0) >= 0.9
         AND last_payment_date >= CURRENT_DATE - 90  THEN 'champion'
    WHEN paid_invoices::float / NULLIF(total_invoices,0) >= 0.5 THEN 'at_risk'
    ELSE 'churned'
  END AS segment
FROM payment_stats
```

### T3: `finance_monthly_summary`
**Input:** `raw.finance_payments`, `raw.finance_revenue_events` (if available)  
**Output:** `transformed.monthly_summary`
```sql
SELECT
  DATE_TRUNC('month', payment_date)   AS month,
  SUM(amount_paid)                    AS total_revenue,
  SUM(amount_paid) * 12               AS arr,
  COUNT(DISTINCT p.invoice_id)        AS paid_invoices,
  SUM(CASE WHEN method = 'card'   THEN amount_paid ELSE 0 END) AS card_revenue,
  SUM(CASE WHEN method = 'bank'   THEN amount_paid ELSE 0 END) AS bank_revenue,
  SUM(CASE WHEN method = 'paypal' THEN amount_paid ELSE 0 END) AS paypal_revenue
FROM raw.finance_payments p
GROUP BY 1
ORDER BY 1
```

---

## 5. BI Modal (Snowflake Transformed node click)

Four Recharts charts rendered inside a modal. Data from `GET /api/finance/charts`. Falls back to simulated data if Snowflake credentials missing or unreachable.

| # | Chart | Type | Source | Key metric |
|---|-------|------|--------|------------|
| 1 | MRR Trend | Line chart | `monthly_summary` | Monthly revenue over 12 months |
| 2 | Revenue by Payment Method | Donut | `monthly_summary` | Card / Bank / PayPal split |
| 3 | Invoice Aging Breakdown | Stacked bar | `invoice_aging` | Current / 1-30 / 31-60 / 60+ days |
| 4 | Customer Segments | Horizontal bar | `customer_segments` | Champion / At-risk / Churned counts |

Modal design: same style as existing `CatalogModal.tsx` — tabs for each chart, dark header, close button.

---

## 6. Backend: FastAPI Finance Router

### New file: `serving/routers/finance.py`

Endpoint: `GET /api/finance/charts`

Logic:
1. Read Snowflake env vars from environment
2. If all vars present → connect via `snowflake-connector-python`, run 3 SQL queries (monthly_summary, invoice_aging, customer_segments)
3. If connection fails or vars missing → return `simulated: true` + hardcoded realistic data
4. Return unified JSON:
```json
{
  "simulated": false,
  "mrr_trend": [{ "month": "2024-01", "revenue": 48200, "arr": 578400 }, ...],
  "payment_methods": [{ "method": "card", "revenue": 28500 }, ...],
  "invoice_aging": [{ "bucket": "paid", "count": 1420 }, ...],
  "customer_segments": [{ "segment": "champion", "count": 980 }, ...]
}
```

### New dependency: `snowflake-connector-python`
Added to `serving/requirements.txt`.

### New env vars (`.env.example`):
```
SNOWFLAKE_ACCOUNT=
SNOWFLAKE_USER=
SNOWFLAKE_PASSWORD=
SNOWFLAKE_DATABASE=SHOPSTREAM
SNOWFLAKE_SCHEMA=transformed
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
HUBSPOT_PORTAL_ID=
```

---

## 7. New UI Component: `FinanceGraph.tsx`

File: `ui/components/FinanceGraph.tsx`

Reuses existing patterns from `FivetranGraph.tsx`:
- `PipelineNode` component (copy, add `hubspot` logo)
- `LayerLabel` component (copy)
- `SilkEdge` component (copy)
- New: clicking `snow-transformed` node calls `setSelectedNode('snow-transformed')` → opens `FinanceBIModal`

New file: `ui/components/FinanceBIModal.tsx`
- Fetches `GET /api/finance/charts` on open
- Renders 4 Recharts charts in tabs
- Shows `simulated` badge if fallback data
- Same modal style as `CatalogModal.tsx`

New logos needed in `FinanceGraph.tsx`:
- `postgres` — blue elephant SVG
- `kafka` — black/orange SVG  
- `hubspot` — orange sprocket SVG

---

## 8. ngrok Auto-Exposure + Kafka Events (make setup integration)

`make setup` (via `scripts/setup.sh`) automatically:
1. Starts ngrok tunnels for Postgres and Kafka after services are healthy
2. Produces Kafka finance events (no separate manual step needed)
3. Prints a formatted copy-paste block for Fivetran and HubSpot

### What gets added to `scripts/setup.sh`

After the existing "Load seed data" step, the script:

1. **Produces Kafka finance events** — runs `python3 seed/produce_finance_events.py` inline (500 events to `shopstream.finance`)
2. **Checks for ngrok** — if `ngrok` not found, prints install instructions and skips (non-fatal)
3. **Checks for `NGROK_AUTHTOKEN`** in `.env` — if missing, prints signup instructions and skips
4. **Starts two ngrok TCP tunnels in the background:**
   - `ngrok tcp 5432` → exposes Postgres
   - `ngrok tcp 9092` → exposes Kafka
5. **Waits 3 seconds** for ngrok to assign public URLs
6. **Queries ngrok local API** (`http://localhost:4040/api/tunnels`) to extract the assigned hostnames and ports
7. **Prints the Fivetran copy-paste block:**

```
╔══════════════════════════════════════════════════════════════════════╗
║   Fivetran Finance — Connection Details                              ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   POSTGRES SOURCE CONNECTOR                                          ║
║   Host:      0.tcp.ngrok.io                                          ║
║   Port:      12345                                                   ║
║   Database:  shopstream                                              ║
║   User:      admin                                                   ║
║   Password:  admin                                                   ║
║   Tables:    finance_invoices, finance_payments, customers           ║
║                                                                      ║
║   KAFKA SOURCE CONNECTOR                                             ║
║   Bootstrap: 0.tcp.ngrok.io:56789                                    ║
║   Topic:     shopstream.finance                                      ║
║   Protocol:  PLAINTEXT                                               ║
║                                                                      ║
║   HUBSPOT REVERSE ETL — FIELD MAPPINGS                               ║
║   Source table:  SHOPSTREAM.transformed.customer_segments            ║
║   Unique ID:     customer_id → Contact External ID                   ║
║   segment     →  revenue_segment (custom property)                  ║
║   total_paid  →  total_revenue   (custom property)                   ║
║                                                                      ║
║   Fivetran dashboard:  https://fivetran.com/dashboard                ║
║   HubSpot portal:      https://app.hubspot.com/contacts/YOUR_ID      ║
╚══════════════════════════════════════════════════════════════════════╝
```

### New `.env.example` var
```
NGROK_AUTHTOKEN=   # get free token at https://dashboard.ngrok.com/get-started/your-authtoken
```

### ngrok install note (printed if missing)
```
  ngrok not found. Install it to auto-expose Postgres + Kafka to Fivetran:
    Mac:    brew install ngrok/ngrok/ngrok
    Linux:  snap install ngrok
  Then add NGROK_AUTHTOKEN=<your_token> to .env and re-run make setup.
```

### Behaviour if ngrok is unavailable
- `make setup` still completes successfully — ngrok is optional
- The Fivetran connection block is skipped
- A single line prints: `  (skipped) ngrok not configured — see docs/fivetran-finance-setup.md for manual steps`

---

## 8b. make down — Demo Reset

`make down` is extended to also reset the demo state so re-running `make setup` always starts from a clean slate. This is the natural mental model: down = everything torn down, ready to go again.

### What gets added to `Makefile` `down` target

The `down` target calls `scripts/teardown.sh` (new file) before stopping Docker, which:

1. **Kills ngrok tunnels** — `pkill -f ngrok` (graceful, non-fatal if not running)
2. **Truncates finance tables in Postgres** — via `docker compose exec postgres psql`:
   ```sql
   TRUNCATE finance_payments, finance_invoices RESTART IDENTITY CASCADE;
   ```
3. **Resets Kafka topic** — deletes and recreates `shopstream.finance` topic via Kafka CLI inside the kafka container (auto-create is enabled so recreation is instant)
4. **Stops Docker services** — existing `docker compose --profile core down` (unchanged)

### Behaviour
- Idempotent — safe to run even if services are already stopped (each step is non-fatal)
- Does **not** delete volumes or seed CSVs (use `make clean` for that, unchanged)
- After `make down` + `make setup`: fresh seed data, fresh Kafka events, fresh ngrok URLs — new copy-paste block printed

### Updated `Makefile` targets
```makefile
## Stop services and reset demo state (finance tables + kafka + ngrok)
down:
    bash scripts/teardown.sh
    docker compose --profile core down
```

---

## 9. Fivetran Finance Setup Guide

Full click-by-click guide: `docs/fivetran-finance-setup.md`

### Step 1: Run make setup
```bash
make setup
```
This will start all services, seed finance data, start ngrok tunnels, and print the Fivetran connection block. Copy the values from the printed block for the steps below.

### Step 2: Create Fivetran account
1. Go to [fivetran.com](https://fivetran.com) → **Start Free Trial**
2. Sign up with email
3. On the dashboard, click **Add Connector**

### Step 3: Configure Postgres source connector
Use the values printed by `make setup` under **POSTGRES SOURCE CONNECTOR**.

1. In Fivetran dashboard → click **Add Connector** → search **PostgreSQL** → select it
2. **Destination schema prefix:** type `finance_raw`
3. **Host:** paste the ngrok host from the printed block (e.g. `0.tcp.ngrok.io`)
4. **Port:** paste the ngrok port from the printed block (e.g. `12345`)
5. **User:** `admin`
6. **Password:** `admin`
7. **Database:** `shopstream`
8. Click **Save & Test** — wait for green checkmark
9. Under **Schema** tab → expand `shopstream` → check: `finance_invoices`, `finance_payments`, `customers`
10. Set **Sync Frequency:** `Every 6 hours` (or **Manual** for demo control)
11. Click **Save & Continue**

### Step 4: Configure Kafka source connector
Use the values printed by `make setup` under **KAFKA SOURCE CONNECTOR**.

1. Click **Add Connector** → search **Apache Kafka** → select it
2. **Bootstrap servers:** paste the ngrok bootstrap address from the printed block (e.g. `0.tcp.ngrok.io:56789`)
3. **Security protocol:** select `PLAINTEXT`
4. **Topics:** type `shopstream.finance`
5. **Consumer group:** type `fivetran-finance`
6. Click **Save & Test** — wait for green checkmark
7. **Destination schema prefix:** type `finance_kafka_raw`
8. Click **Save & Continue**

### Step 5: Configure Snowflake destination
1. In Fivetran sidebar → **Destinations** → **Add Destination**
2. Select **Snowflake**
3. **Account:** your Snowflake account identifier (e.g. `abc12345.us-east-1`)
4. **Database:** `SHOPSTREAM`
5. **Warehouse:** `COMPUTE_WH`
6. **User:** your Snowflake username
7. **Password:** your Snowflake password
8. **Role:** `ACCOUNTADMIN` (or a custom role with CREATE SCHEMA privileges)
9. Click **Save & Test**

### Step 6: Add Fivetran Transformations (dbt models)
1. In Fivetran sidebar → **Transformations** → **Add Transformation**
2. Select **dbt Core**
3. Connect to your Git repo (GitHub) — Fivetran will look for `dbt/` directory
4. Alternatively, use **Fivetran-hosted dbt** (no Git needed for demo):
   - Click **New Model** for each of the 3 SQL models above (T1, T2, T3)
   - Paste the SQL from Section 4 of this spec
   - Set **Run after connector sync:** enabled
   - Set **Connector:** your Postgres connector
5. Click **Save** — Fivetran will run transforms after every sync automatically

### Step 7: Configure Reverse ETL → HubSpot
1. In Fivetran sidebar → **Reverse ETL** → **Add Sync**
2. **Source:** Snowflake → database `SHOPSTREAM` → schema `transformed` → table `customer_segments`
3. **Destination:** HubSpot
   - Click **Add Destination** → search HubSpot → **Authorize** with your HubSpot account
4. **Object:** Contacts
5. **Unique identifier:** `customer_id` → map to HubSpot Contact property `external_id`
6. **Field mappings:**
   | Snowflake column | HubSpot property |
   |-----------------|-----------------|
   | `segment` | `lifecyclestage` (or custom property `revenue_segment`) |
   | `total_paid` | custom property `total_revenue` |
   | `last_payment_date` | custom property `last_payment_date` |
7. **Sync frequency:** After every transformation run
8. Click **Save & Run**

### Step 8: Set environment variables
Copy the Snowflake credentials into `.env`:
```
SNOWFLAKE_ACCOUNT=abc12345.us-east-1
SNOWFLAKE_USER=your_user
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=SHOPSTREAM
SNOWFLAKE_SCHEMA=transformed
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
HUBSPOT_PORTAL_ID=your_portal_id
```
Rebuild FastAPI: `docker compose --profile core build fastapi && docker compose --profile core up -d fastapi`

### Step 9: Seed finance data and trigger first sync
```bash
# Generate and load finance seed data
make seed

# Produce Kafka finance events
python3 seed/produce_finance_events.py

# In Fivetran dashboard: click "Sync Now" on the Postgres connector
# Wait for sync + transformations to complete (~2-5 min)
# Verify in Snowflake: SELECT * FROM transformed.finance_monthly_summary LIMIT 5;
```

---

## 10. Files Changed / Created

| File | Action | Purpose |
|------|--------|---------|
| `ui/app/page.tsx` | Edit | Add third tab `fivetran-finance`, rename `fivetran` → `fivetran-marketing` |
| `ui/components/FinanceGraph.tsx` | Create | Finance lineage graph (8 nodes, 6 columns) |
| `ui/components/FinanceBIModal.tsx` | Create | BI charts modal with 4 Recharts charts + simulated fallback |
| `seed/generate_data.py` | Edit | Add `finance_invoices` and `finance_payments` CSV generation |
| `seed/seed.sh` | Edit | Load `finance_invoices` and `finance_payments` into Postgres |
| `seed/produce_finance_events.py` | Create | Kafka producer for `shopstream.finance` topic |
| `serving/routers/finance.py` | Create | `GET /api/finance/charts` — Snowflake queries + simulated fallback |
| `serving/main.py` | Edit | Register finance router |
| `serving/requirements.txt` | Edit | Add `snowflake-connector-python` |
| `.env.example` | Edit | Add Snowflake, HubSpot, and `NGROK_AUTHTOKEN` env vars |
| `scripts/setup.sh` | Edit | Add Kafka event producer + ngrok tunnel start + Fivetran copy-paste block print after seed step |
| `scripts/teardown.sh` | Create | Kill ngrok, truncate finance tables, reset Kafka topic — called by `make down` |
| `Makefile` | Edit | Extend `down` target to call `scripts/teardown.sh` before stopping Docker |
| `docs/fivetran-finance-setup.md` | Create | Full click-by-click Fivetran setup guide (from this spec §9) |

---

## 11. Interview Demo Script

**"Before" story (ShopStream tab):** Point to the 7-column graph — Postgres → psycopg2 → Spark → Iceberg Bronze → dbt Silver → dbt Gold → MLflow → FastAPI. "This is a real production-grade data stack. It works, but it requires Airflow for orchestration, Spark for compute, Iceberg for storage, and a team to maintain all of it."

**"After" story (Fivetran Finance tab):** Switch to the Finance tab. "Same sources — Postgres and Kafka. But now Fivetran handles ingestion with zero-code connectors. Transformations run inside Snowflake — no Spark, no Airflow DAG, just SQL models that Fivetran triggers automatically after every sync. And the output doesn't just sit in a warehouse — Reverse ETL pushes customer segments directly into HubSpot so the sales team sees updated data without ever touching SQL."

**Click Snowflake Transformed node → BI modal opens.** "These charts are live from Snowflake — MRR trend, payment method breakdown, invoice aging, customer health. The same data that's flowing into HubSpot."
