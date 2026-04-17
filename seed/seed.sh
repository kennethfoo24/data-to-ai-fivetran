#!/bin/bash
set -e

# Load .env from repo root so POSTGRES_USER etc. are available when run directly
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "${SCRIPT_DIR}/.env" ] && export $(grep -v '^#' "${SCRIPT_DIR}/.env" | xargs)
PGUSER=${POSTGRES_USER:-admin}
PGDB=${POSTGRES_DB:-shopstream}

echo "==> [1/4] Generating seed CSVs..."
python3 seed/generate_data.py

echo "==> [2/4] Loading customers + inventory into Postgres..."
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE customers RESTART IDENTITY CASCADE;"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "COPY customers(customer_id,name,email,city,country,signup_date,age,loyalty_tier) FROM '/seed/customers.csv' CSV HEADER"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "SELECT setval(pg_get_serial_sequence('customers','customer_id'), MAX(customer_id)) FROM customers;"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE inventory;"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" -c "
  CREATE TEMP TABLE products_import(product_id int, name text, category text, price numeric, cost_price numeric, stock_qty int);
  COPY products_import FROM '/seed/products.csv' CSV HEADER;
  INSERT INTO inventory(product_id, stock_qty) SELECT product_id, stock_qty FROM products_import;
"

echo "==> [2b/4] Creating + loading finance tables..."
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" -c "
  CREATE TABLE IF NOT EXISTS finance_invoices (
    invoice_id  SERIAL PRIMARY KEY,
    customer_id INT,
    amount      NUMERIC(10,2),
    status      VARCHAR(20),
    issue_date  DATE,
    due_date    DATE
  );
  CREATE TABLE IF NOT EXISTS finance_payments (
    payment_id   SERIAL PRIMARY KEY,
    invoice_id   INT,
    amount_paid  NUMERIC(10,2),
    payment_date DATE,
    method       VARCHAR(20)
  );
"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE finance_payments, finance_invoices RESTART IDENTITY CASCADE;"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "COPY finance_invoices(invoice_id,customer_id,amount,status,issue_date,due_date) FROM '/seed/finance_invoices.csv' CSV HEADER"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "COPY finance_payments(payment_id,invoice_id,amount_paid,payment_date,method) FROM '/seed/finance_payments.csv' CSV HEADER"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "SELECT 'finance_invoices' AS tbl, COUNT(*) FROM finance_invoices UNION ALL SELECT 'finance_payments', COUNT(*) FROM finance_payments;"

echo "==> [3/4] Waiting for Airflow to be ready..."
until curl -s http://localhost:8082/health | grep -q "healthy"; do
  echo "   Airflow not ready yet, retrying in 5s..."
  sleep 5
done

echo "==> [4/4] Triggering Airflow DAGs..."
until curl -s http://localhost:8082/health | grep -q '"status": "healthy"'; do
  echo "   Airflow not ready, retrying in 5s..."
  sleep 5
done

# Unpause DAGs first — new Airflow installs start all DAGs paused
curl -s -X PATCH http://localhost:8082/api/v1/dags/ingest_batch \
  -H "Content-Type: application/json" \
  -u "admin:admin" \
  -d '{"is_paused": false}' > /dev/null && echo "   ingest_batch unpaused ✓"
curl -s -X PATCH http://localhost:8082/api/v1/dags/transform \
  -H "Content-Type: application/json" \
  -u "admin:admin" \
  -d '{"is_paused": false}' > /dev/null && echo "   transform unpaused ✓"

# Trigger ingest_batch and capture the run_id
INGEST_RUN=$(curl -s -X POST http://localhost:8082/api/v1/dags/ingest_batch/dagRuns \
  -H "Content-Type: application/json" \
  -u "admin:admin" \
  -d '{"conf": {}}')
echo "$INGEST_RUN" | grep -q "run_id" && echo "   ingest_batch triggered ✓" || { echo "   ingest_batch trigger failed"; echo "$INGEST_RUN"; exit 1; }
INGEST_RUN_ID=$(echo "$INGEST_RUN" | python3 -c "import sys,json; print(json.load(sys.stdin)['dag_run_id'])")

# Wait for ingest_batch to complete (up to 10 min)
echo "   Waiting for ingest_batch to complete..."
WAIT=0
while [ $WAIT -lt 600 ]; do
  STATE=$(curl -s http://localhost:8082/api/v1/dags/ingest_batch/dagRuns/"$INGEST_RUN_ID" \
    -u "admin:admin" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state','unknown'))" 2>/dev/null)
  if [ "$STATE" = "success" ]; then
    echo "   ingest_batch complete ✓"
    break
  elif [ "$STATE" = "failed" ]; then
    echo "   ERROR: ingest_batch failed. Check Airflow at http://localhost:8082"
    exit 1
  fi
  printf "   [%ds] state=%s, waiting...\n" "$WAIT" "$STATE"
  sleep 15
  WAIT=$((WAIT + 15))
done
if [ $WAIT -ge 600 ]; then
  echo "   WARNING: ingest_batch did not complete within 10 min — triggering transform anyway"
fi

# Trigger transform
curl -s -X POST http://localhost:8082/api/v1/dags/transform/dagRuns \
  -H "Content-Type: application/json" \
  -u "admin:admin" \
  -d '{"conf": {}}' | grep -q "run_id" && echo "   transform triggered ✓" || echo "   transform trigger failed"

echo "   transform is running — Silver/Gold tables will be ready in ~2-3 min."

echo ""
echo "ShopStream seed complete."
echo "  Postgres:  http://localhost:5432"
echo "  Kafka UI:  http://localhost:8080"
echo "  Spark UI:  http://localhost:4040"
echo "  Airflow:   http://localhost:8082  (admin / admin)"
echo "  MLflow:    http://localhost:5000"
echo "  FastAPI:   http://localhost:8001/docs"
echo "  UI:        http://localhost:3000"
