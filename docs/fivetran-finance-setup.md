# Fivetran Finance — Step-by-Step Setup Guide

This guide walks through configuring Fivetran to sync ShopStream's finance data (Cloud SQL Postgres + Kafka) to Snowflake, run dbt transformations, and push customer segments to HubSpot via Reverse ETL.

**Before you start:** Run `make setup` — it provisions Cloud SQL, seeds data, and prints all connection details.

---

## Step 1: Run make setup

```bash
make setup
```

This starts all services, seeds finance data into local Postgres and Cloud SQL, produces 500 Kafka events, and prints a formatted copy-paste block:

```
╔══════════════════════════════════════════════════════════════════════╗
║   Fivetran Finance — Connection Details (copy-paste these)           ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║   POSTGRES SOURCE CONNECTOR (Cloud SQL)                              ║
║   Host:      34.132.27.154                                           ║
║   Port:      5432                                                    ║
║   Database:  shopstream                                              ║
║   User:      fivetran                                                ║
║   Password:  <generated>                                             ║
║   SSL:       required                                                ║
║   Tables:    finance_invoices, finance_payments, customers           ║
║                                                                      ║
║   SNOWFLAKE DESTINATION                                              ║
║   Account:   KKGCKAP-CD56063                                         ║
║   Database:  SHOPSTREAM                                              ║
║   Warehouse: COMPUTE_WH                                              ║
║   Role:      ACCOUNTADMIN                                            ║
║                                                                      ║
║   HUBSPOT REVERSE ETL                                                ║
║   Portal ID: 245945263                                               ║
╚══════════════════════════════════════════════════════════════════════╝
```

> **Prerequisites:** `terraform`, `gcloud` (authenticated), and `psql` must be installed.
> - `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`
> - `brew install --cask google-cloud-sdk && gcloud auth application-default login`
> - `brew install libpq && echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc`

---

## Step 2: Create Fivetran account

