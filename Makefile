# Load .env if it exists
ifneq (,$(wildcard .env))
  include .env
  export
endif

.PHONY: up down seed logs ps build clean setup produce-finance-events help

## Start all services (~8GB RAM)
up:
	docker compose --profile core up -d

## Stop services and reset demo state (finance tables + kafka + ngrok)
down:
	bash scripts/teardown.sh
	docker compose --profile core down

## Generate and load seed data
seed:
	python3 seed/generate_data.py
	bash seed/seed.sh

## Tail logs
logs:
	docker compose --profile core logs -f

## Show running containers
ps:
	docker compose --profile core ps

## Build custom Docker images
build:
	docker compose --profile core build

## Remove containers, volumes, and generated seed data
clean:
	docker compose --profile core down -v
	rm -rf seed/data/

## One-shot setup (copies .env, builds images, starts, seeds)
setup:
	bash scripts/setup.sh

## Produce 100 synthetic finance events to Confluent Cloud (requires CONFLUENT_* vars in .env)
produce-finance-events:
	python3 kafka/produce_finance_events.py

## Show this help
help:
	@grep -E '^## |^[a-zA-Z_-]+:' Makefile | \
	  awk '/^## /{desc=$$0; next} /^[a-zA-Z_-]+:/{gsub(/:$$/,"",$$1); printf "  %-12s %s\n", $$1, substr(desc,4)}'
