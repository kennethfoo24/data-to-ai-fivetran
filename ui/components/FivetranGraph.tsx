'use client'

import React from 'react'
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

// ─── Logos ───────────────────────────────────────────────────────────────────

const logos: Record<string, React.ReactNode> = {
  salesforce: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#00a1e0"/>
      <path
        d="M9 21c-2.5 0-4.5-2-4.5-4.5 0-2.2 1.6-4 3.7-4.4C8.7 10 11 8 14 8c1.6 0 3 .7 4 1.8.6-.3 1.2-.4 1.9-.4 2.5 0 4.5 2 4.5 4.5 0 .4-.1.8-.2 1.2C25.3 15.5 27 17.2 27 19.3 27 21.3 25.3 23 23 23H9z"
        fill="white" opacity="0.95"
      />
    </svg>
  ),
  shopify: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#96bf48"/>
      <path d="M10 15h12l-1.5 9h-9L10 15z" fill="white" opacity="0.95"/>
      <path
        d="M13.5 15c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5"
        fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"
      />
      <circle cx="13" cy="25" r="1.2" fill="rgba(0,0,0,0.2)"/>
      <circle cx="19" cy="25" r="1.2" fill="rgba(0,0,0,0.2)"/>
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
      <line x1="11" y1="5"  x2="16" y2="11" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="21" y1="5"  x2="16" y2="11" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="11" y1="27" x2="16" y2="21" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="21" y1="27" x2="16" y2="21" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="16" cy="16" r="2.5" fill="white"/>
    </svg>
  ),
}

// ─── Node card ────────────────────────────────────────────────────────────────

interface NodeData {
  label: string
  sublabel?: string
  logoKey: string
  url?: string
  status?: 'active' | 'idle'
  tag?: string
  animDelay?: number
  category?: string
  [key: string]: unknown
}

const categoryColor: Record<string, string> = {
  source:      '#6366f1',
  connector:   '#0891b2',
  platform:    '#8b5cf6',
  destination: '#0073e6',
}

