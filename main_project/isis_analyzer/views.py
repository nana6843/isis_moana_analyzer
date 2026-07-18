from django.shortcuts import render

# Create your views here.
# isis_analyzer/views.py

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q
from django.core.management import call_command
from io import StringIO
import networkx as nx
from .management.commands.get_lsdb_via_ssh import get_huawei_isis_lsdb
from pathlib import Path

from .models import ISISRouter, ISISLink

import os
BASE_DIR = Path(__file__).resolve().parent.parent

# Cache graph di memory agar tidak rebuild tiap request
_graph_cache = None

def build_nx_graph(force=False):
    global _graph_cache
    if _graph_cache is not None and not force:
        return _graph_cache

    G = nx.Graph()
    routers = ISISRouter.objects.filter(is_pseudonode=False)
    for r in routers:
        G.add_node(r.hostname, system_id=r.system_id, router_ips=r.router_ips)

    links = ISISLink.objects.select_related('node_a', 'node_b')
    for link in links:
        if link.node_a.is_pseudonode or link.node_b.is_pseudonode:
            continue
        G.add_edge(
            link.node_a.hostname,
            link.node_b.hostname,
            metric=link.metric,
            te_metric=link.te_metric,
            ip_a=link.ip_a,
            ip_b=link.ip_b,
        )
    _graph_cache = G
    return G


class ListRoutersView(APIView):
    """
    GET /api/isis/routers/
    GET /api/isis/routers/?q=PE-JKT
    Response includes adjacency per router (neighbors, cost, IPs).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = ISISRouter.objects.filter(is_pseudonode=False)

        if not request.query_params.get('pseudonode'):
            qs = qs.filter(is_pseudonode=False)

        q = request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(hostname__icontains=q) |
                Q(system_id__icontains=q) |
                Q(router_ips__icontains=q)
            )

        # Prefetch adjacency untuk semua router sekaligus (1 query)
        router_ids = list(qs.values_list('id', flat=True))
        links = ISISLink.objects.select_related('node_a', 'node_b').filter(
            Q(node_a_id__in=router_ids) | Q(node_b_id__in=router_ids)
        )

        # Build adjacency map: router_id -> list of neighbors
        adj_map = {}
        for link in links:
            for node, nbr, lip, rip in [
                (link.node_a, link.node_b, link.ip_a, link.ip_b),
                (link.node_b, link.node_a, link.ip_b, link.ip_a),
            ]:
                if node.id not in adj_map:
                    adj_map[node.id] = []
                adj_map[node.id].append({
                    'hostname':   nbr.hostname,
                    'metric':     link.metric,
                    'te_metric':  link.te_metric,
                    'local_ip':   lip or '',
                    'remote_ip':  rip or '',
                })

        routers = [
            {
                'hostname':      r.hostname,
                'system_id':     r.system_id,
                'router_ips':    r.router_ips,
                'prefix_sid':    r.prefix_sid,
                'prefix_sid_ip': r.prefix_sid_ip,
                'is_pseudonode': r.is_pseudonode,
                'adjacency':     adj_map.get(r.id, []),
            }
            for r in qs
        ]
        return Response({'count': len(routers), 'routers': routers})


class TopologyView(APIView):
    """GET /api/isis/topology/"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        routers = ISISRouter.objects.filter(is_pseudonode=False)
        links   = ISISLink.objects.select_related('node_a', 'node_b').filter(
            node_a__is_pseudonode=False,
            node_b__is_pseudonode=False,
        )

        adjacency = {}
        for r in routers:
            adjacency[r.hostname] = {
                'system_id':  r.system_id,
                'router_ips': r.router_ips,
                'prefix_sid': r.prefix_sid,
                'neighbors':  [],
            }

        for link in links:
            a, b = link.node_a, link.node_b
            if a.hostname in adjacency:
                adjacency[a.hostname]['neighbors'].append({
                    'hostname': b.hostname, 'metric': link.metric,
                    'te_metric': link.te_metric,
                    'local_ip': link.ip_a, 'remote_ip': link.ip_b,
                })
            if b.hostname in adjacency:
                adjacency[b.hostname]['neighbors'].append({
                    'hostname': a.hostname, 'metric': link.metric,
                    'te_metric': link.te_metric,
                    'local_ip': link.ip_b, 'remote_ip': link.ip_a,
                })

        return Response({
            'summary': {'routers': routers.count(), 'links': links.count()},
            'nodes': list(adjacency.values()),
            'edges': [
                {'from': l.node_a.hostname, 'to': l.node_b.hostname,
                 'metric': l.metric, 'ip_a': l.ip_a, 'ip_b': l.ip_b}
                for l in links
            ],
        })


