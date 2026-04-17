'use client'

import React, { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'

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

interface Props { onClose: () => void }

const FASTAPI_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

const P = {
  indigo: '#6366f1', teal: '#0891b2', amber: '#d97706',
  rose: '#e11d48', green: '#16a34a',
}

const PIE_COLORS = [P.indigo, P.teal, P.amber]

const SEGMENT_COLORS: Record<string, string> = {
  champion: P.green, at_risk: P.amber, churned: P.rose,
}

const AGING_COLORS: Record<string, string> = {
  paid: P.green, current: P.indigo, '1-30 days': P.amber,
  '31-60 days': P.rose, '60+ days': '#991b1b',
}

type TabKey = 'mrr' | 'methods' | 'aging' | 'segments'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'mrr',      label: 'MRR Trend' },
  { key: 'methods',  label: 'Payment Mix' },
  { key: 'aging',    label: 'Invoice Aging' },
  { key: 'segments', label: 'Customer Health' },
]

export default function FinanceBIModal({ onClose }: Props) {
  const [data, setData]       = useState<ChartsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setTab]   = useState<TabKey>('mrr')

  useEffect(() => {
    fetch(`${FASTAPI_URL}/api/finance/charts`, { cache: 'no-store' })
      .then(r => r.json()).then(setData).catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15,15,35,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 680, maxHeight: '80vh',
          background: 'var(--bg-surface, #fff)', borderRadius: 16,
          border: '1px solid var(--border-hairline, rgba(99,102,241,0.15))',
          boxShadow: '0 24px 64px rgba(15,15,35,0.25)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px 0', borderBottom: '1px solid var(--border-hairline, rgba(99,102,241,0.12))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-body, sans-serif)', fontWeight: 700, fontSize: 16, color: 'var(--ink-primary, #1e1b4b)', letterSpacing: '-0.01em' }}>
              Snowflake · Finance Analytics
            </div>
            {data?.simulated && (
              <span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.3)', fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: '#d97706', letterSpacing: '0.06em' }}>
                SIMULATED
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-tertiary, #9ca3af)', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>

          <div style={{ display: 'flex', gap: 2 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '6px 14px', borderRadius: '6px 6px 0 0', border: 'none',
                background: activeTab === t.key ? 'rgba(99,102,241,0.10)' : 'transparent',
                borderBottom: activeTab === t.key ? '2px solid #6366f1' : '2px solid transparent',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
                fontWeight: activeTab === t.key ? 600 : 400,
                color: activeTab === t.key ? '#6366f1' : 'var(--ink-tertiary, #9ca3af)',
                cursor: 'pointer', letterSpacing: '0.04em',
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Chart body */}
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ textAlign: 'center', color: 'var(--ink-ghost, #c4c9e2)', paddingTop: 60 }}>Loading…</div>}
          {!loading && !data && <div style={{ textAlign: 'center', color: 'var(--ink-ghost, #c4c9e2)', paddingTop: 60 }}>Could not load chart data.</div>}

          {!loading && data && activeTab === 'mrr' && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.mrr_trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke={P.indigo} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {!loading && data && activeTab === 'methods' && (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={data.payment_methods} dataKey="revenue" nameKey="method" cx="50%" cy="50%" outerRadius={100} innerRadius={50}
                  label={({ name, percent }: { name?: string; percent?: number }) => name && percent != null ? `${name} ${(percent * 100).toFixed(0)}%` : ''}>
                  {data.payment_methods.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Revenue']} />
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
                  {data.invoice_aging.map((row, i) => <Cell key={i} fill={AGING_COLORS[row.bucket] ?? P.indigo} />)}
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
                  {data.customer_segments.map((row, i) => <Cell key={i} fill={SEGMENT_COLORS[row.segment] ?? P.indigo} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
