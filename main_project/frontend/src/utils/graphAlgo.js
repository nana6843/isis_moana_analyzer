// src/utils/graphAlgo.js
// Client-side graph algorithms: Dijkstra + Yen's K-Shortest Simple Paths

/**
 * Build adjacency list from nodes/edges objects.
 * nodes : { hostname: { ... } }
 * edges : { 'A|||B': { a, b, metric, ip_a, ip_b } }
 * Returns { hostname: [{ to, cost, edgeKey }, ...] }
 */
export function buildAdjList(nodes, edges) {
  const adj = {}
  for (const n of Object.keys(nodes)) adj[n] = []

  for (const [key, edge] of Object.entries(edges)) {
    const { a, b, metric } = edge
    const cost = metric != null ? Number(metric) : 1
    if (adj[a] !== undefined) adj[a].push({ to: b, cost, edgeKey: key })
    if (adj[b] !== undefined) adj[b].push({ to: a, cost, edgeKey: key })
  }
  return adj
}

/**
 * Dijkstra's shortest path (simple O(V²) — fine for ISIS topologies).
 * excludeNodes : Set of node names to treat as removed
 * excludeEdges : Set of edge keys to treat as removed
 * Returns { path: string[], cost: number } or null if unreachable.
 */
function dijkstra(adj, start, end, excludeNodes = new Set(), excludeEdges = new Set()) {
  if (!adj[start] || !adj[end]) return null
  if (excludeNodes.has(start) || excludeNodes.has(end)) return null

  const dist = {}
  const prev = {}
  for (const n of Object.keys(adj)) {
    dist[n] = Infinity
    prev[n] = null
  }
  dist[start] = 0

  const unvisited = new Set(Object.keys(adj).filter(n => !excludeNodes.has(n)))

  while (unvisited.size > 0) {
    // Pick node with smallest tentative distance
    let u = null
    for (const n of unvisited) {
      if (u === null || dist[n] < dist[u]) u = n
    }
    if (u === null || dist[u] === Infinity) break
    if (u === end) break
    unvisited.delete(u)

    for (const { to, cost, edgeKey } of (adj[u] || [])) {
      if (excludeNodes.has(to) || excludeEdges.has(edgeKey)) continue
      const alt = dist[u] + cost
      if (alt < dist[to]) {
        dist[to] = alt
        prev[to] = u
      }
    }
  }

  if (!isFinite(dist[end])) return null

  // Reconstruct path
  const path = []
  let curr = end
  const seen = new Set()
  while (curr !== null) {
    if (seen.has(curr)) return null // cycle guard
    seen.add(curr)
    path.unshift(curr)
    curr = prev[curr]
  }
  if (path[0] !== start) return null
  return { path, cost: dist[end] }
}

/**
 * Yen's K-Shortest Simple Paths.
 *
 * nodes : { hostname: { router_ips, prefix_sid, ... } }
 * edges : { 'A|||B': { a, b, metric, ip_a, ip_b } }
 * start, end : hostnames
 * K     : max number of paths
 *
 * Returns array (length ≤ K) of:
 * {
 *   path_index, path, total_metric, hop_count,
 *   hops: [{ router, loopback, prefix_sid, outgoing_ip, incoming_ip, adj_cost,
 *            is_source, is_destination }]
 * }
 */
