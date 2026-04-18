#!/bin/bash
set -e

# Usage: CLOUDSQL_HOST=<ip> CLOUDSQL_USER=admin CLOUDSQL_DB=shopstream bash seed/cloudsql_seed.sh
CLOUDSQL_HOST=${CLOUDSQL_HOST:-127.0.0.1}
CLOUDSQL_USER=${CLOUDSQL_USER:-admin}
CLOUDSQL_DB=${CLOUDSQL_DB:-shopstream}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PSQL="psql -h $CLOUDSQL_HOST -U $CLOUDSQL_USER -d $CLOUDSQL_DB"

echo "==> [1/3] Generating seed CSVs..."
python3 "$SCRIPT_DIR/generate_data.py"

echo "==> [2/3] Creating finance schema and tables..."
$PSQL <<SQL
CREATE SCHEMA IF NOT EXISTS finance;

DROP TABLE IF EXISTS finance."FINANCE_PAYMENTS";
DROP TABLE IF EXISTS finance."FINANCE_INVOICES";
DROP TABLE IF EXISTS finance."CUSTOMERS";

CREATE TABLE finance."CUSTOMERS" (
  customer_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  city          TEXT,
  country       TEXT,
  signup_date   DATE,
  age           INTEGER,
  loyalty_tier  TEXT
);

CREATE TABLE finance."FINANCE_INVOICES" (
  invoice_id    INTEGER PRIMARY KEY,
  customer_id   INTEGER REFERENCES finance."CUSTOMERS"(customer_id),
  amount        NUMERIC(10,2) NOT NULL,
  status        TEXT NOT NULL,
  issue_date    DATE,
  due_date      DATE NOT NULL
);

CREATE TABLE finance."FINANCE_PAYMENTS" (
  payment_id    SERIAL PRIMARY KEY,
  invoice_id    INTEGER REFERENCES finance."FINANCE_INVOICES"(invoice_id),
  amount_paid   NUMERIC(10,2) NOT NULL,
  payment_date  DATE NOT NULL,
  method        TEXT NOT NULL
);

GRANT USAGE ON SCHEMA finance TO fivetran;
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO fivetran;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT SELECT ON TABLES TO fivetran;
SQL

echo "==> [3/3] Loading CSVs..."
$PSQL -c "\COPY finance.\"CUSTOMERS\"(customer_id,name,email,city,country,signup_date,age,loyalty_tier) FROM '$SCRIPT_DIR/data/customers.csv' CSV HEADER"
$PSQL -c "\COPY finance.\"FINANCE_INVOICES\"(invoice_id,customer_id,amount,status,issue_date,due_date) FROM '$SCRIPT_DIR/data/finance_invoices.csv' CSV HEADER"
$PSQL -c "\COPY finance.\"FINANCE_PAYMENTS\"(payment_id,invoice_id,amount_paid,payment_date,method) FROM '$SCRIPT_DIR/data/finance_payments.csv' CSV HEADER"

$PSQL -c "SELECT 'CUSTOMERS' AS tbl, COUNT(*) FROM finance.\"CUSTOMERS\" UNION ALL SELECT 'FINANCE_INVOICES', COUNT(*) FROM finance.\"FINANCE_INVOICES\" UNION ALL SELECT 'FINANCE_PAYMENTS', COUNT(*) FROM finance.\"FINANCE_PAYMENTS\";"

echo ""
echo "Cloud SQL seed complete."
echo "  Schema:  finance"
echo "  Tables:  CUSTOMERS, FINANCE_INVOICES, FINANCE_PAYMENTS"
