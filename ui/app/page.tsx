'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import MetricsBar from '@/components/MetricsBar'

const loading = (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
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
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.16em', color: 'var(--ink-ghost)', textTransform: 'uppercase' as const }}>
      Loading graph
    </span>
  </div>
)

const LineageGraph  = dynamic(() => import('@/components/LineageGraph'),  { ssr: false, loading: () => loading })
const FivetranGraph = dynamic(() => import('@/components/FivetranGraph'), { ssr: false, loading: () => loading })
const FinanceGraph  = dynamic(() => import('@/components/FinanceGraph'),  { ssr: false, loading: () => loading })

type Tab = 'shopstream' | 'fivetran-marketing' | 'fivetran-finance'

const TAB_CONFIG: Record<Tab, { label: string; breadcrumb: { label: string; color: string }[]; pill: string }> = {
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-canvas)' }}>

      {/* ── Header ── */}
      <header style={{
        height: 'var(--header-h)', display: 'flex', alignItems: 'center', padding: '0 20px',
        background: 'rgba(248, 250, 255, 0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-hairline)', boxShadow: 'var(--shadow-header)',
        flexShrink: 0, zIndex: 20, position: 'relative',
        animation: 'header-in 300ms cubic-bezier(0.23, 1, 0.32, 1)',
      }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, fontStyle: 'italic', color: 'var(--ink-primary)', letterSpacing: '-0.02em', lineHeight: 1, flexShrink: 0 }}>
          ShopStream
        </h1>

        <div style={{ display: 'flex', gap: 2, marginLeft: 16, flexShrink: 0 }}>
          {(Object.keys(TAB_CONFIG) as Tab[]).map(tab => {
            const isActive = activeTab === tab
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '4px 12px', borderRadius: 7,
                border: isActive ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                background: isActive ? 'rgba(99,102,241,0.10)' : 'transparent',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#6366f1' : 'var(--ink-tertiary)',
                letterSpacing: '0.05em', cursor: 'pointer',
                transition: 'all 150ms ease-out',
              }}>
                {TAB_CONFIG[tab].label}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1 }} />

        <nav style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {breadcrumb.map((s, i, arr) => (
            <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 2, opacity: 0, animation: 'pill-in 250ms cubic-bezier(0.23, 1, 0.32, 1) forwards', animationDelay: `${200 + i * 50}ms` }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: s.color, opacity: 0.75, padding: '2px 6px', borderRadius: 4, background: `${s.color}0f`, letterSpacing: '-0.01em' }}>
                {s.label}
              </span>
              {i < arr.length - 1 && <span style={{ color: 'var(--ink-ghost)', fontSize: 10, margin: '0 1px' }}>›</span>}
            </span>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ padding: '4px 11px', borderRadius: 7, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.20)', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#6366f1', letterSpacing: '0.1em', fontWeight: 600 }}>
          {pill}
        </div>
      </header>

      {/* ── Graph canvas ── */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative', zIndex: 0 }}>
        {activeTab === 'shopstream'         && <LineageGraph />}
        {activeTab === 'fivetran-marketing' && <FivetranGraph />}
        {activeTab === 'fivetran-finance'   && <FinanceGraph />}

        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 55%, rgba(237,240,251,0.45) 100%)', pointerEvents: 'none', zIndex: 1 }} />
      </main>

      {activeTab === 'shopstream' && <MetricsBar />}
    </div>
  )
}
