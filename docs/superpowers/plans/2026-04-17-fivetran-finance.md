# Fivetran Finance Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Fivetran Finance" tab to the ShopStream UI demonstrating the simplified "after" data stack — Postgres + Kafka → Fivetran → Snowflake (with managed dbt transforms) → Fivetran Reverse ETL → HubSpot — contrasting with the complex ShopStream "before" pipeline.

**Architecture:** Finance seed data (invoices, payments) is loaded into the existing Postgres instance and streamed via Kafka. FastAPI gains a `/api/finance/charts` endpoint that queries Snowflake for 4 BI metrics, falling back to simulated data. The UI gains a `FinanceGraph` ReactFlow component and `FinanceBIModal` Recharts modal. `make setup` auto-starts ngrok tunnels and prints copy-paste connection details; `make down` resets demo state.

**Tech Stack:** Next.js 14 / React / @xyflow/react v12 / Recharts / FastAPI / snowflake-connector-python / ngrok / bash

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `seed/generate_data.py` | Edit | Add `finance_invoices.csv` + `finance_payments.csv` generation |
| `seed/seed.sh` | Edit | Create + load `finance_invoices` + `finance_payments` tables |
| `seed/produce_finance_events.py` | Create | Kafka producer — 500 events to `shopstream.finance` |
| `serving/routers/finance.py` | Create | `GET /api/finance/charts` — Snowflake queries + simulated fallback |
| `serving/requirements.txt` | Edit | Add `snowflake-connector-python` |
| `serving/main.py` | Edit | Register finance router |
| `ui/components/FinanceGraph.tsx` | Create | ReactFlow lineage graph — 8 nodes, 6 columns |
| `ui/components/FinanceBIModal.tsx` | Create | Recharts BI modal — 4 charts, fetches `/api/finance/charts` |
| `ui/app/page.tsx` | Edit | Add `fivetran-finance` tab, rename `fivetran` → `fivetran-marketing` |
| `scripts/setup.sh` | Edit | Add Kafka producer + ngrok tunnels + copy-paste block print |
| `scripts/teardown.sh` | Create | Kill ngrok, truncate finance tables, reset Kafka topic |
| `Makefile` | Edit | Extend `down` to call `scripts/teardown.sh` |
| `.env.example` | Edit | Add `SNOWFLAKE_*`, `HUBSPOT_PORTAL_ID`, `NGROK_AUTHTOKEN` vars |
| `docs/fivetran-finance-setup.md` | Create | Click-by-click Fivetran + HubSpot setup guide |

---

## Task 1: Finance Seed Data — CSV Generation

**Files:**
- Modify: `seed/generate_data.py`

- [ ] **Step 1: Add finance CSV generation to `seed/generate_data.py`**

Append to the end of the existing file (after the orders section):

```python
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
```

- [ ] **Step 2: Run and verify**

```bash
python3 seed/generate_data.py
wc -l seed/data/finance_invoices.csv seed/data/finance_payments.csv
```

Expected output includes `finance_invoices.csv ✓`, `finance_payments.csv ✓`, and line counts of 2001 and 1801 respectively.

- [ ] **Step 3: Commit**

```bash
git add seed/generate_data.py
git commit -m "feat: add finance invoice + payment CSV seed generation"
```

---

## Task 2: Finance Seed Data — Postgres Loading

**Files:**
- Modify: `seed/seed.sh`

- [ ] **Step 1: Add finance table creation and loading to `seed/seed.sh`**

Add after the existing `echo "==> [2/4] Loading customers + inventory..."` block (before the Airflow wait):

```bash
echo "==> [2b/4] Creating + loading finance tables..."
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" -c "
  CREATE TABLE IF NOT EXISTS finance_invoices (
    invoice_id  SERIAL PRIMARY KEY,
    customer_id INT,
    amount      NUMERIC(10,2),
    status      VARCHAR(20),
    issue_date  DATE,
    due_date    DATE
  );
  CREATE TABLE IF NOT EXISTS finance_payments (
    payment_id   SERIAL PRIMARY KEY,
    invoice_id   INT,
    amount_paid  NUMERIC(10,2),
    payment_date DATE,
    method       VARCHAR(20)
  );
"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE finance_payments, finance_invoices RESTART IDENTITY CASCADE;"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "COPY finance_invoices(invoice_id,customer_id,amount,status,issue_date,due_date) FROM '/seed/finance_invoices.csv' CSV HEADER"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "COPY finance_payments(payment_id,invoice_id,amount_paid,payment_date,method) FROM '/seed/finance_payments.csv' CSV HEADER"
docker compose exec postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "SELECT 'finance_invoices' AS tbl, COUNT(*) FROM finance_invoices UNION ALL SELECT 'finance_payments', COUNT(*) FROM finance_payments;"
```

- [ ] **Step 2: Verify tables load (requires Docker running)**

```bash
python3 seed/generate_data.py
bash seed/seed.sh
```

Look for the row count output — expect `finance_invoices | 2000` and `finance_payments | 1800`.

- [ ] **Step 3: Commit**

```bash
git add seed/seed.sh
git commit -m "feat: create and seed finance_invoices + finance_payments postgres tables"
```

---

## Task 3: Kafka Finance Event Producer

**Files:**
- Create: `seed/produce_finance_events.py`

- [ ] **Step 1: Create Kafka producer script**

