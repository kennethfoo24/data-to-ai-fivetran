#!/usr/bin/env bash
# Demo reset: kill ngrok, truncate finance tables, reset Kafka topic.
# Called by `make down` before stopping Docker. Non-fatal — continues even if steps fail.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && export $(grep -v '^#' .env | xargs) 2>/dev/null || true
PGUSER=${POSTGRES_USER:-admin}
PGDB=${POSTGRES_DB:-shopstream}

echo "→ Stopping ngrok tunnels..."
pkill -f ngrok 2>/dev/null && echo "  ✓ ngrok stopped" || echo "  (ngrok was not running)"

echo "→ Truncating finance tables..."
docker compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE finance_payments, finance_invoices RESTART IDENTITY CASCADE;" \
  2>/dev/null && echo "  ✓ finance tables truncated" \
  || echo "  (skipped — postgres not running)"

echo "→ Resetting Kafka topic shopstream.finance..."
docker compose exec -T kafka \
  kafka-topics.sh --bootstrap-server localhost:9092 \
  --delete --topic shopstream.finance 2>/dev/null || true
docker compose exec -T kafka \
  kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic shopstream.finance \
  --partitions 1 --replication-factor 1 2>/dev/null \
  && echo "  ✓ shopstream.finance reset" \
  || echo "  (skipped — kafka not running)"

echo "✓ Demo state reset complete."
