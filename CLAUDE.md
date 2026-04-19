# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DataFabric** is an end-to-end data & AI portfolio project built around **ShopStream**, a fictional e-commerce platform. It demonstrates a full modern data stack: ingestion → lakehouse → ML training → serving → lineage UI → reverse ETL. The project is delivered in 7 phases; all 7 phases are complete.

## Common Commands

```bash
# One-shot setup (copies .env, builds images, starts services, seeds data)
make setup

# Start/stop services
make up          # start all services (~8GB RAM)
make down

# Build Docker images
make build
docker compose --profile core build

# Seed data
make seed        # regenerate + reload seed data
python3 seed/generate_data.py   # generate CSVs only
bash seed/seed.sh               # load into Postgres + trigger Airflow DAGs

# Infrastructure tests
bash infra/postgres/test_postgres.sh
bash infra/kafka/test_kafka.sh

# View logs
make logs
make ps
```

## Deployment

Single profile: `core` (~8GB RAM, 10 services). Run with `make up`. Iceberg uses a filesystem (hadoop) catalog at `/warehouse`.

## Architecture & Data Flow

```
Postgres/CSV ──► psycopg2 + PySpark (Airflow DAG) ──► Bronze (Iceberg)
Kafka ──────────► Spark Structured Streaming ──► Bronze (Iceberg)
                                                      │
                                              dbt Silver (cleaned)
                                                      │
                                              dbt Gold (features)
                                               ┌──────┴──────┐
                                          Churn Model   Recommender
                                          (PyTorch)     (PyTorch)
                                               └──────┬──────┘
                                                   MLflow
                                                   FastAPI (:8001)
                                                  Next.js UI (:3000)
```

**Medallion lakehouse**: All tables are Apache Iceberg (ACID, time travel, schema evolution).
- **Bronze**: Raw ingested data (no transformations) — customers, orders, products, clickstream
- **Silver**: Cleaned/deduplicated via dbt — orders_clean, customers_clean, clickstream_sessions
- **Gold**: Feature-engineered tables for ML, served via dbt — customer_features, product_interactions

**Orchestration**: Airflow (standalone mode — scheduler + webserver in one container) runs ingestion DAGs, dbt transformations, and ML training jobs.

## Service URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| Next.js UI | http://localhost:3000 | — |
| Airflow | http://localhost:8082 | admin / admin |
| MLflow | http://localhost:5001 | — |
| FastAPI docs | http://localhost:8001/docs | — |
| Kafka UI | http://localhost:8080 | — |
| Spark UI | http://localhost:4040 | — |
| pgAdmin | http://localhost:5050 | admin@example.com / Admin1234 |
| Postgres | localhost:5432 | admin / admin (db: shopstream) |

## Key File Locations

- `docker-compose.yml` — All services (10 services, core profile only)
- `.env.example` — All environment variables; copy to `.env` before first run
- `infra/pgadmin/servers.json` — Pre-registers ShopStream Postgres server in pgAdmin
- `infra/pgadmin/pgpass` — Saves Postgres password so pgAdmin connects without prompting
- `infra/` — Dockerfiles and init scripts for each service
- `infra/postgres/init.sql` — Creates airflow, mlflow DBs/users on first start
- `infra/spark/Dockerfile` — Spark image (Python 3.8); use `pandas<=2.0.3`
- `ingestion/` — PyAirbyte connectors, Airflow DAGs, Spark streaming jobs
- `dbt/` — dbt models (bronze/silver/gold) with Spark adapter
- `ml/` — PyTorch model training (churn prediction, recommender)
- `serving/` — FastAPI app (Phase 4)
- `ui/` — Next.js lineage dashboard (Phase 5)
- `seed/` — Synthetic data generator (2K customers, 200 products, 10K orders)
- `docs/superpowers/specs/` — Architecture spec
- `docs/superpowers/plans/` — Phase implementation plans

## Important Technical Constraints

