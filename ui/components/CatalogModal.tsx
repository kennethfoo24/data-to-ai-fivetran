'use client'

import React, { useEffect, useState, useCallback } from 'react'

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

export interface ModalTarget {
  nodeId: string        // e.g. 'bronze', 'dbt-silver', 'gold'
  label: string
  layer: 'bronze' | 'silver' | 'gold'
  isDbt: boolean
}

// ─── Static SQL sources ───────────────────────────────────────────────────────

const SQL_SOURCES: Record<string, string> = {
  orders_clean: `SELECT
  CAST(order_id    AS BIGINT)  AS order_id,
  CAST(customer_id AS BIGINT)  AS customer_id,
  CAST(product_id  AS BIGINT)  AS product_id,
  CAST(quantity    AS INT)     AS quantity,
  CAST(unit_price  AS DOUBLE)  AS unit_price,
  CAST(discount_pct AS INT)    AS discount_pct,
  status,
  CAST(order_date  AS DATE)    AS order_date,
  CASE WHEN return_date IS NULL OR CAST(return_date AS STRING) = ''
       THEN NULL
       ELSE CAST(return_date AS DATE)
  END AS return_date,
  CAST(unit_price * quantity * (1 - discount_pct / 100.0) AS DOUBLE) AS net_revenue
FROM bronze.orders
WHERE order_id    IS NOT NULL
  AND customer_id IS NOT NULL
  AND customer_id BETWEEN 1 AND 2000
  AND product_id  BETWEEN 1 AND 200`,

  customers_clean: `WITH deduped AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY customer_id) AS rn
  FROM bronze.customers
  WHERE customer_id IS NOT NULL
    AND email IS NOT NULL
)
SELECT
  CAST(customer_id AS BIGINT) AS customer_id,
  TRIM(name)                  AS name,
  LOWER(TRIM(email))          AS email,
  city,
  country,
  CAST(signup_date AS DATE)   AS signup_date,
  CAST(age AS INT)            AS age,
  loyalty_tier
FROM deduped
WHERE rn = 1`,

  clickstream_sessions: `WITH base AS (
  SELECT * FROM bronze.clickstream
  WHERE event_timestamp IS NOT NULL
    AND customer_id IS NOT NULL
),
with_gap AS (
  SELECT *,
    LAG(event_timestamp) OVER (
      PARTITION BY customer_id ORDER BY event_timestamp
    ) AS prev_ts
  FROM base
),
labeled AS (
  SELECT *,
    SUM(CASE WHEN prev_ts IS NULL
          OR (UNIX_TIMESTAMP(event_timestamp) - UNIX_TIMESTAMP(prev_ts)) > 1800
        THEN 1 ELSE 0 END)
    OVER (PARTITION BY customer_id ORDER BY event_timestamp
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_num
  FROM with_gap
)
SELECT
  customer_id,
  CONCAT(CAST(customer_id AS STRING), '_', CAST(session_num AS STRING)) AS session_id,
  MIN(event_timestamp)  AS session_start,
  MAX(event_timestamp)  AS session_end,
  COUNT(*)              AS event_count,
  UNIX_TIMESTAMP(MAX(event_timestamp)) - UNIX_TIMESTAMP(MIN(event_timestamp)) AS duration_seconds,
  SUM(CASE WHEN event_type = 'purchase'    THEN 1 ELSE 0 END) AS purchases,
  SUM(CASE WHEN event_type = 'add_to_cart' THEN 1 ELSE 0 END) AS add_to_carts
FROM labeled
GROUP BY customer_id, session_num`,

  customer_features: `WITH order_stats AS (
  SELECT
    customer_id,
    COUNT(*)                                              AS order_count,
    SUM(net_revenue)                                      AS total_spend,
    MAX(order_date)                                       AS last_order_date,
    SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END)  AS return_count
  FROM silver.orders_clean
  GROUP BY customer_id
),
session_stats AS (
  SELECT
    customer_id,
    AVG(duration_seconds) AS avg_session_seconds
  FROM silver.clickstream_sessions
  GROUP BY customer_id
)
SELECT
  c.customer_id,
  COALESCE(o.order_count,  0)   AS order_count,
  COALESCE(o.total_spend,  0.0) AS total_spend,
  DATEDIFF(CURRENT_DATE(), o.last_order_date) AS days_since_last_order,
  CASE WHEN o.order_count > 0
       THEN o.return_count / CAST(o.order_count AS DOUBLE)
       ELSE 0.0 END             AS return_rate,
  COALESCE(s.avg_session_seconds, 0.0) AS avg_session_seconds
FROM silver.customers_clean c
LEFT JOIN order_stats   o ON c.customer_id = o.customer_id
LEFT JOIN session_stats s ON c.customer_id = s.customer_id`,

  product_interactions: `SELECT
  o.customer_id,
  o.product_id,
  MAX(CASE WHEN c.event_type = 'product_view' THEN 1 ELSE 0 END) AS viewed,
  MAX(CASE WHEN o.status IN ('completed', 'pending')              THEN 1 ELSE 0 END) AS purchased,
  MAX(CASE WHEN o.status = 'returned'                             THEN 1 ELSE 0 END) AS returned
FROM silver.orders_clean o
LEFT JOIN bronze.clickstream c
       ON o.customer_id = c.customer_id
      AND o.product_id  = c.product_id
GROUP BY o.customer_id, o.product_id`,
}