```python
"""
Produce 500 finance revenue events to the shopstream.finance Kafka topic.
Each event represents a subscription_renewal, churn, or upsell for a ShopStream customer.
"""
import json
import random
import uuid
from datetime import datetime, timedelta

from kafka import KafkaProducer

BOOTSTRAP = "localhost:9092"
TOPIC     = "shopstream.finance"
N_EVENTS  = 500

random.seed(99)

EVENT_TYPES = ["subscription_renewal", "subscription_renewal", "subscription_renewal",
               "upsell", "churn"]

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
        event = {
            "event_id":    str(uuid.uuid4()),
            "customer_id": random.randint(1, 2000),
            "event_type":  event_type,
            "mrr_delta":   MRR_DELTAS[event_type](),
            "timestamp":   (base_time + timedelta(hours=i * 17)).isoformat(),
        }
        producer.send(TOPIC, value=event)

    producer.flush()
    producer.close()
    print(f"✓ Produced {N_EVENTS} finance events to {TOPIC}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test the producer (requires Docker running with Kafka)**

```bash
python3 seed/produce_finance_events.py
```

Expected: `✓ Produced 500 finance events to shopstream.finance`

Then verify in Kafka UI at http://localhost:8080 — topic `shopstream.finance` should show 500 messages.

- [ ] **Step 3: Commit**

```bash
git add seed/produce_finance_events.py
git commit -m "feat: add Kafka finance event producer (500 events to shopstream.finance)"
```

---

## Task 4: FastAPI Finance Router

**Files:**
- Create: `serving/routers/finance.py`
- Modify: `serving/requirements.txt`
- Modify: `serving/main.py`

- [ ] **Step 1: Add `snowflake-connector-python` to requirements**

In `serving/requirements.txt`, append:
```
snowflake-connector-python==3.10.1
```

- [ ] **Step 2: Create `serving/routers/finance.py`**

```python
"""
Finance BI charts endpoint.
Queries Snowflake transformed schema for 4 chart datasets.
Falls back to simulated data if Snowflake env vars are missing or connection fails.
"""
import math
import os
from functools import lru_cache

from fastapi import APIRouter

router = APIRouter()

SNOWFLAKE_VARS = [
    "SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA", "SNOWFLAKE_WAREHOUSE",
]


def _snowflake_configured() -> bool:
    return all(os.getenv(v) for v in SNOWFLAKE_VARS)


