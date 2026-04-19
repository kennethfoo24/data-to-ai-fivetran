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
        "event_id":    str(uuid.uuid4()),
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
