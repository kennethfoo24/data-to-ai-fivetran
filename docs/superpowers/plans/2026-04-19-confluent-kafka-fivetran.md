# Confluent Cloud Kafka → Fivetran Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Confluent Cloud Kafka topic (`shopstream.finance`) as a Fivetran data source, with a standalone Python producer that generates synthetic finance events, and update the FinanceGraph UI node to link to the live Confluent Cloud cluster.

**Architecture:** A standalone script (`kafka/produce_finance_events.py`) reads Confluent Cloud credentials from `.env` and produces 100 synthetic finance events (JSON) to `shopstream.finance`. Fivetran's native Confluent Cloud connector picks up those events and syncs them to Snowflake. The local Docker Kafka is untouched.

**Tech Stack:** Python 3, `confluent-kafka`, `python-dotenv`, Confluent Cloud (free tier), Fivetran Confluent Cloud connector, Next.js/React (FinanceGraph node URL update)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `kafka/produce_finance_events.py` | Produces 100 synthetic finance events to Confluent Cloud |
| Create | `kafka/requirements.txt` | Pin `confluent-kafka` and `python-dotenv` |
| Modify | `.env.example` | Add 3 Confluent env vars |
| Modify | `.env` | Add real Confluent credentials (never committed) |
| Modify | `ui/components/FinanceGraph.tsx` | Update Kafka node URL to Confluent Cloud dashboard |

---

## Task 1: Add Confluent env vars to `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append Confluent vars to `.env.example`**

Open `.env.example` and add at the end:

```bash
# Confluent Cloud (Kafka → Fivetran)
CONFLUENT_BOOTSTRAP_SERVERS=<cluster-id>.confluent.cloud:9092
CONFLUENT_API_KEY=<your-api-key>
CONFLUENT_API_SECRET=<your-api-secret>
```

- [ ] **Step 2: Add real values to `.env`**

Open `.env` (never committed) and add the same three vars with your actual Confluent Cloud values. You get these from: Confluent Cloud → your cluster → API Keys → Create key (scope: this cluster).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add Confluent Cloud env vars to .env.example"
```

---

## Task 2: Create `kafka/requirements.txt`

**Files:**
- Create: `kafka/requirements.txt`

- [ ] **Step 1: Create the requirements file**

```
confluent-kafka==2.4.0
python-dotenv==1.0.1
```

- [ ] **Step 2: Install dependencies**

```bash
pip install -r kafka/requirements.txt
```

Expected output ends with: `Successfully installed confluent-kafka-2.4.0 python-dotenv-1.0.1` (or "already satisfied")

- [ ] **Step 3: Commit**

```bash
git add kafka/requirements.txt
git commit -m "chore: add kafka producer requirements"
```

---

## Task 3: Write the finance events producer

**Files:**
- Create: `kafka/produce_finance_events.py`

- [ ] **Step 1: Create the producer script**

```python
"""
Produce 100 synthetic finance events to Confluent Cloud topic: shopstream.finance

Usage:
    pip install -r kafka/requirements.txt
    python kafka/produce_finance_events.py

Required env vars (set in .env):
    CONFLUENT_BOOTSTRAP_SERVERS
    CONFLUENT_API_KEY
    CONFLUENT_API_SECRET
"""
import json
import os
import random
import uuid
from datetime import datetime, timezone

from confluent_kafka import Producer
from dotenv import load_dotenv

load_dotenv()

TOPIC = "shopstream.finance"
EVENT_COUNT = 100
EVENT_TYPES = ["payment_received", "invoice_created", "invoice_overdue"]

BOOTSTRAP = os.environ["CONFLUENT_BOOTSTRAP_SERVERS"]
API_KEY    = os.environ["CONFLUENT_API_KEY"]
API_SECRET = os.environ["CONFLUENT_API_SECRET"]

producer = Producer({
    "bootstrap.servers": BOOTSTRAP,
    "security.protocol": "SASL_SSL",
    "sasl.mechanism":    "PLAIN",
    "sasl.username":     API_KEY,
    "sasl.password":     API_SECRET,
})


def delivery_report(err, msg):
    if err:
        print(f"Delivery failed for {msg.key()}: {err}")


def make_event() -> dict:
    return {
        "event_id":   str(uuid.uuid4()),
        "customer_id": random.randint(1, 2000),
        "event_type":  random.choice(EVENT_TYPES),
        "amount":      round(random.uniform(10.0, 2000.0), 2),
        "timestamp":   datetime.now(timezone.utc).isoformat(),
    }