def _safe(val):
    """Convert NaN/None to None for JSON safety."""
    if val is None:
        return None
    try:
        if math.isnan(float(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


def _query_snowflake() -> dict:
    import snowflake.connector  # imported lazily — not installed in dev without Snowflake

    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
    )
    cur = conn.cursor()

    # MRR trend
    cur.execute("""
        SELECT TO_CHAR(month, 'YYYY-MM') AS month,
               total_revenue,
               arr
        FROM finance_monthly_summary
        ORDER BY month
        LIMIT 12
    """)
    mrr_trend = [
        {"month": r[0], "revenue": _safe(r[1]), "arr": _safe(r[2])}
        for r in cur.fetchall()
    ]

    # Payment methods
    cur.execute("""
        SELECT 'card'   AS method, SUM(card_revenue)   AS revenue FROM finance_monthly_summary
        UNION ALL
        SELECT 'bank',             SUM(bank_revenue)             FROM finance_monthly_summary
        UNION ALL
        SELECT 'paypal',           SUM(paypal_revenue)           FROM finance_monthly_summary
    """)
    payment_methods = [
        {"method": r[0], "revenue": _safe(r[1])}
        for r in cur.fetchall()
    ]

    # Invoice aging
    cur.execute("""
        SELECT aging_bucket, COUNT(*) AS count
        FROM finance_invoice_aging
        GROUP BY aging_bucket
        ORDER BY aging_bucket
    """)
    invoice_aging = [{"bucket": r[0], "count": r[1]} for r in cur.fetchall()]

    # Customer segments
    cur.execute("""
        SELECT segment, COUNT(*) AS count
        FROM finance_customer_segments
        GROUP BY segment
        ORDER BY count DESC
    """)
    customer_segments = [{"segment": r[0], "count": r[1]} for r in cur.fetchall()]

    cur.close()
    conn.close()

    return {
        "simulated": False,
        "mrr_trend": mrr_trend,
        "payment_methods": payment_methods,
        "invoice_aging": invoice_aging,
        "customer_segments": customer_segments,
    }


def _simulated_data() -> dict:
    return {
        "simulated": True,
        "mrr_trend": [
            {"month": f"2024-{m:02d}", "revenue": 42000 + m * 1800 + (m % 3) * 900, "arr": (42000 + m * 1800) * 12}
            for m in range(1, 13)
        ],
        "payment_methods": [
            {"method": "card",   "revenue": 312400},
            {"method": "bank",   "revenue": 187200},
            {"method": "paypal", "revenue": 94600},
        ],
        "invoice_aging": [
            {"bucket": "paid",      "count": 1420},
            {"bucket": "current",   "count": 210},
            {"bucket": "1-30 days", "count": 180},
            {"bucket": "31-60 days","count": 110},
            {"bucket": "60+ days",  "count": 80},
        ],
        "customer_segments": [
            {"segment": "champion", "count": 980},
            {"segment": "at_risk",  "count": 620},
            {"segment": "churned",  "count": 400},
        ],
    }


@router.get("/api/finance/charts")
def finance_charts():
    if not _snowflake_configured():
        return _simulated_data()
    try:
        return _query_snowflake()
    except Exception:
        return _simulated_data()
```

- [ ] **Step 3: Register the router in `serving/main.py`**

Add after the existing `from routers.catalog import router as catalog_router` line:

```python
from routers.finance import router as finance_router
```

And add after `app.include_router(catalog_router)`:

```python
app.include_router(finance_router)
```

- [ ] **Step 4: Rebuild and test the endpoint**

```bash
docker compose --profile core build fastapi && docker compose --profile core up -d fastapi
sleep 5
curl -s http://localhost:8001/api/finance/charts | python3 -m json.tool | head -20
```

Expected: JSON response with `"simulated": true` (since Snowflake not yet configured) and all 4 chart arrays populated.

- [ ] **Step 5: Commit**

```bash
git add serving/routers/finance.py serving/requirements.txt serving/main.py
git commit -m "feat: add /api/finance/charts endpoint with Snowflake + simulated fallback"
```

---

## Task 5: FinanceBIModal Component

**Files:**
- Create: `ui/components/FinanceBIModal.tsx`

- [ ] **Step 1: Install recharts (if not already present)**

```bash
cd ui && npm list recharts 2>/dev/null || npm install recharts
```

- [ ] **Step 2: Create `ui/components/FinanceBIModal.tsx`**

```tsx
'use client'

import React, { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MrrPoint        { month: string; revenue: number; arr: number }
interface PaymentMethod   { method: string; revenue: number }
interface InvoiceAging    { bucket: string; count: number }
interface CustomerSegment { segment: string; count: number }

interface ChartsResponse {
  simulated: boolean
  mrr_trend: MrrPoint[]
  payment_methods: PaymentMethod[]
  invoice_aging: InvoiceAging[]
  customer_segments: CustomerSegment[]
}

interface Props {
  onClose: () => void
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FASTAPI_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

const PALETTE = {
  indigo:  '#6366f1',
  teal:    '#0891b2',
  amber:   '#d97706',
  rose:    '#e11d48',
  green:   '#16a34a',
  violet:  '#7c3aed',
}

const PIE_COLORS = [PALETTE.indigo, PALETTE.teal, PALETTE.amber]

const SEGMENT_COLORS: Record<string, string> = {
  champion: PALETTE.green,
  at_risk:  PALETTE.amber,
  churned:  PALETTE.rose,
}

const AGING_COLORS: Record<string, string> = {
  paid:        PALETTE.green,
  current:     PALETTE.indigo,
  '1-30 days': PALETTE.amber,
  '31-60 days':PALETTE.rose,
  '60+ days':  '#991b1b',
}

type TabKey = 'mrr' | 'methods' | 'aging' | 'segments'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'mrr',      label: 'MRR Trend' },
  { key: 'methods',  label: 'Payment Mix' },
  { key: 'aging',    label: 'Invoice Aging' },
  { key: 'segments', label: 'Customer Health' },
]

// ─── Modal ───────────────────────────────────────────────────────────────────

export default function FinanceBIModal({ onClose }: Props) {
  const [data, setData]       = useState<ChartsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setTab]   = useState<TabKey>('mrr')

  useEffect(() => {
    fetch(`${FASTAPI_URL}/api/finance/charts`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15,15,35,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 680, maxHeight: '80vh',
          background: 'var(--bg-surface, #fff)',
          borderRadius: 16,
          border: '1px solid var(--border-hairline, rgba(99,102,241,0.15))',
          boxShadow: '0 24px 64px rgba(15,15,35,0.25)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px 0',
          borderBottom: '1px solid var(--border-hairline, rgba(99,102,241,0.12))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{
              fontFamily: 'var(--font-body, sans-serif)',
              fontWeight: 700, fontSize: 16,
              color: 'var(--ink-primary, #1e1b4b)',
              letterSpacing: '-0.01em',
            }}>
              Snowflake · Finance Analytics
            </div>
            {data?.simulated && (
              <span style={{
                padding: '2px 8px', borderRadius: 4,
                background: 'rgba(217,119,6,0.1)',
                border: '1px solid rgba(217,119,6,0.3)',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 10, color: '#d97706',
                letterSpacing: '0.06em',
              }}>
                SIMULATED
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--ink-tertiary, #9ca3af)', fontSize: 20, lineHeight: 1,
                padding: '0 4px',
              }}
            >×</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '6px 14px', borderRadius: '6px 6px 0 0',
                border: 'none',
                background: activeTab === t.key ? 'rgba(99,102,241,0.10)' : 'transparent',
                borderBottom: activeTab === t.key ? '2px solid #6366f1' : '2px solid transparent',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 11, fontWeight: activeTab === t.key ? 600 : 400,
                color: activeTab === t.key ? '#6366f1' : 'var(--ink-tertiary, #9ca3af)',
                cursor: 'pointer', letterSpacing: '0.04em',
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart body */}
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--ink-ghost, #c4c9e2)', paddingTop: 60 }}>
              Loading…
            </div>
          )}

          {!loading && !data && (
            <div style={{ textAlign: 'center', color: 'var(--ink-ghost, #c4c9e2)', paddingTop: 60 }}>
              Could not load chart data.
            </div>
          )}

          {!loading && data && activeTab === 'mrr' && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.mrr_trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke={PALETTE.indigo} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {!loading && data && activeTab === 'methods' && (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.payment_methods}
                  dataKey="revenue" nameKey="method"
                  cx="50%" cy="50%" outerRadius={100} innerRadius={50}
                  label={({ method, percent }) => `${method} ${(percent * 100).toFixed(0)}%`}
                >
                  {data.payment_methods.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}

          {!loading && data && activeTab === 'aging' && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.invoice_aging} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }} width={80} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.invoice_aging.map((row, i) => (
                    <Cell key={i} fill={AGING_COLORS[row.bucket] ?? PALETTE.indigo} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {!loading && data && activeTab === 'segments' && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.customer_segments} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="segment" tick={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }} width={80} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.customer_segments.map((row, i) => (
                    <Cell key={i} fill={SEGMENT_COLORS[row.segment] ?? PALETTE.indigo} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/components/FinanceBIModal.tsx
git commit -m "feat: add FinanceBIModal with 4 Recharts BI charts (MRR, payment mix, aging, segments)"
```

---

## Task 6: FinanceGraph Component

**Files:**
- Create: `ui/components/FinanceGraph.tsx`

- [ ] **Step 1: Create `ui/components/FinanceGraph.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import FinanceBIModal from './FinanceBIModal'

// ─── Logos ───────────────────────────────────────────────────────────────────

const logos: Record<string, React.ReactNode> = {
  postgres: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <circle cx="16" cy="16" r="14" fill="#336791"/>
      <ellipse cx="16" cy="12" rx="7" ry="4" fill="rgba(255,255,255,0.92)"/>
      <path d="M9 12v7a7 4 0 0014 0v-7" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5"/>
      <path d="M9 15.5a7 4 0 0014 0" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1"/>
    </svg>
  ),
  kafka: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#1d1d1d"/>
      <circle cx="16" cy="16" r="3.5" fill="white"/>
      <circle cx="7"  cy="10" r="2.5" fill="white"/>
      <circle cx="25" cy="10" r="2.5" fill="white"/>
      <circle cx="7"  cy="22" r="2.5" fill="white"/>
      <circle cx="25" cy="22" r="2.5" fill="white"/>
      <line x1="16" y1="16" x2="7"  y2="10" stroke="white" strokeWidth="1.5"/>
      <line x1="16" y1="16" x2="25" y2="10" stroke="white" strokeWidth="1.5"/>
      <line x1="16" y1="16" x2="7"  y2="22" stroke="white" strokeWidth="1.5"/>
      <line x1="16" y1="16" x2="25" y2="22" stroke="white" strokeWidth="1.5"/>
    </svg>
  ),
  fivetran: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#0073e6"/>
      <rect x="6"  y="7"  width="8" height="8" rx="2" fill="white"/>
      <rect x="18" y="7"  width="8" height="8" rx="2" fill="rgba(255,255,255,0.70)"/>
      <rect x="6"  y="18" width="8" height="8" rx="2" fill="rgba(255,255,255,0.70)"/>
      <rect x="18" y="18" width="8" height="8" rx="2" fill="rgba(255,255,255,0.40)"/>
    </svg>
  ),
  snowflake: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#29b5e8"/>
      <line x1="16" y1="5"  x2="16" y2="27" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="5"  y1="11" x2="27" y2="21" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="5"  y1="21" x2="27" y2="11" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="16" cy="16" r="2.5" fill="white"/>
    </svg>
  ),
  hubspot: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#ff7a59"/>
      <circle cx="21" cy="11" r="3.5" fill="white"/>
      <path
        d="M21 14.5v2.5a5.5 5.5 0 11-5.5-5.5H18"
        fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"
      />
    </svg>
  ),
}