class FindPathsView(APIView):
    """
    GET /api/isis/paths/?src=PE-JKT-01&dst=PE-SBY-01&k=5
    Optimized: paths dibatasi max_cost = shortest * 2.5 agar tidak lambat.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        src    = request.query_params.get('src', '').strip()
        dst    = request.query_params.get('dst', '').strip()
        k      = min(int(request.query_params.get('k', 5)), 10)
        weight = request.query_params.get('weight', 'metric')

        if not src or not dst:
            return Response({'error': 'Parameter src dan dst wajib diisi'}, status=400)
        if src == dst:
            return Response({'error': 'Source dan destination tidak boleh sama'}, status=400)

        G = build_nx_graph()

        if src not in G:
            return Response({'error': f"Router '{src}' tidak ditemukan"}, status=404)
        if dst not in G:
            return Response({'error': f"Router '{dst}' tidak ditemukan"}, status=404)

        # Hitung cost path terpendek dulu sebagai batas atas
        try:
            shortest_cost = nx.shortest_path_length(G, src, dst, weight=weight)
        except nx.NetworkXNoPath:
            return Response({'error': f'Tidak ada path: {src} → {dst}'}, status=404)

        # max_cost = 2.5x shortest agar tidak eksplorasi terlalu jauh
        max_cost = shortest_cost * 2.5

        paths = []
        try:
            for path in nx.shortest_simple_paths(G, src, dst, weight=weight):
                cost = sum(
                    G[path[i]][path[i+1]].get(weight) or G[path[i]][path[i+1]].get('metric', 0)
                    for i in range(len(path) - 1)
                )
                if cost > max_cost:
                    break
                paths.append(path)
                if len(paths) >= k:
                    break
        except Exception as e:
            return Response({'error': str(e)}, status=500)

        if not paths:
            return Response({'error': f'Tidak ada path: {src} → {dst}'}, status=404)

        # Prefetch semua link yang dibutuhkan
        all_nodes = set(n for p in paths for n in p)
        links_qs = ISISLink.objects.select_related('node_a', 'node_b').filter(
            node_a__hostname__in=all_nodes,
            node_b__hostname__in=all_nodes,
        )
        link_map = {}
        for link in links_qs:
            link_map[(link.node_a.hostname, link.node_b.hostname)] = link
            link_map[(link.node_b.hostname, link.node_a.hostname)] = link

        router_map = {r.hostname: r for r in ISISRouter.objects.filter(hostname__in=all_nodes)}

        result = []
        for i, path in enumerate(paths, 1):
            total_metric = 0
            hops, ero = [], []

            for idx, node in enumerate(path):
                router   = router_map.get(node)
                next_node = path[idx + 1] if idx < len(path) - 1 else None
                outgoing_ip = None
                incoming_ip = None
                adj_cost    = None

                if next_node:
                    ed = G.get_edge_data(node, next_node)
                    if ed:
                        adj_cost = ed.get(weight) or ed.get('metric', 0)
                        total_metric += adj_cost
                    link = link_map.get((node, next_node))
                    if link:
                        if link.node_a.hostname == node:
                            outgoing_ip = link.ip_a
                            incoming_ip = link.ip_b
                        else:
                            outgoing_ip = link.ip_b
                            incoming_ip = link.ip_a

                loopback = router.router_ips[0] if (router and router.router_ips) else None
                ero_type = 'strict' if outgoing_ip else 'loose'
                ero_ip   = outgoing_ip or loopback

                hops.append({
                    'hop_index':      idx,
                    'router':         node,
                    'system_id':      router.system_id if router else '',
                    'loopback':       loopback,
                    'all_router_ips': router.router_ips if router else [],
                    'outgoing_ip':    outgoing_ip,
                    'incoming_ip':    incoming_ip,   # IP on next router's interface
                    'ero_type':       ero_type,
                    'is_source':      idx == 0,
                    'is_destination': idx == len(path) - 1,
                    'prefix_sid':     router.prefix_sid if router else None,
                    'prefix_sid_ip':  router.prefix_sid_ip if router else None,
                    'adj_cost':       adj_cost,
                })
                if not (idx == len(path) - 1) and ero_ip:
                    ero.append(f"{ero_type} {ero_ip}/32")

            result.append({
                'path_index':   i,
                'total_metric': total_metric,
                'hop_count':    len(path),
                'path':         path,
                'ero':          ero,
                'hops':         hops,
            })

        return Response({
            'src': src, 'dst': dst,
            'weight': weight,
            'shortest_metric': shortest_cost,
            'paths_found': len(result),
            'paths': result,
        })


class RefreshLSDBView(APIView):
    """
    POST /api/isis/refresh/
    Re-import LSDB file dan rebuild graph cache.
    Memanggil management command import_lsdb yang sudah ada.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        global _graph_cache
        try:
            ROUTER_IP = "10.66.180.0"
            USER = "bt-mngd"
            PASSWORD = "!@#$%^&*"
            FILE_NAME = "lsdb.txt"
            ISIS_LSDB_FILE = os.path.join(BASE_DIR, "isis_analyzer", "management", "commands", FILE_NAME)
            get_huawei_isis_lsdb(ip=ROUTER_IP, username=USER, password=PASSWORD, output_filename=ISIS_LSDB_FILE)
            out = StringIO()
            call_command('import_lsdb', stdout=out)
            _graph_cache = None          # paksa rebuild graph di request berikutnya
            detail = out.getvalue().strip()
            return Response({
                'status':  'ok',
                'message': 'LSDB berhasil di-import ulang',
                'detail':  detail,
            })
        except Exception as e:
            return Response({'status': 'error', 'message': str(e)}, status=500)