- **Spark image uses Python 3.8** (`apache/spark:3.5.0` base). Max `pandas==2.0.3`; `pandas>=2.1` is incompatible.
- **Kafka runs KRaft** (no Zookeeper). Topic auto-creation enabled; default topic: `shopstream.clickstream`.
- **Airflow is standalone** — no Celery/Redis. Not suitable for production-scale parallelism.
- Iceberg catalog type switches between profiles: `hadoop` (core filesystem) vs `hive` (full, backed by MinIO).
- The `version` key in `docker-compose.yml` is obsolete (Compose v2) — harmless warning, do not add it back.

## Development Status

All 6 phases complete and verified end-to-end. `make setup` brings up 9 services, seeds 2K customers + 200 products, and triggers the full pipeline.

- **Phase 1** (Infrastructure): Complete
- **Phase 2** (Data Pipeline — ingestion, Spark, dbt): Complete
- **Phase 3** (ML — PyTorch, MLflow): Complete
- **Phase 4** (Serving — FastAPI): Complete
- **Phase 5** (UI — Next.js lineage dashboard): Complete
- **Phase 6** (Iceberg Catalog Explorer): Complete
- **Phase 7** (Fivetran Activations → HubSpot Reverse ETL): Complete

## Phase 2 — Completed (2026-04-08)

All 10 Iceberg tables operational. Full pipeline runs end-to-end via `make seed`.

| File | Purpose |
|------|---------|
| `infra/airflow/Dockerfile` | Java 17, iceberg jar, pyspark, psycopg2; arch-agnostic JAVA_HOME |
| `infra/airflow/entrypoint.sh` | Chowns /warehouse, migrates DB, sets admin/admin password, starts standalone |
| `infra/spark/Dockerfile` | Bundles 4 Kafka connector jars at build time (no runtime `--packages`) |
| `docker-compose.yml` | `user: root` on airflow + spark; basic_auth for Airflow REST API |
| `ingestion/connectors/batch_ingest.py` | psycopg2 → Postgres reads; PySpark + Iceberg hadoop catalog → Bronze |
| `ingestion/dags/ingest_batch.py` | Airflow DAG: triggers `batch_ingest.run_all()` |
| `ingestion/dags/transform.py` | Airflow DAG: `dbt run --select silver` then `dbt run --select gold` |
| `ingestion/streaming/clickstream_job.py` | PySpark Structured Streaming: Kafka → `local.bronze.clickstream`, 30s micro-batches |
| `dbt/dbt_project.yml` | silver+gold as Iceberg tables; no `+database` key (not supported by dbt-spark) |
| `dbt/profiles.yml` | `spark_session` method; iceberg jar + hadoop catalog at `/warehouse` |
| `dbt/macros/generate_schema_name.sql` | Prevents dbt from prefixing schemas (e.g. `silver` not `default_silver`) |
| `dbt/models/bronze/sources.yml` | Declares bronze sources; no `database:` key |
| `dbt/models/silver/*.sql` | orders_clean, customers_clean, clickstream_sessions |
| `dbt/models/gold/*.sql` | customer_features, product_interactions |
| `seed/seed.sh` | TRUNCATE before COPY (idempotent re-runs); triggers both Airflow DAGs |

### Key lessons learned
- **PyAirbyte** can't run inside containers (requires Docker-in-Docker) — replaced with psycopg2
- **PyIceberg 0.11.x** dropped `HadoopCatalog` — use PySpark + Iceberg Spark runtime instead
- **dbt-spark** doesn't support `+database:` config key — remove it from `dbt_project.yml` and `sources.yml`
- **Apple Silicon**: JAVA_HOME must use `dpkg --print-architecture` to resolve arm64 vs amd64

## Phase 3 — Completed (2026-04-08): ML (PyTorch + MLflow)

Two PyTorch models trained from Gold tables, tracked in MLflow.