function PipelineNode({ data }: NodeProps) {
  const nd = data as NodeData
  const isActive = nd.status === 'active'
  const color = categoryColor[nd.category ?? 'source'] ?? '#6366f1'

  return (
    <div
      className={`df-node ${isActive ? 'active' : ''}`}
      style={{ animationDelay: `${(nd.animDelay ?? 0) * 45}ms` }}
      onClick={() => nd.url && window.open(nd.url as string, '_blank')}
      title={nd.url ? `Open ${nd.label}` : nd.label}
    >
      <Handle type="target" position={Position.Left}  id="in"  />
      <Handle type="source" position={Position.Right} id="out" />

      {/* Category accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 20, right: 20, height: 3,
        borderRadius: '0 0 2px 2px',
        background: isActive
          ? `linear-gradient(90deg, transparent, ${color}, transparent)`
          : 'transparent',
        transition: 'background 200ms ease-out',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        {/* Logo */}
        <div style={{
          flexShrink: 0,
          width: 46, height: 46, borderRadius: 12,
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(30,27,75,0.07)',
        }}>
          {logos[nd.logoKey] ?? <span style={{ fontSize: 20 }}>◈</span>}
        </div>

        {/* Text */}
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

        {/* Status dot */}
        <div style={{ flexShrink: 0, position: 'relative', width: 9, height: 9 }}>
          <div style={{
            width: 9, height: 9, borderRadius: '50%',
            background: isActive ? '#16a34a' : 'var(--ink-ghost)',
            boxShadow: isActive ? '0 0 0 2px rgba(22,163,74,0.22)' : 'none',
          }} />
          {isActive && (
            <div style={{
              position: 'absolute', inset: -2,
              borderRadius: '50%',
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
          background: `${color}14`,
          border: `1px solid ${color}30`,
          fontFamily: 'var(--font-mono)',
          fontSize: 10, color,
          letterSpacing: '0.07em',
          textTransform: 'uppercase' as const,
          fontWeight: 500,
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
      <path
        d={edgePath} fill="none"
        stroke="rgba(99,102,241,0.48)" strokeWidth={1.5}
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

// ─── Graph data ───────────────────────────────────────────────────────────────
//
//  Sources     Connectors     Fivetran      Snowflake
//  [SF]        [SF Conn]
//                             [Fivetran]   [Snowflake]
//  [Shopify]   [SH Conn]

const COL = {
  src:  20,
  conn: 300,
  ftv:  580,
  snow: 860,
}

const ROW = {
  top: 90,
  mid: 185,
  bot: 280,
}

function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    // ── Layer labels ──────────────────────────────────────────────
    { id: 'lbl-src',  type: 'layer', position: { x: COL.src,  y: 28 }, data: { label: 'Sources'    }, draggable: false },
    { id: 'lbl-conn', type: 'layer', position: { x: COL.conn, y: 28 }, data: { label: 'Connectors' }, draggable: false },
    { id: 'lbl-ftv',  type: 'layer', position: { x: COL.ftv,  y: 28 }, data: { label: 'Fivetran'   }, draggable: false },
    { id: 'lbl-snow', type: 'layer', position: { x: COL.snow, y: 28 }, data: { label: 'Snowflake'  }, draggable: false },

    // ── Sources ───────────────────────────────────────────────────
    {
      id: 'salesforce', type: 'pipeline', position: { x: COL.src, y: ROW.top },
      data: {
        label: 'Salesforce', sublabel: 'CRM · Campaigns',
        logoKey: 'salesforce',
        url: 'https://orgfarm-04280042a2-dev-ed.develop.lightning.force.com/lightning/r/Campaign/701gL00000sEZZtQAO/view',
        status: 'active', tag: 'CRM',
        category: 'source', animDelay: 0,
      },
    },
    {
      id: 'shopify', type: 'pipeline', position: { x: COL.src, y: ROW.bot },
      data: {
        label: 'Shopify', sublabel: 'E-commerce · Orders',
        logoKey: 'shopify',
        url: 'https://admin.shopify.com/store/fivetran-demo-store',
        status: 'active', tag: 'e-commerce',
        category: 'source', animDelay: 1,
      },
    },

    // ── Connectors ────────────────────────────────────────────────
    {
      id: 'sf-connector', type: 'pipeline', position: { x: COL.conn, y: ROW.top },
      data: {
        label: 'SF Connector', sublabel: 'Salesforce sync',
        logoKey: 'fivetran',
        url: 'https://fivetran.com/dashboard/connections',
        status: 'active',
        category: 'connector', animDelay: 2,
      },
    },
    {
      id: 'sh-connector', type: 'pipeline', position: { x: COL.conn, y: ROW.bot },
      data: {
        label: 'SH Connector', sublabel: 'Shopify sync',
        logoKey: 'fivetran',
        url: 'https://fivetran.com/dashboard/connections',
        status: 'active',
        category: 'connector', animDelay: 3,
      },
    },

    // ── Fivetran platform (centred) ───────────────────────────────
    {
      id: 'fivetran-platform', type: 'pipeline', position: { x: COL.ftv, y: ROW.mid },
      data: {
        label: 'Fivetran', sublabel: 'Managed ELT',
        logoKey: 'fivetran',
        url: 'https://fivetran.com/dashboard/destinations',
        status: 'active', tag: 'platform',
        category: 'platform', animDelay: 4,
      },
    },

    // ── Snowflake destination (centred) ───────────────────────────
    {
      id: 'snowflake', type: 'pipeline', position: { x: COL.snow, y: ROW.mid },
      data: {
        label: 'Snowflake', sublabel: 'Data warehouse',
        logoKey: 'snowflake',
        url: 'https://app.snowflake.com/kkgckap/cd56063/#/data/databases/PC_FIVETRAN_DB/schemas/SALESFORCE_MARKETING_DEMO_QUICKSTART_REPORTS/table/SALESFORCE__CONTACT_ENHANCED/data-preview',
        status: 'active', tag: 'destination',
        category: 'destination', animDelay: 5,
      },
    },
  ]

  const e = (id: string, source: string, target: string): Edge => ({
    id, source, target,
    sourceHandle: 'out', targetHandle: 'in',
    type: 'silk',
    markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: 'rgba(99,102,241,0.45)' },
  })

  const edges: Edge[] = [
    // Sources → Connectors (parallel horizontal)
    e('e1', 'salesforce', 'sf-connector'),
    e('e2', 'shopify',    'sh-connector'),

    // Connectors → Fivetran platform (converging diagonals)
    e('e3', 'sf-connector', 'fivetran-platform'),
    e('e4', 'sh-connector', 'fivetran-platform'),

    // Fivetran platform → Snowflake (horizontal)
    e('e5', 'fivetran-platform', 'snowflake'),
  ]

  return { nodes, edges }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function FivetranGraph() {
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
        fitView
        fitViewOptions={{ padding: 0.20, maxZoom: 1.0 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="rgba(99,102,241,0.10)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