// ─── Node ────────────────────────────────────────────────────────────────────

interface NodeData {
  label: string
  sublabel?: string
  logoKey: string
  url?: string
  status?: 'active' | 'idle'
  tag?: string
  animDelay?: number
  category?: string
  clickable?: boolean
  [key: string]: unknown
}

const categoryColor: Record<string, string> = {
  source:      '#6366f1',
  connector:   '#0891b2',
  platform:    '#8b5cf6',
  destination: '#0073e6',
  transform:   '#7c3aed',
  warehouse:   '#29b5e8',
  crm:         '#ff7a59',
}

interface PipelineNodeProps extends NodeProps {
  onBIClick?: () => void
}

function PipelineNode({ data, id }: NodeProps) {
  const nd = data as NodeData
  const isActive    = nd.status === 'active'
  const isClickable = !!nd.clickable || !!nd.url
  const color       = categoryColor[nd.category ?? 'source'] ?? '#6366f1'

  const handleClick = () => {
    if (nd.url) window.open(nd.url as string, '_blank')
  }

  return (
    <div
      className={`df-node ${isActive ? 'active' : ''}`}
      style={{
        animationDelay: `${(nd.animDelay ?? 0) * 45}ms`,
        cursor: isClickable ? 'pointer' : 'default',
        outline: nd.clickable ? `2px solid ${color}40` : undefined,
      }}
      onClick={handleClick}
      title={nd.clickable ? 'Click to view BI charts' : nd.url ? `Open ${nd.label}` : nd.label}
    >
      <Handle type="target" position={Position.Left}  id="in"  />
      <Handle type="source" position={Position.Right} id="out" />

      <div style={{
        position: 'absolute', top: 0, left: 20, right: 20, height: 3,
        borderRadius: '0 0 2px 2px',
        background: isActive
          ? `linear-gradient(90deg, transparent, ${color}, transparent)`
          : 'transparent',
        transition: 'background 200ms ease-out',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{
          flexShrink: 0, width: 46, height: 46, borderRadius: 12,
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(30,27,75,0.07)',
        }}>
          {logos[nd.logoKey] ?? <span style={{ fontSize: 20 }}>◈</span>}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontWeight: 600, fontSize: 15,
            color: 'var(--ink-primary)',
            lineHeight: 1.25, letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
          }}>{nd.label}</div>
          {nd.sublabel && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11, color: 'var(--ink-tertiary)',
              marginTop: 3, letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}>{nd.sublabel}</div>
          )}
        </div>

        <div style={{ flexShrink: 0, position: 'relative', width: 9, height: 9 }}>
          <div style={{
            width: 9, height: 9, borderRadius: '50%',
            background: isActive ? '#16a34a' : 'var(--ink-ghost)',
            boxShadow: isActive ? '0 0 0 2px rgba(22,163,74,0.22)' : 'none',
          }} />
          {isActive && (
            <div style={{
              position: 'absolute', inset: -2, borderRadius: '50%',
              border: '1.5px solid rgba(22,163,74,0.3)',
              animation: 'pulse-ring 2s ease-out infinite',
            }} />
          )}
        </div>
      </div>

      {nd.tag && (
        <div style={{
          marginTop: 11,
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 10px', borderRadius: 5,
          background: `${color}14`, border: `1px solid ${color}30`,
          fontFamily: 'var(--font-mono)',
          fontSize: 10, color, letterSpacing: '0.07em',
          textTransform: 'uppercase' as const, fontWeight: 500,
        }}>
          {nd.tag}
        </div>
      )}
    </div>
  )
}

// ─── Layer label ──────────────────────────────────────────────────────────────

function LayerLabel({ data }: NodeProps) {
  const d = data as { label: string; [key: string]: unknown }
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5, letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: 'var(--ink-secondary)',
      fontWeight: 500, padding: '3px 0',
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {d.label}
    </div>
  )
}

// ─── Silk edge ────────────────────────────────────────────────────────────────

function SilkEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const seed   = parseInt(id.replace(/\D/g, '').slice(0, 4) || '999', 10)
  const dur1   = 2.0 + (seed % 1400) / 1000
  const dur2   = dur1 * 1.35
  const delay1 = (seed % 2800) / 1000
  const delay2 = ((seed * 11) % 2200) / 1000

  return (
    <g>
      <path d={edgePath} fill="none" stroke="rgba(99,102,241,0.06)" strokeWidth={7} />
      <path d={edgePath} fill="none" stroke="rgba(99,102,241,0.16)" strokeWidth={1.5} />
      <path d={edgePath} fill="none" stroke="rgba(99,102,241,0.48)" strokeWidth={1.5}
        strokeDasharray="5 9"
        style={{ animation: `silk-flow ${dur1}s linear infinite`, animationDelay: `${delay1}s` }}
      />
      <circle r={3.5} fill="#6366f1" style={{ filter: 'drop-shadow(0 0 4px rgba(99,102,241,0.75))' }}>
        <animateMotion dur={`${dur1 * 1.2}s`} repeatCount="indefinite" begin={`${delay1}s`} path={edgePath} />
        <animate attributeName="opacity" values="0;1;1;0" dur={`${dur1 * 1.2}s`} repeatCount="indefinite" begin={`${delay1}s`} />
        <animate attributeName="r" values="2;3.5;2" dur={`${dur1 * 1.2}s`} repeatCount="indefinite" begin={`${delay1}s`} />
      </circle>
      <circle r={2} fill="#a5b4fc" style={{ filter: 'drop-shadow(0 0 3px rgba(165,180,252,0.65))' }}>
        <animateMotion dur={`${dur2}s`} repeatCount="indefinite" begin={`${delay2}s`} path={edgePath} />
        <animate attributeName="opacity" values="0;0.75;0.75;0" dur={`${dur2}s`} repeatCount="indefinite" begin={`${delay2}s`} />
      </circle>
    </g>
  )
}

const nodeTypes = { pipeline: PipelineNode, layer: LayerLabel }
const edgeTypes = { silk: SilkEdge }

// ─── Layout constants ─────────────────────────────────────────────────────────
//
//  Sources    ELT        Snow Raw   Transforms  Snow Clean  Rev ETL   HubSpot
//  [Postgres] [FTV Conn]            [Transforms]            [RevETL]
//                        [Snow Raw]              [Snow Clean]         [HubSpot]
//  [Kafka]

const COL = { src: 20, conn: 260, sraw: 500, xfm: 740, sclean: 980, retl: 1220, hub: 1460 }
const ROW = { top: 80, mid: 185, bot: 290 }

function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    // Layer labels
    { id: 'lbl-src',    type: 'layer', position: { x: COL.src,    y: 20 }, data: { label: 'Sources'     }, draggable: false },
    { id: 'lbl-conn',   type: 'layer', position: { x: COL.conn,   y: 20 }, data: { label: 'ELT'         }, draggable: false },
    { id: 'lbl-sraw',   type: 'layer', position: { x: COL.sraw,   y: 20 }, data: { label: 'Snowflake Raw'}, draggable: false },
    { id: 'lbl-xfm',    type: 'layer', position: { x: COL.xfm,    y: 20 }, data: { label: 'Transforms'  }, draggable: false },
    { id: 'lbl-sclean', type: 'layer', position: { x: COL.sclean, y: 20 }, data: { label: 'Snowflake ✦' }, draggable: false },
    { id: 'lbl-retl',   type: 'layer', position: { x: COL.retl,   y: 20 }, data: { label: 'Reverse ETL' }, draggable: false },
    { id: 'lbl-hub',    type: 'layer', position: { x: COL.hub,    y: 20 }, data: { label: 'HubSpot'     }, draggable: false },

    // Sources
    {
      id: 'pg-source', type: 'pipeline', position: { x: COL.src, y: ROW.top },
      data: { label: 'Postgres', sublabel: 'Finance · Revenue', logoKey: 'postgres',
              url: 'http://localhost:5050', status: 'active', tag: 'source',
              category: 'source', animDelay: 0 },
    },
    {
      id: 'kafka-source', type: 'pipeline', position: { x: COL.src, y: ROW.bot },
      data: { label: 'Kafka', sublabel: 'shopstream.finance', logoKey: 'kafka',
              url: 'http://localhost:8080', status: 'active', tag: 'streaming',
              category: 'source', animDelay: 1 },
    },

    // ELT connector
    {
      id: 'ftv-connector', type: 'pipeline', position: { x: COL.conn, y: ROW.mid },
      data: { label: 'Fivetran ELT', sublabel: 'Postgres + Kafka sync', logoKey: 'fivetran',
              url: 'https://fivetran.com/dashboard/connections', status: 'active', tag: 'connector',
              category: 'connector', animDelay: 2 },
    },

    // Snowflake raw
    {
      id: 'snow-raw', type: 'pipeline', position: { x: COL.sraw, y: ROW.mid },
      data: { label: 'Snowflake Raw', sublabel: 'invoices · payments · events', logoKey: 'snowflake',
              url: 'https://app.snowflake.com', status: 'active', tag: 'raw',
              category: 'warehouse', animDelay: 3 },
    },

    // Fivetran transforms
    {
      id: 'ftv-transforms', type: 'pipeline', position: { x: COL.xfm, y: ROW.mid },
      data: { label: 'Fivetran Transforms', sublabel: 'No Airflow · runs after sync', logoKey: 'fivetran',
              url: 'https://fivetran.com/dashboard/transformations', status: 'active', tag: 'dbt · managed',
              category: 'transform', animDelay: 4 },
    },

    // Snowflake transformed (clickable → BI modal)
    {
      id: 'snow-transformed', type: 'pipeline', position: { x: COL.sclean, y: ROW.mid },
      data: {
        label: 'Snowflake Clean', sublabel: 'invoice_aging · segments · MRR', logoKey: 'snowflake',
        status: 'active', tag: 'transformed', category: 'warehouse', animDelay: 5,
        clickable: true,
      },
    },

    // Reverse ETL
    {
      id: 'ftv-reverse-etl', type: 'pipeline', position: { x: COL.retl, y: ROW.mid },
      data: { label: 'Reverse ETL', sublabel: 'Snowflake → HubSpot', logoKey: 'fivetran',
              url: 'https://fivetran.com/dashboard/reverse-etl', status: 'active', tag: 'reverse etl',
              category: 'platform', animDelay: 6 },
    },

    // HubSpot
    {
      id: 'hubspot', type: 'pipeline', position: { x: COL.hub, y: ROW.mid },
      data: { label: 'HubSpot CRM', sublabel: 'Customer segments', logoKey: 'hubspot',
              url: 'https://app.hubspot.com/contacts', status: 'active', tag: 'destination',
              category: 'crm', animDelay: 7 },
    },
  ]

  const e = (id: string, source: string, target: string): Edge => ({
    id, source, target,
    sourceHandle: 'out', targetHandle: 'in',
    type: 'silk',
    markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: 'rgba(99,102,241,0.45)' },
  })

  const edges: Edge[] = [
    e('e1', 'pg-source',      'ftv-connector'),
    e('e2', 'kafka-source',   'ftv-connector'),
    e('e3', 'ftv-connector',  'snow-raw'),
    e('e4', 'snow-raw',       'ftv-transforms'),
    e('e5', 'ftv-transforms', 'snow-transformed'),
    e('e6', 'snow-transformed','ftv-reverse-etl'),
    e('e7', 'ftv-reverse-etl','hubspot'),
  ]

  return { nodes, edges }
}

