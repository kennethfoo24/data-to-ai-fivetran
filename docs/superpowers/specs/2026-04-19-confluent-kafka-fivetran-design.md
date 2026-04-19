# Design: Confluent Cloud Kafka → Fivetran Connector

**Date:** 2026-04-19  
**Status:** Approved

## Overview

Add a real Kafka data source (Confluent Cloud) to the Finance lineage, replacing the visually-only local Kafka node. A standalone Python producer script generates synthetic finance events and publishes them to a Confluent Cloud topic. Fivetran's native Confluent Cloud connector syncs those events into Snowflake, making the Kafka → ELT → Snowflake path real end-to-end.

## Architecture & Data Flow

```
kafka/produce_finance_events.py
        │
        │  confluent-kafka (Python), reads creds from .env
        ▼
Confluent Cloud Cluster
  topic: shopstream.finance
        │
        │  Fivetran native Confluent Cloud connector
        ▼
Snowflake Raw (PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE.FINANCE_EVENTS)
        │
        │  existing dbt + Fivetran Transforms
        ▼
Snowflake Clean → Reverse ETL → HubSpot
```

The local Docker Kafka (`confluentinc/cp-kafka:7.6.0`) is untouched — it continues serving `shopstream.clickstream`. This is a separate cloud-hosted topic for finance events only.

## Event Schema

Minimal JSON payload (~200 bytes), well within Confluent Cloud free tier (5GB/month):

```json
{
  "event_id": "uuid4-string",
  "customer_id": 1042,
  "event_type": "payment_received | invoice_created | invoice_overdue",
  "amount": 149.99,
  "timestamp": "2026-04-19T10:23:00Z"
}
```

- **Topic:** `shopstream.finance`
- **Partition key:** `customer_id`
- **Volume:** ~100 events per producer run (~20KB/run, negligible against 5GB limit)

## Components

### `kafka/produce_finance_events.py`
Standalone Python script that:
1. Reads `CONFLUENT_BOOTSTRAP_SERVERS`, `CONFLUENT_API_KEY`, `CONFLUENT_API_SECRET` from `.env`
2. Creates a `confluent-kafka` Producer with SASL/SSL auth
3. Generates 100 synthetic finance events using random `customer_id` (1–2000), random `event_type`, random `amount` (10–2000)
4. Produces all events to `shopstream.finance`, flushes, and exits
5. Prints a summary: `Produced 100 events to shopstream.finance`

### `.env` / `.env.example`
Add three new variables:
```
CONFLUENT_BOOTSTRAP_SERVERS=<cluster>.confluent.cloud:9092
CONFLUENT_API_KEY=<key>
CONFLUENT_API_SECRET=<secret>
```

### Fivetran Connector
- **Type:** Confluent Cloud (native connector, not generic Kafka)
- **Topic:** `shopstream.finance`
- **Destination table:** `PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE.FINANCE_EVENTS`
- **Sync key:** `event_id`
- **Setup:** paste Bootstrap URL + API key/secret in Fivetran UI; auto-discovers topic

### `ui/components/FinanceGraph.tsx`
Update Kafka node `url` from `http://localhost:8080` to the Confluent Cloud cluster dashboard URL so clicking the node opens the real cluster.

## Out of Scope

- No changes to local Docker Kafka or existing clickstream pipeline
- No Airflow DAG — script is run manually (`python kafka/produce_finance_events.py`)
- No new dbt models at this stage (existing transforms can consume `FINANCE_EVENTS` later)
- No schema registry — plain JSON, no Avro

## Setup Steps (manual, one-time)

1. Create free Confluent Cloud account at confluent.io
2. Create a cluster (Basic, free tier)
3. Create topic `shopstream.finance` (1 partition, default retention)
4. Create an API key scoped to the cluster
5. Add creds to `.env`
6. Run `pip install confluent-kafka` then `python kafka/produce_finance_events.py`
7. In Fivetran, add a new Confluent Cloud connector pointing to `shopstream.finance`
8. Trigger initial sync → verify `FINANCE_EVENTS` table in Snowflake
