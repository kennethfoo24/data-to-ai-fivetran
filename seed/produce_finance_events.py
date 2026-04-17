"""Produce 500 finance revenue events to the shopstream.finance Kafka topic."""
import json
import random
import uuid
from datetime import datetime, timedelta

from kafka import KafkaProducer

BOOTSTRAP = "localhost:9092"
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
    producer = KafkaProducer(
        bootstrap_servers=BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )
    base_time = datetime(2024, 1, 1)
    for i in range(N_EVENTS):
        event_type = random.choice(EVENT_TYPES)
        producer.send(TOPIC, value={
            "event_id":    str(uuid.uuid4()),
            "customer_id": random.randint(1, 2000),
            "event_type":  event_type,
            "mrr_delta":   MRR_DELTAS[event_type](),
            "timestamp":   (base_time + timedelta(hours=i * 17)).isoformat(),
        })
    producer.flush()
    producer.close()
    print(f"✓ Produced {N_EVENTS} finance events to {TOPIC}")

if __name__ == "__main__":
    main()