1. Go to [fivetran.com](https://fivetran.com) → click **Start Free Trial**
2. Sign up with your email address
3. On the dashboard, click **Add Connector**

---

## Step 3: Configure Snowflake destination

1. Fivetran sidebar → **Destinations** → **Add Destination** → select **Snowflake**
2. Fill in credentials:
   - **Account:** `KKGCKAP-CD56063`
   - **Database:** `SHOPSTREAM`
   - **Warehouse:** `COMPUTE_WH`
   - **User:** `KENNETHFOO24`
   - **Password:** your Snowflake password
   - **Role:** `ACCOUNTADMIN`
3. Click **Save & Test** — wait for green checkmark

---

## Step 4: Configure Postgres source connector (Cloud SQL)

Use the values from the **POSTGRES SOURCE CONNECTOR** block printed by `make setup`.

1. Fivetran dashboard → **Add Connector** → search **PostgreSQL** → select it
2. **Destination schema prefix:** `finance_raw`
3. **Host:** paste the Cloud SQL IP (e.g. `34.132.27.154`)
4. **Port:** `5432`
5. **User:** `fivetran`
6. **Password:** paste from `make setup` output (or run `cd infra/terraform/cloudsql && terraform output -raw fivetran_password`)
7. **Database:** `shopstream`
8. **Connection method:** Direct Connection
9. **Update method:** Query-Based
10. Click **Save & Test** — wait for the green checkmark
11. Click the **Schema** tab → expand `public` → check: `finance_invoices`, `finance_payments`, `customers`
12. Set **Sync Frequency:** `Every 6 hours` (or **Manual** for demo control)
13. Click **Save & Continue**

> **Cloud SQL Studio:** Browse data at https://console.cloud.google.com/sql/instances/shopstream-postgres/studio?project=fivetran-493702

---

## Step 5: Add Fivetran Transformations (dbt models)

Fivetran Transformations run dbt SQL inside Snowflake — no Airflow, no external compute.

1. Fivetran sidebar → **Transformations** → **Add Transformation** → select **dbt Core**
2. Click **New Model** for each of the 3 models below

### Model 1: `finance_invoice_aging`

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
FROM finance_raw.finance_invoices
```

### Model 2: `finance_customer_segments`

```sql
WITH payment_stats AS (
  SELECT
    i.customer_id,
    COUNT(i.invoice_id)                                 AS total_invoices,
    SUM(CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END) AS paid_invoices,
    SUM(p.amount_paid)                                  AS total_paid,
    MAX(p.payment_date)                                 AS last_payment_date
  FROM finance_raw.finance_invoices i
  LEFT JOIN finance_raw.finance_payments p ON i.invoice_id = p.invoice_id
  GROUP BY i.customer_id
)
SELECT
  customer_id,
  total_invoices,
  paid_invoices,
  total_paid,
  last_payment_date,
  CASE
    WHEN paid_invoices::float / NULLIF(total_invoices, 0) >= 0.9
         AND last_payment_date >= CURRENT_DATE - 90 THEN 'champion'
    WHEN paid_invoices::float / NULLIF(total_invoices, 0) >= 0.5 THEN 'at_risk'
    ELSE 'churned'
  END AS segment
FROM payment_stats
```

### Model 3: `finance_monthly_summary`

```sql
SELECT
  DATE_TRUNC('month', payment_date)   AS month,
  SUM(amount_paid)                    AS total_revenue,
  SUM(amount_paid) * 12               AS arr,
  COUNT(DISTINCT invoice_id)          AS paid_invoices,
  SUM(CASE WHEN method = 'card'   THEN amount_paid ELSE 0 END) AS card_revenue,
  SUM(CASE WHEN method = 'bank'   THEN amount_paid ELSE 0 END) AS bank_revenue,
  SUM(CASE WHEN method = 'paypal' THEN amount_paid ELSE 0 END) AS paypal_revenue
FROM finance_raw.finance_payments
GROUP BY 1
ORDER BY 1
```

3. For each model, enable **Run after connector sync** → set **Connector** to your Postgres connector
4. Click **Save**

---

## Step 6: Configure Reverse ETL → HubSpot

1. Fivetran sidebar → **Reverse ETL** → **Add Sync**
2. **Source:** Snowflake → database `SHOPSTREAM` → schema `transformed` → table `customer_segments`
3. **Destination:** HubSpot → click **Authorize** → log in (portal ID: `245945263`)
4. **Object:** Contacts
5. **Unique identifier:** map `customer_id` → HubSpot Contact property `external_id`
6. **Field mappings:**

   | Snowflake column | HubSpot property |
   |-----------------|-----------------|
   | `segment` | `revenue_segment` (custom — create in HubSpot Settings → Properties) |
   | `total_paid` | `total_revenue` (custom, type: Number) |
   | `last_payment_date` | `last_payment_date` (custom, type: Date) |

7. **Sync frequency:** After every transformation run
8. Click **Save & Run**

---

## Step 7: Connect Snowflake to FastAPI (live charts)

Add Snowflake credentials to `.env`:

```
SNOWFLAKE_ACCOUNT=KKGCKAP-CD56063
SNOWFLAKE_USER=KENNETHFOO24
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=SHOPSTREAM
SNOWFLAKE_SCHEMA=transformed
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
HUBSPOT_PORTAL_ID=245945263
```

Rebuild FastAPI:

```bash
docker compose --profile core build fastapi && docker compose --profile core up -d fastapi
```

The BI modal in the UI will now show live Snowflake data instead of the simulated fallback.

---

## Step 8: Trigger first sync and verify

```bash
# Fivetran dashboard → click your Postgres connector → click "Sync Now"
# Wait for sync + transformations to complete (~2-5 min)

# Verify in Snowflake:
SELECT * FROM SHOPSTREAM.transformed.finance_monthly_summary LIMIT 5;
SELECT * FROM SHOPSTREAM.transformed.customer_segments LIMIT 5;
SELECT * FROM SHOPSTREAM.transformed.finance_invoice_aging LIMIT 5;
```

Open the UI at http://localhost:3000 → **Fivetran Finance** tab → click the **Snowflake Clean** node → the BI modal should show live data (no SIMULATED badge).

---

## Demo Reset

To reset local services (keeps Cloud SQL data intact — it's persistent):

```bash
make down   # truncates local finance tables, resets Kafka topic, stops Docker
make setup  # rebuilds everything, re-seeds local Postgres, skips Cloud SQL (already has data)
```

To fully re-seed Cloud SQL:
```bash
HOST=$(cd infra/terraform/cloudsql && terraform output -raw host)
psql "host=$HOST port=5432 dbname=shopstream user=admin password=admin sslmode=require" \
  -c "TRUNCATE finance_payments, finance_invoices, customers RESTART IDENTITY CASCADE;"
# Then re-run make setup — it will re-seed since row count is 0
```
