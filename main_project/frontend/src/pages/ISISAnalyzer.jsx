// src/pages/ISISAnalyzer.jsx
import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import './ISISAnalyzer.css'

// ─── API helper ───────────────────────────────────────────
const token = () => localStorage.getItem('access')

let _refreshing = null
async function tryRefresh() {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    const refresh = localStorage.getItem('refresh')
    if (!refresh) throw new Error('no refresh token')
    const r = await fetch('/api/auth/token/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
    if (!r.ok) throw new Error('refresh failed')
    const data = await r.json()
    localStorage.setItem('access', data.access)
    if (data.refresh) localStorage.setItem('refresh', data.refresh)
    return data.access
  })()
  try   { return await _refreshing }
  finally { _refreshing = null }
}

function goLogin() {
  localStorage.removeItem('access')
  localStorage.removeItem('refresh')
  window.location.href = '/login'
}

async function apiFetch(url) {
  let r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } })
  if (r.status === 401) {
    try {
      await tryRefresh()
      r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } })
    } catch {
      goLogin(); throw new Error('401 Unauthorized')
    }
  }
  if (r.status === 401) { goLogin(); throw new Error('401 Unauthorized') }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function apiPost(url, body) {
  let r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401) {
    try {
      await tryRefresh()
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      goLogin(); throw new Error('401 Unauthorized')
    }
  }
  if (r.status === 401) { goLogin(); throw new Error('401 Unauthorized') }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ─── Export helpers ───────────────────────────────────────
function exportCSV(routers) {
  const header = ['No', 'Hostname', 'System ID', 'Router IPs', 'Prefix-SID']
  const rows = routers.map((r, i) => [
    i + 1, r.hostname, r.system_id,
    (r.router_ips || []).join(' | '),
    r.prefix_sid ?? '-',
  ])
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: 'isis_routers.csv'
  })
  a.click(); URL.revokeObjectURL(a.href)
}