| File | Purpose |
|------|---------|
| `infra/airflow/Dockerfile` | Added `torch==2.2.2` (plain, no `+cpu` suffix) and `mlflow==2.12.2` |
| `ml/churn/__init__.py` | Makes `churn` importable as a package |
| `ml/churn/features.py` | Loads `gold.customer_features` via PySpark; adds synthetic churn label |
| `ml/churn/model.py` | `ChurnMLP` — 3-layer MLP (5→32→16→1, sigmoid) |
| `ml/churn/train.py` | 3-run HP sweep; registers best as `churn-classifier` Production alias |
| `ml/recommend/__init__.py` | Makes `recommend` importable as a package |
| `ml/recommend/features.py` | Loads `gold.product_interactions`; builds implicit-feedback ratings + index maps |
| `ml/recommend/model.py` | `MatrixFactorization` — embedding MF with bias terms; `top_n()` helper |
| `ml/recommend/train.py` | 3-run HP sweep; saves index maps as artifact; registers `product-recommender` |
| `ingestion/dags/train_churn.py` | Airflow DAG: 30 min schedule, calls `churn.train.run()` |
| `ingestion/dags/train_recommend.py` | Airflow DAG: 30 min schedule, calls `recommend.train.run()` |

### Key notes
- ML code lives in `/opt/airflow/ml` inside the Airflow container (mounted volume)
- Both DAGs insert `/opt/airflow/ml` into `sys.path` so package imports work
- Churn label is heuristic (days_since_last_order > 90 AND order_count < 3) — intentional for demo
- Recommender saves `index_maps.json` artifact alongside the model for serving-layer decoding
- MLflow tracking URI: `http://mlflow:5000` (internal), exposed at `localhost:5001`

## Phase 4 — Completed (2026-04-08): Serving (FastAPI)

| File | Purpose |
|------|---------|
| `serving/main.py` | FastAPI app with CORS, `/health`, `/api/status` (live MLflow + Postgres metrics) |
| `serving/routers/churn.py` | `POST /predict/churn` — loads `churn-classifier@Production` from MLflow, returns churn probability |
| `serving/routers/recommend.py` | `POST /predict/recommend` — loads `product-recommender@Production`, decodes index maps, returns top-5 product IDs |
| `docker-compose.yml` | `fastapi` service: mounts `mlflow_artifacts:/mlflow/artifacts`, `./ml:/app/ml`; sets `PYTHONPATH: /app/ml` |

### Key notes
- Models loaded once at first request via `lru_cache` — no startup latency
- `/api/status` polls MLflow Model Registry + Postgres live; used by UI every 10s
- `serving/requirements.txt` pins `mlflow==2.12.2`, `torch==2.2.2` — must match the MLflow server version
- `PYTHONPATH: /app/ml` required so MLflow's PyTorch flavor can import model classes at deserialization time
- Rebuild fastapi image: `docker compose --profile core build fastapi && docker compose --profile core up -d fastapi`

### Key lessons learned
- **MLflow client/server version parity**: Client API calls must match server. Newer clients call `/api/2.0/mlflow/logged-models` which doesn't exist on older servers — pin both to the same version.
- **Shared artifact volume**: All three services (airflow, mlflow, fastapi) must mount the same `mlflow_artifacts` named volume. Missing it on any service causes 404s when loading models.
- **`torch==2.2.2+cpu` is invalid**: The `+cpu` suffix only exists for torch ≥2.6 on the PyTorch whl index. Use plain `torch==2.2.2` — CPU-only by default on Linux/ARM.
- **pyiceberg conflicts with mlflow**: `pyiceberg[pyarrow]` requires `pyarrow>=17`; `mlflow<2.14` needs `pyarrow<16`. Drop pyiceberg from Airflow image (PySpark handles all Iceberg reads anyway).
- **`orders` is not a Postgres table**: Data lives only in Iceberg. Don't query it from Postgres in `/api/status`.

## Phase 5 — Completed (2026-04-08): UI (Next.js lineage dashboard)

Interactive ReactFlow lineage graph showing the full pipeline from sources through Bronze → Silver → Gold → ML → Serve, with live metrics polling FastAPI `/api/status` every 10s.

