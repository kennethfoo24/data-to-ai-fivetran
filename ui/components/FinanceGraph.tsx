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
      <path d="M21 14.5v2.5a5.5 5.5 0 11-5.5-5.5H18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  dbt: (
    <svg viewBox="0 0 32 32" width="24" height="24">
      <rect width="32" height="32" rx="6" fill="#FF694A"/>
      <path d="M7 16L16 7l9 9-9 9-9-9z" fill="white" opacity="0.9"/>
      <circle cx="16" cy="16" r="3" fill="#FF694A"/>
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

function PipelineNode({ data }: NodeProps) {
  const nd = data as NodeData
  const isActive    = nd.status === 'active'
  const isClickable = !!nd.clickable || !!nd.url
  const color       = categoryColor[nd.category ?? 'source'] ?? '#6366f1'

  return (
    <div
      className={`df-node ${isActive ? 'active' : ''}`}
      style={{
        animationDelay: `${(nd.animDelay ?? 0) * 45}ms`,
        cursor: isClickable ? 'pointer' : 'default',
        outline: nd.clickable ? `2px solid ${color}40` : undefined,
        width: 280,
        boxSizing: 'border-box',
      }}
      onClick={() => { if (nd.url && !nd.clickable) window.open(nd.url as string, '_blank') }}
      title={nd.clickable ? 'Click to view BI charts' : nd.label}
    >
      <Handle type="target" position={Position.Left}   id="in"         />
      <Handle type="source" position={Position.Right}  id="out"        />
      <Handle type="source" position={Position.Bottom} id="bottom-out" />
      <Handle type="target" position={Position.Top}    id="top-in"     />

      <div style={{
        position: 'absolute', top: 0, left: 20, right: 20, height: 3,
        borderRadius: '0 0 2px 2px',
        background: isActive ? `linear-gradient(90deg, transparent, ${color}, transparent)` : 'transparent',
        transition: 'background 200ms ease-out',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{
          flexShrink: 0, width: 46, height: 46, borderRadius: 12,
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-hairline)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(30,27,75,0.07)',
        }}>
          {logos[nd.logoKey] ?? <span style={{ fontSize: 20 }}>◈</span>}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: 'var(--ink-primary)', lineHeight: 1.25, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            {nd.label}
          </div>
          {nd.sublabel && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 3, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
              {nd.sublabel}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, position: 'relative', width: 9, height: 9 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: isActive ? '#16a34a' : 'var(--ink-ghost)', boxShadow: isActive ? '0 0 0 2px rgba(22,163,74,0.22)' : 'none' }} />
          {isActive && (
            <div style={{ position: 'absolute', inset: -2, borderRadius: '50%', border: '1.5px solid rgba(22,163,74,0.3)', animation: 'pulse-ring 2s ease-out infinite' }} />
          )}
        </div>
      </div>

      {nd.tag && (
        <div style={{
          marginTop: 11, display: 'inline-flex', alignItems: 'center',
          padding: '2px 10px', borderRadius: 5,
          background: `${color}14`, border: `1px solid ${color}30`,
          fontFamily: 'var(--font-mono)', fontSize: 10, color,
          letterSpacing: '0.07em', textTransform: 'uppercase' as const, fontWeight: 500,
        }}>
          {nd.tag}
        </div>
      )}
    </div>
  )
}