async function exportExcel(routers) {
  try {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(routers.map((r, i) => ({
      No: i + 1, Hostname: r.hostname, 'System ID': r.system_id,
      'Router IPs': (r.router_ips || []).join(' | '),
      'Prefix-SID': r.prefix_sid ?? '-',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ISIS Routers')
    XLSX.writeFile(wb, 'isis_routers.xlsx')
  } catch {
    alert('Install xlsx dulu: npm install xlsx')
  }
}

// ─── Search highlight ────────────────────────────────────
function Highlight({ text, query }) {
  if (!query || !text) return <>{text}</>
  const lo = text.toLowerCase(), q = query.toLowerCase()
  const idx = lo.indexOf(q)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hl">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// ─── Path colors & dash patterns ──────────────────────────
const PATH_COLORS = ['#4858c8', '#0ea5e9', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#ec4899', '#14b8a6']
const PATH_DASH   = [null, '8,4', '4,4', '8,4,4,4', null, '8,4', '4,4', '8,4,4,4']

// ─── Shared topology helpers ──────────────────────────────
const NODE_W = 130, NODE_H = 46

function shortenLine(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const hw = NODE_W / 2 + 3, hh = NODE_H / 2 + 3
  const t = Math.min(hw / (Math.abs(dx / len) || 1e-6), hh / (Math.abs(dy / len) || 1e-6))
  return { x1: ax + (dx/len)*t, y1: ay + (dy/len)*t,
           x2: bx - (dx/len)*(t+9), y2: by - (dy/len)*(t+9), dx, dy, len }
}

function svgTooltip(key, lines, header, mx, my, W, H, pinned = false) {
  if (!lines.length) return null
  const TW = 220, TH = lines.length * 18 + 14
  const tx = Math.min(Math.max(mx, TW/2+6), W-TW/2-6)
  const ty = my > H/2 ? my - TH - 14 : my + 14
  const hdr = pinned ? '#1e3a5f' : '#334155'
  return (
    <g key={key} style={{ pointerEvents: 'none' }}>
      <rect x={tx-TW/2+2} y={ty+2} width={TW} height={TH} rx="7" fill="rgba(0,0,0,0.14)" />
      <rect x={tx-TW/2} y={ty} width={TW} height={TH} rx="7" fill="#1e293b" />
      <rect x={tx-TW/2} y={ty} width={TW} height={22} rx="7" fill={hdr} />
      <rect x={tx-TW/2} y={ty+15} width={TW} height={7} fill={hdr} />
      <text x={tx} y={ty+14} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">
        {header}{pinned ? ' 📌' : ''}
      </text>
      {lines.map((l, i) => (
        <g key={i}>
          <text x={tx-TW/2+10} y={ty+28+i*18} fontSize="8.5" fill="#94a3b8">{l.label}</text>
          <text x={tx+TW/2-8} y={ty+28+i*18} textAnchor="end" fontSize="9"
            fill="#e2e8f0" fontFamily="'Courier New', monospace" fontWeight="600">{l.val}</text>
        </g>
      ))}
    </g>
  )
}

// ─── Multi-path topology SVG ──────────────────────────────
function PathTopologySVG({ paths, src, dst }) {
  const [selectedPath, setSelectedPath] = useState(null)
  const [showIPs, setShowIPs]           = useState(false)
  const [showCost, setShowCost]         = useState(false)
  const [hoveredEdge, setHoveredEdge]   = useState(null)
  const [pinnedEdges, setPinnedEdges]   = useState(new Set())

  const togglePin = (edgeKey) => {
    setPinnedEdges(prev => {
      const next = new Set(prev)
      next.has(edgeKey) ? next.delete(edgeKey) : next.add(edgeKey)
      return next
    })
  }

  if (!paths || paths.length === 0) return null

  const loopbackMap = {}
  for (const p of paths) {
    for (const hop of p.hops) {
      if (hop.loopback && !loopbackMap[hop.router]) loopbackMap[hop.router] = hop.loopback
    }
  }

  const edgeIpMap = {}
  for (const p of paths) {
    for (let i = 0; i < p.hops.length - 1; i++) {
      const key = `${p.path[i]}|||${p.path[i + 1]}`
      if (!edgeIpMap[key]) {
        edgeIpMap[key] = {
          outgoing_ip: p.hops[i].outgoing_ip,
          incoming_ip: p.hops[i].incoming_ip,
          metric:      p.hops[i].adj_cost,
          color:       PATH_COLORS[0],
        }
      }
    }
  }

  const displayPaths = selectedPath !== null ? [paths[selectedPath]] : paths

  const levels = {}
  const allNodesSet = new Set()
  for (const p of paths) {
    p.path.forEach((node, i) => {
      allNodesSet.add(node)
      if (levels[node] === undefined || levels[node] > i) levels[node] = i
    })
  }

  const byLevel = {}
  for (const node of allNodesSet) {
    const l = levels[node]
    if (!byLevel[l]) byLevel[l] = []
    byLevel[l].push(node)
  }
  Object.values(byLevel).forEach(arr => arr.sort())

  const maxLevel    = Math.max(...Object.values(levels))
  const maxPerLevel = Math.max(...Object.values(byLevel).map(a => a.length))
  const padX = 70, padY = 55
  const levelGap = Math.max(NODE_W + 90, 220)
  const rowGap   = Math.max(NODE_H + 50, 100)
  const W = Math.max(900, padX * 2 + maxLevel * levelGap + NODE_W)
  const H = Math.max(180, padY * 2 + (maxPerLevel - 1) * rowGap + NODE_H)

  const positions = {}
  for (const [levelStr, nodes] of Object.entries(byLevel)) {
    const l = Number(levelStr)
    const x = padX + NODE_W / 2 + l * levelGap
    const totalH = (nodes.length - 1) * rowGap
    const startY = (H - totalH) / 2
    nodes.forEach((node, i) => { positions[node] = { x, y: startY + i * rowGap } })
  }

  const edgeData = {}
  for (const p of paths) {
    for (let i = 0; i < p.hops.length - 1; i++) {
      const key = [p.path[i], p.path[i+1]].sort().join('|||')
      if (!edgeData[key]) edgeData[key] = { a: p.path[i], b: p.path[i+1], metric: p.hops[i].adj_cost }
    }
  }

  const getEdgeTooltipData = (edgeKey) => {
    for (const p of displayPaths) {
      for (let i = 0; i < p.path.length - 1; i++) {
        const fwd = `${p.path[i]}|||${p.path[i+1]}`
        const rev = `${p.path[i+1]}|||${p.path[i]}`
        if (fwd === edgeKey || rev === edgeKey) {
          const hop = p.hops[i]
          const a = positions[p.path[i]], b = positions[p.path[i+1]]
          if (!a || !b) return null
          const { x1, y1, x2, y2 } = shortenLine(a.x, a.y, b.x, b.y)
          return { hop, mx: (x1+x2)/2, my: (y1+y2)/2, nodeA: p.path[i], nodeB: p.path[i+1] }
        }
      }
    }
    return null
  }

  return (
    <div className="isis-path-topo-wrap">
      <div className="isis-path-selector">
        <button className={`isis-path-sel-btn ${selectedPath === null ? 'sel-all' : ''}`}
          onClick={() => setSelectedPath(null)}>All Paths</button>
        {paths.map((p, pi) => (
          <button key={pi}
            className={`isis-path-sel-btn ${selectedPath === pi ? 'sel-active' : ''}`}
            style={selectedPath === pi
              ? { background: PATH_COLORS[pi % PATH_COLORS.length], borderColor: PATH_COLORS[pi % PATH_COLORS.length], color: '#fff' }
              : { borderColor: PATH_COLORS[pi % PATH_COLORS.length], color: PATH_COLORS[pi % PATH_COLORS.length] }}
            onClick={() => setSelectedPath(selectedPath === pi ? null : pi)}>
            Path #{p.path_index}
            <span className="isis-path-sel-meta"> · {p.total_metric}</span>
          </button>
        ))}
        <span className="isis-path-sel-divider" />
        <button
          className={`isis-path-sel-btn isis-cost-toggle ${showCost ? 'cost-on' : ''}`}
          onClick={() => setShowCost(v => !v)}>
          {showCost ? '📊 Hide Cost' : '📊 Show Cost'}
        </button>
        <button
          className={`isis-path-sel-btn isis-ip-toggle ${showIPs ? 'ip-on' : ''}`}
          onClick={() => setShowIPs(v => !v)}>
          {showIPs ? '🔵 Hide IPs' : '⚪ Show IPs'}
        </button>
      </div>

      <div className="isis-path-topo-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="isis-path-topo-svg">
          <defs>
            {PATH_COLORS.map((c, i) => (
              <marker key={i} id={`parr-${i}`} markerWidth="7" markerHeight="5"
                refX="7" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill={c} />
              </marker>
            ))}
          </defs>

          {Object.values(edgeData).map(({ a, b }) => {
            const pa = positions[a], pb = positions[b]
            if (!pa || !pb) return null
            const { x1, y1, x2, y2 } = shortenLine(pa.x, pa.y, pb.x, pb.y)
            return (
              <line key={`bg-${a}-${b}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="#dde3ef" strokeWidth="5" strokeLinecap="round" />
            )
          })}

          {displayPaths.map((p, dpi) => {
            const pi    = selectedPath !== null ? selectedPath : dpi
            const color = PATH_COLORS[pi % PATH_COLORS.length]
            const dash  = PATH_DASH[pi % PATH_DASH.length]
            return p.path.map((node, ni) => {
              if (ni === p.path.length - 1) return null
              const next = p.path[ni + 1]
              const a = positions[node], b = positions[next]
              if (!a || !b) return null
              const { x1, y1, x2, y2, dx, dy, len } = shortenLine(a.x, a.y, b.x, b.y)
              const offset = displayPaths.length > 1 ? (dpi - (displayPaths.length - 1) / 2) * 5 : 0
              const px = (-dy/len)*offset, py = (dx/len)*offset
              return (
                <line key={`ln-${pi}-${ni}`}
                  x1={x1+px} y1={y1+py} x2={x2+px} y2={y2+py}
                  stroke={color} strokeWidth="2.5" strokeDasharray={dash || undefined}
                  markerEnd={`url(#parr-${pi % PATH_COLORS.length})`}
                  strokeLinecap="round" opacity="0.92" />
              )
            })
          })}

          {showCost && (() => {
            const seen = new Set()
            const labels = []
            for (const p of displayPaths) {
              for (let i = 0; i < p.path.length - 1; i++) {
                const physKey = [p.path[i], p.path[i+1]].sort().join('|||')
                if (seen.has(physKey)) continue
                seen.add(physKey)
                const pa = positions[p.path[i]], pb = positions[p.path[i+1]]
                if (!pa || !pb) continue
                const metric = p.hops[i].adj_cost
                if (metric == null) continue
                const { x1, y1, x2, y2 } = shortenLine(pa.x, pa.y, pb.x, pb.y)
                const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                labels.push(
                  <g key={`cost-${physKey}`} style={{ pointerEvents: 'none' }}>
                    <rect x={mx-18} y={my-10} width={36} height={19} rx="5"
                      fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.2" />
                    <text x={mx} y={my+0.5} textAnchor="middle" dominantBaseline="middle"
                      fontSize="9.5" fill="#92400e" fontWeight="800">{metric}</text>
                  </g>
                )
              }
            }
            return labels
          })()}

          {displayPaths.map((p, dpi) => {
            const pi = selectedPath !== null ? selectedPath : dpi
            return p.path.map((node, ni) => {
              if (ni === p.path.length - 1) return null
              const next = p.path[ni + 1]
              const a = positions[node], b = positions[next]
              if (!a || !b) return null
              const edgeKey = `${node}|||${next}`
              const { x1, y1, x2, y2, dx, dy, len } = shortenLine(a.x, a.y, b.x, b.y)
              const offset = displayPaths.length > 1 ? (dpi - (displayPaths.length - 1) / 2) * 5 : 0
              const px = (-dy/len)*offset, py = (dx/len)*offset
              return (
                <line key={`hit-${pi}-${ni}`}
                  x1={x1+px} y1={y1+py} x2={x2+px} y2={y2+py}
                  stroke="transparent" strokeWidth="22"
                  style={{ cursor: pinnedEdges.has(edgeKey) ? 'pointer' : 'crosshair' }}
                  onMouseEnter={() => setHoveredEdge(edgeKey)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onDoubleClick={(e) => { e.stopPropagation(); togglePin(edgeKey) }} />
              )
            })
          })}

          {Array.from(allNodesSet).map(node => {
            const p = positions[node]
            if (!p) return null
            const isSrc = node === src, isDst = node === dst
            const fill  = isSrc ? '#16a34a' : isDst ? '#dc2626' : '#4858c8'
            const loopback = loopbackMap[node]
            return (
              <g key={node} transform={`translate(${p.x}, ${p.y})`}>
                {(isSrc || isDst) && (
                  <rect x={-NODE_W/2-4} y={-NODE_H/2-4}
                    width={NODE_W+8} height={NODE_H+8} rx="10" fill={fill} opacity="0.18" />
                )}
                <rect x={-NODE_W/2} y={-NODE_H/2}
                  width={NODE_W} height={NODE_H} rx="7"
                  fill={fill} stroke="white" strokeWidth="1.5" />
                <text x={0} y={loopback ? -7 : 0}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="9" fill="white" fontWeight="700">
                  {node}
                </text>
                {loopback && (
                  <text x={0} y={10}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill="rgba(255,255,255,0.78)"
                    fontFamily="'Courier New', monospace">
                    {loopback}
                  </text>
                )}
              </g>
            )
          })}

          {(() => {
            const renderTooltip = (key, hop, nodeA, nodeB, mx, my, pinned = false) => {
              const lines = [
                { label: `↗ ${nodeA}`, val: hop?.outgoing_ip },
                { label: `↘ ${nodeB}`, val: hop?.incoming_ip },
                { label: 'Cost',        val: hop?.adj_cost },
              ].filter(l => l.val != null && l.val !== '')
              if (!lines.length) return null
              const TW = 215, TH = lines.length * 18 + 14
              const tx = Math.min(Math.max(mx, TW/2 + 6), W - TW/2 - 6)
              const ty = my > H / 2 ? my - TH - 14 : my + 14
              const hdrColor = pinned ? '#1e3a5f' : '#334155'
              return (
                <g key={key} style={{ pointerEvents: 'none' }}>
                  <rect x={tx - TW/2 + 2} y={ty + 2} width={TW} height={TH}
                    rx="7" fill="rgba(0,0,0,0.14)" />
                  <rect x={tx - TW/2} y={ty} width={TW} height={TH}
                    rx="7" fill="#1e293b" />
                  <rect x={tx - TW/2} y={ty} width={TW} height={22}
                    rx="7" fill={hdrColor} />
                  <rect x={tx - TW/2} y={ty+15} width={TW} height={7} fill={hdrColor} />
                  <text x={tx} y={ty+14} textAnchor="middle"
                    fontSize="9" fill="#94a3b8" fontWeight="700">
                    {nodeA} → {nodeB}{pinned ? ' 📌' : ''}
                  </text>
                  {lines.map((l, i) => (
                    <g key={i}>
                      <text x={tx - TW/2 + 10} y={ty + 28 + i*18}
                        fontSize="8.5" fill="#94a3b8">{l.label}</text>
                      <text x={tx + TW/2 - 8} y={ty + 28 + i*18}
                        textAnchor="end" fontSize="9"
                        fill="#e2e8f0" fontFamily="'Courier New', monospace" fontWeight="600">
                        {l.val}
                      </text>
                    </g>
                  ))}
                </g>
              )
            }

            const tips = []

            if (showIPs) {
              const seen = {}
              for (const p of displayPaths) {
                for (let ni = 0; ni < p.path.length - 1; ni++) {
                  const nodeA = p.path[ni], nodeB = p.path[ni+1]
                  const physKey = [nodeA, nodeB].sort().join('|||')
                  if (seen[physKey]) continue
                  seen[physKey] = true
                  const a = positions[nodeA], b = positions[nodeB]
                  if (!a || !b) continue
                  const { x1, y1, x2, y2 } = shortenLine(a.x, a.y, b.x, b.y)
                  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
                  tips.push(renderTooltip(`sip-${physKey}`, p.hops[ni], nodeA, nodeB, mx, my))
                }
              }
            }

            for (const ek of pinnedEdges) {
              const d = getEdgeTooltipData(ek)
              if (!d) continue
              tips.push(renderTooltip(`pin-${ek}`, d.hop, d.nodeA, d.nodeB, d.mx, d.my, true))
            }

            if (hoveredEdge && !showIPs && !pinnedEdges.has(hoveredEdge)) {
              const d = getEdgeTooltipData(hoveredEdge)
              if (d) tips.push(renderTooltip('hover-tip', d.hop, d.nodeA, d.nodeB, d.mx, d.my))
            }

            return tips
          })()}
        </svg>
      </div>

      <div className="isis-path-topo-legend">
        <span className="isis-path-topo-legend-src">
          <span style={{ background: '#16a34a' }} className="isis-path-topo-dot" /> {src}
        </span>
        <span className="isis-path-topo-legend-dst">
          <span style={{ background: '#dc2626' }} className="isis-path-topo-dot" /> {dst}
        </span>
        <span className="isis-path-topo-legend-sep">|</span>
        {paths.map((p, pi) => {
          const color = PATH_COLORS[pi % PATH_COLORS.length]
          const dash  = PATH_DASH[pi % PATH_DASH.length]
          return (
            <span key={pi} className="isis-path-topo-legend-item">
              <svg width="28" height="10" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                <line x1="0" y1="5" x2="28" y2="5"
                  stroke={color} strokeWidth="2.5" strokeDasharray={dash || undefined} />
              </svg>
              <span style={{ color }}>Path #{p.path_index}</span>
              <span className="isis-path-topo-meta">· Metric: {p.total_metric} · {p.hop_count} hops</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Network Map ──────────────────────────────────────────
function NetworkMapView({ allRouters }) {
  const [selected, setSelected]               = useState([])
  const [searchQ, setSearchQ]                 = useState('')
  const [dropOpen, setDropOpen]               = useState(false)
  const [showIPs, setShowIPs]                 = useState(false)
  const [showCost, setShowCost]               = useState(false)
  const [hoveredEdge, setHoveredEdge]         = useState(null)
  const [hoveredNode, setHoveredNode]         = useState(null)
  const [pinnedEdges, setPinnedEdges]         = useState(new Set())
  const [deletedNodes, setDeletedNodes]       = useState(new Set())
  const [deletedEdges, setDeletedEdges]       = useState(new Set())
  const [ctxMenu, setCtxMenu]                 = useState(null)
  const [hlIdx, setHlIdx]                     = useState(-1)
  const [nodePosOverride, setNodePosOverride] = useState({})
  const [dragging, setDragging]               = useState(null)
  const wrapRef = useRef()
  const listRef = useRef()
  const svgRef  = useRef()

  // ── PERUBAHAN 1: Tidak reset nodePosOverride saat tambah router ──
  useEffect(() => {
    setDeletedNodes(new Set())
    setDeletedEdges(new Set())
    setPinnedEdges(new Set())
  }, [selected])

  const togglePin = (key) => setPinnedEdges(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const routerMap = useMemo(() => {
    const m = {}; for (const r of allRouters) m[r.hostname] = r; return m
  }, [allRouters])

  const results = useMemo(() =>
    allRouters.filter(r =>
      !selected.includes(r.hostname) &&
      r.hostname.toLowerCase().includes(searchQ.toLowerCase())
    ).slice(0, 15),
    [allRouters, selected, searchQ]
  )

  useEffect(() => setHlIdx(-1), [results])
  useEffect(() => {
    if (hlIdx >= 0 && listRef.current)
      listRef.current.children[hlIdx]?.scrollIntoView({ block: 'nearest' })
  }, [hlIdx])
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const addRouter    = (h) => { if (!selected.includes(h)) setSelected(p => [...p, h]); setSearchQ(''); setDropOpen(false); setHlIdx(-1) }
  const removeRouter = (h) => setSelected(p => p.filter(x => x !== h))
  const clearAll     = () => {
    setSelected([])
    setPinnedEdges(new Set())
    setHoveredEdge(null)
    setNodePosOverride({}) // reset posisi hanya saat clear all
  }

  const deleteNode = (h) => {
    setHoveredNode(null)
    if (selected.includes(h)) removeRouter(h)
    else setDeletedNodes(prev => { const n = new Set(prev); n.add(h); return n })
  }
  const deleteEdge = (key) => {
    setHoveredEdge(null)
    setPinnedEdges(prev => { const n = new Set(prev); n.delete(key); return n })
    setDeletedEdges(prev => { const n = new Set(prev); n.add(key); return n })
  }
  const restoreAll = () => { setDeletedNodes(new Set()); setDeletedEdges(new Set()) }

  const allNodes = useMemo(() => {
    const nodeSet = new Set(selected)
    for (const hostname of selected) {
      const router = routerMap[hostname]
      if (!router) continue
      for (const adj of (router.adjacency || []))
        if (routerMap[adj.hostname]) nodeSet.add(adj.hostname)
    }
    for (const d of deletedNodes) nodeSet.delete(d)
    return Array.from(nodeSet)
  }, [selected, routerMap, deletedNodes])

  const { basePositions, edgeMap, W, H } = useMemo(() => {
    const n = allNodes.length
    if (n === 0) return { basePositions: {}, edgeMap: {}, W: 0, H: 0 }

    const DRAG_PAD = 500
    const r  = Math.max(180, Math.ceil(n * (NODE_W + 40) / (2 * Math.PI)))
    const cx = r + NODE_W + 10, cy = r + NODE_H * 2 + 10
    const W  = cx * 2 + DRAG_PAD * 2
    const H  = cy * 2 + DRAG_PAD * 2

    const ordered = [...selected, ...allNodes.filter(h => !selected.includes(h))]
    const basePositions = {}
    ordered.forEach((h, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2
      basePositions[h] = {
        x: cx + r * Math.cos(angle) + DRAG_PAD,
        y: cy + r * Math.sin(angle) + DRAG_PAD,
      }
    })

    const nodeSet = new Set(allNodes)
    const edgeMap = {}
    for (const hostname of allNodes) {
      const router = routerMap[hostname]
      if (!router) continue
      for (const adj of (router.adjacency || [])) {
        if (!nodeSet.has(adj.hostname)) continue
        const key = [hostname, adj.hostname].sort().join('|||')
        if (!edgeMap[key])
          edgeMap[key] = { a: hostname, b: adj.hostname, metric: adj.metric, local_ip: adj.local_ip, remote_ip: adj.remote_ip }
      }
    }
    return { basePositions, edgeMap, W, H }
  }, [allNodes, selected, routerMap])

  const positions = useMemo(() => {
    const pos = { ...basePositions }
    for (const [h, p] of Object.entries(nodePosOverride)) if (pos[h]) pos[h] = p
    return pos
  }, [basePositions, nodePosOverride])

  const visibleEdgeMap = useMemo(() => {
    if (!deletedEdges.size) return edgeMap
    const m = {}
    for (const [key, edge] of Object.entries(edgeMap))
      if (!deletedEdges.has(key)) m[key] = edge
    return m
  }, [edgeMap, deletedEdges])

  const startDrag = (e, hostname) => {
    e.stopPropagation()
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const sx = W / rect.width, sy = H / rect.height
    const p  = positions[hostname]
    setDragging({ node: hostname, ox: (e.clientX - rect.left) * sx - p.x, oy: (e.clientY - rect.top) * sy - p.y, sx, sy, rect })
  }
  const onSVGMouseMove = (e) => {
    if (!dragging) return
    const { node, ox, oy, sx, sy, rect } = dragging
    setNodePosOverride(prev => ({ ...prev, [node]: {
      x: (e.clientX - rect.left) * sx - ox,
      y: (e.clientY - rect.top)  * sy - oy,
    }}))
  }
  const stopDrag = () => setDragging(null)

  // ── PERUBAHAN 3: Download PNG ──
  const downloadPNG = () => {
    const svg = svgRef.current
    if (!svg) return
    const serializer = new XMLSerializer()
    const source = '<?xml version="1.0" standalone="no"?>\r\n' + serializer.serializeToString(svg)
    const img = new Image()
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width  = svg.width.baseVal.value * scale
      canvas.height = svg.height.baseVal.value * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.fillStyle = '#f8f9fc'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(b => {
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(b),
          download: `network-map-${selected.join('-') || 'export'}.png`
        })
        a.click()
      })
    }
    img.src = url
  }

  const makeTooltip = (key, edge, mx, my, pinned) =>
    svgTooltip(key,
      [
        { label: `↗ ${edge.a}`, val: edge.local_ip },
        { label: `↘ ${edge.b}`, val: edge.remote_ip },
        { label: 'Metric',       val: edge.metric },
      ].filter(l => l.val != null && l.val !== ''),
      `${edge.a} ↔ ${edge.b}`, mx, my, W, H, pinned
    )

  return (
    <div className="isis-netmap-wrap">

      <div className="isis-netmap-selector" ref={wrapRef}>
        <div className="isis-netmap-chips">
          {selected.map(h => (
            <span key={h} className="isis-netmap-chip">
              {h}
              <button className="isis-netmap-chip-x" onClick={() => removeRouter(h)}>×</button>
            </span>
          ))}
          <input
            className="isis-netmap-search"
            placeholder={selected.length === 0 ? '🔍  Cari dan pilih router...' : 'Tambah router...'}
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setDropOpen(true) }}
            onFocus={() => setDropOpen(true)}
            onKeyDown={e => {
              if (!dropOpen || !results.length) return
              if      (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(i => Math.min(i+1, results.length-1)) }
              else if (e.key === 'ArrowUp')   { e.preventDefault(); setHlIdx(i => Math.max(i-1, 0)) }
              else if (e.key === 'Enter' && hlIdx >= 0) { e.preventDefault(); addRouter(results[hlIdx].hostname) }
              else if (e.key === 'Escape')    { setDropOpen(false); setHlIdx(-1) }
            }}
          />
          {selected.length > 0 && (
            <button className="isis-netmap-clear" onClick={clearAll}>✕ Clear all</button>
          )}
        </div>
        {dropOpen && results.length > 0 && (
          <ul className="isis-netmap-dropdown" ref={listRef}>
            {results.map((r, i) => (
              <li key={r.hostname} className={i === hlIdx ? 'hl' : ''}
                onMouseDown={() => addRouter(r.hostname)}>
                <span className={`isis-hostname ${!/PE/i.test(r.hostname) ? 'core' : 'pe'}`}>{r.hostname}</span>
                <span className="isis-netmap-adj-count">{(r.adjacency||[]).length} neighbors</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected.length === 0 ? (
        <div className="isis-netmap-hint">
          Pilih minimal 1 router — neighbor-nya akan otomatis ditampilkan beserta link langsung antar router.
        </div>
      ) : (
        <>
          <div className="isis-path-selector">
            <span className="isis-netmap-info">
              <strong>{selected.length}</strong> dipilih ·&nbsp;
              <span style={{color:'#94a3b8'}}>{allNodes.length - selected.length} neighbor</span>
              &nbsp;· {Object.keys(visibleEdgeMap).length} link
              {(deletedNodes.size > 0 || deletedEdges.size > 0) && (
                <span style={{color:'#ef4444',marginLeft:6}}>
                  ({deletedNodes.size + deletedEdges.size} disembunyikan)
                </span>
              )}
            </span>
            <span className="isis-path-sel-divider" />
            {(deletedNodes.size > 0 || deletedEdges.size > 0) && (
              <button className="isis-path-sel-btn" onClick={restoreAll}
                style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                ↺ Restore
              </button>
            )}
            <button className={`isis-path-sel-btn isis-cost-toggle ${showCost ? 'cost-on' : ''}`}
              onClick={() => setShowCost(v => !v)}>
              {showCost ? '📊 Hide Cost' : '📊 Show Cost'}
            </button>
            <button className={`isis-path-sel-btn isis-ip-toggle ${showIPs ? 'ip-on' : ''}`}
              onClick={() => setShowIPs(v => !v)}>
              {showIPs ? '🔵 Hide IPs' : '⚪ Show IPs'}
            </button>
            {/* ── PERUBAHAN 3: Tombol download ── */}
            <button className="isis-path-sel-btn" onClick={downloadPNG}
              style={{ color: '#16a34a', borderColor: '#bbf7d0' }}
              title="Download topology sebagai PNG">
              📥 Download PNG
            </button>
          </div>

          <div className="isis-path-topo-scroll">
            <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
              className="isis-path-topo-svg"
              style={{ userSelect: 'none', cursor: dragging ? 'grabbing' : 'default' }}
              onMouseMove={onSVGMouseMove}
              onMouseUp={stopDrag}
              onMouseLeave={stopDrag}>

              {Object.values(visibleEdgeMap).map(({ a, b }) => {
                const pa=positions[a], pb=positions[b]; if (!pa||!pb) return null
                const {x1,y1,x2,y2} = shortenLine(pa.x,pa.y,pb.x,pb.y)
                return <line key={`bg-${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#dde3ef" strokeWidth="5" strokeLinecap="round" />
              })}

              {showCost && Object.values(visibleEdgeMap).map(({ a, b, metric }) => {
                if (metric == null) return null
                const pa=positions[a], pb=positions[b]; if (!pa||!pb) return null
                const {x1,y1,x2,y2} = shortenLine(pa.x,pa.y,pb.x,pb.y)
                const mx=(x1+x2)/2, my=(y1+y2)/2
                return (
                  <g key={`cost-${a}-${b}`} style={{ pointerEvents:'none' }}>
                    <rect x={mx-18} y={my-10} width={36} height={19} rx="5"
                      fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.2" />
                    <text x={mx} y={my+0.5} textAnchor="middle" dominantBaseline="middle"
                      fontSize="9.5" fill="#92400e" fontWeight="800">{metric}</text>
                  </g>
                )
              })}

              {Object.values(visibleEdgeMap).map(({ a, b }) => {
                const pa=positions[a], pb=positions[b]; if (!pa||!pb) return null
                const {x1,y1,x2,y2} = shortenLine(pa.x,pa.y,pb.x,pb.y)
                const key = [a,b].sort().join('|||')
                return <line key={`hit-${key}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="transparent" strokeWidth="22"
                  style={{ cursor: dragging ? 'grabbing' : (pinnedEdges.has(key) ? 'pointer' : 'crosshair') }}
                  onMouseEnter={() => { if (!dragging) setHoveredEdge(key) }}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onDoubleClick={e => { e.stopPropagation(); togglePin(key) }}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ key, x: e.clientX, y: e.clientY }) }} />
              })}

              {allNodes.map(hostname => {
                const p = positions[hostname]; if (!p) return null
                const isSel  = selected.includes(hostname)
                const isPE   = /PE/i.test(hostname)
                const color  = isPE ? '#4858c8' : '#0ea5e9'
                const fill   = isSel ? color : 'white'
                const stroke = isSel ? 'white' : color
                const tFill  = isSel ? 'white' : color
                const lb     = routerMap[hostname]?.router_ips?.[0]
                const isHov  = hoveredNode === hostname
                return (
                  <g key={hostname} transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: dragging?.node === hostname ? 'grabbing' : 'grab' }}
                    onMouseDown={e => startDrag(e, hostname)}
                    onMouseEnter={() => { if (!dragging) setHoveredNode(hostname) }}
                    onMouseLeave={() => setHoveredNode(null)}>
                    {isSel && (
                      <rect x={-NODE_W/2-4} y={-NODE_H/2-4} width={NODE_W+8} height={NODE_H+8}
                        rx="10" fill={color} opacity="0.15" />
                    )}
                    <rect x={-NODE_W/2} y={-NODE_H/2} width={NODE_W} height={NODE_H} rx="7"
                      fill={fill} stroke={stroke} strokeWidth={isSel ? 1.5 : 2} />
                    <text x={0} y={lb ? -7 : 0} textAnchor="middle" dominantBaseline="middle"
                      fontSize="9" fill={tFill} fontWeight="700">{hostname}</text>
                    {lb && <text x={0} y={10} textAnchor="middle" dominantBaseline="middle"
                      fontSize="8" fill={isSel ? 'rgba(255,255,255,0.78)' : color}
                      fontFamily="'Courier New',monospace">{lb}</text>}
                    {isHov && !dragging && (
                      <g style={{ cursor: 'pointer' }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); deleteNode(hostname) }}>
                        <circle cx={NODE_W/2-1} cy={-NODE_H/2+1} r="9"
                          fill="#ef4444" stroke="white" strokeWidth="1.5" />
                        <text x={NODE_W/2-1} y={-NODE_H/2+1.5}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize="12" fill="white" fontWeight="900" style={{pointerEvents:'none'}}>×</text>
                      </g>
                    )}
                  </g>
                )
              })}

              {(() => {
                const tips = []
                if (showIPs) {
                  for (const [key, edge] of Object.entries(visibleEdgeMap)) {
                    const pa=positions[edge.a], pb=positions[edge.b]; if (!pa||!pb) continue
                    const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
                    tips.push(makeTooltip(`sip-${key}`, edge, (x1+x2)/2, (y1+y2)/2, false))
                  }
                }
                for (const key of pinnedEdges) {
                  const edge=visibleEdgeMap[key]; if (!edge) continue
                  const pa=positions[edge.a], pb=positions[edge.b]; if (!pa||!pb) continue
                  const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
                  tips.push(makeTooltip(`pin-${key}`, edge, (x1+x2)/2, (y1+y2)/2, true))
                }
                if (hoveredEdge && !showIPs && !pinnedEdges.has(hoveredEdge)) {
                  const edge=visibleEdgeMap[hoveredEdge]; if (edge) {
                    const pa=positions[edge.a], pb=positions[edge.b]; if (pa&&pb) {
                      const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
                      tips.push(makeTooltip('hover', edge, (x1+x2)/2, (y1+y2)/2, false))
                    }
                  }
                }
                return tips
              })()}
            </svg>
          </div>

          <div className="isis-router-topo-legend">
            <span><span className="dot pe" /> PE (selected)</span>
            <span><span className="dot core" /> P/Core (selected)</span>
            <span style={{display:'flex',alignItems:'center',gap:'5px'}}>
              <span style={{width:14,height:14,border:'2px solid #4858c8',borderRadius:3,display:'inline-block'}} /> neighbor
            </span>
            <span className="isis-topo-note">
              Drag node &nbsp;·&nbsp; Hover node → ✕ hapus &nbsp;·&nbsp; Klik kanan link → menu hapus &nbsp;·&nbsp; Double-click link → pin tooltip
            </span>
          </div>
        </>
      )}

      {ctxMenu && (
        <div className="isis-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={e => e.stopPropagation()}>
          <div className="isis-ctx-header">Link</div>
          <button className="isis-ctx-item isis-ctx-item--danger"
            onClick={() => { deleteEdge(ctxMenu.key); setCtxMenu(null) }}>
            🗑 Hapus Link
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Router search ────────────────────────────────────────
function RouterSearch({ label, value, onChange, options }) {
  const [open, setOpen]   = useState(false)
  const [q, setQ]         = useState(value)
  const [hlIdx, setHlIdx] = useState(-1)
  const ref     = useRef()
  const listRef = useRef()

  useEffect(() => { setQ(value) }, [value])

  const filtered = useMemo(() =>
    options.filter(o => o.toLowerCase().includes(q.toLowerCase())).slice(0, 20),
    [options, q]
  )

  useEffect(() => setHlIdx(-1), [filtered])

  useEffect(() => {
    if (hlIdx >= 0 && listRef.current) {
      listRef.current.children[hlIdx]?.scrollIntoView({ block: 'nearest' })
    }
  }, [hlIdx])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (o) => { onChange(o); setQ(o); setOpen(false); setHlIdx(-1) }

  return (
    <div className="router-search-wrap" ref={ref}>
      <label>{label}</label>
      <input
        className="router-search-input"
        value={q}
        placeholder="Ketik nama router..."
        onChange={e => { setQ(e.target.value); setOpen(true); onChange('') }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!open || !filtered.length) return
          if      (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(i => Math.min(i + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp')   { e.preventDefault(); setHlIdx(i => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && hlIdx >= 0) { e.preventDefault(); select(filtered[hlIdx]) }
          else if (e.key === 'Escape')    { setOpen(false); setHlIdx(-1) }
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="router-search-dropdown" ref={listRef}>
          {filtered.map((o, i) => (
            <li key={o} className={i === hlIdx ? 'hl' : ''}
              onMouseDown={() => select(o)}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────
export default function ISISAnalyzer() {
  const [tab, setTab] = useState('routers')

  const [routers, setRouters]             = useState([])
  const [loadingRouters, setLoadingRouters] = useState(true)
  const [routerError, setRouterError]     = useState('')
  const [search, setSearch]               = useState('')
  const [expandedRouters, setExpandedRouters] = useState(new Set())

  const toggleRouter = (sysid) => {
    setExpandedRouters(prev => {
      const next = new Set(prev)
      next.has(sysid) ? next.delete(sysid) : next.add(sysid)
      return next
    })
  }

  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)

  const [src, setSrc]           = useState('')
  const [dst, setDst]           = useState('')
  const [kPaths, setKPaths]     = useState(3)
  const [paths, setPaths]       = useState([])
  const [pathError, setPathError] = useState('')
  const [loadingPaths, setLoadingPaths] = useState(false)
  const [expandedPath, setExpandedPath] = useState(null)

  useEffect(() => { fetchRouters() }, [])

  const fetchRouters = () => {
    setLoadingRouters(true)
    apiFetch('/api/isis/routers/')
      .then(data => { setRouters(data.routers || []); setRouterError('') })
      .catch(err => {
        if (err.message === '401 Unauthorized') return
        setRouterError(`Gagal memuat data router (${err.message}). Pastikan backend Django berjalan.`)
      })
      .finally(() => setLoadingRouters(false))
  }

  const refreshLSDB = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const data = await apiPost('/api/isis/refresh/')
      if (data.status === 'ok') {
        setRefreshMsg({ ok: true, text: data.message || 'LSDB berhasil di-import ulang' })
        fetchRouters()
      } else {
        setRefreshMsg({ ok: false, text: data.message || 'Gagal import LSDB' })
      }
    } catch {
      setRefreshMsg({ ok: false, text: 'Gagal menghubungi API' })
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(null), 5000)
    }
  }

  const filteredRouters = useMemo(() => {
    if (!search) return routers
    const q = search.toLowerCase()
    return routers.filter(r =>
      r.hostname.toLowerCase().includes(q) ||
      (r.router_ips || []).some(ip => ip.includes(q)) ||
      (r.adjacency || []).some(adj =>
        adj.hostname.toLowerCase().includes(q) ||
        adj.local_ip?.includes(q) ||
        adj.remote_ip?.includes(q)
      )
    )
  }, [routers, search])

  const isIpSearch = search.length >= 4 && /[\d.]/.test(search)
  const isRouterOpen = (r) => {
    if (expandedRouters.has(r.system_id)) return true
    if (isIpSearch) {
      const q = search.toLowerCase()
      return (r.router_ips || []).some(ip => ip.includes(q)) ||
             (r.adjacency || []).some(adj =>
               adj.local_ip?.includes(q) || adj.remote_ip?.includes(q))
    }
    return false
  }

  const routerNames = useMemo(() => routers.map(r => r.hostname), [routers])

  const findPaths = async () => {
    setPathError(''); setPaths([])
    if (!src || !dst) { setPathError('Source dan destination wajib diisi'); return }
    if (src === dst)  { setPathError('Source dan destination tidak boleh sama'); return }
    setLoadingPaths(true)
    try {
      const data = await apiFetch(`/api/isis/paths/?src=${encodeURIComponent(src)}&dst=${encodeURIComponent(dst)}&k=${kPaths}`)
      if (data.error) { setPathError(data.error); return }
      setPaths(data.paths || [])
      setExpandedPath(0)
    } catch {
      setPathError('Gagal menghubungi API')
    } finally {
      setLoadingPaths(false)
    }
  }

  return (
    <div className="isis-root">

      {/* Tabs */}
      <div className="isis-tabs">
        {[
          { key: 'routers', label: '🌐 Routers' },
          { key: 'paths',   label: '🔀 Path Finder' },
          { key: 'netmap',  label: '🗺 Network Map' },
        ].map(t => (
          <button key={t.key} className={`isis-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
        {!loadingRouters && routers.length > 0 && (
          <div className="isis-tab-badge">● {routers.length} routers loaded</div>
        )}
        <div className="isis-refresh-wrap">
          {refreshMsg && (
            <span className={`isis-refresh-msg ${refreshMsg.ok ? 'ok' : 'err'}`}>
              {refreshMsg.ok ? '✓' : '✗'} {refreshMsg.text}
            </span>
          )}
          <button
            className={`isis-btn isis-btn--refresh ${refreshing ? 'loading' : ''}`}
            onClick={refreshLSDB}
            disabled={refreshing}
            title="Ambil data LSDB dari router dan re-import">
            {refreshing ? '⏳ Importing...' : '🔄 Refresh LSDB'}
          </button>
        </div>
      </div>

      {/* ══ PERUBAHAN 2: Pakai display:none agar state tidak hilang saat ganti tab ══ */}

      {/* TAB: ROUTERS */}
      <div className="isis-panel" style={{ display: tab === 'routers' ? '' : 'none' }}>
        <div className="isis-toolbar">
          <input className="isis-search"
            placeholder="🔍  Search hostname, system ID, atau IP..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <div className="isis-toolbar-right">
            <button className="isis-btn" onClick={() => exportCSV(filteredRouters)}>⬇ CSV</button>
            <button className="isis-btn isis-btn--green" onClick={() => exportExcel(filteredRouters)}>⬇ Excel</button>
          </div>
        </div>

        {loadingRouters && <div className="isis-loading">⏳ Memuat data router...</div>}
        {routerError   && <div className="isis-error">{routerError}</div>}

        {!loadingRouters && !routerError && (
          <div className="isis-table-wrap">
            <table className="isis-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Hostname</th>
                  <th>Loopback IP</th>
                  <th>Prefix-SID</th>
                  <th style={{textAlign:'center'}}>Neighbors</th>
                  <th>Adjacency</th>
                </tr>
              </thead>
              <tbody>
                {filteredRouters.length === 0
                  ? <tr><td colSpan={6} className="isis-empty">Tidak ada data</td></tr>
                  : filteredRouters.map((r, i) => {
                    const isOpen   = isRouterOpen(r)
                    const loopback = r.router_ips?.[0] || '-'
                    const nbCount  = (r.adjacency || []).length
                    return (
                      <Fragment key={r.system_id}>
                        <tr className={isOpen ? 'row-expanded' : ''}>
                          <td>{i + 1}</td>
                          <td>
                            <span className={`isis-hostname ${!r.hostname.startsWith('PE') ? 'core' : 'pe'}`}>
                              <Highlight text={r.hostname} query={search} />
                            </span>
                          </td>
                          <td>
                            <code className="loopback-ip">
                              <Highlight text={loopback} query={search} />
                            </code>
                          </td>
                          <td>
                            {r.prefix_sid != null
                              ? <span className="isis-sid">{r.prefix_sid}</span>
                              : <span className="isis-na">-</span>}
                          </td>
                          <td style={{textAlign:'center'}}>
                            <span className="isis-nb-count">{nbCount}</span>
                          </td>
                          <td>
                            <button
                              className={`isis-show-btn ${isOpen ? 'open' : ''}`}
                              onClick={() => toggleRouter(r.system_id)}>
                              {isOpen ? '▲ Hide' : '▼ Show'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="row-detail">
                            <td colSpan={6}>
                              <div className="adj-link-list">
                                {(r.adjacency || []).length === 0
                                  ? <span className="isis-na">Tidak ada adjacency</span>
                                  : (r.adjacency || []).map((adj, ai) => {
                                    const qlo = search.toLowerCase()
                                    const matchLocal  = adj.local_ip?.includes(qlo)
                                    const matchRemote = adj.remote_ip?.includes(qlo)
                                    return (
                                      <div key={ai} className={`adj-link-row ${(matchLocal || matchRemote) ? 'adj-link-row--hl' : ''}`}>
                                        <span className={`isis-hostname adj-lh ${!r.hostname.startsWith('PE') ? 'core' : 'pe'}`}>
                                          <Highlight text={r.hostname} query={search} />
                                        </span>
                                        <span className="adj-link-colon">:</span>
                                        <code className="adj-link-ip">
                                          <Highlight text={adj.local_ip || '-'} query={search} />
                                        </code>
                                        <span className="adj-link-wire">
                                          <span className="adj-link-line-l" />
                                          <span className="adj-link-cost">{adj.metric}</span>
                                          <span className="adj-link-line-r" />
                                        </span>
                                        <code className="adj-link-ip">
                                          <Highlight text={adj.remote_ip || '-'} query={search} />
                                        </code>
                                        <span className="adj-link-colon">:</span>
                                        <span className={`isis-hostname adj-lh ${!adj.hostname.startsWith('PE') ? 'core' : 'pe'}`}>
                                          <Highlight text={adj.hostname} query={search} />
                                        </span>
                                      </div>
                                    )
                                  })
                                }
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}

        <div className="isis-footer">
          {filteredRouters.length} router ditampilkan
          <span className="isis-source-badge">● Data dari API</span>
        </div>
      </div>

      {/* TAB: PATH FINDER */}
      <div className="isis-panel" style={{ display: tab === 'paths' ? '' : 'none' }}>
        <div className="isis-path-form">
          <div className="isis-form-row">
            <RouterSearch label="Source Router" value={src} onChange={setSrc} options={routerNames} />
            <div className="isis-form-arrow">→</div>
            <RouterSearch label="Destination Router" value={dst} onChange={setDst} options={routerNames} />
            <div className="isis-form-field isis-form-field--sm">
              <label>Possible Path</label>
              <input type="number" min={1} max={10} value={kPaths}
                onChange={e => setKPaths(Math.min(10, Math.max(1, Number(e.target.value))))} />
            </div>
            <button className="isis-btn isis-btn--primary isis-btn--find"
              onClick={findPaths} disabled={loadingPaths}>
              {loadingPaths ? '⏳ Mencari...' : '🔍 Find Paths'}
            </button>
          </div>
          {pathError && <div className="isis-error">{pathError}</div>}
        </div>

        {paths.length > 0 && (
          <div className="isis-path-results">
            <div className="isis-path-summary">
              Ditemukan <strong>{paths.length}</strong> path:
              <strong> {src}</strong> → <strong>{dst}</strong>
            </div>

            <PathTopologySVG paths={paths} src={src} dst={dst} />

            {paths.map((p, pi) => (
              <div key={pi} className={`isis-path-card ${expandedPath === pi ? 'expanded' : ''}`}
                style={{ '--path-color': PATH_COLORS[pi % PATH_COLORS.length] }}>
                <div className="isis-path-header"
                  onClick={() => setExpandedPath(expandedPath === pi ? null : pi)}>
                  <span className="isis-path-num"
                    style={{ background: PATH_COLORS[pi % PATH_COLORS.length] }}>
                    Path #{p.path_index}
                  </span>
                  <span className="isis-path-route">{(p.path || []).join(' → ')}</span>
                  <div className="isis-path-meta">
                    <span className="isis-badge isis-badge--metric">Metric: {p.total_metric}</span>
                    <span className="isis-badge isis-badge--hop">Hops: {p.hop_count}</span>
                    <span className="isis-expand-icon">{expandedPath === pi ? '▲' : '▼'}</span>
                  </div>
                </div>

                {expandedPath === pi && (
                  <div className="isis-path-detail">
                    <div className="isis-hop-chain">
                      {(p.hops || []).map((hop, hi) => (
                        <div key={hi} className="isis-hop-group">
                          <div className={`isis-hop-node ${hop.is_source ? 'src' : hop.is_destination ? 'dst' : ''}`}>
                            <div className="isis-hop-name">{hop.router}</div>
                            <div className="isis-hop-lb">{hop.loopback || '-'}</div>
                            {hop.prefix_sid && <div className="isis-hop-sid">SID:{hop.prefix_sid}</div>}
                          </div>
                          {!hop.is_destination && (
                            <div className="isis-hop-link">
                              <div className="isis-hop-line">
                                <span className="isis-hop-cost">{hop.adj_cost}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <table className="isis-hop-table">
                      <thead>
                        <tr>
                          <th>Hop</th><th>Router</th>
                          <th>Local IP</th><th>Remote IP</th><th>Adj Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(p.hops || []).map((hop, hi) => (
                          <tr key={hi} className={hop.is_source ? 'row-src' : hop.is_destination ? 'row-dst' : ''}>
                            <td>{hi + 1}</td>
                            <td><strong>{hop.router}</strong></td>
                            <td><code className="ip-out">{hop.outgoing_ip || '-'}</code></td>
                            <td><code className="ip-in">{hop.incoming_ip || '-'}</code></td>
                            <td>{hop.adj_cost ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TAB: NETWORK MAP */}
      <div className="isis-panel isis-panel--netmap" style={{ display: tab === 'netmap' ? '' : 'none' }}>
        {!loadingRouters && <NetworkMapView allRouters={routers} />}
        {loadingRouters && <div className="isis-loading">⏳ Memuat data router...</div>}
      </div>

    </div>
  )
}