// ─── Graph ────────────────────────────────────────────────────────────────────

export default function FinanceGraph() {
  const [showModal, setShowModal] = useState(false)

  const { nodes: init, edges: initE } = buildGraph()
  const [nodes, , onNodesChange] = useNodesState(init)
  const [edges, , onEdgesChange] = useEdgesState(initE)

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes as never}
        onNodeClick={(_, node) => {
          if (node.id === 'snow-transformed') setShowModal(true)
          else if (node.data?.url) window.open(node.data.url as string, '_blank')
        }}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.9 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="rgba(99,102,241,0.10)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {showModal && <FinanceBIModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/components/FinanceGraph.tsx
git commit -m "feat: add FinanceGraph ReactFlow component (8 nodes, Snowflake click → BI modal)"
```

---

## Task 7: Wire Up Third Tab in `page.tsx`

**Files:**
- Modify: `ui/app/page.tsx`

- [ ] **Step 1: Update `ui/app/page.tsx`**

Replace the entire file with:

```tsx
'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import MetricsBar from '@/components/MetricsBar'

const loading = (
  <div style={{
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 14,
  }}>
    <div style={{ display: 'flex', gap: 6 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'rgba(79,70,229,0.3)',
          animation: `pulse-dot ${1 + i * 0.15}s ease-in-out infinite`,
          animationDelay: `${i * 0.18}s`,
        }} />
      ))}
    </div>
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10,
      letterSpacing: '0.16em', color: 'var(--ink-ghost)',
      textTransform: 'uppercase' as const,
    }}>
      Loading graph
    </span>
  </div>
)

const LineageGraph  = dynamic(() => import('@/components/LineageGraph'),  { ssr: false, loading: () => loading })
const FivetranGraph = dynamic(() => import('@/components/FivetranGraph'), { ssr: false, loading: () => loading })
const FinanceGraph  = dynamic(() => import('@/components/FinanceGraph'),  { ssr: false, loading: () => loading })

type Tab = 'shopstream' | 'fivetran-marketing' | 'fivetran-finance'

const TAB_CONFIG: Record<Tab, {
  label: string
  breadcrumb: { label: string; color: string }[]
  pill: string
}> = {
  'shopstream': {
    label: 'ShopStream',
    breadcrumb: [
      { label: 'Ingest',  color: '#0891b2' },
      { label: 'Bronze',  color: '#16a34a' },
      { label: 'Silver',  color: '#16a34a' },
      { label: 'Gold',    color: '#d97706' },
      { label: 'ML',      color: '#7c3aed' },
      { label: 'Serve',   color: '#be185d' },
    ],
    pill: 'Phase 5',
  },
  'fivetran-marketing': {
    label: 'Fivetran Marketing',
    breadcrumb: [
      { label: 'Sources',    color: '#6366f1' },
      { label: 'Connectors', color: '#0891b2' },
      { label: 'Fivetran',   color: '#8b5cf6' },
      { label: 'Snowflake',  color: '#0073e6' },
    ],
    pill: 'Fivetran',
  },
  'fivetran-finance': {
    label: 'Fivetran Finance',
    breadcrumb: [
      { label: 'Sources',     color: '#6366f1' },
      { label: 'ELT',         color: '#0891b2' },
      { label: 'Snowflake',   color: '#29b5e8' },
      { label: 'Transforms',  color: '#7c3aed' },
      { label: 'Reverse ETL', color: '#ff7a59' },
      { label: 'HubSpot',     color: '#ff7a59' },
    ],
    pill: 'Finance',
  },
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('shopstream')
  const { breadcrumb, pill } = TAB_CONFIG[activeTab]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      background: 'var(--bg-canvas)',
    }}>
      {/* ── Header ── */}
      <header style={{
        height: 'var(--header-h)',
        display: 'flex', alignItems: 'center',
        padding: '0 20px',
        background: 'rgba(248, 250, 255, 0.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-hairline)',
        boxShadow: 'var(--shadow-header)',
        flexShrink: 0, zIndex: 20, position: 'relative',
        animation: 'header-in 300ms cubic-bezier(0.23, 1, 0.32, 1)',
      }}>
        {/* Wordmark */}
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 22,
          fontWeight: 500, fontStyle: 'italic',
          color: 'var(--ink-primary)',
          letterSpacing: '-0.02em', lineHeight: 1, flexShrink: 0,
        }}>
          ShopStream
        </h1>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 16, flexShrink: 0 }}>
          {(Object.keys(TAB_CONFIG) as Tab[]).map(tab => {
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '4px 12px', borderRadius: 7,
                  border: isActive ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                  background: isActive ? 'rgba(99,102,241,0.10)' : 'transparent',
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#6366f1' : 'var(--ink-tertiary)',
                  letterSpacing: '0.05em', cursor: 'pointer',
                  transition: 'all 150ms ease-out',
                }}
              >
                {TAB_CONFIG[tab].label}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Pipeline breadcrumb */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {breadcrumb.map((s, i, arr) => (
            <span key={s.label} style={{
              display: 'flex', alignItems: 'center', gap: 2,
              opacity: 0,
              animation: 'pill-in 250ms cubic-bezier(0.23, 1, 0.32, 1) forwards',
              animationDelay: `${200 + i * 50}ms`,
            }}>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 11,
                fontWeight: 500, color: s.color, opacity: 0.75,
                padding: '2px 6px', borderRadius: 4,
                background: `${s.color}0f`, letterSpacing: '-0.01em',
              }}>{s.label}</span>
              {i < arr.length - 1 && (
                <span style={{ color: 'var(--ink-ghost)', fontSize: 10, margin: '0 1px' }}>›</span>
              )}
            </span>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Pill */}
        <div style={{
          padding: '4px 11px', borderRadius: 7,
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.20)',
          fontFamily: 'var(--font-mono)', fontSize: 9.5,
          color: '#6366f1', letterSpacing: '0.1em', fontWeight: 600,
        }}>
          {pill}
        </div>
      </header>

      {/* ── Graph canvas ── */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative', zIndex: 0 }}>
        {activeTab === 'shopstream'         && <LineageGraph />}
        {activeTab === 'fivetran-marketing' && <FivetranGraph />}
        {activeTab === 'fivetran-finance'   && <FinanceGraph />}

        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 55%, rgba(237,240,251,0.45) 100%)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      </main>

      {activeTab === 'shopstream' && <MetricsBar />}
    </div>
  )
}
```

- [ ] **Step 2: Verify UI compiles**

```bash
npm --prefix ui run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add ui/app/page.tsx
git commit -m "feat: add Fivetran Finance tab, rename marketing tab, refactor TAB_CONFIG"
```

---

## Task 8: ngrok + Kafka Producer in `scripts/setup.sh`

**Files:**
- Modify: `scripts/setup.sh`
- Modify: `.env.example`

- [ ] **Step 1: Add `NGROK_AUTHTOKEN` to `.env.example`**

Add these lines to `.env.example` (at the end of the file, before any trailing newline):

```
# ── Fivetran Finance ─────────────────────────────────────────────────────────
NGROK_AUTHTOKEN=          # https://dashboard.ngrok.com/get-started/your-authtoken
SNOWFLAKE_ACCOUNT=        # e.g. abc12345.us-east-1
SNOWFLAKE_USER=
SNOWFLAKE_PASSWORD=
SNOWFLAKE_DATABASE=SHOPSTREAM
SNOWFLAKE_SCHEMA=transformed
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
HUBSPOT_PORTAL_ID=        # found in HubSpot Settings → Account Setup → Account Details
```

- [ ] **Step 2: Add finance events + ngrok block to `scripts/setup.sh`**

Replace the `# 8. Done` section at the end of `scripts/setup.sh` with:

