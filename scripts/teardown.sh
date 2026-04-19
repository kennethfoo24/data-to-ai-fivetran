#!/usr/bin/env bash
# Demo reset: truncate local finance tables, reset Kafka topic.
# Called by `make down` before stopping Docker. Non-fatal — continues even if steps fail.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && export $(grep -v '^#' .env | xargs) 2>/dev/null || true
PGUSER=${POSTGRES_USER:-admin}
PGDB=${POSTGRES_DB:-shopstream}

echo "→ Truncating finance tables..."
docker compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE finance_payments, finance_invoices RESTART IDENTITY CASCADE;" \
  2>/dev/null && echo "  ✓ finance tables truncated" \
  || echo "  (skipped — postgres not running)"

echo "→ Resetting Kafka topic shopstream.finance..."
docker compose exec -T kafka \
  kafka-topics --bootstrap-server localhost:9092 \
  --delete --topic shopstream.finance 2>/dev/null || true
docker compose exec -T kafka \
  kafka-topics --bootstrap-server localhost:9092 \
  --create --topic shopstream.finance \
  --partitions 1 --replication-factor 1 2>/dev/null \
  && echo "  ✓ shopstream.finance reset" \
  || echo "  (skipped — kafka not running)"

echo "✓ Demo state reset complete."
