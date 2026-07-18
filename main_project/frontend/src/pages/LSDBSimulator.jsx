// src/pages/LSDBSimulator.jsx
// Path Finder style + editable topology – v3
// Features: neighbor count on nodes, existing link/node browsers, path compare
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { yenKSP, computeDiff } from '../utils/graphAlgo'
import './ISISAnalyzer.css'
import './LSDBSimulator.css'

// ─── Auth helpers ──────────────────────────────────────────────────────────────
const token = () => localStorage.getItem('access')
let _refreshing = null
async function tryRefresh() {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    const refresh = localStorage.getItem('refresh')
    if (!refresh) throw new Error('no refresh token')
    const r = await fetch('/api/auth/token/refresh/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
    if (!r.ok) throw new Error('refresh failed')
    const d = await r.json()
    localStorage.setItem('access', d.access)
    if (d.refresh) localStorage.setItem('refresh', d.refresh)
  })()
  try { return await _refreshing } finally { _refreshing = null }
}
function goLogin() {
  localStorage.removeItem('access'); localStorage.removeItem('refresh')
  window.location.href = '/login'
}
async function apiFetch(url) {
  let r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } })
  if (r.status === 401) {
    try { await tryRefresh(); r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } }) }
    catch { goLogin(); throw new Error('401') }
  }
  if (r.status === 401) { goLogin(); throw new Error('401') }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ─── Build graph ───────────────────────────────────────────────────────────────
