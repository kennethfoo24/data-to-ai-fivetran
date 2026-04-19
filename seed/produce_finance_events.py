"""Produce 500 finance revenue events to shopstream.finance via docker compose exec."""
import json
import random
import subprocess
import sys
import uuid
from datetime import datetime, timedelta

TOPIC     = "shopstream.finance"
N_EVENTS  = 500

random.seed(99)

EVENT_TYPES = ["subscription_renewal", "subscription_renewal", "subscription_renewal", "upsell", "churn"]

MRR_DELTAS = {
    "subscription_renewal": lambda: round(random.uniform(50, 500), 2),
    "upsell":               lambda: round(random.uniform(100, 800), 2),
    "churn":                lambda: -round(random.uniform(50, 500), 2),
}

def main():
    base_time = datetime(2024, 1, 1)
    lines = []
    for i in range(N_EVENTS):
        event_type = random.choice(EVENT_TYPES)
        lines.append(json.dumps({
            "event_id":    str(uuid.uuid4()),
            "customer_id": random.randint(1, 2000),
            "event_type":  event_type,
            "mrr_delta":   MRR_DELTAS[event_type](),
            "timestamp":   (base_time + timedelta(hours=i * 17)).isoformat(),
        }))

    payload = "\n".join(lines) + "\n"

    result = subprocess.run(
        [
            "docker", "compose", "exec", "-T", "kafka",
            "kafka-console-producer",
            "--bootstrap-server", "localhost:9092",
            "--topic", TOPIC,
        ],
        input=payload.encode(),
        capture_output=True,
    )

    if result.returncode != 0:
        print(f"  (skipped — Kafka not reachable)", file=sys.stderr)
        sys.exit(1)

    print(f"✓ Produced {N_EVENTS} finance events to {TOPIC}")

if __name__ == "__main__":
    main()