function LayerLabel({ data }: NodeProps) {
  const d = data as { label: string; [key: string]: unknown }
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.18em',
      textTransform: 'uppercase', color: 'var(--ink-secondary)',
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
      <path d={edgePath} fill="none" stroke="rgba(99,102,241,0.48)" strokeWidth={1.5} strokeDasharray="5 9"
        style={{ animation: `silk-flow ${dur1}s linear infinite`, animationDelay: `${delay1}s` }} />
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

// ─── Layout ───────────────────────────────────────────────────────────────────

const COL = { src: 20, conn: 420, sraw: 820, xfm: 1220, sclean: 1620, retl: 2020, hub: 2420 }
const ROW = { top: 80, mid: 220, bot: 360 }

function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: 'lbl-src',    type: 'layer', position: { x: COL.src,    y: 20 }, data: { label: 'Sources'      }, draggable: false },
    { id: 'lbl-conn',   type: 'layer', position: { x: COL.conn,   y: 20 }, data: { label: 'ELT'          }, draggable: false },
    { id: 'lbl-sraw',   type: 'layer', position: { x: COL.sraw,   y: 20 }, data: { label: 'Snowflake Raw' }, draggable: false },
    { id: 'lbl-xfm',    type: 'layer', position: { x: COL.xfm,    y: 20 }, data: { label: 'Transforms'   }, draggable: false },
    { id: 'lbl-sclean', type: 'layer', position: { x: COL.sclean, y: 20 }, data: { label: 'Snowflake ✦'  }, draggable: false },
    { id: 'lbl-retl',   type: 'layer', position: { x: COL.retl,   y: 20 }, data: { label: 'Reverse ETL'  }, draggable: false },
    { id: 'lbl-hub',    type: 'layer', position: { x: COL.hub,    y: 20 }, data: { label: 'HubSpot'      }, draggable: false },

    { id: 'pg-source',   type: 'pipeline', position: { x: COL.src,    y: ROW.top }, data: { label: 'Postgres',           sublabel: 'Finance · Revenue',              logoKey: 'postgres',  url: 'https://console.cloud.google.com/sql/instances/shopstream-postgres/studio?project=fivetran-493702', status: 'active', tag: 'cloud sql',    category: 'source',      animDelay: 0 } },
    { id: 'kafka-source',type: 'pipeline', position: { x: COL.src,    y: ROW.bot }, data: { label: 'Kafka',              sublabel: 'shopstream.finance',              logoKey: 'kafka',     url: 'https://confluent.cloud/environments/env-0y0o0q/clusters/lkc-96xymm/topics/shopstream.finance/message-viewer', status: 'active', tag: 'confluent cloud',    category: 'source',      animDelay: 1 } },
    { id: 'ftv-connector',type:'pipeline', position: { x: COL.conn,   y: ROW.mid }, data: { label: 'Fivetran ELT',       sublabel: 'Postgres + Kafka sync',           logoKey: 'fivetran',  url: 'https://fivetran.com/dashboard/connections', status: 'active', tag: 'connector', category: 'connector', animDelay: 2 } },
    { id: 'snow-raw',    type: 'pipeline', position: { x: COL.sraw,   y: ROW.mid }, data: { label: 'Snowflake Raw',      sublabel: 'invoices · payments · events',    logoKey: 'snowflake', url: 'https://app.snowflake.com/kkgckap/cd56063/#/data/databases/PC_FIVETRAN_DB/schemas/SHOPSTREAM_FINANCE_FINANCE/table/CUSTOMERS/data-preview', status: 'active', tag: 'raw',       category: 'warehouse',   animDelay: 3 } },
    { id: 'ftv-transforms',type:'pipeline',position: { x: COL.xfm,   y: ROW.mid }, data: { label: 'Fivetran Transforms', sublabel: 'No Airflow · runs after sync',    logoKey: 'fivetran',  url: 'https://fivetran.com/dashboard/transformations', status: 'active', tag: 'dbt · managed', category: 'transform', animDelay: 4 } },
    { id: 'dbt-models',   type: 'pipeline', position: { x: COL.xfm,   y: ROW.bot }, data: { label: 'dbt Models',          sublabel: 'finance_transformed · 3 models',  logoKey: 'dbt',       url: 'https://github.com/kennethfoo24/data-to-ai-fivetran/tree/main/dbt_fivetran/models', status: 'active', tag: 'dbt core', category: 'transform', animDelay: 4 } },
    { id: 'snow-transformed',type:'pipeline',position:{x: COL.sclean, y: ROW.mid }, data: { label: 'Snowflake Clean',   sublabel: 'invoice_aging · segments · MRR',  logoKey: 'snowflake', status: 'active', tag: 'transformed', category: 'warehouse', animDelay: 5, clickable: true } },
    { id: 'ftv-reverse-etl',type:'pipeline',position: { x: COL.retl,  y: ROW.mid }, data: { label: 'Reverse ETL',       sublabel: 'Snowflake → HubSpot',             logoKey: 'fivetran',  url: 'https://fivetran.com/dashboard/activations', status: 'active', tag: 'reverse etl', category: 'platform', animDelay: 6 } },
    { id: 'hubspot',     type: 'pipeline', position: { x: COL.hub,    y: ROW.mid }, data: { label: 'HubSpot CRM',       sublabel: 'Customer segments',               logoKey: 'hubspot',   url: 'https://app-na2.hubspot.com/contacts/245945263/objects/0-1/views/all/list?prefetch=', status: 'active', tag: 'destination', category: 'crm', animDelay: 7 } },
  ]

  const e = (id: string, source: string, target: string): Edge => ({
    id, source, target, sourceHandle: 'out', targetHandle: 'in',
    type: 'silk',
    markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: 'rgba(99,102,241,0.45)' },
  })

  return {
    nodes,
    edges: [
      e('e1', 'pg-source',       'ftv-connector'),
      e('e2', 'kafka-source',    'ftv-connector'),
      e('e3', 'ftv-connector',   'snow-raw'),
      e('e4', 'snow-raw',        'ftv-transforms'),
      e('e5', 'ftv-transforms',  'snow-transformed'),
      { id: 'e8', source: 'ftv-transforms', target: 'dbt-models', sourceHandle: 'bottom-out', targetHandle: 'top-in', type: 'silk', markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: 'rgba(99,102,241,0.45)' } },
      e('e6', 'snow-transformed','ftv-reverse-etl'),
      e('e7', 'ftv-reverse-etl', 'hubspot'),
    ],
  }
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