| File | Purpose |
|------|---------|
| `ui/package.json` | Next.js 14.2.3, @xyflow/react ^12, motion ^11, tailwindcss ^3 |
| `ui/tsconfig.json` | TypeScript config with `@/*` path aliases and `moduleResolution: bundler` |
| `ui/app/globals.css` | Design system: lavender/periwinkle palette (`#edf0fb` canvas), Lora+DM Sans+JetBrains Mono, Emil Kowalski animation principles |
| `ui/app/layout.tsx` | Minimal layout loading globals.css |
| `ui/app/page.tsx` | Full-bleed layout: "ShopStream" header (italic Lora 22px), ReactFlow canvas, MetricsBar |
| `ui/components/LineageGraph.tsx` | ReactFlow graph: `PipelineNode`, `SilkEdge` (bezier + animateMotion particles), `SilkStraightEdge` (vertical drops), `LayerLabel` |
| `ui/components/MetricsBar.tsx` | Bottom bar polling `/api/status`: 6 metric pills, live indicator, profile badge |
| `docker-compose.yml` | `ui` service: Next.js on port 3000, `NEXT_PUBLIC_API_URL=http://localhost:8001` |

### Key notes
- `NEXT_PUBLIC_API_URL` must be `http://localhost:8001` (browser calls FastAPI directly, not via Docker hostname)
- `LineageGraph` is dynamically imported with `ssr: false` (ReactFlow requires a browser environment)
- Two edge types: `SilkEdge` (bezier, for cross-column connections) and `SilkStraightEdge` (getStraightPath, for within-column vertical drops like dbt→Iceberg)
- Layout: 7 columns (Sources/Ingest/Bronze/Silver/Gold/ML/Serving), 280px column gaps, `COL`/`ROW` constants at the top of `LineageGraph.tsx`
- dbt nodes share a column with their output Iceberg table (dbt on top row, Iceberg on bottom) — connected via `bottom-out → top-in` handles with `SilkStraightEdge`
- Node entrance stagger: `animDelay * 45ms`; animation principles: `cubic-bezier(0.23, 1, 0.32, 1)` ease-out, `prefers-reduced-motion` support
- Layer labels (`LayerLabel` node type): `--ink-secondary` color, 10.5px mono weight 500 — must stay readable against the lavender canvas
- MiniMap removed; Controls (zoom +/−/fit) kept
- Rebuild: `docker compose --profile core build ui && docker compose --profile core up -d ui`
- Dev server (hot reload, no Docker rebuild): `npm --prefix ui run dev -- -p 3001`

### Key lessons learned
- **`@xyflow/react` vs `reactflow`**: Use `@xyflow/react` (v12) which has updated API; `reactflow` is the legacy v11 package
- **ReactFlow + SSR**: Always use `dynamic(() => import(...), { ssr: false })` — ReactFlow uses browser APIs at import time
- **Backward S-curves**: When source and target nodes share the same x column, default left/right handles create backward bezier curves. Fix: use `bottom-out → top-in` handles + `getStraightPath` for a clean vertical line
- **`tsconfig.json` missing causes false IDE errors**: Next.js finds it but TypeScript language server needs it in the project root
- **`NEXT_PUBLIC_*` baked at build time**: These vars are embedded in the JS bundle during `next build`, not at runtime — must match where the browser actually calls

## Phase 5 — Post-wiring fixes (2026-04-08)

Fixes applied after initial Phase 5 to make the UI accurately reflect live data.

### FastAPI `/api/status` (`serving/main.py`)
- Removed dead `orders` field — orders live only in Iceberg, not Postgres
- Added `products` count from the `inventory` Postgres table (seeded from `products.csv`)
- `/api/status` now returns: `{ customers: 2000, products: 200 }` + live model registry info

