# Fivetran Finance — Step-by-Step Setup Guide

This guide walks through configuring Fivetran to sync ShopStream's finance data (Postgres + Kafka) to Snowflake, run dbt transformations, and push customer segments to HubSpot via Reverse ETL.

**Before you start:** You need a Fivetran account (free trial at fivetran.com), a Snowflake account, and a HubSpot account (free tier works).

---

## Step 1: Run make setup

```bash
make setup
```

This starts all services, seeds finance data into Postgres, publishes 500 events to `shopstream.finance` Kafka topic, starts ngrok tunnels, and prints a formatted copy-paste block:

```
╔══════════════════════════════════════════════════════════════════════╗
║   Fivetran Finance — Connection Details (copy-paste these)           ║
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
╚══════════════════════════════════════════════════════════════════════╝
```

Keep this terminal open — you'll copy values from it in the steps below.

> **ngrok required:** If you don't have ngrok installed: `brew install ngrok/ngrok/ngrok` (Mac) or `snap install ngrok` (Linux). Get a free auth token at https://dashboard.ngrok.com/get-started/your-authtoken and add `NGROK_AUTHTOKEN=<token>` to your `.env` file, then re-run `make setup`.

---

## Step 2: Create Fivetran account

1. Go to [fivetran.com](https://fivetran.com) → click **Start Free Trial**
2. Sign up with your email address
3. On the dashboard, click **Add Connector**

---

## Step 3: Configure Postgres source connector

Use the values from the **POSTGRES SOURCE CONNECTOR** block printed by `make setup`.

1. In the Fivetran dashboard → click **Add Connector** → search for **PostgreSQL** → select it
2. **Destination schema prefix:** type `finance_raw`
3. **Host:** paste the ngrok host (e.g. `0.tcp.ngrok.io`)
4. **Port:** paste the ngrok port (e.g. `12345`)
5. **User:** `admin`
6. **Password:** `admin`
7. **Database:** `shopstream`
8. Click **Save & Test** — wait for the green checkmark
9. Click the **Schema** tab → expand `shopstream` → check the boxes for: `finance_invoices`, `finance_payments`, `customers`
10. Set **Sync Frequency:** `Every 6 hours` (or **Manual** for demo control)
11. Click **Save & Continue**

---

## Step 4: Configure Kafka source connector

Use the values from the **KAFKA SOURCE CONNECTOR** block printed by `make setup`.

1. Click **Add Connector** → search **Apache Kafka** → select it
2. **Bootstrap servers:** paste the ngrok bootstrap address (e.g. `0.tcp.ngrok.io:56789`)
3. **Security protocol:** select `PLAINTEXT`
4. **Topics:** type `shopstream.finance`
5. **Consumer group:** type `fivetran-finance`
6. Click **Save & Test** — wait for green checkmark
7. **Destination schema prefix:** type `finance_kafka_raw`
8. Click **Save & Continue**

---

## Step 5: Configure Snowflake destination

1. In the Fivetran sidebar → **Destinations** → **Add Destination**
2. Select **Snowflake**
3. Fill in your Snowflake credentials:
   - **Account:** your Snowflake account identifier (e.g. `abc12345.us-east-1`)
   - **Database:** `SHOPSTREAM`
   - **Warehouse:** `COMPUTE_WH`
   - **User:** your Snowflake username
   - **Password:** your Snowflake password
   - **Role:** `ACCOUNTADMIN` (or a role with CREATE SCHEMA privileges)
4. Click **Save & Test** — wait for the green checkmark

---

## Step 6: Add Fivetran Transformations (dbt models)

Fivetran Transformations run dbt SQL inside Snowflake — no Airflow, no external compute. They trigger automatically after every connector sync.

1. In Fivetran sidebar → **Transformations** → **Add Transformation**
2. Select **dbt Core**
3. Click **New Model** for each of the 3 models below

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
FROM raw.finance_invoices
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
FROM raw.finance_payments
GROUP BY 1
ORDER BY 1
```

4. For each model, enable **Run after connector sync** and set **Connector:** to your Postgres connector
5. Click **Save** — Fivetran will now run all 3 transforms automatically after every sync

---

## Step 7: Configure Reverse ETL → HubSpot

1. In Fivetran sidebar → **Reverse ETL** → **Add Sync**
2. **Source:** Snowflake → database `SHOPSTREAM` → schema `transformed` → table `customer_segments`
3. **Destination:** HubSpot
   - Click **Add Destination** → search HubSpot → click **Authorize** and log in with your HubSpot account
4. **Object:** Contacts
5. **Unique identifier:** map `customer_id` → HubSpot Contact property `external_id`
6. **Field mappings:**

   | Snowflake column | HubSpot property |
   |-----------------|-----------------|
   | `segment` | `revenue_segment` (custom property — create it in HubSpot if it doesn't exist) |
   | `total_paid` | `total_revenue` (custom property) |
   | `last_payment_date` | `last_payment_date` (custom property) |

7. **Sync frequency:** After every transformation run
8. Click **Save & Run**

> **To create custom properties in HubSpot:** Go to Settings → Properties → Create property. Set type to `Single-line text` for segment, `Number` for total_revenue, `Date` for last_payment_date.

---

## Step 8: Connect Snowflake to FastAPI (live charts)

Add your Snowflake credentials to `.env`:

```
SNOWFLAKE_ACCOUNT=abc12345.us-east-1
SNOWFLAKE_USER=your_user
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=SHOPSTREAM
SNOWFLAKE_SCHEMA=transformed
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
HUBSPOT_PORTAL_ID=your_portal_id
```

Rebuild FastAPI to pick up the new env vars:

```bash
docker compose --profile core build fastapi && docker compose --profile core up -d fastapi
```

The BI modal in the UI will now show live Snowflake data instead of the simulated fallback.

---

## Step 9: Trigger first sync and verify

```bash
# Data is already seeded — just trigger the sync in Fivetran
# Go to Fivetran dashboard → click your Postgres connector → click "Sync Now"
# Wait for sync + transformations to complete (~2-5 min)

# Verify in Snowflake (Snowflake web UI or SnowSQL):
SELECT * FROM SHOPSTREAM.transformed.finance_monthly_summary LIMIT 5;
SELECT * FROM SHOPSTREAM.transformed.customer_segments LIMIT 5;
SELECT * FROM SHOPSTREAM.transformed.invoice_aging LIMIT 5;
```

Open the UI at http://localhost:3000 → click **Fivetran Finance** tab → click the **Snowflake Clean** node → the BI modal should show live data (no SIMULATED badge).

---

## Demo Reset

To tear down and restart from scratch:

```bash
make down   # kills ngrok, truncates finance tables, resets Kafka topic, stops Docker
make setup  # rebuilds everything, re-seeds, prints new ngrok URLs
```