function buildGraph(routers) {
  const nodes = {}, edges = {}
  for (const r of routers)
    nodes[r.hostname] = { hostname: r.hostname, router_ips: r.router_ips || [], prefix_sid: r.prefix_sid ?? null }
  for (const r of routers) {
    for (const adj of (r.adjacency || [])) {
      if (!nodes[adj.hostname]) continue
      const key = [r.hostname, adj.hostname].sort().join('|||')
      if (!edges[key]) edges[key] = { a: r.hostname, b: adj.hostname, metric: adj.metric ?? 10, ip_a: adj.local_ip || null, ip_b: adj.remote_ip || null }
    }
  }
  return { nodes, edges }
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const PATH_COLORS = ['#4858c8','#0ea5e9','#16a34a','#dc2626','#f59e0b','#7c3aed','#ec4899','#14b8a6']
const PATH_DASH   = [null,'8,4','4,4','8,4,4,4',null,'8,4','4,4','8,4,4,4']
const NW = 132, NH = 50

// ─── Layout ────────────────────────────────────────────────────────────────────
function computeLevelLayout(paths) {
  if (!paths?.length) return { positions: {}, W: 800, H: 400 }
  const levels = {}
  const allSet = new Set()
  for (const p of paths) p.path.forEach((n, i) => {
    allSet.add(n)
    if (levels[n] === undefined || levels[n] > i) levels[n] = i
  })
  const byLevel = {}
  for (const n of allSet) { const l = levels[n]; if (!byLevel[l]) byLevel[l] = []; byLevel[l].push(n) }
  Object.values(byLevel).forEach(a => a.sort())
  const maxLevel    = Math.max(...Object.values(levels))
  const maxPerLevel = Math.max(...Object.values(byLevel).map(a => a.length))
  const PAD = 200, padX = 70+PAD, padY = 55+PAD
  const levelGap = Math.max(NW+90, 220), rowGap = Math.max(NH+50, 100)
  const W = Math.max(900, padX*2 + maxLevel*levelGap + NW)
  const H = Math.max(180, padY*2 + (maxPerLevel-1)*rowGap + NH)
  const positions = {}
  for (const [ls, nodes] of Object.entries(byLevel)) {
    const l = Number(ls), x = padX+NW/2+l*levelGap
    const totalH = (nodes.length-1)*rowGap, startY = (H-totalH)/2
    nodes.forEach((n, i) => { positions[n] = { x, y: startY+i*rowGap } })
  }
  return { positions, W, H }
}
function shortenLine(ax, ay, bx, by) {
  const dx=bx-ax, dy=by-ay, len=Math.sqrt(dx*dx+dy*dy)||1
  const hw=NW/2+3, hh=NH/2+3
  const t = Math.min(hw/(Math.abs(dx/len)||1e-6), hh/(Math.abs(dy/len)||1e-6))
  return { x1:ax+(dx/len)*t, y1:ay+(dy/len)*t, x2:bx-(dx/len)*(t+9), y2:by-(dy/len)*(t+9), dx, dy, len }
}

// ─── RouterSearch ──────────────────────────────────────────────────────────────
function RouterSearch({ label, value, onChange, options }) {
  const [open, setOpen]   = useState(false)
  const [q, setQ]         = useState(value)
  const [hlIdx, setHlIdx] = useState(-1)
  const ref = useRef(), listRef = useRef()
  useEffect(() => { setQ(value) }, [value])
  const filtered = useMemo(() => options.filter(o => o.toLowerCase().includes(q.toLowerCase())).slice(0,20), [options, q])
  useEffect(() => setHlIdx(-1), [filtered])
  useEffect(() => { if (hlIdx>=0&&listRef.current) listRef.current.children[hlIdx]?.scrollIntoView({block:'nearest'}) }, [hlIdx])
  useEffect(() => {
    const h = e => { if (ref.current&&!ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const select = o => { onChange(o); setQ(o); setOpen(false); setHlIdx(-1) }
  return (
    <div className="sim-rs-wrap" ref={ref}>
      <label className="sim-rs-label">{label}</label>
      <input className="sim-rs-input" value={q} placeholder="Ketik nama router..."
        onChange={e => { setQ(e.target.value); setOpen(true); onChange('') }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!open||!filtered.length) return
          if (e.key==='ArrowDown')  { e.preventDefault(); setHlIdx(i=>Math.min(i+1,filtered.length-1)) }
          else if (e.key==='ArrowUp') { e.preventDefault(); setHlIdx(i=>Math.max(i-1,0)) }
          else if (e.key==='Enter'&&hlIdx>=0) { e.preventDefault(); select(filtered[hlIdx]) }
          else if (e.key==='Escape') { setOpen(false); setHlIdx(-1) }
        }} />
      {open&&filtered.length>0&&(
        <ul className="sim-rs-dropdown" ref={listRef}>
          {filtered.map((o,i)=>(
            <li key={o} className={i===hlIdx?'hl':''} onMouseDown={()=>select(o)}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Editable Path Topology ────────────────────────────────────────────────────
function EditablePathTopology({
  simPaths, src, dst,
  simNodes, simEdges, origEdges,
  diff, readOnly=false,
  extraNodes=[],          // additional nodes to show beyond path nodes
  editMode, addLinkSrc,
  onNodeDelete, onEdgeClick, onNodeClick,
  selectedPath, showCost, showIPs,
  origNodeCount=0,
}) {
  const [posOverride, setPosOverride] = useState({})
  const [dragging, setDragging]       = useState(null)
  const [hovNode, setHovNode]         = useState(null)
  const [hovEdge, setHovEdge]         = useState(null)
  const [pinnedEdges, setPinnedEdges] = useState(new Set())
  const svgRef = useRef()

  const displayPaths = selectedPath!==null ? [simPaths[selectedPath]] : simPaths

  // Edge keys that belong to the currently displayed path(s) — used to filter cost/IP labels
  const activeEdgeKeys = useMemo(() => {
    const s = new Set()
    for (const p of displayPaths)
      for (let i = 0; i < p.path.length - 1; i++)
        s.add([p.path[i], p.path[i+1]].sort().join('|||'))
    return s
  }, [displayPaths])

  const allNodesSet = useMemo(() => {
    const s = new Set()
    // 1. nodes from computed paths
    for (const p of simPaths) for (const n of p.path) s.add(n)
    // 2. newly added nodes (not in original graph) — show them even if not in any path yet
    if (diff?.addedNodes) for (const n of diff.addedNodes) if (simNodes[n]) s.add(n)
    // 3. extra nodes explicitly requested (e.g. from ExistingNodeBrowser)
    for (const n of extraNodes) if (simNodes[n]) s.add(n)
    return s
  }, [simPaths, diff, extraNodes, simNodes])

  const { positions: basePos, W, H } = useMemo(() => computeLevelLayout(simPaths), [simPaths])

  // When allNodesSet changes, only purge overrides for nodes that left the set
  // (don't wipe all overrides — preserves drag positions for existing nodes)
  const prevNodeKey = useRef('')
  useEffect(() => {
    const key = [...allNodesSet].sort().join(',')
    if (key !== prevNodeKey.current) {
      setPosOverride(prev => {
        const next = {}
        for (const [h, pp] of Object.entries(prev)) if (allNodesSet.has(h)) next[h] = pp
        return next
      })
      prevNodeKey.current = key
    }
  })

  const pos = useMemo(() => {
    // 1. Start with path-layout positions
    const p = { ...basePos }
    // 2. Place extra nodes (not in path layout) in a staging row at the top of the SVG
    const unpositioned = [...allNodesSet].filter(n => !p[n])
    if (unpositioned.length > 0) {
      const cols = Math.max(1, Math.floor((W - 140) / (NW + 28)))
      unpositioned.forEach((n, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        // Place above path layout area (top 50px of SVG, before DRAG_PAD kicks in)
        p[n] = { x: 70 + NW/2 + col * (NW + 28), y: NH/2 + 14 + row * (NH + 22) }
      })
    }
    // 3. Apply drag overrides for any positioned node
    for (const [h, pp] of Object.entries(posOverride)) if (p[h] !== undefined) p[h] = pp
    return p
  }, [basePos, posOverride, allNodesSet, W])

  // Visible edges (both endpoints in topology)
  const visEdges = useMemo(() => {
    const r = {}
    for (const [k,e] of Object.entries(simEdges))
      if (allNodesSet.has(e.a)&&allNodesSet.has(e.b)) r[k]=e
    return r
  }, [simEdges, allNodesSet])

  // Visible neighbor count per node (only edges drawn in topology)
  const neighborCounts = useMemo(() => {
    const c = {}
    for (const n of allNodesSet) c[n] = 0
    for (const e of Object.values(visEdges)) {
      if (c[e.a] !== undefined) c[e.a]++
      if (c[e.b] !== undefined) c[e.b]++
    }
    return c
  }, [visEdges, allNodesSet])

  // Total neighbor count per node in full sim graph (all simEdges)
  const totalNeighborCounts = useMemo(() => {
    const c = {}
    for (const n of Object.keys(simNodes)) c[n] = 0
    for (const e of Object.values(simEdges)) {
      if (c[e.a] !== undefined) c[e.a]++
      if (c[e.b] !== undefined) c[e.b]++
    }
    return c
  }, [simNodes, simEdges])

  // Drag
  const startDrag = useCallback((e, hostname) => {
    if (editMode==='addLink') return
    e.stopPropagation()
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const sx=W/rect.width, sy=H/rect.height
    const p=pos[hostname]
    setDragging({ node:hostname, ox:(e.clientX-rect.left)*sx-p.x, oy:(e.clientY-rect.top)*sy-p.y, sx, sy, rect })
  }, [editMode, W, H, pos])
  const onMouseMove = useCallback(e => {
    if (!dragging) return
    const { node, ox, oy, sx, sy, rect } = dragging
    setPosOverride(prev => ({ ...prev, [node]: { x:(e.clientX-rect.left)*sx-ox, y:(e.clientY-rect.top)*sy-oy } }))
  }, [dragging])

  const togglePin = key => setPinnedEdges(prev => {
    const n=new Set(prev); n.has(key)?n.delete(key):n.add(key); return n
  })

  // PNG export
  const downloadPNG = () => {
    const svg=svgRef.current; if (!svg) return
    const src2='<?xml version="1.0" standalone="no"?>\r\n'+new XMLSerializer().serializeToString(svg)
    const img=new Image()
    const url=URL.createObjectURL(new Blob([src2],{type:'image/svg+xml;charset=utf-8'}))
    img.onload = () => {
      const scale=2, canvas=document.createElement('canvas')
      canvas.width=svg.width.baseVal.value*scale; canvas.height=svg.height.baseVal.value*scale
      const ctx=canvas.getContext('2d'); ctx.scale(scale,scale)
      ctx.fillStyle='#f8f9fc'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0)
      URL.revokeObjectURL(url)
      canvas.toBlob(b=>Object.assign(document.createElement('a'),
        {href:URL.createObjectURL(b),download:`sim-${src}-${dst}.png`}).click())
    }
    img.src=url
  }

  // IP tooltip
  const edgeIpTooltip = (key, edge, mx, my, pinned=false) => {
    const lines = [{label:`↗ ${edge.a}`,val:edge.ip_a},{label:`↘ ${edge.b}`,val:edge.ip_b},{label:'Metric',val:edge.metric}]
      .filter(l=>l.val!=null&&l.val!=='')
    if (!lines.length) return null
    const TW=215, TH=lines.length*18+14
    const tx=Math.min(Math.max(mx,TW/2+6),W-TW/2-6)
    const ty=my>H/2?my-TH-14:my+14
    const hdr=pinned?'#1e3a5f':'#334155'
    return (
      <g key={`tip-${key}`} style={{pointerEvents:'none'}}>
        <rect x={tx-TW/2+2} y={ty+2} width={TW} height={TH} rx="7" fill="rgba(0,0,0,0.14)" />
        <rect x={tx-TW/2}   y={ty}   width={TW} height={TH} rx="7" fill="#1e293b" />
        <rect x={tx-TW/2}   y={ty}   width={TW} height={22} rx="7" fill={hdr} />
        <rect x={tx-TW/2}   y={ty+15} width={TW} height={7}  fill={hdr} />
        <text x={tx} y={ty+14} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">
          {edge.a} → {edge.b}{pinned?' 📌':''}
        </text>
        {lines.map((l,i)=>(
          <g key={i}>
            <text x={tx-TW/2+10} y={ty+28+i*18} fontSize="8.5" fill="#94a3b8">{l.label}</text>
            <text x={tx+TW/2-8}  y={ty+28+i*18} textAnchor="end" fontSize="9"
              fill="#e2e8f0" fontFamily="'Courier New',monospace" fontWeight="600">{l.val}</text>
          </g>
        ))}
      </g>
    )
  }

  const simTotal = Object.keys(simNodes).length

  return (
    <div className="sim-topo-wrap">
      {/* Selector bar */}
      <div className="isis-path-selector">
        <button className={`isis-path-sel-btn ${selectedPath===null?'sel-all':''}`}
          onClick={()=>onNodeClick?.('__ALL__')}>All Paths</button>
        {simPaths.map((p,pi)=>(
          <button key={pi}
            className={`isis-path-sel-btn ${selectedPath===pi?'sel-active':''}`}
            style={selectedPath===pi
              ?{background:PATH_COLORS[pi%PATH_COLORS.length],borderColor:PATH_COLORS[pi%PATH_COLORS.length],color:'#fff'}
              :{borderColor:PATH_COLORS[pi%PATH_COLORS.length],color:PATH_COLORS[pi%PATH_COLORS.length]}}
            onClick={()=>onNodeClick?.(`__PATH_${pi}__`)}>
            Path #{p.path_index}<span className="isis-path-sel-meta"> · {p.total_metric}</span>
          </button>
        ))}
        <span className="isis-path-sel-divider"/>
        <button className={`isis-path-sel-btn isis-cost-toggle ${showCost?'cost-on':''}`}
          onClick={()=>onNodeClick?.('__TOGGLE_COST__')}>{showCost?'📊 Hide Cost':'📊 Show Cost'}</button>
        <button className={`isis-path-sel-btn isis-ip-toggle ${showIPs?'ip-on':''}`}
          onClick={()=>onNodeClick?.('__TOGGLE_IP__')}>{showIPs?'🔵 Hide IPs':'⚪ Show IPs'}</button>
        <button className="isis-path-sel-btn" onClick={downloadPNG}
          style={{color:'#16a34a',borderColor:'#bbf7d0'}}>📥 PNG</button>
      </div>

      {/* SVG */}
      <div className="isis-path-topo-scroll">
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          className="isis-path-topo-svg"
          style={{userSelect:'none', cursor:dragging?'grabbing':editMode==='addLink'?'crosshair':'default'}}
          onMouseMove={onMouseMove} onMouseUp={()=>setDragging(null)} onMouseLeave={()=>setDragging(null)}>
          <defs>
            {PATH_COLORS.map((c,i)=>(
              <marker key={i} id={`sarr-${readOnly?'ro':'ed'}-${i}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <polygon points="0 0, 7 2.5, 0 5" fill={c}/>
              </marker>
            ))}
          </defs>

          {/* Background edges */}
          {Object.entries(visEdges).map(([key,edge])=>{
            const pa=pos[edge.a], pb=pos[edge.b]; if(!pa||!pb) return null
            const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
            const isChanged=!!diff?.changedEdges?.[key]
            const isAdded=diff?.addedEdges?.includes(key)
            let stroke='#dde3ef',sw=5,dash
            if(isChanged){stroke='#f59e0b';sw=4}
            if(isAdded){stroke='#16a34a';sw=3;dash='8,3'}
            return <line key={`bg-${key}`} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={stroke} strokeWidth={sw} strokeDasharray={dash} strokeLinecap="round"/>
          })}

          {/* Path edges */}
          {displayPaths.map((p,dpi)=>{
            const pi=selectedPath!==null?selectedPath:dpi
            const color=PATH_COLORS[pi%PATH_COLORS.length]
            const dash=PATH_DASH[pi%PATH_DASH.length]
            const sfx=readOnly?'ro':'ed'
            return p.path.map((node,ni)=>{
              if(ni===p.path.length-1) return null
              const next=p.path[ni+1]
              const a=pos[node], b=pos[next]; if(!a||!b) return null
              const {x1,y1,x2,y2,dx,dy,len}=shortenLine(a.x,a.y,b.x,b.y)
              const offset=displayPaths.length>1?(dpi-(displayPaths.length-1)/2)*5:0
              const px=(-dy/len)*offset, py=(dx/len)*offset
              return <line key={`ln-${pi}-${ni}`}
                x1={x1+px} y1={y1+py} x2={x2+px} y2={y2+py}
                stroke={color} strokeWidth="2.5" strokeDasharray={dash||undefined}
                markerEnd={`url(#sarr-${sfx}-${pi%PATH_COLORS.length})`}
                strokeLinecap="round" opacity="0.92"/>
            })
          })}

          {/* Cost labels */}
          {showCost&&(()=>{
            const seen=new Set()
            return Object.entries(visEdges).map(([key,edge])=>{
              if(!activeEdgeKeys.has(key)) return null
              if(seen.has(key)) return null; seen.add(key)
              const pa=pos[edge.a], pb=pos[edge.b]; if(!pa||!pb) return null
              const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
              const mx=(x1+x2)/2, my=(y1+y2)/2
              const isChanged=diff?.changedEdges?.[key]
              return (
                <g key={`cost-${key}`} style={{pointerEvents:'none'}}>
                  <rect x={mx-20} y={my-11} width={40} height={22} rx="5"
                    fill={isChanged?'#fef3c7':'#f0f0ff'} stroke={isChanged?'#f59e0b':'#4858c8'} strokeWidth="1.2"/>
                  <text x={mx} y={my+1} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9.5" fill={isChanged?'#92400e':'#3730a3'} fontWeight="800">{edge.metric}</text>
                  {isChanged&&(
                    <text x={mx} y={my+15} textAnchor="middle" fontSize="8" fill="#9ca3af" style={{pointerEvents:'none'}}>
                      was {diff.changedEdges[key].orig}
                    </text>
                  )}
                </g>
              )
            })
          })()}

          {/* Edge hit areas */}
          {!readOnly&&Object.entries(visEdges).map(([key,edge])=>{
            const pa=pos[edge.a], pb=pos[edge.b]; if(!pa||!pb) return null
            const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
            return <line key={`hit-${key}`} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="transparent" strokeWidth="22"
              style={{cursor:editMode==='select'?'pointer':'default'}}
              onMouseEnter={()=>!dragging&&setHovEdge(key)}
              onMouseLeave={()=>setHovEdge(null)}
              onClick={e=>{e.stopPropagation();if(editMode==='select') onEdgeClick?.(key,edge,e.clientX,e.clientY)}}
              onDoubleClick={e=>{e.stopPropagation();togglePin(key)}}/>
          })}

          {/* Nodes */}
          {[...allNodesSet].map(hostname=>{
            const p=pos[hostname]; if(!p) return null
            const nd=simNodes[hostname]||{}
            const isSrc=hostname===src, isDst=hostname===dst
            const isAdded=diff?.addedNodes?.includes(hostname)
            const isHov=hovNode===hostname
            const isLinkSrc=!readOnly&&editMode==='addLink'&&addLinkSrc===hostname
            const lb=nd.router_ips?.[0]
            const nc    = neighborCounts[hostname] ?? 0       // visible neighbors
            const ncMax = totalNeighborCounts[hostname] ?? 0  // total in sim graph
            const fill=isSrc?'#16a34a':isDst?'#dc2626':isAdded?'#16a34a':'#4858c8'
            const stroke=isLinkSrc?'#f59e0b':'white'
            const sw=isLinkSrc?3:1.5

            return (
              <g key={hostname} transform={`translate(${p.x},${p.y})`}
                style={{cursor:!readOnly&&editMode==='addLink'?'pointer':(dragging?.node===hostname?'grabbing':'grab')}}
                onMouseDown={e=>startDrag(e,hostname)}
                onMouseEnter={()=>!dragging&&setHovNode(hostname)}
                onMouseLeave={()=>setHovNode(null)}
                onClick={e=>{
                  if(dragging) return
                  if(!readOnly&&editMode==='addLink'){e.stopPropagation();onNodeClick?.(hostname)}
                }}>
                {/* Glow ring */}
                {(isSrc||isDst||isLinkSrc)&&(
                  <rect x={-NW/2-5} y={-NH/2-5} width={NW+10} height={NH+10} rx="11"
                    fill={isLinkSrc?'#fef3c7':fill} opacity="0.18"/>
                )}
                {/* Node box */}
                <rect x={-NW/2} y={-NH/2} width={NW} height={NH} rx="7"
                  fill={fill} stroke={stroke} strokeWidth={sw}/>
                {/* Hostname */}
                <text x={0} y={lb?-10:0} textAnchor="middle" dominantBaseline="middle"
                  fontSize="9" fill="white" fontWeight="700">{hostname}</text>
                {/* Loopback IP */}
                {lb&&<text x={0} y={8} textAnchor="middle" dominantBaseline="middle"
                  fontSize="7.5" fill="rgba(255,255,255,0.78)" fontFamily="'Courier New',monospace">{lb}</text>}
                {/* Neighbor badge: "visible/total" e.g. "2/5" */}
                <g style={{pointerEvents:'none'}}>
                  <rect x={NW/2-34} y={-NH/2+2} width={32} height={16} rx="4"
                    fill={nc<ncMax ? 'rgba(245,158,11,0.35)' : 'rgba(0,0,0,0.22)'}/>
                  {/* visible count */}
                  <text x={NW/2-24} y={-NH/2+10} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill="rgba(255,255,255,0.95)" fontWeight="800">{nc}</text>
                  {/* separator */}
                  <text x={NW/2-18} y={-NH/2+10} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill="rgba(255,255,255,0.55)" fontWeight="400">/</text>
                  {/* total count */}
                  <text x={NW/2-10} y={-NH/2+10} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill="rgba(255,255,255,0.75)" fontWeight="600">{ncMax}</text>
                </g>
                {/* Delete button – select mode, hover, not readOnly */}
                {!readOnly&&isHov&&!dragging&&editMode==='select'&&(
                  <g style={{cursor:'pointer'}}
                    onMouseDown={e=>e.stopPropagation()}
                    onClick={e=>{e.stopPropagation();onNodeDelete?.(hostname)}}>
                    <circle cx={NW/2-1} cy={-NH/2+1} r="9" fill="#ef4444" stroke="white" strokeWidth="1.5"/>
                    <text x={NW/2-1} y={-NH/2+1.5} textAnchor="middle" dominantBaseline="middle"
                      fontSize="12" fill="white" fontWeight="900" style={{pointerEvents:'none'}}>×</text>
                  </g>
                )}
                {/* Add-link target hint */}
                {!readOnly&&editMode==='addLink'&&addLinkSrc&&addLinkSrc!==hostname&&isHov&&(
                  <g style={{pointerEvents:'none'}}>
                    <circle cx={0} cy={-NH/2-14} r="10" fill="#16a34a" stroke="white" strokeWidth="1.5"/>
                    <text x={0} y={-NH/2-13} textAnchor="middle" dominantBaseline="middle"
                      fontSize="13" fill="white" fontWeight="700">+</text>
                  </g>
                )}
              </g>
            )
          })}

          {/* IP Tooltips */}
          {(()=>{
            const tips=[]
            if(showIPs) for(const [key,edge] of Object.entries(visEdges)){
              if(!activeEdgeKeys.has(key)) continue
              const pa=pos[edge.a],pb=pos[edge.b]; if(!pa||!pb) continue
              const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
              tips.push(edgeIpTooltip(key,edge,(x1+x2)/2,(y1+y2)/2))
            }
            for(const key of pinnedEdges){
              const edge=visEdges[key]; if(!edge) continue
              const pa=pos[edge.a],pb=pos[edge.b]; if(!pa||!pb) continue
              const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
              tips.push(edgeIpTooltip(`pin-${key}`,edge,(x1+x2)/2,(y1+y2)/2,true))
            }
            if(hovEdge&&!showIPs&&!pinnedEdges.has(hovEdge)){
              const edge=visEdges[hovEdge]; if(edge){
                const pa=pos[edge.a],pb=pos[edge.b]; if(pa&&pb){
                  const {x1,y1,x2,y2}=shortenLine(pa.x,pa.y,pb.x,pb.y)
                  tips.push(edgeIpTooltip('hov',edge,(x1+x2)/2,(y1+y2)/2))
                }
              }
            }
            return tips
          })()}
        </svg>
      </div>

      {/* Legend */}
      <div className="isis-path-topo-legend">
        <span className="isis-path-topo-legend-src">
          <span style={{background:'#16a34a'}} className="isis-path-topo-dot"/> {src}
        </span>
        <span className="isis-path-topo-legend-dst">
          <span style={{background:'#dc2626'}} className="isis-path-topo-dot"/> {dst}
        </span>
        <span className="isis-path-topo-legend-sep">|</span>
        {simPaths.map((p,pi)=>(
          <span key={pi} className="isis-path-topo-legend-item">
            <svg width="28" height="10" style={{display:'inline-block',verticalAlign:'middle'}}>
              <line x1="0" y1="5" x2="28" y2="5"
                stroke={PATH_COLORS[pi%PATH_COLORS.length]} strokeWidth="2.5"
                strokeDasharray={PATH_DASH[pi%PATH_DASH.length]||undefined}/>
            </svg>
            <span style={{color:PATH_COLORS[pi%PATH_COLORS.length]}}>Path #{p.path_index}</span>
            <span className="isis-path-topo-meta">· {p.total_metric} · {p.hop_count}h</span>
          </span>
        ))}
        <span className="isis-path-topo-legend-sep">|</span>
        <span className="sim-usage-label">
          🖧 <strong>{allNodesSet.size}</strong> ditampilkan dari <strong>{simTotal}</strong> router total
        </span>
        {!readOnly&&<>
          {diff?.addedEdges?.length>0&&<span style={{color:'#16a34a',fontSize:11,fontWeight:600}}>+{diff.addedEdges.length} link baru</span>}
          {Object.keys(diff?.changedEdges||{}).length>0&&<span style={{color:'#f59e0b',fontSize:11,fontWeight:600}}>~{Object.keys(diff.changedEdges).length} metric berubah</span>}
          <span className="isis-topo-note">Drag · Hover node→✕ hapus · Klik link→edit · Dbl-click link→pin IP</span>
        </>}
        {readOnly&&<span className="isis-topo-note sim-readonly-badge">👁 Read-only (original graph)</span>}
      </div>
    </div>
  )
}

// ─── Edge edit panel ───────────────────────────────────────────────────────────
function EdgeEditPanel({ edgeKey, edge, origEdge, onSave, onDelete, onClose, anchorX, anchorY }) {
  const [metric, setMetric] = useState(String(edge?.metric??10))
  return (
    <div className="sim-edge-panel" style={{top:anchorY,left:anchorX}}
      onMouseDown={e=>e.stopPropagation()}>
      <div className="sim-edge-panel-header"><span>✎ Edit Link</span>
        <button className="sim-ep-close" onClick={onClose}>×</button></div>
      <div className="sim-edge-panel-route">{edge?.a} ↔ {edge?.b}</div>
      {origEdge&&origEdge.metric!==edge?.metric&&(
        <div className="sim-ep-orig">Original metric: {origEdge.metric}</div>
      )}
      <label className="sim-ep-label">Metric / Cost</label>
      <input className="sim-ep-input" type="number" min={1} value={metric}
        onChange={e=>setMetric(e.target.value)} autoFocus
        onKeyDown={e=>{if(e.key==='Enter') onSave(edgeKey,Number(metric)||1)}}/>
      {origEdge&&(
        <button className="sim-ep-restore" onClick={()=>{setMetric(String(origEdge.metric));onSave(edgeKey,origEdge.metric)}}>
          ↺ Restore original ({origEdge.metric})
        </button>
      )}
      <div className="sim-ep-actions">
        <button className="sim-ep-btn sim-ep-btn--save" onClick={()=>onSave(edgeKey,Number(metric)||1)}>✓ Save</button>
        <button className="sim-ep-btn sim-ep-btn--del"  onClick={()=>onDelete(edgeKey)}>🗑 Delete</button>
      </div>
    </div>
  )
}

// ─── Add link dialog (new link) ────────────────────────────────────────────────
function AddLinkDialog({ nodeA, nodeB, origEdge, onConfirm, onCancel }) {
  const [metric, setMetric] = useState(String(origEdge?.metric??10))
  const [ipA, setIpA]       = useState(origEdge?.ip_a||'')
  const [ipB, setIpB]       = useState(origEdge?.ip_b||'')
  return (
    <div className="sim-modal-overlay" onClick={onCancel}>
      <div className="sim-modal" onClick={e=>e.stopPropagation()}>
        <div className="sim-modal-header">➕ Tambah Link</div>
        <div className="sim-modal-route">{nodeA} ↔ {nodeB}</div>
        {origEdge&&<div className="sim-modal-existing">✓ Link ini ada di original graph (metric: {origEdge.metric}) — sudah di-prefill</div>}
        <label className="sim-modal-label">Metric / Cost *</label>
        <input className="sim-modal-input" type="number" min={1} value={metric} onChange={e=>setMetric(e.target.value)} autoFocus/>
        <label className="sim-modal-label">IP {nodeA} (opsional)</label>
        <input className="sim-modal-input" placeholder="e.g. 10.0.0.1" value={ipA} onChange={e=>setIpA(e.target.value)}/>
        <label className="sim-modal-label">IP {nodeB} (opsional)</label>
        <input className="sim-modal-input" placeholder="e.g. 10.0.0.2" value={ipB} onChange={e=>setIpB(e.target.value)}/>
        <div className="sim-modal-actions">
          <button className="sim-ep-btn sim-ep-btn--save"
            onClick={()=>onConfirm({metric:Number(metric)||10,ip_a:ipA||null,ip_b:ipB||null})}>✓ Add Link</button>
          <button className="sim-ep-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add router dialog (new) ───────────────────────────────────────────────────
function AddRouterDialog({ onConfirm, onCancel }) {
  const [hostname,setHostname]=useState('')
  const [ip,setIp]=useState('')
  const [sid,setSid]=useState('')
  return (
    <div className="sim-modal-overlay" onClick={onCancel}>
      <div className="sim-modal" onClick={e=>e.stopPropagation()}>
        <div className="sim-modal-header">🖥 Tambah Router Baru</div>
        <label className="sim-modal-label">Hostname *</label>
        <input className="sim-modal-input" placeholder="e.g. PE-NEW-01" value={hostname}
          onChange={e=>setHostname(e.target.value)} autoFocus/>
        <label className="sim-modal-label">Loopback IP (opsional)</label>
        <input className="sim-modal-input" placeholder="e.g. 10.0.0.99" value={ip} onChange={e=>setIp(e.target.value)}/>
        <label className="sim-modal-label">Prefix-SID (opsional)</label>
        <input className="sim-modal-input" type="number" placeholder="e.g. 999" value={sid} onChange={e=>setSid(e.target.value)}/>
        <div className="sim-modal-actions">
          <button className="sim-ep-btn sim-ep-btn--save" disabled={!hostname.trim()}
            onClick={()=>onConfirm({hostname:hostname.trim(),router_ips:ip?[ip.trim()]:[],prefix_sid:sid?Number(sid):null})}>
            ✓ Add Router
          </button>
          <button className="sim-ep-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Existing Link Browser ─────────────────────────────────────────────────────
// excludeEdgeSet = Set of edge keys currently VISIBLE (drawn) in the topology SVG
function ExistingLinkBrowser({ origEdges, excludeEdgeSet, onAdd, onClose }) {
  const [q, setQ] = useState('')
  // Show all original edges NOT currently drawn on the topology SVG
  const available = Object.entries(origEdges).filter(([key]) => !excludeEdgeSet.has(key))
  const filtered  = available.filter(([key, edge]) =>
    key.toLowerCase().includes(q.toLowerCase()) ||
    edge.a.toLowerCase().includes(q.toLowerCase()) ||
    edge.b.toLowerCase().includes(q.toLowerCase())
  )
  return (
    <div className="sim-browser-overlay" onClick={onClose}>
      <div className="sim-browser" onClick={e=>e.stopPropagation()}>
        <div className="sim-browser-header">
          <span>🔗 Tambah Link dari Graph Original</span>
          <button className="sim-ep-close" onClick={onClose}>×</button>
        </div>
        <div className="sim-browser-subhead">
          {available.length} link dari original graph belum ditampilkan
        </div>
        <input className="sim-browser-search" placeholder="Filter hostname..." value={q}
          onChange={e=>setQ(e.target.value)} autoFocus/>
        <div className="sim-browser-count">{filtered.length} hasil</div>
        <div className="sim-browser-list">
          {filtered.map(([key,edge])=>(
            <button key={key} className="sim-browser-item" onClick={()=>onAdd(key,edge)}>
              <span className="sim-bi-route">{edge.a} ↔ {edge.b}</span>
              <span className="sim-bi-metric">metric {edge.metric}</span>
              {edge.ip_a&&<span className="sim-bi-ip">{edge.ip_a}↔{edge.ip_b}</span>}
            </button>
          ))}
          {!filtered.length&&<div className="sim-browser-empty">
            {q?`Tidak ada link untuk "${q}"`:'Semua link original sudah ditampilkan di topologi'}
          </div>}
        </div>
      </div>
    </div>
  )
}

// ─── Existing Node Browser ─────────────────────────────────────────────────────
// excludeSet = Set of hostnames currently visible in the topology SVG
function ExistingNodeBrowser({ origNodes, excludeSet, onAdd, onClose }) {
  const [q, setQ] = useState('')
  // Show all original nodes NOT currently visible in topology
  const available = Object.entries(origNodes).filter(([h])=>!excludeSet.has(h))
  const filtered  = available.filter(([h])=>h.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="sim-browser-overlay" onClick={onClose}>
      <div className="sim-browser" onClick={e=>e.stopPropagation()}>
        <div className="sim-browser-header">
          <span>🖥 Tambah Node ke Topologi</span>
          <button className="sim-ep-close" onClick={onClose}>×</button>
        </div>
        <div className="sim-browser-subhead">
          {available.length} node dari original graph belum ditampilkan
        </div>
        <input className="sim-browser-search" placeholder="Filter hostname..." value={q}
          onChange={e=>setQ(e.target.value)} autoFocus/>
        <div className="sim-browser-count">{filtered.length} hasil</div>
        <div className="sim-browser-list">
          {filtered.map(([h,nd])=>(
            <button key={h} className="sim-browser-item" onClick={()=>onAdd(h,nd)}>
              <span className="sim-bi-hostname">{h}</span>
              {nd.router_ips?.[0]&&<span className="sim-bi-ip">{nd.router_ips[0]}</span>}
              {nd.prefix_sid&&<span className="sim-bi-metric">SID:{nd.prefix_sid}</span>}
            </button>
          ))}
          {!filtered.length&&<div className="sim-browser-empty">
            {q?`Tidak ada node untuk "${q}"`:'Semua node sudah ditampilkan di topologi'}
          </div>}
        </div>
      </div>
    </div>
  )
}

// ─── Sim Link Browser (edit existing sim links) ────────────────────────────────
function SimLinkBrowser({ simEdges, origEdges, diff, onEdit, onClose }) {
  const [q, setQ] = useState('')
  const links    = Object.entries(simEdges)
  const filtered = links.filter(([key])=>key.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="sim-browser-overlay" onClick={onClose}>
      <div className="sim-browser" onClick={e=>e.stopPropagation()}>
        <div className="sim-browser-header">
          <span>✎ Edit Link Simulasi</span>
          <button className="sim-ep-close" onClick={onClose}>×</button>
        </div>
        <div className="sim-browser-subhead">{links.length} link di simulasi</div>
        <input className="sim-browser-search" placeholder="Filter hostname..." value={q}
          onChange={e=>setQ(e.target.value)} autoFocus/>
        <div className="sim-browser-count">{filtered.length} hasil</div>
        <div className="sim-browser-list">
          {filtered.map(([key,edge])=>{
            const isChanged=!!diff?.changedEdges?.[key]
            const isAdded  =diff?.addedEdges?.includes(key)
            return (
              <button key={key}
                className={`sim-browser-item ${isChanged?'sim-bi--changed':''} ${isAdded?'sim-bi--added':''}`}
                onClick={()=>onEdit(key,edge)}>
                <span className="sim-bi-route">{edge.a} ↔ {edge.b}</span>
                <span className="sim-bi-metric">metric {edge.metric}</span>
                {isChanged&&<span className="sim-bi-badge sim-bi-badge--changed">berubah dari {diff.changedEdges[key].orig}</span>}
                {isAdded  &&<span className="sim-bi-badge sim-bi-badge--added">link baru</span>}
              </button>
            )
          })}
          {!filtered.length&&<div className="sim-browser-empty">Tidak ada hasil untuk "{q}"</div>}
        </div>
      </div>
    </div>
  )
}

// ─── Diff Summary Bar ──────────────────────────────────────────────────────────
function DiffSummaryBar({ diff }) {
  const total = diff.addedNodes.length+diff.removedNodes.length+
                diff.addedEdges.length+diff.removedEdges.length+
                Object.keys(diff.changedEdges).length
  if (!total)
    return <div className="sim-diff-bar sim-diff-bar--clean">✓ Identik dengan original</div>
  return (
    <div className="sim-diff-bar">
      <span className="sim-diff-title">Δ</span>
      {diff.addedNodes.length   >0&&<span className="sim-diff-chip added">+{diff.addedNodes.length} router</span>}
      {diff.removedNodes.length >0&&<span className="sim-diff-chip removed">−{diff.removedNodes.length} router</span>}
      {diff.addedEdges.length   >0&&<span className="sim-diff-chip added">+{diff.addedEdges.length} link</span>}
      {diff.removedEdges.length >0&&<span className="sim-diff-chip removed">−{diff.removedEdges.length} link</span>}
      {Object.keys(diff.changedEdges).length>0&&
        <span className="sim-diff-chip changed">~{Object.keys(diff.changedEdges).length} metric</span>}
    </div>
  )
}

// ─── Path card ─────────────────────────────────────────────────────────────────
function SimPathCard({ p, origPaths, expandedPath, setExpandedPath }) {
  const origP      = origPaths?.find(op=>op.path.join(',')===p.path.join(','))
  const metricDiff = origP?p.total_metric-origP.total_metric:null
  const isNew      = !origP
  return (
    <div className={`isis-path-card ${expandedPath===p.path_index?'expanded':''}`}
      style={{'--path-color':PATH_COLORS[(p.path_index-1)%PATH_COLORS.length]}}>
      <div className="isis-path-header"
        onClick={()=>setExpandedPath(expandedPath===p.path_index?null:p.path_index)}>
        <span className="isis-path-num" style={{background:PATH_COLORS[(p.path_index-1)%PATH_COLORS.length]}}>
          Path #{p.path_index}
        </span>
        <span className="isis-path-route">{p.path.join(' → ')}</span>
        <div className="isis-path-meta">
          <span className="isis-badge isis-badge--metric">Metric: {p.total_metric}</span>
          <span className="isis-badge isis-badge--hop">Hops: {p.hop_count}</span>
          {isNew&&<span className="isis-badge" style={{background:'#dcfce7',color:'#166534'}}>NEW</span>}
          {metricDiff!==null&&metricDiff!==0&&(
            <span className="isis-badge" style={{background:metricDiff<0?'#dcfce7':'#fee2e2',color:metricDiff<0?'#166534':'#991b1b'}}>
              {metricDiff>0?'+':''}{metricDiff}
            </span>
          )}
          <span className="isis-expand-icon">{expandedPath===p.path_index?'▲':'▼'}</span>
        </div>
      </div>
      {expandedPath===p.path_index&&(
        <div className="isis-path-detail">
          <div className="isis-hop-chain">
            {p.hops.map((hop,hi)=>(
              <div key={hi} className="isis-hop-group">
                <div className={`isis-hop-node ${hop.is_source?'src':hop.is_destination?'dst':''}`}>
                  <div className="isis-hop-name">{hop.router}</div>
                  <div className="isis-hop-lb">{hop.loopback||'-'}</div>
                  {hop.prefix_sid&&<div className="isis-hop-sid">SID:{hop.prefix_sid}</div>}
                </div>
                {!hop.is_destination&&(
                  <div className="isis-hop-link"><div className="isis-hop-line">
                    <span className="isis-hop-cost">{hop.adj_cost}</span>
                  </div></div>
                )}
              </div>
            ))}
          </div>
          <table className="isis-hop-table">
            <thead><tr><th>Hop</th><th>Router</th><th>Local IP</th><th>Remote IP</th><th>Adj Cost</th></tr></thead>
            <tbody>
              {p.hops.map((hop,hi)=>(
                <tr key={hi} className={hop.is_source?'row-src':hop.is_destination?'row-dst':''}>
                  <td>{hi+1}</td><td><strong>{hop.router}</strong></td>
                  <td><code className="ip-out">{hop.outgoing_ip||'-'}</code></td>
                  <td><code className="ip-in">{hop.incoming_ip||'-'}</code></td>
                  <td>{hop.adj_cost??'-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Path Compare Section ──────────────────────────────────────────────────────
function PathCompareSection({ src, dst, origPaths, simPaths, origNodes, origEdges, simNodes, simEdges, diff, showCost, showIPs }) {
  const [origSelectedPath, setOrigSelectedPath] = useState(null)
  const [simSelectedPath,  setSimSelectedPath]  = useState(null)
  const emptyDiff = { addedNodes:[], removedNodes:[], addedEdges:[], removedEdges:[], changedEdges:{} }

  // Match paths by route string
  const allKeys = [...new Set([
    ...origPaths.map(p=>p.path.join(',')),
    ...simPaths.map(p=>p.path.join(',')),
  ])]
  const origByRoute = Object.fromEntries(origPaths.map(p=>[p.path.join(','),p]))
  const simByRoute  = Object.fromEntries(simPaths.map(p=>[p.path.join(','),p]))

  // Also match by rank (position)
  const maxLen = Math.max(origPaths.length, simPaths.length)
  const compareRows = Array.from({length:maxLen},(_,i)=>({
    rank: i+1,
    orig: origPaths[i]||null,
    sim:  simPaths[i]||null,
    sameRoute: origPaths[i]&&simPaths[i]&&origPaths[i].path.join(',')===simPaths[i].path.join(','),
  }))

  const handleOrigNodeClick = signal => {
    if (signal==='__ALL__') setOrigSelectedPath(null)
    else if (signal?.startsWith('__PATH_')) setOrigSelectedPath(Number(signal.replace('__PATH_','').replace('__','')))
  }
  const handleSimNodeClick = signal => {
    if (signal==='__ALL__') setSimSelectedPath(null)
    else if (signal?.startsWith('__PATH_')) setSimSelectedPath(Number(signal.replace('__PATH_','').replace('__','')))
  }

  if (!origPaths.length && !simPaths.length) return null

  return (
    <div className="sim-compare-section">
      <div className="sim-compare-header">📊 Perbandingan Original vs Simulasi</div>

      {/* Comparison table */}
      <div className="sim-compare-table-wrap">
        <table className="sim-compare-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Route Original</th>
              <th>Metric Orig</th>
              <th>Route Simulasi</th>
              <th>Metric Sim</th>
              <th>Δ Metric</th>
            </tr>
          </thead>
          <tbody>
            {compareRows.map(row=>{
              const delta = row.orig&&row.sim?row.sim.total_metric-row.orig.total_metric:null
              const routeChanged = row.orig&&row.sim&&!row.sameRoute
              return (
                <tr key={row.rank} className={
                  !row.orig?'sim-cmp-row-new':!row.sim?'sim-cmp-row-lost':
                  routeChanged?'sim-cmp-row-rerouted':
                  delta!==null&&delta<0?'sim-cmp-row-better':
                  delta!==null&&delta>0?'sim-cmp-row-worse':''
                }>
                  <td><strong>#{row.rank}</strong></td>
                  <td className="sim-cmp-route">{row.orig?row.orig.path.join(' → '):'—'}</td>
                  <td>{row.orig?row.orig.total_metric:'—'}</td>
                  <td className="sim-cmp-route">{row.sim?row.sim.path.join(' → '):'—'}</td>
                  <td>{row.sim?row.sim.total_metric:'—'}</td>
                  <td className="sim-cmp-delta">
                    {delta===null?'—':delta===0?
                      <span className="sim-cmp-same">=</span>:
                      <span className={delta<0?'sim-cmp-better':'sim-cmp-worse'}>
                        {delta>0?'+':''}{delta}
                      </span>
                    }
                    {!row.orig&&<span className="sim-cmp-badge sim-cmp-badge--new">NEW PATH</span>}
                    {!row.sim &&<span className="sim-cmp-badge sim-cmp-badge--lost">PATH HILANG</span>}
                    {routeChanged&&<span className="sim-cmp-badge sim-cmp-badge--rerouted">REROUTED</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Original topology ── */}
      {origPaths.length>0&&(
        <div className="sim-compare-topo-block sim-compare-topo-block--orig">
          <div className="sim-compare-sub-header">
            <span className="sim-compare-topo-label sim-compare-topo-label--orig">ORIGINAL</span>
            Topologi Original ({src} → {dst})
          </div>
          <EditablePathTopology
            simPaths={origPaths} src={src} dst={dst}
            simNodes={origNodes} simEdges={origEdges} origEdges={origEdges}
            diff={emptyDiff}
            readOnly={true}
            editMode="select" addLinkSrc={null}
            onNodeDelete={null} onEdgeClick={null}
            onNodeClick={handleOrigNodeClick}
            selectedPath={origSelectedPath}
            showCost={showCost} showIPs={showIPs}
            origNodeCount={Object.keys(origNodes).length}
          />
        </div>
      )}

      {/* ── Sim topology ── */}
      {simPaths.length>0&&(
        <div className="sim-compare-topo-block sim-compare-topo-block--sim">
          <div className="sim-compare-sub-header">
            <span className="sim-compare-topo-label sim-compare-topo-label--sim">SIMULASI</span>
            Topologi Simulasi ({src} → {dst})
            {diff&&(
              <span className="sim-compare-diff-inline">
                {diff.addedNodes.length>0&&<span className="sim-diff-chip added">+{diff.addedNodes.length} router</span>}
                {diff.removedNodes.length>0&&<span className="sim-diff-chip removed">−{diff.removedNodes.length} router</span>}
                {diff.addedEdges.length>0&&<span className="sim-diff-chip added">+{diff.addedEdges.length} link</span>}
                {diff.removedEdges.length>0&&<span className="sim-diff-chip removed">−{diff.removedEdges.length} link</span>}
                {Object.keys(diff.changedEdges||{}).length>0&&<span className="sim-diff-chip changed">~{Object.keys(diff.changedEdges).length} metric</span>}
              </span>
            )}
          </div>
          <EditablePathTopology
            simPaths={simPaths} src={src} dst={dst}
            simNodes={simNodes} simEdges={simEdges} origEdges={origEdges}
            diff={diff||emptyDiff}
            readOnly={true}
            editMode="select" addLinkSrc={null}
            onNodeDelete={null} onEdgeClick={null}
            onNodeClick={handleSimNodeClick}
            selectedPath={simSelectedPath}
            showCost={showCost} showIPs={showIPs}
            origNodeCount={Object.keys(origNodes).length}
          />
        </div>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LSDBSimulator() {
  const [routers, setRouters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  const { origNodes, origEdges } = useMemo(()=>{ const {nodes,edges}=buildGraph(routers); return {origNodes:nodes,origEdges:edges} }, [routers])

  const [simNodes, setSimNodes] = useState({})
  const [simEdges, setSimEdges] = useState({})

  // Path state
  const [src, setSrc]           = useState('')
  const [dst, setDst]           = useState('')
  const [k, setK]               = useState(3)
  const [simPaths,  setSimPaths]  = useState([])
  const [origPaths, setOrigPaths] = useState([])
  const [pathErr, setPathErr]     = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  // UI state
  const [selectedPath,   setSelectedPath]   = useState(null)
  const [showCost,       setShowCost]       = useState(false)
  const [showIPs,        setShowIPs]        = useState(false)
  const [expandedPath,   setExpandedPath]   = useState(null)
  const [showCompare,    setShowCompare]    = useState(false)
  const [editMode,       setEditMode]       = useState('select')
  const [addLinkSrc,     setAddLinkSrc]     = useState(null)
  const [addLinkDst,     setAddLinkDst]     = useState(null)
  const [editingEdge,    setEditingEdge]    = useState(null)
  // extra nodes to force-show in topology (beyond path nodes)
  const [extraVisibleNodes, setExtraVisibleNodes] = useState([])
  // browsers
  const [showExistingLinks, setShowExistingLinks] = useState(false)
  const [showExistingNodes, setShowExistingNodes] = useState(false)
  const [showSimLinks,      setShowSimLinks]       = useState(false)
  const [showAddRouter,     setShowAddRouter]      = useState(false)

  const diff = useMemo(()=>computeDiff(origNodes,origEdges,simNodes,simEdges),
    [origNodes,origEdges,simNodes,simEdges])

  const allHostnames = useMemo(()=>
    [...new Set([...Object.keys(origNodes),...Object.keys(simNodes)])].sort(),[origNodes,simNodes])

  // Set of nodes currently visible in the main topology SVG
  const topologyVisibleNodes = useMemo(()=>{
    const s = new Set()
    for (const p of simPaths) for (const n of p.path) s.add(n)
    if (diff.addedNodes) for (const n of diff.addedNodes) s.add(n)
    for (const n of extraVisibleNodes) s.add(n)
    return s
  }, [simPaths, diff, extraVisibleNodes])

  // Set of edge keys currently drawn in the SVG (both endpoints visible)
  const topologyVisibleEdges = useMemo(()=>{
    const s = new Set()
    for (const [k, e] of Object.entries(simEdges))
      if (topologyVisibleNodes.has(e.a) && topologyVisibleNodes.has(e.b)) s.add(k)
    return s
  }, [simEdges, topologyVisibleNodes])

  // Load
  useEffect(()=>{
    apiFetch('/api/isis/routers/')
      .then(d=>{setRouters(d.routers||[]);setLoadErr('')})
      .catch(e=>{if(e.message!=='401')setLoadErr('Gagal memuat: '+e.message)})
      .finally(()=>setLoading(false))
  },[])

  // Init sim graph
  useEffect(()=>{setSimNodes({...origNodes});setSimEdges({...origEdges})},[origNodes,origEdges])

  // Auto-recompute paths after sim graph changes
  useEffect(()=>{
    if (!hasSearched||!src||!dst) return
    setSimPaths(yenKSP(simNodes,simEdges,src,dst,k))
  },[simNodes,simEdges])

  const findPaths = () => {
    setPathErr('')
    if (!src||!dst){setPathErr('Pilih source dan destination');return}
    if (src===dst){setPathErr('Source dan destination tidak boleh sama');return}
    const sp=yenKSP(simNodes,simEdges,src,dst,k)
    const op=yenKSP(origNodes,origEdges,src,dst,k)
    setSimPaths(sp); setOrigPaths(op)
    setHasSearched(true); setSelectedPath(null); setExpandedPath(null)
    if (!sp.length) setPathErr('Tidak ada path ditemukan di topologi simulasi')
  }

  const resetSim = () => {
    setSimNodes({...origNodes}); setSimEdges({...origEdges})
    setExtraVisibleNodes([])
    setEditMode('select'); setAddLinkSrc(null); setAddLinkDst(null); setEditingEdge(null)
    if (hasSearched&&src&&dst)
      setTimeout(()=>setSimPaths(yenKSP({...origNodes},{...origEdges},src,dst,k)),0)
  }

  // Edit ops
  const deleteNode = hostname => {
    setSimNodes(prev=>{const n={...prev};delete n[hostname];return n})
    setSimEdges(prev=>{const e={...prev};for(const k of Object.keys(e))if(e[k].a===hostname||e[k].b===hostname)delete e[k];return e})
    // Remove from extra visible if present
    setExtraVisibleNodes(prev=>prev.filter(n=>n!==hostname))
    setEditingEdge(null)
  }
  const deleteEdge = key => {
    setSimEdges(prev=>{const e={...prev};delete e[key];return e}); setEditingEdge(null)
  }
  const saveEdgeMetric = (key,metric) => {
    setSimEdges(prev=>({...prev,[key]:{...prev[key],metric}})); setEditingEdge(null)
  }
  const addRouter = ({hostname,router_ips,prefix_sid}) => {
    if (simNodes[hostname]){alert(`Router "${hostname}" sudah ada`);return}
    setSimNodes(prev=>({...prev,[hostname]:{hostname,router_ips,prefix_sid,system_id:''}}))
    // Force-show in topology immediately
    setExtraVisibleNodes(prev=>[...prev, hostname])
    setShowAddRouter(false)
  }
  const addLink = ({metric,ip_a,ip_b}) => {
    if (!addLinkSrc||!addLinkDst) return
    const key=[addLinkSrc,addLinkDst].sort().join('|||')
    if (simEdges[key]){alert('Link ini sudah ada');return}
    const [a,b]=key.split('|||')
    setSimEdges(prev=>({...prev,[key]:{a,b,metric,ip_a,ip_b}}))
    setAddLinkSrc(null); setAddLinkDst(null); setEditMode('select')
  }
  // Add existing link — also pull both endpoint nodes into visible topology
  const addExistingLink = (key, edge) => {
    // Ensure edge is in simEdges (it should already be since simEdges = origEdges,
    // but add defensively in case it was deleted)
    setSimEdges(prev => ({ ...prev, [key]: { ...edge } }))
    // Make both endpoints visible in topology
    setExtraVisibleNodes(prev => {
      const next = [...prev]
      if (!topologyVisibleNodes.has(edge.a) && !next.includes(edge.a)) next.push(edge.a)
      if (!topologyVisibleNodes.has(edge.b) && !next.includes(edge.b)) next.push(edge.b)
      return next
    })
    setShowExistingLinks(false)
  }
  // Add existing node to visible topology
  // (node is already in simNodes since simNodes = origNodes; just make it visible)
  const addExistingNode = (hostname,nd) => {
    // Re-add to simNodes in case it was deleted, then force-show
    setSimNodes(prev=>({...prev,[hostname]:{...nd}}))
    setExtraVisibleNodes(prev=>prev.includes(hostname)?prev:[...prev,hostname])
    setShowExistingNodes(false)
  }
  // Open edit for sim link (from browser)
  const openSimLinkEdit = (key,edge) => {
    setEditingEdge({key,edge,x:window.innerWidth/2,y:window.innerHeight/2-80})
    setShowSimLinks(false)
  }

  // SVG callback router
  const handleNodeClick = signal => {
    if (signal==='__ALL__')          { setSelectedPath(null); return }
    if (signal?.startsWith('__PATH_')) { setSelectedPath(Number(signal.replace('__PATH_','').replace('__',''))); return }
    if (signal==='__TOGGLE_COST__') { setShowCost(v=>!v); return }
    if (signal==='__TOGGLE_IP__')   { setShowIPs(v=>!v); return }
    // addLink mode: node clicked
    if (editMode==='addLink') {
      if (!addLinkSrc) setAddLinkSrc(signal)
      else if (addLinkSrc===signal) setAddLinkSrc(null)
      else setAddLinkDst(signal)
    }
  }

  const exportJSON = () => {
    const blob=new Blob([JSON.stringify({nodes:simNodes,edges:simEdges,diff,exported_at:new Date().toISOString()},null,2)],{type:'application/json'})
    Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:'sim-topology.json'}).click()
  }

  if (loading) return <div className="sim-loading">⏳ Memuat topologi ISIS...</div>
  if (loadErr) return <div className="sim-error">{loadErr}</div>

  const pendingLinkKey = addLinkSrc&&addLinkDst?[addLinkSrc,addLinkDst].sort().join('|||'):null
  const pendingOrigEdge = pendingLinkKey?origEdges[pendingLinkKey]:null

  return (
    <div className="sim-root" onClick={()=>setEditingEdge(null)}>

      {/* ── Top bar ── */}
      <div className="sim-topbar">
        <span className="sim-topbar-title">⚗️ LSDB Simulator</span>
        <DiffSummaryBar diff={diff}/>
        <span className="sim-topbar-counts">
          🖧 sim <strong>{Object.keys(simNodes).length}</strong> / orig <strong>{Object.keys(origNodes).length}</strong> router
        </span>
        <div className="sim-topbar-right">
          <button className={`sim-tool-btn ${showCompare?'sim-tool-btn--active':''}`}
            style={showCompare?{background:'#eef2ff',borderColor:'#4858c8',color:'#4858c8'}:{}}
            onClick={()=>setShowCompare(v=>!v)}>
            📊 {showCompare?'Sembunyikan':'Compare'}
          </button>
          <button className="sim-tool-btn sim-tool-btn--json" onClick={exportJSON}>⬇ JSON</button>
          <button className="sim-tool-btn sim-tool-btn--reset" onClick={resetSim}>↺ Reset</button>
        </div>
      </div>

      {/* ── Edit toolbar ── */}
      <div className="sim-edit-toolbar">
        <span className="sim-etb-label">Edit:</span>
        {/* Select mode */}
        <button
          className={`sim-etb-btn ${editMode==='select'?'sim-etb-btn--active':''}`}
          onClick={()=>{setEditMode('select');setAddLinkSrc(null)}}>
          ↖ Select
        </button>
        {/* New link via click */}
        <button
          className={`sim-etb-btn ${editMode==='addLink'?'sim-etb-btn--active sim-etb-btn--link':'sim-etb-btn--link'}`}
          onClick={()=>{setEditMode(editMode==='addLink'?'select':'addLink');setAddLinkSrc(null)}}>
          🔗 Link Baru{editMode==='addLink'&&addLinkSrc?` (dari ${addLinkSrc})`:''}
        </button>
        {/* Add link from original graph */}
        <button className="sim-etb-btn sim-etb-btn--exist"
          onClick={()=>{setShowExistingLinks(true);setEditMode('select')}}>
          🔗 Link Existing
        </button>
        {/* Edit existing sim links */}
        <button className="sim-etb-btn sim-etb-btn--edit"
          onClick={()=>{setShowSimLinks(true);setEditMode('select')}}>
          ✎ Edit Link
        </button>
        <span className="sim-etb-sep"/>
        {/* New router */}
        <button className="sim-etb-btn sim-etb-btn--router"
          onClick={()=>{setShowAddRouter(true);setEditMode('select')}}>
          🖥 Router Baru
        </button>
        {/* Add node from original */}
        <button className="sim-etb-btn sim-etb-btn--exist"
          onClick={()=>{setShowExistingNodes(true);setEditMode('select')}}>
          🖥 Node Existing
        </button>
      </div>

      {/* ── Path form ── */}
      <div className="isis-path-form">
        <div className="isis-form-row">
          <RouterSearch label="Source Router"      value={src} onChange={setSrc} options={allHostnames}/>
          <div className="isis-form-arrow">→</div>
          <RouterSearch label="Destination Router" value={dst} onChange={setDst} options={allHostnames}/>
          <div className="isis-form-field isis-form-field--sm">
            <label>Possible Path</label>
            <input type="number" min={1} max={10} value={k}
              onChange={e=>setK(Math.min(10,Math.max(1,Number(e.target.value))))}/>
          </div>
          <button className="isis-btn isis-btn--primary isis-btn--find" onClick={findPaths}>
            🔍 Find Paths
          </button>
        </div>
        {pathErr&&<div className="isis-error">{pathErr}</div>}
      </div>

      {/* ── Results ── */}
      {simPaths.length>0&&(
        <div className="sim-results">
          <div className="isis-path-summary">
            Ditemukan <strong>{simPaths.length}</strong> path: <strong>{src}</strong> → <strong>{dst}</strong>
            {origPaths.length!==simPaths.length&&(
              <span style={{marginLeft:10,color:'#f59e0b',fontWeight:600}}>(original: {origPaths.length} path)</span>
            )}
          </div>

          {/* Sim editable topology */}
          <EditablePathTopology
            simPaths={simPaths} src={src} dst={dst}
            simNodes={simNodes} simEdges={simEdges} origEdges={origEdges}
            diff={diff}
            extraNodes={extraVisibleNodes}
            editMode={editMode} addLinkSrc={addLinkSrc}
            onNodeDelete={deleteNode}
            onEdgeClick={(key,edge,x,y)=>setEditingEdge({key,edge,x,y})}
            onNodeClick={handleNodeClick}
            selectedPath={selectedPath}
            showCost={showCost} showIPs={showIPs}
            origNodeCount={Object.keys(origNodes).length}
          />

          {/* Path cards */}
          <div className="isis-path-results">
            {simPaths.map(p=>(
              <SimPathCard key={p.path_index} p={p} origPaths={origPaths}
                expandedPath={expandedPath} setExpandedPath={setExpandedPath}/>
            ))}
          </div>

          {/* Compare section */}
          {showCompare&&(
            <PathCompareSection
              src={src} dst={dst}
              origPaths={origPaths} simPaths={simPaths}
              origNodes={origNodes} origEdges={origEdges}
              simNodes={simNodes} simEdges={simEdges}
              diff={diff}
              showCost={showCost} showIPs={showIPs}
            />
          )}
        </div>
      )}

      {/* ── Overlays ── */}
      {editingEdge&&(
        <EdgeEditPanel
          edgeKey={editingEdge.key}
          edge={simEdges[editingEdge.key]||editingEdge.edge}
          origEdge={origEdges[editingEdge.key]}
          anchorX={editingEdge.x} anchorY={editingEdge.y}
          onSave={saveEdgeMetric} onDelete={deleteEdge}
          onClose={()=>setEditingEdge(null)}/>
      )}
      {addLinkSrc&&addLinkDst&&(
        <AddLinkDialog nodeA={addLinkSrc} nodeB={addLinkDst}
          origEdge={pendingOrigEdge}
          onConfirm={addLink} onCancel={()=>{setAddLinkSrc(null);setAddLinkDst(null)}}/>
      )}
      {showAddRouter&&(
        <AddRouterDialog onConfirm={addRouter} onCancel={()=>setShowAddRouter(false)}/>
      )}
      {showExistingLinks&&(
        <ExistingLinkBrowser origEdges={origEdges} excludeEdgeSet={topologyVisibleEdges}
          onAdd={addExistingLink} onClose={()=>setShowExistingLinks(false)}/>
      )}
      {showExistingNodes&&(
        <ExistingNodeBrowser origNodes={origNodes} excludeSet={topologyVisibleNodes}
          onAdd={addExistingNode} onClose={()=>setShowExistingNodes(false)}/>
      )}
      {showSimLinks&&(
        <SimLinkBrowser simEdges={simEdges} origEdges={origEdges} diff={diff}
          onEdit={openSimLinkEdit} onClose={()=>setShowSimLinks(false)}/>
      )}
    </div>
  )
}