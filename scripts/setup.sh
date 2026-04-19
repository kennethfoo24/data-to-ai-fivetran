#!/usr/bin/env bash
# DataFabric one-shot setup
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   DataFabric — ShopStream Setup          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 1. Copy .env if missing
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created .env from .env.example"
  echo "  Edit .env to change passwords before deploying to a server."
else
  echo "✓ .env already exists."
fi

[ -f .env ] && export $(grep -v '^#' .env | xargs) 2>/dev/null || true

# Generate AIRFLOW_FERNET_KEY if it's still the placeholder
if grep -q "^AIRFLOW_FERNET_KEY=GENERATE_ME" .env; then
  FERNET_KEY=$(python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())")
  sed -i.bak "s|^AIRFLOW_FERNET_KEY=.*|AIRFLOW_FERNET_KEY=${FERNET_KEY}|" .env && rm -f .env.bak
  echo "✓ Generated AIRFLOW_FERNET_KEY."
fi

# Generate AIRFLOW_SECRET_KEY if it's still the placeholder
if grep -q "^AIRFLOW_SECRET_KEY=CHANGE_ME" .env; then
  SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
  sed -i.bak "s|^AIRFLOW_SECRET_KEY=.*|AIRFLOW_SECRET_KEY=${SECRET_KEY}|" .env && rm -f .env.bak
  echo "✓ Generated AIRFLOW_SECRET_KEY."
fi

# 2. Generate seed CSVs
echo ""
echo "→ Generating seed data..."
python3 seed/generate_data.py

# 3. Build Docker images
echo ""
echo "→ Building Docker images (first run takes ~5 min)..."
docker compose --profile core build

# 4. Start services
echo ""
echo "→ Starting services..."
docker compose --profile core up -d

# 5. Wait for Postgres
echo ""
echo "→ Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U admin -q 2>/dev/null; do
  printf '.'
  sleep 2
done
echo " ready."

# 6. Wait for Airflow
echo "→ Waiting for Airflow (up to 90s on first boot)..."
WAIT=0
until curl -sf http://localhost:8082/health 2>/dev/null | grep -q "healthy"; do
  if [ $WAIT -ge 90 ]; then
    echo ""
    echo "ERROR: Airflow did not become healthy within 90s."
    echo "Run 'make logs' to check what went wrong."
    exit 1
  fi
  printf '.'
  sleep 5
  WAIT=$((WAIT + 5))
done
echo " ready."

# 7. Load seed data
echo ""
echo "→ Loading seed data..."
bash seed/seed.sh

# 8. Produce Kafka finance events
echo ""
echo "→ Producing Kafka finance events..."
python3 kafka/produce_finance_events.py && echo "✓ Finance events published." || echo "  (skipped — Confluent Cloud not configured)"

# 9. Cloud SQL — validate or provision
echo ""
echo "→ Checking Cloud SQL (Fivetran Finance demo database)..."

TERRAFORM_DIR="infra/terraform/cloudsql"

if ! command -v terraform &> /dev/null; then
  echo "  ⚠ terraform not found — skipping Cloud SQL step."
  echo "    Install: brew tap hashicorp/tap && brew install hashicorp/tap/terraform"
elif ! command -v gcloud &> /dev/null; then
  echo "  ⚠ gcloud not found — skipping Cloud SQL step."
  echo "    Install: brew install --cask google-cloud-sdk && gcloud auth application-default login"
