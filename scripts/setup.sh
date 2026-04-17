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
python3 seed/produce_finance_events.py && echo "✓ Finance events published." || echo "  (skipped — Kafka not reachable)"

# 9. ngrok tunnels (optional — for Fivetran demo)
echo ""
[ -f .env ] && export $(grep -v '^#' .env | xargs) 2>/dev/null || true
if ! command -v ngrok &> /dev/null; then
  echo "  (skipped) ngrok not found. Install to auto-expose for Fivetran:"
  echo "    Mac:   brew install ngrok/ngrok/ngrok"
  echo "    Linux: snap install ngrok"
  echo "  Then add NGROK_AUTHTOKEN=<token> to .env and re-run make setup."
elif [ -z "${NGROK_AUTHTOKEN:-}" ]; then
  echo "  (skipped) NGROK_AUTHTOKEN not set in .env"
  echo "  Get a free token at https://dashboard.ngrok.com/get-started/your-authtoken"
else
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" --log=false 2>/dev/null || true
  pkill -f ngrok 2>/dev/null || true
  sleep 1

  cat > /tmp/ngrok-shopstream.yml << NGROK_EOF
version: "2"
authtoken: ${NGROK_AUTHTOKEN}
tunnels:
  postgres:
    proto: tcp
    addr: 5432
  kafka:
    proto: tcp
    addr: 9092
NGROK_EOF

  ngrok start --all --config /tmp/ngrok-shopstream.yml --log /tmp/ngrok.log &
  sleep 4

  TUNNELS_JSON=$(curl -sf http://localhost:4040/api/tunnels 2>/dev/null || echo '{}')
  PG_URL=$(echo "$TUNNELS_JSON" | python3 -c "
import sys, json
tunnels = json.load(sys.stdin).get('tunnels', [])
for t in tunnels:
    if '5432' in t.get('config', {}).get('addr', ''):
        addr = t['public_url'].replace('tcp://', '')
        host, port = addr.rsplit(':', 1)
        print(f'{host} {port}')
        break
" 2>/dev/null || echo "")
  KAFKA_URL=$(echo "$TUNNELS_JSON" | python3 -c "
import sys, json
tunnels = json.load(sys.stdin).get('tunnels', [])
for t in tunnels:
    if '9092' in t.get('config', {}).get('addr', ''):
        print(t['public_url'].replace('tcp://', ''))
        break
" 2>/dev/null || echo "")

  PG_HOST=$(echo "$PG_URL" | cut -d' ' -f1)
  PG_PORT=$(echo "$PG_URL" | cut -d' ' -f2)

  if [ -n "$PG_HOST" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    echo "║   Fivetran Finance — Connection Details (copy-paste these)           ║"
    echo "╠══════════════════════════════════════════════════════════════════════╣"
    echo "║                                                                      ║"
    echo "║   POSTGRES SOURCE CONNECTOR                                          ║"
    printf "║   Host:      %-55s║\n" "$PG_HOST"
    printf "║   Port:      %-55s║\n" "$PG_PORT"
    echo "║   Database:  shopstream                                              ║"
    echo "║   User:      admin                                                   ║"
    echo "║   Password:  admin                                                   ║"
    echo "║   Tables:    finance_invoices, finance_payments, customers           ║"
    echo "║                                                                      ║"
    echo "║   KAFKA SOURCE CONNECTOR                                             ║"
    printf "║   Bootstrap: %-55s║\n" "$KAFKA_URL"
    echo "║   Topic:     shopstream.finance                                      ║"
    echo "║   Protocol:  PLAINTEXT                                               ║"
    echo "║                                                                      ║"
    echo "║   HUBSPOT REVERSE ETL — FIELD MAPPINGS                               ║"
    echo "║   Source:    SHOPSTREAM.transformed.customer_segments                ║"
    echo "║   Unique ID: customer_id → Contact External ID                       ║"
    echo "║   segment      → revenue_segment (custom property)                   ║"
    echo "║   total_paid   → total_revenue   (custom property)                   ║"
    echo "║                                                                      ║"
    echo "║   Fivetran:  https://fivetran.com/dashboard                          ║"
    printf "║   HubSpot:   https://app.hubspot.com/contacts/%-24s║\n" "${HUBSPOT_PORTAL_ID:-<your-portal-id>}"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
  else
    echo "  ⚠ ngrok started but could not read tunnel URLs — check http://localhost:4040"
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