export function yenKSP(nodes, edges, start, end, K = 3) {
  if (!nodes[start] || !nodes[end] || start === end) return []

  const adj = buildAdjList(nodes, edges)

  // Helper: compute cost of a full path
  const pathCost = (path) => {
    let c = 0
    for (let i = 0; i < path.length - 1; i++) {
      const key = [path[i], path[i + 1]].sort().join('|||')
      c += edges[key]?.metric != null ? Number(edges[key].metric) : 1
    }
    return c
  }

  // A[0] = shortest path
  const first = dijkstra(adj, start, end)
  if (!first) return []

  const A = [first]            // confirmed shortest paths
  const B = []                 // candidate paths
  const seenPaths = new Set()
  seenPaths.add(JSON.stringify(first.path))

  for (let k = 1; k < K; k++) {
    const prevPath = A[k - 1].path

    for (let i = 0; i < prevPath.length - 1; i++) {
      const spurNode = prevPath[i]
      const rootPath = prevPath.slice(0, i + 1)
      const rootKey  = JSON.stringify(rootPath)

      const exEdges = new Set()
      const exNodes = new Set()

      // For every confirmed path sharing the same root, remove the next edge
      for (const p of A) {
        if (p.path.length > i &&
            JSON.stringify(p.path.slice(0, i + 1)) === rootKey) {
          const ek = [p.path[i], p.path[i + 1]].sort().join('|||')
          exEdges.add(ek)
        }
      }
      // Same for candidates in B
      for (const c of B) {
        if (c.path.length > i &&
            JSON.stringify(c.path.slice(0, i + 1)) === rootKey) {
          const ek = [c.path[i], c.path[i + 1]].sort().join('|||')
          exEdges.add(ek)
        }
      }

      // Remove root nodes (except spurNode) to force new path through spur
      for (const n of rootPath.slice(0, -1)) exNodes.add(n)

      const spurResult = dijkstra(adj, spurNode, end, exNodes, exEdges)
      if (!spurResult) continue

      // Combine root prefix + spur path
      const totalPath = [...rootPath.slice(0, -1), ...spurResult.path]
      const totalKey  = JSON.stringify(totalPath)
      if (seenPaths.has(totalKey)) continue
      seenPaths.add(totalKey)

      B.push({ path: totalPath, cost: pathCost(totalPath) })
    }

    if (B.length === 0) break

    // Pick candidate with lowest cost
    B.sort((a, b) => a.cost - b.cost)
    const next = B.shift()
    A.push(next)
  }

  // Format into hop detail objects (same shape as backend API)
  return A.map((p, idx) => {
    const hops = p.path.map((node, ni) => {
      const nextNode = p.path[ni + 1]
      let outgoing_ip = null, incoming_ip = null, adj_cost = null

      if (nextNode) {
        const edgeKey = [node, nextNode].sort().join('|||')
        const edge    = edges[edgeKey]
        if (edge) {
          const forward = edge.a === node
          outgoing_ip  = forward ? edge.ip_a : edge.ip_b
          incoming_ip  = forward ? edge.ip_b : edge.ip_a
          adj_cost     = edge.metric != null ? Number(edge.metric) : null
        }
      }
      const nd = nodes[node] || {}
      return {
        router:         node,
        loopback:       nd.router_ips?.[0] || null,
        prefix_sid:     nd.prefix_sid || null,
        outgoing_ip,
        incoming_ip,
        adj_cost,
        is_source:      ni === 0,
        is_destination: ni === p.path.length - 1,
      }
    })
    return {
      path_index:   idx + 1,
      path:         p.path,
      total_metric: p.cost,
      hop_count:    p.path.length - 1,
      hops,
    }
  })
}

/**
 * Compute diff between original and simulated graph.
 * Returns { addedNodes, removedNodes, addedEdges, removedEdges, changedEdges }
 * where changedEdges = { key: { orig, sim } }
 */
export function computeDiff(origNodes, origEdges, simNodes, simEdges) {
  const addedNodes   = Object.keys(simNodes).filter(n => !origNodes[n])
  const removedNodes = Object.keys(origNodes).filter(n => !simNodes[n])
  const addedEdges   = Object.keys(simEdges).filter(k => !origEdges[k])
  const removedEdges = Object.keys(origEdges).filter(k => !simEdges[k])
  const changedEdges = {}
  for (const key of Object.keys(origEdges)) {
    if (simEdges[key] && Number(origEdges[key].metric) !== Number(simEdges[key].metric)) {
      changedEdges[key] = { orig: origEdges[key].metric, sim: simEdges[key].metric }
    }
  }
  return { addedNodes, removedNodes, addedEdges, removedEdges, changedEdges }
}