else
  # Check if the instance already exists in GCP
  CLOUDSQL_EXISTS=$(gcloud sql instances list \
    --project="${GCP_PROJECT_ID}" \
    --filter="name=shopstream-postgres" \
    --format="value(name)" 2>/dev/null || echo "")

  if [ -n "$CLOUDSQL_EXISTS" ]; then
    echo "  ✓ Cloud SQL instance shopstream-postgres already exists."
    CLOUDSQL_IP=$(gcloud sql instances describe shopstream-postgres \
      --project="${GCP_PROJECT_ID}" \
      --format="value(ipAddresses[0].ipAddress)" 2>/dev/null || echo "")
  else
    echo "  → Cloud SQL instance not found — provisioning with Terraform..."
    (
      cd "$TERRAFORM_DIR"
      export TF_VAR_project_id="${GCP_PROJECT_ID}"
      export TF_VAR_admin_password="${CLOUDSQL_ADMIN_PASSWORD:-admin}"
      terraform init -input=false -no-color 2>/dev/null
      terraform apply -auto-approve -input=false -no-color
    )
    CLOUDSQL_IP=$(cd "$TERRAFORM_DIR" && terraform output -raw host 2>/dev/null || echo "")
    echo "  ✓ Cloud SQL provisioned."
  fi

  if [ -n "$CLOUDSQL_IP" ]; then
    # Check if tables already have data — skip seed if so
    ROW_COUNT=$(psql "host=${CLOUDSQL_IP} port=5432 dbname=shopstream user=admin password=${CLOUDSQL_ADMIN_PASSWORD:-admin} sslmode=require" \
      -tAc "SELECT COUNT(*) FROM customers;" 2>/dev/null || echo "0")

    if [ "${ROW_COUNT}" = "0" ] || [ -z "${ROW_COUNT}" ]; then
      echo "  → Seeding Cloud SQL schema and data..."
      psql "host=${CLOUDSQL_IP} port=5432 dbname=shopstream user=admin password=${CLOUDSQL_ADMIN_PASSWORD:-admin} sslmode=require" \
        -f "${TERRAFORM_DIR}/seed.sql" -q
      psql "host=${CLOUDSQL_IP} port=5432 dbname=shopstream user=admin password=${CLOUDSQL_ADMIN_PASSWORD:-admin} sslmode=require" \
        -c "\COPY finance.\"CUSTOMERS\" FROM 'seed/data/customers.csv' CSV HEADER" -q
      psql "host=${CLOUDSQL_IP} port=5432 dbname=shopstream user=admin password=${CLOUDSQL_ADMIN_PASSWORD:-admin} sslmode=require" \
        -c "\COPY finance.\"FINANCE_INVOICES\" FROM 'seed/data/finance_invoices.csv' CSV HEADER" -q
      psql "host=${CLOUDSQL_IP} port=5432 dbname=shopstream user=admin password=${CLOUDSQL_ADMIN_PASSWORD:-admin} sslmode=require" \
        -c "\COPY finance.\"FINANCE_PAYMENTS\" FROM 'seed/data/finance_payments.csv' CSV HEADER" -q
      echo "  ✓ Cloud SQL seeded."
    else
      echo "  ✓ Cloud SQL already has data (${ROW_COUNT} customers) — skipping seed."
    fi

    FIVETRAN_PASSWORD=$(cd "$TERRAFORM_DIR" && terraform output -raw fivetran_password 2>/dev/null || echo "<run: terraform output -raw fivetran_password>")

    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    echo "║   Fivetran Finance — Connection Details (copy-paste these)           ║"
    echo "╠══════════════════════════════════════════════════════════════════════╣"
    echo "║                                                                      ║"
    echo "║   POSTGRES SOURCE CONNECTOR (Cloud SQL)                              ║"
    printf "║   Host:      %-55s║\n" "${CLOUDSQL_IP}"
    echo "║   Port:      5432                                                    ║"
    echo "║   Database:  shopstream                                              ║"
    echo "║   User:      fivetran                                                ║"
    printf "║   Password:  %-55s║\n" "${FIVETRAN_PASSWORD}"
    echo "║   SSL:       required                                                ║"
    echo "║   Tables:    finance_invoices, finance_payments, customers           ║"
    echo "║                                                                      ║"
    echo "║   KAFKA SOURCE CONNECTOR (local)                                     ║"
    echo "║   Bootstrap: localhost:9092                                          ║"
    echo "║   Topic:     shopstream.finance                                      ║"
    echo "║   Protocol:  PLAINTEXT                                               ║"
    echo "║                                                                      ║"
    echo "║   SNOWFLAKE DESTINATION                                              ║"
    printf "║   Account:   %-55s║\n" "${SNOWFLAKE_ACCOUNT}"
    echo "║   Database:  SHOPSTREAM                                              ║"
    echo "║   Warehouse: COMPUTE_WH                                              ║"
    echo "║   Role:      ACCOUNTADMIN                                            ║"
    echo "║                                                                      ║"
    echo "║   HUBSPOT REVERSE ETL                                                ║"
    echo "║   Portal ID: 245945263                                               ║"
    echo "║   Source:    SHOPSTREAM.transformed.customer_segments                ║"
    echo "║   Unique ID: customer_id → Contact External ID                       ║"
    echo "║   segment      → revenue_segment (custom property)                   ║"
    echo "║   total_paid   → total_revenue   (custom property)                   ║"
    echo "║                                                                      ║"
    echo "║   Fivetran:  https://fivetran.com/dashboard                          ║"
    printf "║   Cloud SQL: https://console.cloud.google.com/sql/instances/shopstream-postgres/studio?project=%-1s ║\n" "${GCP_PROJECT_ID}"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
  fi
fi

# 10. Done
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   DataFabric is running!                                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║   Lineage UI   →  http://localhost:3000                      ║"
echo "║   Airflow      →  http://localhost:8082  (admin / admin)     ║"
echo "║   MLflow       →  http://localhost:5001                      ║"
echo "║   FastAPI docs →  http://localhost:8001/docs                 ║"
echo "║   Kafka UI     →  http://localhost:8080                      ║"
echo "║   Spark UI     →  http://localhost:4040                      ║"
echo "║   pgAdmin      →  http://localhost:5050  (admin@example.com / Admin1234) ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Commands:  make up | make down | make logs | make clean"