```bash
# 8. Produce Kafka finance events
echo ""
echo "→ Producing Kafka finance events..."
python3 seed/produce_finance_events.py && echo "✓ Finance events published."

# 9. ngrok tunnels (optional — for Fivetran demo)
echo ""
if ! command -v ngrok &> /dev/null; then
  echo "  (skipped) ngrok not found. Install to auto-expose for Fivetran:"
  echo "    Mac:   brew install ngrok/ngrok/ngrok"
  echo "    Linux: snap install ngrok"
  echo "  Then add NGROK_AUTHTOKEN=<token> to .env and re-run make setup."
elif [ -z "${NGROK_AUTHTOKEN:-}" ]; then
  echo "  (skipped) NGROK_AUTHTOKEN not set in .env"
  echo "  Get a free token at https://dashboard.ngrok.com/get-started/your-authtoken"
else
  # Authenticate ngrok (idempotent)
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" --log=false 2>/dev/null || true

  # Kill any existing ngrok processes
  pkill -f ngrok 2>/dev/null || true
  sleep 1

  # Start tunnels in background (ngrok only allows 1 session on free tier —
  # use a single ngrok process with multiple tunnels via config)
  cat > /tmp/ngrok-shopstream.yml << NGROK_EOF
version: "2"
authtoken: ${NGROK_AUTHTOKEN}
tunnels:
  postgres:
    proto: tcp
    addr: 5432
  kafka:
    proto: tcp
    addr: 9092
NGROK_EOF

  ngrok start --all --config /tmp/ngrok-shopstream.yml --log /tmp/ngrok.log &
  NGROK_PID=$!
  sleep 4  # wait for tunnels to be assigned

  # Query ngrok API to get public URLs
  TUNNELS_JSON=$(curl -sf http://localhost:4040/api/tunnels 2>/dev/null || echo '{}')
  PG_URL=$(echo "$TUNNELS_JSON" | python3 -c "
import sys, json
tunnels = json.load(sys.stdin).get('tunnels', [])
for t in tunnels:
    if '5432' in t.get('config', {}).get('addr', ''):
        addr = t['public_url'].replace('tcp://', '')
        host, port = addr.rsplit(':', 1)
        print(f'{host} {port}')
        break
" 2>/dev/null || echo "")
  KAFKA_URL=$(echo "$TUNNELS_JSON" | python3 -c "
import sys, json
tunnels = json.load(sys.stdin).get('tunnels', [])
for t in tunnels:
    if '9092' in t.get('config', {}).get('addr', ''):
        addr = t['public_url'].replace('tcp://', '')
        print(addr)
        break
" 2>/dev/null || echo "")

  PG_HOST=$(echo "$PG_URL" | cut -d' ' -f1)
  PG_PORT=$(echo "$PG_URL" | cut -d' ' -f2)

  if [ -n "$PG_HOST" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    echo "║   Fivetran Finance — Connection Details (copy-paste these)           ║"
    echo "╠══════════════════════════════════════════════════════════════════════╣"
    echo "║                                                                      ║"
    echo "║   POSTGRES SOURCE CONNECTOR                                          ║"
    printf "║   Host:      %-55s║\n" "$PG_HOST"
    printf "║   Port:      %-55s║\n" "$PG_PORT"
    echo "║   Database:  shopstream                                              ║"
    echo "║   User:      admin                                                   ║"
    echo "║   Password:  admin                                                   ║"
    echo "║   Tables:    finance_invoices, finance_payments, customers           ║"
    echo "║                                                                      ║"
    echo "║   KAFKA SOURCE CONNECTOR                                             ║"
    printf "║   Bootstrap: %-55s║\n" "$KAFKA_URL"
    echo "║   Topic:     shopstream.finance                                      ║"
    echo "║   Protocol:  PLAINTEXT                                               ║"
    echo "║                                                                      ║"
    echo "║   HUBSPOT REVERSE ETL — FIELD MAPPINGS                               ║"
    echo "║   Source:    SHOPSTREAM.transformed.customer_segments                ║"
    echo "║   Unique ID: customer_id → Contact External ID                       ║"
    echo "║   segment      → revenue_segment (custom property)                   ║"
    echo "║   total_paid   → total_revenue   (custom property)                   ║"
    echo "║                                                                      ║"
    echo "║   Fivetran:  https://fivetran.com/dashboard                          ║"
    printf "║   HubSpot:   https://app.hubspot.com/contacts/%-24s║\n" "${HUBSPOT_PORTAL_ID:-<your-portal-id>}"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
  else
    echo "  ⚠ ngrok started but could not read tunnel URLs — check http://localhost:4040"
  fi
fi

# 10. Done
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   DataFabric is running!                                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║   Lineage UI   →  http://localhost:3000                      ║"
echo "║   Airflow      →  http://localhost:8082  (admin / admin)     ║"
echo "║   MLflow       →  http://localhost:5001                      ║"
echo "║   FastAPI docs →  http://localhost:8001/docs                 ║"
echo "║   Kafka UI     →  http://localhost:8080                      ║"
echo "║   Spark UI     →  http://localhost:4040                      ║"
echo "║   pgAdmin      →  http://localhost:5050  (admin@example.com / Admin1234) ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Commands:  make up | make down | make logs | make clean"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/setup.sh .env.example
git commit -m "feat: add Kafka finance events + ngrok auto-tunnel to make setup"
```