def main():
    for _ in range(EVENT_COUNT):
        event = make_event()
        producer.produce(
            TOPIC,
            key=str(event["customer_id"]),
            value=json.dumps(event).encode("utf-8"),
            on_delivery=delivery_report,
        )
        producer.poll(0)

    producer.flush()
    print(f"Produced {EVENT_COUNT} events to {TOPIC}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the producer**

```bash
python kafka/produce_finance_events.py
```

Expected output:
```
Produced 100 events to shopstream.finance
```

If you see `CONFLUENT_BOOTSTRAP_SERVERS` KeyError: your `.env` values are missing — check Task 1 Step 2.

If you see a delivery failure about authentication: double-check your API key/secret in `.env` and that the key has access to the cluster (not just Schema Registry).

- [ ] **Step 3: Verify in Confluent Cloud UI**

In Confluent Cloud → your cluster → Topics → `shopstream.finance` → Messages, you should see 100 messages with JSON payloads like `{"event_id": "...", "customer_id": 1234, "event_type": "payment_received", "amount": 149.99, "timestamp": "..."}`.

- [ ] **Step 4: Commit**

```bash
git add kafka/produce_finance_events.py
git commit -m "feat: add Confluent Cloud finance events producer"
```

---

## Task 4: Set up Fivetran Confluent Cloud connector (manual UI steps)

**Files:** None — this is a Fivetran UI configuration task.

- [ ] **Step 1: Add connector in Fivetran**

In Fivetran dashboard → Connectors → Add connector → search "Confluent" → select **Confluent** (not generic Kafka).

- [ ] **Step 2: Configure the connector**

Fill in:
- **Bootstrap server:** value of `CONFLUENT_BOOTSTRAP_SERVERS` (e.g. `abc-12345.us-east-1.aws.confluent.cloud:9092`)
- **API key:** value of `CONFLUENT_API_KEY`
- **API secret:** value of `CONFLUENT_API_SECRET`
- **Topic:** `shopstream.finance`
- **Destination schema:** `SHOPSTREAM_FINANCE_FINANCE` (matches existing schema)
- **Destination table:** `FINANCE_EVENTS`
- **Sync key / primary key:** `event_id`

- [ ] **Step 3: Test & save the connector**

Click "Test connection" — should show green. Save. Fivetran will run an initial sync.

- [ ] **Step 4: Verify in Snowflake**

In Snowflake: `SELECT * FROM PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE.FINANCE_EVENTS LIMIT 10;`

Expected: 100 rows with columns `EVENT_ID`, `CUSTOMER_ID`, `EVENT_TYPE`, `AMOUNT`, `TIMESTAMP`.

---

## Task 5: Update FinanceGraph Kafka node URL

**Files:**
- Modify: `ui/components/FinanceGraph.tsx:246`

- [ ] **Step 1: Get your Confluent Cloud cluster URL**

In Confluent Cloud → your cluster → Cluster overview. The URL in your browser will look like:
`https://confluent.cloud/environments/<env-id>/clusters/<cluster-id>/overview`

Copy that URL.

- [ ] **Step 2: Update the Kafka node in FinanceGraph.tsx**

Find this line in `ui/components/FinanceGraph.tsx` (around line 246):

```tsx
{ id: 'kafka-source',type: 'pipeline', position: { x: COL.src,    y: ROW.bot }, data: { label: 'Kafka',              sublabel: 'shopstream.finance',              logoKey: 'kafka',     url: 'http://localhost:8080', status: 'active', tag: 'streaming',    category: 'source',      animDelay: 1 } },
```

Replace `url: 'http://localhost:8080'` with your Confluent Cloud cluster URL:

```tsx
{ id: 'kafka-source',type: 'pipeline', position: { x: COL.src,    y: ROW.bot }, data: { label: 'Kafka',              sublabel: 'shopstream.finance',              logoKey: 'kafka',     url: 'https://confluent.cloud/environments/<env-id>/clusters/<cluster-id>/overview', status: 'active', tag: 'confluent cloud',    category: 'source',      animDelay: 1 } },
```

Also update `tag: 'streaming'` → `tag: 'confluent cloud'` to reflect the real provider.

- [ ] **Step 3: Verify the UI change**

```bash
npm --prefix ui run dev -- -p 3001
```

Open `http://localhost:3001`, navigate to Finance tab, click the Kafka node — it should open the Confluent Cloud cluster in a new tab.

- [ ] **Step 4: Commit**

```bash
git add ui/components/FinanceGraph.tsx
git commit -m "feat: update Kafka node to link to Confluent Cloud cluster"
```

---

## Task 6: Update CLAUDE.md with Phase 7 extension notes

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Confluent Cloud notes to CLAUDE.md Phase 7 section**

In `CLAUDE.md`, under the Phase 7 section, append:

```markdown
### Confluent Cloud Kafka connector (2026-04-19)
- Topic: `shopstream.finance` — finance/payment events (100 events per producer run)
- Producer: `kafka/produce_finance_events.py` — reads creds from `.env`, uses `confluent-kafka` + SASL/SSL
- Fivetran connector type: **Confluent** (native, not generic Kafka) — syncs to `FINANCE_EVENTS` table
- Env vars: `CONFLUENT_BOOTSTRAP_SERVERS`, `CONFLUENT_API_KEY`, `CONFLUENT_API_SECRET`
- FinanceGraph Kafka node URL updated to Confluent Cloud cluster dashboard
- Local Docker Kafka (`confluentinc/cp-kafka`) is untouched — still serves `shopstream.clickstream`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Confluent Cloud Kafka connector in CLAUDE.md"
```
