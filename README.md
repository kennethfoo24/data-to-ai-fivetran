

# DataFabric — End-to-End Data & AI Portfolio

A fully runnable, Docker Compose portfolio project demonstrating modern data engineering and machine learning — built around **ShopStream**, a fictional e-commerce platform.

![App Screenshot](https://i.imgur.com/pviU3ZR.png)

![App Screenshot](https://i.imgur.com/LTaihzl.png)

![App Screenshot](https://i.imgur.com/v9ZpWvh.png)

![App Screenshot](https://i.imgur.com/z5NgI3J.png)


### Data-to-AI Architecture Interface
![App Screenshot](https://i.imgur.com/QQ3oJuE.png)

## What It Demonstrates

| Layer | Tools |
|---|---|
| **Sources** | CSV files, PostgreSQL, Apache Kafka (real-time stream) |
| **Ingestion** | PyAirbyte (batch), Spark Structured Streaming (Kafka) |
| **Lakehouse** | Apache Iceberg — Bronze → Silver → Gold medallion architecture |
| **Transformation** | Apache Spark, dbt Core |
| **Orchestration** | Apache Airflow |
| **ML Training & Tracking** | PyTorch, MLflow |
| **Model Serving** | FastAPI (`/predict/churn`, `/predict/recommend`) |
| **Lineage Dashboard** | Next.js + ReactFlow — animated, clickable data lineage |
| **Catalog Explorer** | Click any Iceberg or dbt node to browse schema, sample rows, and SQL |

## Prerequisites

- Docker Desktop ≥ 24 with **≥ 8GB RAM** allocated (Settings → Resources)
- Python 3.11+
- `make` (macOS/Linux built-in; Windows: use Git Bash)

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/data-to-ai.git
cd data-to-ai
bash scripts/setup.sh
open http://localhost:3000
```

Setup takes ~5 minutes on first run (Docker image builds). Subsequent starts take ~2 minutes.

## Commands

```bash
make setup      # First-time setup (copies .env, builds, starts, seeds)
make up         # Start services
make down       # Stop services
make seed       # Re-generate and reload seed data
make logs       # Tail all service logs
make ps         # Show running containers
make clean      # Stop + remove volumes + delete seed data
```

## Service URLs & Credentials

| Service | URL | Username | Password |
|---|---|---|---|
| **Lineage UI** | http://localhost:3000 | — | — |
| **Airflow** | http://localhost:8082 | `admin` | `admin` |
| **MLflow** | http://localhost:5001 | — | — |
| **FastAPI docs** | http://localhost:8001/docs | — | — |
| **Kafka UI** | http://localhost:8080 | — | — |
| **Spark UI** | http://localhost:4040 | — | — |
| **pgAdmin** | http://localhost:5050 | `admin@example.com` | `Admin1234` |
| **PostgreSQL** | localhost:5432 | `admin` | `admin` |

> Click the **PostgreSQL** node in the Lineage UI to open pgAdmin. The ShopStream server is pre-registered — no extra setup needed.

## Architecture

```
  Sources                Lakehouse (Apache Iceberg)
  ───────                ──────────────────────────
  CSV files ──┐
  PostgreSQL──┼──► Airbyte/PyAirbyte ──► Bronze (raw)
  Kafka    ───┘         Spark                │
  (clickstream)     Structured               ▼
                    Streaming           dbt Silver (cleaned)
                                             │
                                             ▼
                                        dbt Gold (features)
                                             │
                                    ┌────────┴────────┐
                              Churn Model      Recommender
                              (PyTorch)        (PyTorch)
                                    └────────┬────────┘
                                         MLflow
                                         FastAPI
                                         Next.js Lineage UI
                                         Catalog Explorer (/catalog)
```
### Data-to-AI Architecture Interface
![App Screenshot](https://i.imgur.com/EBBsGQ5.png)

### Kafka Streams
![App Screenshot](https://i.imgur.com/rcndTCW.png)

### Spark Jobs
![App Screenshot](https://i.imgur.com/F4bZOUN.png)

### Airflow DAG
![App Screenshot](https://i.imgur.com/G7ntjQo.png)

### MLFlow Experiments
![App Screenshot](https://i.imgur.com/dBAmPZR.png)

### Catalog Explorer
Click any Bronze / Silver / Gold / dbt node in the lineage graph to browse table schema, sample rows, and (for dbt nodes) the SQL model source.

## Databricks

See [`scripts/databricks_guide.md`](scripts/databricks_guide.md) to connect Spark and dbt to a Databricks cluster instead of local Spark.

## License

MIT
