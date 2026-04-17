"""
Generate realistic ShopStream seed CSVs.
Outputs: seed/data/customers.csv, products.csv, orders.csv
"""
import csv
import os
import random
from datetime import date, timedelta

random.seed(42)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# ── Customers (2,000) ──────────────────────────────────────────────────────────
CITIES = [
    ("London", "UK"), ("Manchester", "UK"), ("Birmingham", "UK"),
    ("New York", "US"), ("Los Angeles", "US"), ("Chicago", "US"),
    ("Sydney", "AU"), ("Melbourne", "AU"),
    ("Toronto", "CA"), ("Vancouver", "CA"),
]
TIERS = ["bronze", "bronze", "bronze", "silver", "silver", "gold"]
FIRST = ["Alice","Bob","Carol","Dave","Eve","Frank","Grace","Henry","Iris","Jack",
         "Karen","Leo","Mia","Noah","Olivia","Paul","Quinn","Rose","Sam","Tina"]
LAST  = ["Smith","Jones","Williams","Taylor","Brown","Davies","Evans","Wilson",
         "Thomas","Roberts","Johnson","Lee","Walker","Hall","Allen","Young"]

def random_date(start: date, end: date) -> str:
    return (start + timedelta(days=random.randint(0, (end - start).days))).isoformat()

with open(f"{DATA_DIR}/customers.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["customer_id","name","email","city","country","signup_date","age","loyalty_tier"])
    for i in range(1, 2001):
        first, last = random.choice(FIRST), random.choice(LAST)
        city, country = random.choice(CITIES)
        w.writerow([
            i, f"{first} {last}", f"{first.lower()}.{last.lower()}{i}@example.com",
            city, country,
            random_date(date(2021, 1, 1), date(2024, 12, 31)),
            random.randint(18, 72),
            random.choice(TIERS),
        ])
print("customers.csv ✓")

# ── Products (200) ────────────────────────────────────────────────────────────
CATEGORIES = {
    "Electronics":    [("iPhone 15 Pro", 999), ("Samsung S24", 849), ("iPad Air", 749),
                       ("MacBook Air M3", 1299), ("AirPods Pro", 249), ("Sony WH-1000XM5", 349),
                       ("Dell XPS 15", 1799), ("LG OLED 55in", 1499)],
    "Home Appliances":[("Dyson V15", 699), ("Nespresso Vertuo", 199), ("KitchenAid Mixer", 449),
                       ("Instant Pot Duo", 99), ("Roomba j7+", 599)],
    "Clothing":       [("Nike Air Max", 149), ("Levis 501 Jeans", 89), ("North Face Jacket", 299),
                       ("Adidas Ultraboost", 179), ("Ray-Ban Wayfarer", 189)],
    "Books":          [("Dune", 18), ("Atomic Habits", 16), ("The Pragmatic Programmer", 45),
                       ("Clean Code", 42), ("Designing Data-Intensive Applications", 55)],
    "Sports":         [("Yoga Mat", 39), ("Resistance Bands", 25), ("Foam Roller", 29),
                       ("Jump Rope", 15), ("Dumbbell Set 20kg", 89)],
    "Gaming":         [("PS5 Controller", 79), ("Xbox Series X", 499), ("Nintendo Switch", 299),
                       ("Gaming Headset", 129), ("Mechanical Keyboard", 149)],
    "Beauty":         [("Olay Regenerist", 35), ("CeraVe Moisturiser", 18), ("Vitamin C Serum", 29),
                       ("Electric Toothbrush", 89)],
    "Garden":         [("Garden Hose 30m", 45), ("Lawn Mower", 299), ("Plant Pots Set", 35),
                       ("Solar Lights 10pk", 49)],
}

with open(f"{DATA_DIR}/products.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["product_id","name","category","price","cost_price","stock_qty"])
    pid = 1
    for cat, items in CATEGORIES.items():
        for name, price in items:
            cost = round(price * random.uniform(0.4, 0.65), 2)
            stock = random.randint(0, 500)
            w.writerow([pid, name, cat, price, cost, stock])
            pid += 1
        # Pad each category to ~25 products
        while pid % 25 != 1 and pid <= 200:
            w.writerow([pid, f"{cat} Product {pid}", cat,
                        round(random.uniform(10, 1000), 2),
                        round(random.uniform(5, 400), 2),
                        random.randint(0, 300)])
            pid += 1
        if pid > 200:
            break
print("products.csv ✓")

# ── Orders (10,000) ───────────────────────────────────────────────────────────
STATUSES   = ["completed","completed","completed","completed","returned","cancelled","pending"]
ORDER_START = date(2023, 1, 1)
ORDER_END   = date(2024, 12, 31)

with open(f"{DATA_DIR}/orders.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["order_id","customer_id","product_id","quantity",
                "unit_price","discount_pct","status","order_date","return_date"])
    for oid in range(1, 10001):
        order_date = random_date(ORDER_START, ORDER_END)
        status     = random.choice(STATUSES)
        return_date = ""
        if status == "returned":
            rd = date.fromisoformat(order_date) + timedelta(days=random.randint(3, 30))
            return_date = rd.isoformat()
        w.writerow([
            oid,
            random.randint(1, 2000),
            random.randint(1, 200),
            random.randint(1, 3),
            round(random.uniform(10, 1200), 2),
            random.choice([0, 0, 0, 5, 10, 15, 20]),
            status,
            order_date,
            return_date,
        ])
print("orders.csv ✓")
print("Seed data generation complete.")

# ── Finance Invoices (2,000) ──────────────────────────────────────────────────
INVOICE_STATUSES = ["paid", "paid", "paid", "unpaid", "overdue"]

with open(f"{DATA_DIR}/finance_invoices.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["invoice_id", "customer_id", "amount", "status", "issue_date", "due_date"])
    for iid in range(1, 2001):
        issue = date.fromisoformat(random_date(date(2023, 1, 1), date(2024, 10, 31)))
        due   = issue + timedelta(days=random.choice([30, 45, 60]))
        status = random.choice(INVOICE_STATUSES)
        # Force overdue if due date is in the past
        if status == "unpaid" and due < date(2024, 12, 1):
            status = "overdue"
        w.writerow([
            iid,
            random.randint(1, 2000),
            round(random.uniform(50, 5000), 2),
            status,
            issue.isoformat(),
            due.isoformat(),
        ])
print("finance_invoices.csv ✓")

# ── Finance Payments (1,800) ──────────────────────────────────────────────────
METHODS = ["card", "card", "card", "bank", "paypal"]

with open(f"{DATA_DIR}/finance_payments.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["payment_id", "invoice_id", "amount_paid", "payment_date", "method"])
    paid_invoices = random.sample(range(1, 2001), 1800)
    for pid, iid in enumerate(paid_invoices, start=1):
        w.writerow([
            pid,
            iid,
            round(random.uniform(50, 5000), 2),
            random_date(date(2023, 2, 1), date(2025, 1, 31)),
            random.choice(METHODS),
        ])
print("finance_payments.csv ✓")
print("Finance seed data generation complete.")