---

## Task 9: `make down` Demo Reset (`scripts/teardown.sh` + `Makefile`)

**Files:**
- Create: `scripts/teardown.sh`
- Modify: `Makefile`

- [ ] **Step 1: Create `scripts/teardown.sh`**

```bash
#!/usr/bin/env bash
# Demo reset: kill ngrok, truncate finance tables, reset Kafka topic.
# Called by `make down` before stopping Docker. Non-fatal — continues even if steps fail.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && export $(grep -v '^#' .env | xargs) 2>/dev/null || true
PGUSER=${POSTGRES_USER:-admin}
PGDB=${POSTGRES_DB:-shopstream}

echo "→ Stopping ngrok tunnels..."
pkill -f ngrok 2>/dev/null && echo "  ✓ ngrok stopped" || echo "  (ngrok was not running)"

echo "→ Truncating finance tables..."
docker compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" \
  -c "TRUNCATE finance_payments, finance_invoices RESTART IDENTITY CASCADE;" \
  2>/dev/null && echo "  ✓ finance tables truncated" \
  || echo "  (skipped — postgres not running)"

echo "→ Resetting Kafka topic shopstream.finance..."
docker compose exec -T kafka \
  kafka-topics.sh --bootstrap-server localhost:9092 \
  --delete --topic shopstream.finance 2>/dev/null || true
docker compose exec -T kafka \
  kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic shopstream.finance \
  --partitions 1 --replication-factor 1 2>/dev/null \
  && echo "  ✓ shopstream.finance reset" \
  || echo "  (skipped — kafka not running)"

echo "✓ Demo state reset complete."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/teardown.sh
```

- [ ] **Step 3: Update `Makefile` `down` target**

In `Makefile`, replace:

```makefile
## Stop all services
down:
	docker compose --profile core down
```

with:

```makefile
## Stop services and reset demo state (finance tables + kafka + ngrok)
down:
	bash scripts/teardown.sh
	docker compose --profile core down
```

- [ ] **Step 4: Test teardown (requires Docker running)**

```bash
make down
```

Expected output includes ngrok stop message, finance table truncation, Kafka topic reset, then Docker services stopping.

- [ ] **Step 5: Commit**

```bash
git add scripts/teardown.sh Makefile
git commit -m "feat: extend make down with demo reset (ngrok + finance tables + kafka topic)"
```

---

## Task 10: Fivetran Setup Guide

**Files:**
- Create: `docs/fivetran-finance-setup.md`

- [ ] **Step 1: Create `docs/fivetran-finance-setup.md`**

This is a verbatim copy of Section 9 from the design spec at `docs/superpowers/specs/2026-04-17-fivetran-finance-design.md`. Extract sections 9 (Steps 1–9) and format as a standalone guide with a clear title and intro paragraph.

The guide must contain all 9 steps with full click-by-click instructions. Do not abbreviate. Reference the printed `make setup` output for Steps 3 and 4 connection details.

- [ ] **Step 2: Commit**

```bash
git add docs/fivetran-finance-setup.md
git commit -m "docs: add Fivetran Finance click-by-click setup guide"
```

---

## Task 11: Rebuild UI + FastAPI and Smoke Test

**Files:** None new — verification only.

- [ ] **Step 1: Rebuild FastAPI with new dependency**

```bash
docker compose --profile core build fastapi
docker compose --profile core up -d fastapi
```

- [ ] **Step 2: Rebuild UI**

```bash
docker compose --profile core build ui
docker compose --profile core up -d ui
```

- [ ] **Step 3: Smoke test the finance endpoint**

```bash
curl -s http://localhost:8001/api/finance/charts | python3 -m json.tool | head -30
```

Expected: valid JSON with `"simulated": true` and 4 non-empty arrays.

- [ ] **Step 4: Smoke test the UI**

Open http://localhost:3000. Verify:
- Three tabs appear: "ShopStream", "Fivetran Marketing", "Fivetran Finance"
- Clicking "Fivetran Finance" shows the 8-node graph
- Clicking "Snowflake Clean" node opens the BI modal with 4 chart tabs
- Charts render with data (simulated badge visible)
- Clicking "Fivetran Marketing" still works (existing tab, now renamed)
- ShopStream tab unchanged

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: verify Fivetran Finance tab end-to-end (simulated data mode)"
```
