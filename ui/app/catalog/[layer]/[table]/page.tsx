'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Column { name: string; type: string }

interface CatalogData {
  layer: string
  table: string
  columns: Column[]
  rows: Record<string, unknown>[]
  row_count: number | null
  available: boolean
  message?: string
}

const LAYER_TABLES: Record<string, string[]> = {
  bronze: ['customers', 'orders', 'products', 'clickstream'],
  silver: ['orders_clean', 'customers_clean', 'clickstream_sessions'],
  gold:   ['customer_features', 'product_interactions'],
}

const GITHUB_BASE = 'https://github.com/kennethfoo24/data-to-ai-fivetran/blob/main/dbt/models'
const DBT_LAYERS = new Set(['silver', 'gold'])

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

const LAYER_COLOR: Record<string, string> = {
  bronze: '#d97706',
  silver: '#64748b',
  gold:   '#ca8a04',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CatalogTablePage() {
  const params = useParams()
  const layer = (params?.layer as string) ?? ''
  const table = (params?.table as string) ?? ''

  const [data, setData] = useState<CatalogData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!layer || !table) return
    setLoading(true)
    setData(null)
    fetch(`${API_URL}/api/catalog/${layer}/${table}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [layer, table])

  const color = LAYER_COLOR[layer] ?? '#4f46e5'
  const isDbt = DBT_LAYERS.has(layer)
  const githubUrl = isDbt ? `${GITHUB_BASE}/${layer}/${table}.sql` : null

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-canvas)',
      display: 'flex',
      fontFamily: 'var(--font-body)',
    }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border-hairline)',
        background: 'var(--bg-surface)',
        padding: '20px 0',
        overflowY: 'auto',
      }}>
        <div style={{ padding: '0 16px 16px', borderBottom: '1px solid var(--border-hairline)' }}>
          <Link href="/" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--ink-tertiary)', textDecoration: 'none',
            letterSpacing: '0.04em',
          }}>
            ← Lineage UI
          </Link>
        </div>

        {Object.entries(LAYER_TABLES).map(([l, tables]) => (
          <div key={l} style={{ marginTop: 16 }}>
            <div style={{
              padding: '0 16px 6px',
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: LAYER_COLOR[l] ?? 'var(--ink-ghost)',
              fontWeight: 500,
            }}>
              {l}
            </div>
            {tables.map(t => {
              const isActive = l === layer && t === table
              return (
                <Link
                  key={t}
                  href={`/catalog/${l}/${t}`}
                  style={{
                    display: 'block',
                    padding: '6px 16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: isActive ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                    textDecoration: 'none',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    borderLeft: isActive ? `2px solid var(--accent)` : '2px solid transparent',
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  {t}
                </Link>
              )
            })}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px 40px', overflowX: 'auto' }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--ink-primary)',
                letterSpacing: '-0.02em',
              }}>
                {table}
              </h1>
              <span style={{
                padding: '2px 10px',
                borderRadius: 6,
                background: `${color}18`,
                border: `1px solid ${color}30`,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                {layer}
              </span>
            </div>
            {data?.row_count != null && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-tertiary)' }}>
                ~{data.row_count.toLocaleString()} rows
              </div>
            )}
          </div>
          {githubUrl && (
            <a href={githubUrl} target="_blank" rel="noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              borderRadius: 8,
              border: '1px solid rgba(79,70,229,0.25)',
              background: 'var(--accent-soft)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--accent)',
              textDecoration: 'none',
              fontWeight: 500,
            }}>
              View on GitHub ↗
            </a>
          )}
        </div>

        {loading && (
          <div style={{ color: 'var(--ink-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {!loading && !data && (
          <div style={{ color: 'var(--amber)', fontSize: 13 }}>
            Failed to fetch data. Is FastAPI running at {API_URL}?
          </div>
        )}

        {!loading && data && !data.available && (
          <div style={{ color: 'var(--amber)', fontSize: 13 }}>
            {data.message ?? 'Table not yet populated — run the pipeline (make seed).'}
          </div>
        )}

        {!loading && data?.available && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {/* Schema */}
            <section>
              <h2 style={sectionHeadStyle}>Schema</h2>
              <div style={{
                border: '1px solid var(--border-hairline)',
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--bg-raised)',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                      <th style={thStyle}>Column</th>
                      <th style={thStyle}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.columns.map((col, i) => (
                      <tr key={col.name} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                        <td style={tdMono}>{col.name}</td>
                        <td style={{ ...td, color: 'var(--ink-tertiary)' }}>{col.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Sample data */}
            <section>
              <h2 style={sectionHeadStyle}>Sample data <span style={{ color: 'var(--ink-ghost)', fontWeight: 400 }}>(5 rows)</span></h2>
              <div style={{
                border: '1px solid var(--border-hairline)',
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--bg-raised)',
                overflowX: 'auto',
              }}>
                {data.rows.length === 0 ? (
                  <div style={{ padding: '16px 20px', color: 'var(--ink-tertiary)', fontSize: 12 }}>No rows available</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                        {data.columns.map(col => (
                          <th key={col.name} style={thStyle}>{col.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                          {data.columns.map(col => (
                            <td key={col.name} style={tdMono}>
                              {row[col.name] == null
                                ? <span style={{ color: 'var(--ink-ghost)' }}>null</span>
                                : String(row[col.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sectionHeadStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--ink-primary)',
  marginBottom: 10,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 14px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--ink-tertiary)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  borderBottom: '1px solid var(--border-hairline)',
}

const td: React.CSSProperties = {
  padding: '7px 14px',
  fontFamily: 'var(--font-body)',
  fontSize: 12.5,
  color: 'var(--ink-primary)',
  borderBottom: '1px solid var(--border-hairline)',
}

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
}