const GITHUB_BASE = 'https://github.com/kennethfoo24/data-to-ai-fivetran/blob/main/dbt/models'

const LAYER_TABLES: Record<string, string[]> = {
  bronze: ['customers', 'orders', 'products', 'clickstream'],
  silver: ['orders_clean', 'customers_clean', 'clickstream_sessions'],
  gold:   ['customer_features', 'product_interactions'],
}

const DBT_LAYER: Record<string, string> = {
  'dbt-silver': 'silver',
  'dbt-gold':   'gold',
}

// ─── SQL highlight (minimal, no deps) ────────────────────────────────────────

function highlightSQL(sql: string): React.ReactNode[] {
  const keywords = /\b(SELECT|FROM|WHERE|WITH|AS|LEFT|JOIN|ON|GROUP\s+BY|ORDER\s+BY|PARTITION\s+BY|OVER|ROWS\s+BETWEEN|UNBOUNDED\s+PRECEDING|CURRENT\s+ROW|AND|OR|NOT|IN|IS|NULL|CASE|WHEN|THEN|ELSE|END|CAST|COUNT|SUM|MAX|MIN|AVG|COALESCE|CONCAT|TRIM|LOWER|DATEDIFF|UNIX_TIMESTAMP|LAG|ROW_NUMBER|DISTINCT|CURRENT_DATE)\b/gi
  const parts = sql.split(/(--[^\n]*|'[^']*'|\b(?:SELECT|FROM|WHERE|WITH|AS|LEFT|JOIN|ON|GROUP BY|ORDER BY|PARTITION BY|OVER|ROWS BETWEEN|UNBOUNDED PRECEDING|CURRENT ROW|AND|OR|NOT|IN|IS|NULL|CASE|WHEN|THEN|ELSE|END|CAST|COUNT|SUM|MAX|MIN|AVG|COALESCE|CONCAT|TRIM|LOWER|DATEDIFF|UNIX_TIMESTAMP|LAG|ROW_NUMBER|DISTINCT|CURRENT_DATE)\b)/gi)
  return parts.map((part, i) => {
    if (!part) return null
    if (keywords.test(part)) {
      keywords.lastIndex = 0
      return <span key={i} style={{ color: '#818cf8', fontWeight: 500 }}>{part}</span>
    }
    if (part.startsWith("'")) return <span key={i} style={{ color: '#34d399' }}>{part}</span>
    if (part.startsWith('--')) return <span key={i} style={{ color: '#6b7280', fontStyle: 'italic' }}>{part}</span>
    return <span key={i}>{part}</span>
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SchemaTable({ columns }: { columns: Column[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          <th style={thStyle}>Column</th>
          <th style={thStyle}>Type</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col, i) => (
          <tr key={col.name} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.018)' }}>
            <td style={tdStyleMono}>{col.name}</td>
            <td style={{ ...tdStyle, color: 'var(--ink-tertiary)' }}>{col.type}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SampleRows({ columns, rows }: { columns: Column[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <div style={{ color: 'var(--ink-tertiary)', fontSize: 12, padding: '12px 0' }}>No rows available</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, whiteSpace: 'nowrap' }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.name} style={thStyle}>{col.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.018)' }}>
              {columns.map(col => (
                <td key={col.name} style={tdStyleMono}>
                  {row[col.name] == null ? <span style={{ color: 'var(--ink-ghost)' }}>null</span> : String(row[col.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Table panel (schema + sample) ───────────────────────────────────────────

function TablePanel({ layer, table, apiUrl }: { layer: string; table: string; apiUrl: string }) {
  const [data, setData] = useState<CatalogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'schema' | 'data'>('schema')

  useEffect(() => {
    setLoading(true)
    setData(null)
    fetch(`${apiUrl}/api/catalog/${layer}/${table}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [layer, table, apiUrl])

  if (loading) return <div style={loadingStyle}>Loading…</div>
  if (!data) return <div style={errorStyle}>Failed to fetch data. Is FastAPI running?</div>
  if (!data.available) return <div style={errorStyle}>{data.message ?? 'Table not yet populated — run the pipeline.'}</div>

  return (
    <div>
      {/* Row count badge */}
      {data.row_count != null && (
        <div style={{ marginBottom: 12 }}>
          <span style={badgeStyle}>~{data.row_count.toLocaleString()} rows</span>
        </div>
      )}

      {/* Schema / Data tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['schema', 'data'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={tab === t ? activeTabStyle : tabStyle}>
            {t === 'schema' ? 'Schema' : 'Sample data'}
          </button>
        ))}
      </div>

      {tab === 'schema'
        ? <SchemaTable columns={data.columns} />
        : <SampleRows columns={data.columns} rows={data.rows} />
      }
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface CatalogModalProps {
  target: ModalTarget | null
  onClose: () => void
  apiUrl: string
}

export default function CatalogModal({ target, onClose, apiUrl }: CatalogModalProps) {
  const [activeTable, setActiveTable] = useState<string>('')
  const [sqlTab, setSqlTab] = useState<'sql' | 'output'>('sql')

  // Derive layer + tables list
  const layer = target
    ? (target.isDbt ? DBT_LAYER[target.nodeId] : target.layer) as string
    : ''
  const tables = layer ? LAYER_TABLES[layer] ?? [] : []

  useEffect(() => {
    if (tables.length > 0) setActiveTable(tables[0])
  }, [target])

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!target) return null

  const isDbt = target.isDbt
  const githubPath = isDbt && activeTable
    ? `${GITHUB_BASE}/${layer}/${activeTable}.sql`
    : null
  const catalogUrl = activeTable ? `/catalog/${layer}/${activeTable}` : null

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26,23,20,0.45)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        animation: 'fadeIn 150ms var(--ease-out)',
      }}
    >
      <div style={{
        background: 'var(--bg-raised)',
        borderRadius: 16,
        border: '1px solid var(--border-light)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
        width: '100%',
        maxWidth: isDbt ? 860 : 640,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'slideUp 200ms var(--ease-out)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontWeight: 600,
              fontSize: 14,
              color: 'var(--ink-primary)',
            }}>
              {target.label}
            </span>
            <span style={{ ...badgeStyle, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {layer}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {githubPath && (
              <a href={githubPath} target="_blank" rel="noreferrer" style={linkStyle}>
                View on GitHub ↗
              </a>
            )}
            {catalogUrl && (
              <a href={catalogUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                Full page ↗
              </a>
            )}
            <button onClick={onClose} style={closeStyle} aria-label="Close">✕</button>
          </div>
        </div>

        {/* Table tabs */}
        <div style={{
          display: 'flex', gap: 2, padding: '10px 20px 0',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0, overflowX: 'auto',
        }}>
          {tables.map(t => (
            <button
              key={t}
              onClick={() => setActiveTable(t)}
              style={activeTable === t ? activeTableTabStyle : tableTabStyle}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {isDbt ? (
            // dbt node: SQL + output side by side
            <div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
                {(['sql', 'output'] as const).map(t => (
                  <button key={t} onClick={() => setSqlTab(t)} style={sqlTab === t ? activeTabStyle : tabStyle}>
                    {t === 'sql' ? 'SQL' : 'Output preview'}
                  </button>
                ))}
              </div>
              {sqlTab === 'sql' ? (
                <pre style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  background: '#0f1117',
                  borderRadius: 10,
                  padding: '14px 16px',
                  overflowX: 'auto',
                  color: '#e2e8f0',
                  margin: 0,
                }}>
                  {highlightSQL(SQL_SOURCES[activeTable] ?? '-- SQL not found')}
                </pre>
              ) : (
                <TablePanel layer={layer} table={activeTable} apiUrl={apiUrl} />
              )}
            </div>
          ) : (
            // Iceberg node: schema + sample
            <TablePanel layer={layer} table={activeTable} apiUrl={apiUrl} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--ink-tertiary)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  borderBottom: '1px solid var(--border-hairline)',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontFamily: 'var(--font-body)',
  fontSize: 12,
  color: 'var(--ink-primary)',
  borderBottom: '1px solid var(--border-hairline)',
}

const tdStyleMono: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
}

const tabStyle: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid var(--border-light)',
  background: 'transparent',
  fontFamily: 'var(--font-body)',
  fontSize: 12,
  color: 'var(--ink-secondary)',
  cursor: 'pointer',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: '#fff',
  fontWeight: 500,
}

const tableTabStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: '6px 6px 0 0',
  border: '1px solid transparent',
  borderBottom: 'none',
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-secondary)',
  cursor: 'pointer',
  marginBottom: -1,
}

const activeTableTabStyle: React.CSSProperties = {
  ...tableTabStyle,
  background: 'var(--bg-raised)',
  border: '1px solid var(--border-light)',
  borderBottom: '1px solid var(--bg-raised)',
  color: 'var(--ink-primary)',
  fontWeight: 500,
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 5,
  background: 'var(--accent-soft)',
  border: '1px solid rgba(79,70,229,0.15)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--accent)',
  fontWeight: 500,
}

const linkStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 12,
  color: 'var(--accent)',
  textDecoration: 'none',
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid rgba(79,70,229,0.2)',
}

const closeStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 6,
  border: '1px solid var(--border-light)',
  background: 'transparent',
  color: 'var(--ink-tertiary)',
  cursor: 'pointer',
  fontSize: 12,
}

const loadingStyle: React.CSSProperties = {
  color: 'var(--ink-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '24px 0',
  textAlign: 'center',
}

const errorStyle: React.CSSProperties = {
  color: 'var(--amber)',
  fontFamily: 'var(--font-body)',
  fontSize: 12,
  padding: '12px 0',
}