### MetricsBar (`ui/components/MetricsBar.tsx`)
- Updated `StatusResponse` type to include `products: number | null`
- Churn pill: changed metric from `val_accuracy` (doesn't exist) → `val_auc` (what the model logs)
- Recommender pill: changed metric from `val_loss` → `train_rmse` (what the model logs)
- Replaced dead "Accuracy" pill (was `val_accuracy`, always `—`) with "Products" pill showing live count
- Removed unused `pct()` helper

### LineageGraph (`ui/components/LineageGraph.tsx`)
- Removed `url` from both dbt nodes — dbt has no web UI in core profile (was pointing to `:8580`)
- PostgreSQL node links to pgAdmin (`:5050`) — click to open pgAdmin pre-loaded with the ShopStream server

### Seed (`seed/seed.sh`)
- Added inventory seeding: loads `products.csv` via a Postgres temp table → `inventory` table
- Seed now populates both `customers` (2K rows) and `inventory` (200 rows) on every `make seed`
- Uses server-side `COPY` (not `\COPY`) so it works inside `docker compose exec -c` strings

### Key constraint
- **`orders` is not a Postgres table**: Orders data lives only in Iceberg (Bronze layer). Never query `orders` from Postgres in `/api/status` or anywhere else.
- **fastapi image is baked, not volume-mounted**: Changes to `serving/` require `docker compose --profile core build fastapi && docker compose --profile core up -d fastapi`

## Phase 6 — Completed (2026-04-09): Iceberg Catalog Explorer

Clicking any Iceberg node (bronze/silver/gold) or dbt node opens a modal showing schema + 5 sample rows. dbt nodes show syntax-highlighted SQL. Full catalog page at `/catalog/[layer]/[table]`.

| File | Purpose |
|------|---------|
| `serving/routers/catalog.py` | `GET /api/catalog/{layer}/{table}` — reads Iceberg Parquet via pyarrow, returns schema + 5 rows + row count |
| `serving/routers/catalog.py` | `GET /api/catalog` — lists all layers/tables |
| `ui/components/CatalogModal.tsx` | Modal with table tabs, schema/data toggle, SQL highlight for dbt nodes, GitHub + full-page links |
| `ui/app/catalog/[layer]/[table]/page.tsx` | Full catalog page with sidebar listing all tables |
| `ui/app/catalog/layout.tsx` | Layout wrapper for catalog pages |
| `docker-compose.yml` | `warehouse` named volume mounted on `fastapi` container (`/warehouse`) |

### Key notes
- `catalog.py` reads Parquet directly via `pyarrow` — no Spark session needed at serving time
- Iceberg Parquet path pattern: `/warehouse/{layer}/{table}/data/**/*.parquet`
- Row count is summed from Parquet file metadata (fast, no full scan)
- SQL sources are statically embedded in `CatalogModal.tsx` (no dbt API needed)
- GitHub links point to `https://github.com/kennethfoo24/data-to-ai-fivetran/blob/main/dbt/models/{layer}/{model}.sql`
- `pyarrow` is already in `serving/requirements.txt` — no new deps needed
- Rebuild fastapi: `docker compose --profile core build fastapi && docker compose --profile core up -d fastapi`
- Rebuild UI: `docker compose --profile core build ui && docker compose --profile core up -d ui`

### Key lessons learned
- **`pyarrow` conflicts with `mlflow<2.14`**: `pyarrow>=17` required by pyiceberg breaks mlflow. Use `pyarrow` without version pin in `serving/requirements.txt` — mlflow 2.12.2 works fine with pyarrow in the serving container (not the Airflow container).
- **Non-JSON-safe types**: Parquet columns like `date32`, `decimal128`, timestamps must be cast to string before returning as JSON. Handle `math.isnan` for float NaN → None.
- **`warehouse` volume on fastapi**: Must add `- warehouse:/warehouse` to fastapi volumes in `docker-compose.yml` and declare `warehouse:` in top-level `volumes:`.

## Phase 7 — Completed (2026-04-19): Fivetran Activations → HubSpot Reverse ETL

Syncs cleaned Snowflake data back to HubSpot CRM via Fivetran Activations (powered by Census). Customer segment and invoice status data is pushed as enriched contact properties. The Finance tab in the UI now shows the full lineage: Postgres/Kafka → ELT → Snowflake Raw → Transforms → Snowflake Clean → Reverse ETL → HubSpot.

| Component | Details |
|-----------|---------|
| `ui/components/FinanceGraph.tsx` | Finance lineage graph: 7 columns, dbt node below Fivetran Transforms, HubSpot node links to live contacts |
| `ui/components/FinanceBIModal.tsx` | BI charts modal (MRR trend, payment mix, invoice aging, customer health) |
| `serving/routers/finance.py` | FastAPI router: `/api/finance/charts` + `/api/finance/preview/{table}` |
| `dbt_fivetran/models/` | 3 dbt models: `finance_customer_segments`, `finance_invoice_aging`, `finance_monthly_summary` |
| `dbt_fivetran/models/sources.yml` | Source: `PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE` (CUSTOMERS, FINANCE_INVOICES, FINANCE_PAYMENTS) |

### Snowflake setup for Fivetran Activations (Census)
Fivetran Activations uses a `CENSUS_ROLE` / `CENSUS_USER` / `CENSUS_WAREHOUSE` convention internally:

```sql
CREATE ROLE CENSUS_ROLE;
CREATE USER CENSUS_USER RSA_PUBLIC_KEY='<your-public-key>';
ALTER USER CENSUS_USER SET DEFAULT_ROLE = CENSUS_ROLE;
GRANT ROLE CENSUS_ROLE TO USER CENSUS_USER;
CREATE WAREHOUSE CENSUS_WAREHOUSE WITH WAREHOUSE_SIZE = 'XSMALL';
GRANT USAGE ON WAREHOUSE CENSUS_WAREHOUSE TO ROLE CENSUS_ROLE;
CREATE DATABASE IF NOT EXISTS CENSUS;
CREATE SCHEMA IF NOT EXISTS CENSUS.CENSUS;
GRANT ALL ON DATABASE CENSUS TO ROLE CENSUS_ROLE;
GRANT ALL ON ALL SCHEMAS IN DATABASE CENSUS TO ROLE CENSUS_ROLE;
GRANT USAGE ON DATABASE PC_FIVETRAN_DB TO ROLE CENSUS_ROLE;
GRANT USAGE ON SCHEMA PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE TO ROLE CENSUS_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE TO ROLE CENSUS_ROLE;
GRANT USAGE ON DATABASE PC_FIVETRAN_DB TO ROLE CENSUS_ROLE;
GRANT USAGE ON SCHEMA PC_FIVETRAN_DB.FINANCE_TRANSFORMED TO ROLE CENSUS_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA PC_FIVETRAN_DB.FINANCE_TRANSFORMED TO ROLE CENSUS_ROLE;
```

### Dataset SQL (joins 3 tables across 2 schemas)
```sql
SELECT
  c.EMAIL,
  c.NAME,
  cs.SEGMENT       AS CUSTOMER_SEGMENT,
  (SELECT AGING_BUCKET FROM PC_FIVETRAN_DB.FINANCE_TRANSFORMED.FINANCE_INVOICE_AGING
   WHERE CUSTOMER_ID = c.ID ORDER BY UPDATED_AT DESC LIMIT 1) AS INVOICE_STATUS
FROM PC_FIVETRAN_DB.SHOPSTREAM_FINANCE_FINANCE.CUSTOMERS c
LEFT JOIN PC_FIVETRAN_DB.FINANCE_TRANSFORMED.FINANCE_CUSTOMER_SEGMENTS cs
  ON cs.CUSTOMER_ID = c.ID
WHERE cs.SEGMENT IS NOT NULL
```

### Segments created
- **At Risk** (`CUSTOMER_SEGMENT = 'at_risk'`) — 871 contacts
- **Churned** (`CUSTOMER_SEGMENT = 'churned'`) — 406 contacts
- Champion segment was omitted — no champion data exists in transformed tables

### HubSpot custom properties
Created under Contacts → Properties:
- `customer_segment` (Single-line text)
- `invoice_status` (Single-line text)

Sync key: `EMAIL` (unique per contact)

### FinanceGraph.tsx key details
- 7 columns: Sources / ELT / Snowflake Raw / Transforms / Snowflake Clean / Reverse ETL / HubSpot
- `COL` constants: `{ src: 20, conn: 420, sraw: 820, xfm: 1220, sclean: 1620, retl: 2020, hub: 2420 }`
- `ROW` constants: `{ top: 80, mid: 220, bot: 360 }`
- dbt node sits at `(COL.xfm, ROW.bot)` — connected from Fivetran Transforms via `bottom-out → top-in` handles
- `PipelineNode` exposes 4 handles: `in` (left), `out` (right), `bottom-out` (bottom), `top-in` (top)
- HubSpot node URL: `https://app-na2.hubspot.com/contacts/245945263/objects/0-1/views/all/list?prefetch=`
- dbt node URL: `https://github.com/kennethfoo24/data-to-ai-fivetran/tree/main/dbt_fivetran/models`

### Key lessons learned
- **Fivetran Activations uses Census infrastructure**: Requires `CENSUS_ROLE`, `CENSUS_USER`, `CENSUS_WAREHOUSE`, and a `CENSUS.CENSUS` schema in Snowflake — must be created and granted explicitly.
- **CUSTOMERS table has `NAME` not `FIRST_NAME`/`LAST_NAME`**: The seeded schema uses a single `NAME` column.
- **FINANCE_INVOICE_AGING has multiple rows per customer**: Use a subquery with `ORDER BY UPDATED_AT DESC LIMIT 1` to get the latest bucket per customer, avoiding duplicate contacts.
- **Sync key must be unique**: Use `EMAIL` as the sync key, not `CUSTOMER_SEGMENT` (which is not unique).
- **No champion data**: `FINANCE_CUSTOMER_SEGMENTS` only contains `at_risk` and `churned` values — do not create a Champions segment.
- **Vertical edges in same column**: Use `sourceHandle: 'bottom-out'` + `targetHandle: 'top-in'` with bezier edge type for clean vertical drops between stacked nodes.

### Confluent Cloud Kafka connector (2026-04-19)
- Topic: `shopstream.finance` — finance/payment events (100 events per producer run)
- Producer: `kafka/produce_finance_events.py` — reads creds from `.env`, uses `confluent-kafka` + SASL/SSL
- Fivetran connector type: **Confluent** (native, not generic Kafka) — syncs to `FINANCE_EVENTS` table
- Env vars: `CONFLUENT_BOOTSTRAP_SERVERS`, `CONFLUENT_API_KEY`, `CONFLUENT_API_SECRET`
- FinanceGraph Kafka node URL updated to Confluent Cloud cluster dashboard
- Local Docker Kafka (`confluentinc/cp-kafka`) is untouched — still serves `shopstream.clickstream`

## Post-Review Fixes (2026-04-20)

Bug fixes identified via full codebase review.

| File | Fix |
|------|-----|
| `scripts/setup.sh:85` | Corrected producer path from `seed/produce_finance_events.py` → `kafka/produce_finance_events.py` |
| `.gitignore` | Added Terraform state/directory exclusions |
| `scripts/setup.sh`, `variables.tf` | Replaced hardcoded GCP project ID and Snowflake account with `${GCP_PROJECT_ID}` / `${SNOWFLAKE_ACCOUNT}` env vars |
| `infra/terraform/cloudsql/main.tf` | Cloud SQL admin password now uses `var.admin_password` (set via `TF_VAR_admin_password` / `CLOUDSQL_ADMIN_PASSWORD` in `.env`) |
| `scripts/setup.sh:132-136` | Cloud SQL COPY commands corrected to `finance."CUSTOMERS"`, `finance."FINANCE_INVOICES"`, `finance."FINANCE_PAYMENTS"` |
| `ui/components/FinanceGraph.tsx` | Added missing edge `dbt-models → snow-transformed` (lineage was a dead end) |
| `ingestion/connectors/batch_ingest.py` | Default Postgres credentials changed from `postgres/postgres` → `admin/admin` to match deployment |
| `serving/routers/catalog.py` | Fixed unreachable NaN check — float NaN now correctly serializes to `null` in JSON |
| `ui/components/CatalogModal.tsx`, `ui/app/catalog/[layer]/[table]/page.tsx` | Fixed GitHub URL from `data-to-ai` → `data-to-ai-fivetran` |

### Required `.env` / `.env.example` vars added
```
GCP_PROJECT_ID=fivetran-493702
SNOWFLAKE_ACCOUNT=KKGCKAP-CD56063
CLOUDSQL_ADMIN_PASSWORD=admin
```

### Key constraints
- **Two separate Kafka producers**: `seed/produce_finance_events.py` targets local Docker Kafka (`mrr_delta` schema); `kafka/produce_finance_events.py` targets Confluent Cloud (`amount` schema). Never conflate them.
- **Cloud SQL tables are schema-qualified and quoted**: Always use `finance."CUSTOMERS"` etc. — unqualified names will fail.
