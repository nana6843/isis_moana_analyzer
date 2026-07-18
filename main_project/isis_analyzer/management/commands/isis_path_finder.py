#!/usr/bin/env python3
"""
ISIS LSDB Path Finder for RSVP-TE
===================================
Parses ISIS LSDB dari Cisco IOS-XR dan Huawei, membangun topology graph,
dan mencari k-shortest paths beserta IP ERO untuk RSVP-TE.

Supported commands:
  Cisco   : show isis database verbose
             show isis database detail
  Huawei  : display isis lsdb verbose

Usage:
  # List semua router dalam topology
  python isis_path_finder.py -f lsdb.txt --list-routers

  # Cari 5 path terpendek
  python isis_path_finder.py -f lsdb.txt -s PE-01 -d PE-50 -k 5

  # Export topology ke JSON (untuk integrasi aplikasi lain)
  python isis_path_finder.py -f lsdb.txt --export-json topology.json

  # Gabungkan file dari banyak router (multi-file)
  python isis_path_finder.py -f lsdb1.txt lsdb2.txt -s PE-01 -d PE-50

Requirements:
  pip install networkx
"""

import re
import sys
import json
import argparse
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

try:
    import networkx as nx
except ImportError:
    print("[!] NetworkX tidak ditemukan. Install dengan: pip install networkx")
    sys.exit(1)


# ============================================================
# DATA MODELS
# ============================================================

@dataclass
class ISISLink:
    """Satu adjacency/link dalam ISIS topology"""
    neighbor_sysid: str
    metric: int = 10
    local_ip: Optional[str] = None    # IP interface sisi lokal (sub-TLV)
    remote_ip: Optional[str] = None   # IP interface sisi neighbor (sub-TLV)
    te_metric: Optional[int] = None   # TE metric jika ada
    max_bw: Optional[float] = None    # Maximum bandwidth (bytes/sec)
    avail_bw: Optional[float] = None  # Available bandwidth (bytes/sec)


@dataclass
class ISISNode:
    """Satu router (LSP entry) dalam ISIS database"""
    system_id: str
    hostname: str = ""
    router_ips: List[str] = field(default_factory=list)   # TLV 132: IP interface addresses
    prefixes: List[str] = field(default_factory=list)      # IP reachability prefixes
    links: List[ISISLink] = field(default_factory=list)
    is_pseudonode: bool = False    # True jika ini pseudonode (DIS)
    level: int = 2
    prefix_sid: Optional[int] = None      # Prefix-SID dari loopback /32
    prefix_sid_ip: Optional[str] = None   # IP loopback yang diberi Prefix-SID


# ============================================================
# CISCO IOS-XR PARSER
# ============================================================

class CiscoISISParser:
    """
    Parser untuk output:
      show isis database verbose
      show isis database detail

    Format LSP ID: <hostname>.00-00  atau  xxxx.xxxx.xxxx.00-00
    """

    # Header LSP baru
    RE_LSP = re.compile(
        r'^([\w\-\.]+\.[\da-fA-F]{2}-[\da-fA-F]{2})\s+[\*\s]\s+0x[\da-fA-F]+'
    )
    RE_HOSTNAME  = re.compile(r'^\s+Hostname:\s+(\S+)', re.I)
    RE_IP_ADDR   = re.compile(r'^\s+IP [Aa]ddress:\s+(\d+\.\d+\.\d+\.\d+)')
    # IS Neighbor (narrow/wide TLV)
    # "  Metric: 10         IS router2.00"
    RE_IS_NBR    = re.compile(r'^\s+Metric:\s+(\d+)\s+IS\s+(\S+\.[\da-fA-F]{2})\s*$', re.I)
    # IP prefix reachability
    RE_IP_REACH  = re.compile(r'^\s+Metric:\s+\d+\s+IP\s+(\d+\.\d+\.\d+\.\d+/\d+)', re.I)
    # Extended IS Reachability sub-TLVs (TLV 22)
    RE_IPV4_INTF = re.compile(r'^\s+IPv4 [Ii]nterface [Aa]ddress:\s+(\d+\.\d+\.\d+\.\d+)')
    RE_IPV4_NBR  = re.compile(r'^\s+IPv4 [Nn]eighbor [Aa]ddress:\s+(\d+\.\d+\.\d+\.\d+)')
    RE_TE_METRIC = re.compile(r'^\s+TE [Dd]efault [Mm]etric:\s+(\d+)')
    RE_MAX_BW    = re.compile(r'^\s+Maximum [Bb]andwidth:\s+([\d\.]+)')
    RE_AVAIL_BW  = re.compile(r'^\s+Maximum [Rr]eservable [Bb]andwidth:\s+([\d\.]+)')
    # Prefix-SID (IOS-XR format)
    RE_PREFIX_SID = re.compile(r'^\s+Prefix-SID Index:\s+(\d+)', re.I)
    # IP reachability /32 prefix (loopback candidate)
    RE_IP_REACH_32 = re.compile(
        r'^\s+Metric:\s+\d+\s+IP\s+(\d+\.\d+\.\d+\.\d+)/32', re.I
    )

    def parse(self, text: str) -> Dict[str, ISISNode]:
        nodes: Dict[str, ISISNode] = {}
        current_node: Optional[ISISNode] = None
        current_link: Optional[ISISLink] = None
        last_reach_ip: Optional[str] = None   # IP dari IP reach /32 terakhir

        for line in text.splitlines():
            # --- Deteksi header LSP baru ---
            m = self.RE_LSP.match(line)
            if m:
                lsp_id = m.group(1)
                fm = re.match(r'^(.*)\.([\da-fA-F]{2})-([\da-fA-F]{2})$', lsp_id)
                if not fm:
                    current_node = None
                    continue

                sysid_part = fm.group(1)
                pseudonode = fm.group(2)
                # fragment = fm.group(3)

                node_key = f"{sysid_part}.{pseudonode}"
                is_pseudo = (pseudonode.upper() != '00')

                if node_key not in nodes:
                    nodes[node_key] = ISISNode(
                        system_id=node_key,
                        hostname=sysid_part,
                        is_pseudonode=is_pseudo
                    )
                current_node = nodes[node_key]
                current_link = None
                last_reach_ip = None
                continue

            if current_node is None:
                continue

            # --- Hostname ---
            m = self.RE_HOSTNAME.match(line)
            if m:
                current_node.hostname = m.group(1)
                continue

            # --- IP Address (TLV 132) ---
            m = self.RE_IP_ADDR.match(line)
            if m:
                ip = m.group(1)
                if ip not in current_node.router_ips:
                    current_node.router_ips.append(ip)
                continue

            # --- IS Neighbor ---
            m = self.RE_IS_NBR.match(line)
            if m:
                metric = int(m.group(1))
                nbr_sysid = m.group(2)
                link = ISISLink(neighbor_sysid=nbr_sysid, metric=metric)
                current_node.links.append(link)
                current_link = link
                continue

            # --- IP Prefix ---
            m = self.RE_IP_REACH.match(line)
            if m:
                current_node.prefixes.append(m.group(1))
                current_link = None
                # Track /32 untuk Prefix-SID
                m32 = self.RE_IP_REACH_32.match(line)
                last_reach_ip = m32.group(1) if m32 else None
                continue

            # --- Prefix-SID (Cisco IOS-XR) ---
            m = self.RE_PREFIX_SID.match(line)
            if m and last_reach_ip:
                sid = int(m.group(1))
                if current_node.prefix_sid is None:
                    current_node.prefix_sid = sid
                    current_node.prefix_sid_ip = last_reach_ip
                continue

            # --- Sub-TLVs (Extended IS Reachability) ---
            m = self.RE_IPV4_INTF.match(line)
            if m and current_link:
                current_link.local_ip = m.group(1)
                continue

            m = self.RE_IPV4_NBR.match(line)
            if m and current_link:
                current_link.remote_ip = m.group(1)
                continue

            m = self.RE_TE_METRIC.match(line)
            if m and current_link:
                current_link.te_metric = int(m.group(1))
                continue

            m = self.RE_MAX_BW.match(line)
            if m and current_link:
                current_link.max_bw = float(m.group(1))
                continue

            m = self.RE_AVAIL_BW.match(line)
            if m and current_link:
                current_link.avail_bw = float(m.group(1))
                continue

        return nodes


# ============================================================
# SUBNET HELPERS
# ============================================================

def _ip_to_int(ip: str) -> int:
    parts = ip.split('.')
    return (int(parts[0]) << 24) | (int(parts[1]) << 16) | (int(parts[2]) << 8) | int(parts[3])

def _mask_to_bits(mask: str) -> int:
    return bin(_ip_to_int(mask)).count('1')

def _network_addr(ip: str, mask: str) -> str:
    """Hitung network address dari IP + mask"""
    ip_int = _ip_to_int(ip)
    mask_int = _ip_to_int(mask)
    net_int = ip_int & mask_int
    return f"{(net_int >> 24) & 0xff}.{(net_int >> 16) & 0xff}.{(net_int >> 8) & 0xff}.{net_int & 0xff}"

def _ip_in_subnet(ip: str, net_ip: str, mask: str) -> bool:
    """Apakah ip berada dalam subnet net_ip/mask?"""
    try:
        return _network_addr(ip, mask) == net_ip
    except Exception:
        return False

def _int_to_ip(n: int) -> str:
    return f"{(n >> 24) & 0xff}.{(n >> 16) & 0xff}.{(n >> 8) & 0xff}.{n & 0xff}"

def _infer_remote_ip(local_ip: str, net_ip: str, mask: str) -> Optional[str]:
    """
    Inferensikan IP remote dari subnet P2P (/30 atau /31) ketika
    remote tidak mengiklankan INTF ADDR.
    - /31: dua host, flip bit terakhir
    - /30: host adalah net+1 dan net+2, ambil yang bukan local
    """
    try:
        bits = _mask_to_bits(mask)
        local_int = _ip_to_int(local_ip)
        net_int   = _ip_to_int(net_ip)
        if bits == 31:
            other = local_int ^ 1
            if _network_addr(_int_to_ip(other), mask) == net_ip:
                return _int_to_ip(other)
        elif bits == 30:
            h1, h2 = net_int + 1, net_int + 2
            if local_int == h1:
                return _int_to_ip(h2)
            if local_int == h2:
                return _int_to_ip(h1)
    except Exception:
        pass
    return None


# ============================================================
# HUAWEI PARSER  (format nyata dari display isis lsdb verbose)
# ============================================================

class HuaweiISISParser:
    """
    Parser untuk output: display isis lsdb verbose (Huawei VRP)

    Format khas:
      Header  : xxxx.xxxx.xxxx.00-00  0x...
      SOURCE  : HOSTNAME.00           ← mapping sysid -> hostname
      HOST NAME: HOSTNAME
      INTF ADDR: x.x.x.x             ← interface IPs router ini
      +NBR  ID   HOSTNAME.00  COST: N ← neighbor by hostname
      +IP-Extended x.x.x.x mask COST:N ← prefix/link subnet
      Router ID: x.x.x.x

    Neighbor pakai HOSTNAME, bukan numeric system ID.
    Resolusi sysid neighbor dilakukan di post-processing.
    Interface IP per link dicari via subnet matching INTF ADDR ↔ IP-Extended.
    """

    # LSP header: xxxx.xxxx.xxxx.xx-xx  0x...
    # '*' setelah LSP ID = LSP milik router lokal (di mana dis isis lsdb dijalankan)
    RE_LSP = re.compile(
        r'^([\da-fA-F]{4}\.[\da-fA-F]{4}\.[\da-fA-F]{4}\.[\da-fA-F]{2}-[\da-fA-F]{2})\*?\s+0x'
    )
    # SOURCE: maps LSP ke hostname (misal: DPSTKUHW02.00)
    RE_SOURCE    = re.compile(r'^\s+SOURCE\s+(\S+)', re.I)
    # HOST NAME (bukan HOSTNAME)
    RE_HOSTNAME  = re.compile(r'^\s+HOST NAME\s+(\S+)', re.I)
    # INTF ADDR (bukan IP-ADDRESS)
    RE_INTF_ADDR = re.compile(r'^\s+INTF ADDR\s+(\d+\.\d+\.\d+\.\d+)', re.I)
    # Router ID
    RE_ROUTER_ID = re.compile(r'^\s+Router ID\s+(\d+\.\d+\.\d+\.\d+)', re.I)
    # +NBR  ID      HOSTNAME.xx  COST: NNN
    RE_NBR = re.compile(
        r'^\+NBR\s+ID\s+(\S+?)\s+COST:\s*(\d+)', re.I
    )
    # +IP-Extended  net_ip  mask  COST: NNN
    RE_IP_EXT = re.compile(
        r'^\+IP-Extended\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+COST:\s*(\d+)', re.I
    )
    # Prefix-Sid   1274       Algorithm: 0   Flag: ...
    RE_PREFIX_SID = re.compile(r'^\s+Prefix-Sid\s+(\d+)', re.I)

    def parse(self, text: str) -> Dict[str, 'ISISNode']:
        nodes: Dict[str, ISISNode] = {}
        # hostname -> system_id (diisi dari SOURCE field)
        hostname_to_sysid: Dict[str, str] = {}

        current_node: Optional[ISISNode] = None
        current_link: Optional[ISISLink] = None
        last_ip_ext_ip: Optional[str] = None    # IP dari +IP-Extended terakhir
        last_ip_ext_is_loopback: bool = False   # True jika /32 (loopback)

        for line in text.splitlines():
            # --- LSP Header ---
            m = self.RE_LSP.match(line)
            if m:
                lsp_id = m.group(1)
                fm = re.match(r'^(.*)\.([\da-fA-F]{2})-([\da-fA-F]{2})$', lsp_id)
                if not fm:
                    current_node = None
                    continue

                sysid_part = fm.group(1)   # e.g. "0001.0200.4074"
                pseudonode = fm.group(2)   # e.g. "00"
                node_key = f"{sysid_part}.{pseudonode}"
                is_pseudo = (pseudonode.upper() != '00')

                if node_key not in nodes:
                    nodes[node_key] = ISISNode(
                        system_id=node_key,
                        hostname=sysid_part,   # default, akan di-override
                        is_pseudonode=is_pseudo
                    )
                current_node = nodes[node_key]
                current_link = None
                last_ip_ext_ip = None
                last_ip_ext_is_loopback = False
                continue

            if current_node is None:
                continue

            # --- SOURCE: maps LSP ke hostname ---
            m = self.RE_SOURCE.match(line)
            if m:
                # SOURCE berisi "HOSTNAME.xx" - strip pseudonode byte
                src_raw = m.group(1)  # e.g. "DPSTKUHW02.00"
                # Ambil hostname (hapus .xx suffix)
                src_hostname = re.sub(r'\.\d{2}$', '', src_raw)
                # Update hostname di node
                if not current_node.hostname or current_node.hostname == current_node.system_id.rsplit('.', 1)[0]:
                    current_node.hostname = src_hostname
                # Daftarkan mapping hostname -> sysid
                sysid_base = current_node.system_id.rsplit('.', 1)[0]  # strip pseudonode
                hostname_to_sysid[src_hostname.lower()] = sysid_base
                continue

            # --- HOST NAME ---
            m = self.RE_HOSTNAME.match(line)
            if m:
                hostname = m.group(1)
                current_node.hostname = hostname
                sysid_base = current_node.system_id.rsplit('.', 1)[0]
                hostname_to_sysid[hostname.lower()] = sysid_base
                continue

            # --- INTF ADDR (interface IPs router ini) ---
            m = self.RE_INTF_ADDR.match(line)
            if m:
                ip = m.group(1)
                if ip not in current_node.router_ips:
                    current_node.router_ips.append(ip)
                current_link = None
                continue

            # --- Router ID ---
            m = self.RE_ROUTER_ID.match(line)
            if m:
                rid = m.group(1)
                # Router ID biasanya loopback, pastikan ada di router_ips
                if rid not in current_node.router_ips:
                    current_node.router_ips.insert(0, rid)
                continue

            # --- +NBR  ID (IS Neighbor) ---
            m = self.RE_NBR.match(line)
            if m:
                nbr_ref = m.group(1)   # bisa "HOSTNAME.00" atau "xxxx.xxxx.xxxx.00"
                metric = int(m.group(2))
                # Strip pseudonode byte dari neighbor ref
                nbr_ref_clean = re.sub(r'\.\d{2}$', '', nbr_ref)
                link = ISISLink(neighbor_sysid=nbr_ref_clean, metric=metric)
                current_node.links.append(link)
                current_link = link
                continue

            # --- +IP-Extended (prefix/link subnet) ---
            m = self.RE_IP_EXT.match(line)
            if m:
                net_ip = m.group(1)
                mask   = m.group(2)
                cost   = int(m.group(3))
                bits   = _mask_to_bits(mask)
                prefix_str = f"{net_ip}/{bits}"
                if prefix_str not in current_node.prefixes:
                    current_node.prefixes.append(prefix_str)
                # Track untuk Prefix-Sid parsing di baris berikutnya
                last_ip_ext_ip = net_ip
                last_ip_ext_is_loopback = (bits == 32)
                # Simpan link subnet info untuk resolusi interface IP nanti
                if not hasattr(current_node, '_link_subnets'):
                    current_node._link_subnets = []
                current_node._link_subnets.append((net_ip, mask, cost))
                current_link = None
                continue

            # --- Prefix-Sid (sub-TLV dari IP-Extended /32) ---
            m = self.RE_PREFIX_SID.match(line)
            if m and last_ip_ext_is_loopback and last_ip_ext_ip:
                sid = int(m.group(1))
                # Ambil Prefix-SID yang pertama ditemukan (biasanya Algorithm: 0)
                if current_node.prefix_sid is None:
                    current_node.prefix_sid = sid
                    current_node.prefix_sid_ip = last_ip_ext_ip
                continue

        # ------------------------------------------------------------------
        # Post-processing: resolve hostname-based neighbor refs ke system ID
        # ------------------------------------------------------------------
        for node_key, node in nodes.items():
            for link in node.links:
                ref = link.neighbor_sysid.lower()
                # Cek apakah sudah berupa numeric sysid (xxxx.xxxx.xxxx)
                if re.match(r'^[\da-f]{4}\.[\da-f]{4}\.[\da-f]{4}$', ref):
                    pass  # sudah berupa sysid, biarkan
                else:
                    # Coba resolve hostname ke sysid
                    resolved = hostname_to_sysid.get(ref)
                    if resolved:
                        link.neighbor_sysid = resolved
                    # Kalau tidak ketemu, biarkan sebagai hostname
                    # (akan di-skip saat build graph)

        # ------------------------------------------------------------------
        # Post-processing: resolusi interface IP per link via subnet matching
        # Untuk setiap link A->B, cari INTF ADDR milik A yang ada di
        # subnet yang juga dimiliki B (IP-Extended /30 atau /31)
        # ------------------------------------------------------------------
        self._resolve_link_ips(nodes, hostname_to_sysid)

        return nodes

    def _resolve_link_ips(self, nodes: Dict[str, 'ISISNode'],
                           hostname_to_sysid: Dict[str, str]) -> None:
        """
        Untuk setiap link A→B, cari interface IP local dan remote via subnet matching.

        Algoritma (prioritas berurutan):
        1. Cari subnet dari A dengan cost == NBR cost, dan B punya INTF ADDR di subnet tsb
           → paling akurat, langsung identifikasi link yang benar
        2. Jika tidak ketemu, cari subnet mana saja di A yang B juga punya INTF ADDR-nya
           → fallback jika ada multi-link dengan cost berbeda

        SYARAT: local_ip DAN remote_ip keduanya harus ditemukan.
        Jika hanya local_ip yang ketemu (B tidak punya INTF ADDR di subnet itu),
        subnet ini dilewati — jangan langsung break.
        """
        def find_node(sysid_base: str) -> Optional['ISISNode']:
            candidate = f"{sysid_base}.00"
            if candidate in nodes:
                return nodes[candidate]
            for k, n in nodes.items():
                if k.startswith(sysid_base):
                    return n
            return None

        for node_key, node in nodes.items():
            if node.is_pseudonode:
                continue
            link_subnets = getattr(node, '_link_subnets', [])  # [(net_ip, mask, cost), ...]

            for link in node.links:
                nbr_node = find_node(link.neighbor_sysid)
                if nbr_node is None:
                    continue

                best_local = None
                best_remote = None

                # Pass 1: subnet cost == NBR cost, kedua router punya INTF ADDR-nya
                for (net_ip, mask, cost) in link_subnets:
                    if _mask_to_bits(mask) == 32 or cost != link.metric:
                        continue
                    local_ip = next(
                        (ip for ip in node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                    )
                    if not local_ip:
                        continue
                    remote_ip = next(
                        (ip for ip in nbr_node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                    )
                    if local_ip and remote_ip:
                        best_local, best_remote = local_ip, remote_ip
                        break

                # Pass 2: subnet cost == NBR cost, remote tidak ada di INTF ADDR →
                #          inferensikan dari /30 atau /31 (hanya 2 host per subnet)
                if not best_local:
                    for (net_ip, mask, cost) in link_subnets:
                        if _mask_to_bits(mask) == 32 or cost != link.metric:
                            continue
                        local_ip = next(
                            (ip for ip in node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                        )
                        if not local_ip:
                            continue
                        # Remote tidak iklankan INTF ADDR, tapi kita tahu subnet-nya
                        # → cek apakah nbr memang punya subnet ini di IP-Extended-nya
                        nbr_subnets = getattr(nbr_node, '_link_subnets', [])
                        nbr_has_subnet = any(n == net_ip and m == mask for n, m, _ in nbr_subnets)
                        if nbr_has_subnet:
                            inferred = _infer_remote_ip(local_ip, net_ip, mask)
                            best_local = local_ip
                            best_remote = inferred   # bisa None jika /29 atau lebih besar
                            break

                # Pass 3: fallback — subnet mana saja yang keduanya punya INTF ADDR
                if not best_local:
                    for (net_ip, mask, cost) in link_subnets:
                        if _mask_to_bits(mask) == 32:
                            continue
                        local_ip = next(
                            (ip for ip in node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                        )
                        if not local_ip:
                            continue
                        remote_ip = next(
                            (ip for ip in nbr_node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                        )
                        if local_ip and remote_ip:
                            best_local, best_remote = local_ip, remote_ip
                            break

                # Pass 4: fallback dengan inferensi, tanpa syarat cost
                if not best_local:
                    for (net_ip, mask, cost) in link_subnets:
                        if _mask_to_bits(mask) == 32:
                            continue
                        local_ip = next(
                            (ip for ip in node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                        )
                        if not local_ip:
                            continue
                        nbr_subnets = getattr(nbr_node, '_link_subnets', [])
                        nbr_has_subnet = any(n == net_ip and m == mask for n, m, _ in nbr_subnets)
                        if nbr_has_subnet:
                            inferred = _infer_remote_ip(local_ip, net_ip, mask)
                            best_local = local_ip
                            best_remote = inferred
                            break

                # Pass 5: reverse inference — node tidak punya INTF ADDR di link subnet,
                #          tapi neighbor punya. Infer IP node dari /30 atau /31.
                #          Kasus: IP router yang tidak iklankan INTF ADDR P2P-nya.
                if not best_local:
                    nbr_subnets = getattr(nbr_node, '_link_subnets', [])
                    for (net_ip, mask, cost) in link_subnets:
                        if _mask_to_bits(mask) == 32:
                            continue
                        # Node tidak punya INTF ADDR di subnet ini
                        if any(_ip_in_subnet(ip, net_ip, mask) for ip in node.router_ips):
                            continue
                        # Tapi neighbor punya INTF ADDR di subnet ini
                        remote_ip = next(
                            (ip for ip in nbr_node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                        )
                        if remote_ip:
                            # Infer IP lokal dari sisi yang berlawanan di /30//31
                            local_ip = _infer_remote_ip(remote_ip, net_ip, mask)
                            if local_ip:
                                best_local, best_remote = local_ip, remote_ip
                                break
                    # Jika masih kosong, coba via subnet milik neighbor
                    if not best_local:
                        for (net_ip, mask, cost) in nbr_subnets:
                            if _mask_to_bits(mask) == 32:
                                continue
                            remote_ip = next(
                                (ip for ip in nbr_node.router_ips if _ip_in_subnet(ip, net_ip, mask)), None
                            )
                            if not remote_ip:
                                continue
                            # Check apakah node juga share subnet ini
                            if not any(n == net_ip and m == mask for n, m, _ in link_subnets):
                                continue
                            local_ip = _infer_remote_ip(remote_ip, net_ip, mask)
                            if local_ip:
                                best_local, best_remote = local_ip, remote_ip
                                break

                if best_local:
                    link.local_ip = best_local
                    link.remote_ip = best_remote


# ============================================================
# TOPOLOGY BUILDER & PATH FINDER
# ============================================================

class ISISTopology:
    """
    Membangun graph dari ISIS nodes dan mencari k-shortest paths.
    Graph adalah undirected weighted graph dengan metric sebagai weight.
    """

    def __init__(self):
        self.nodes: Dict[str, ISISNode] = {}
        self.graph = nx.Graph()
        self._hostname_map: Dict[str, str] = {}   # hostname.lower() -> system_id

    # ----------------------------------------------------------
    # Load & Build
    # ----------------------------------------------------------

    def load(self, nodes: Dict[str, ISISNode]):
        self.nodes.update(nodes)
        # Update hostname map
        for sysid, node in self.nodes.items():
            if node.hostname:
                self._hostname_map[node.hostname.lower()] = sysid
        self._build_graph()

    def _normalize_sysid(self, ref: str) -> Optional[str]:
        """
        Resolve neighbor reference ke canonical system ID (dengan .00 suffix)
        yang ada di self.nodes.
        ref bisa berupa:
          - numeric sysid: "xxxx.xxxx.xxxx" → cari "xxxx.xxxx.xxxx.00"
          - hostname: "DPSTKUHW01" → cari via _hostname_map
        """
        # Exact match (sudah ada .00)
        if ref in self.nodes:
            return ref
        # Tambah .00
        candidate = f"{ref}.00"
        if candidate in self.nodes:
            return candidate
        # Hostname lookup (case-insensitive)
        lower = ref.lower()
        if lower in self._hostname_map:
            sysid_base = self._hostname_map[lower]
            c2 = f"{sysid_base}.00"
            if c2 in self.nodes:
                return c2
            return sysid_base
        # Prefix/partial match
        for key in self.nodes:
            if key.startswith(ref):
                return key
        return None

    def _build_graph(self):
        self.graph.clear()

        # Add nodes
        for sysid, node in self.nodes.items():
            self.graph.add_node(
                sysid,
                label=node.hostname or sysid,
                router_ips=node.router_ips,
                is_pseudonode=node.is_pseudonode
            )

        # Add edges (undirected; proses dua sisi untuk dapat IP info lengkap)
        processed: set = set()

        for sysid, node in self.nodes.items():
            for link in node.links:
                nbr_id = self._normalize_sysid(link.neighbor_sysid)
                if nbr_id is None:
                    continue

                edge_key = tuple(sorted([sysid, nbr_id]))
                if edge_key in processed:
                    # Edge sudah ada - coba update interface IP jika belum terisi
                    if self.graph.has_edge(sysid, nbr_id):
                        ed = self.graph[sysid][nbr_id]
                        if not ed.get('ip_a') and link.local_ip:
                            # Determine which side is which
                            if ed.get('node_a') == sysid:
                                ed['ip_a'] = link.local_ip
                            else:
                                ed['ip_b'] = link.local_ip
                    continue

                # Get reverse link for IP info
                nbr_node = self.nodes.get(nbr_id)
                reverse_link: Optional[ISISLink] = None
                if nbr_node:
                    for rl in nbr_node.links:
                        rl_nbr = self._normalize_sysid(rl.neighbor_sysid)
                        if rl_nbr == sysid:
                            reverse_link = rl
                            break

                # Resolve interface IPs
                # ip_a = IP pada sisi sysid, ip_b = IP pada sisi nbr_id
                ip_a = link.local_ip
                ip_b = link.remote_ip or (reverse_link.local_ip if reverse_link else None)
                if not ip_a and reverse_link:
                    ip_a = reverse_link.remote_ip

                metric = link.metric
                te_metric = link.te_metric or (reverse_link.te_metric if reverse_link else None)

                self.graph.add_edge(
                    sysid, nbr_id,
                    metric=metric,
                    te_metric=te_metric,
                    ip_a=ip_a,      # IP pada sisi sysid (node pertama di edge_key)
                    ip_b=ip_b,      # IP pada sisi nbr_id
                    node_a=sysid,
                    node_b=nbr_id,
                )
                processed.add(edge_key)

    # ----------------------------------------------------------
    # Lookup helpers
    # ----------------------------------------------------------

    def resolve(self, name: str) -> Optional[str]:
        """Resolve hostname, partial name, atau system ID ke canonical system ID"""
        # Exact match
        if name in self.nodes:
            return name
        # Hostname
        if name.lower() in self._hostname_map:
            return self._hostname_map[name.lower()]
        # Partial / case-insensitive
        for sysid, node in self.nodes.items():
            hn = node.hostname or ''
            if (name.lower() in sysid.lower()) or (name.lower() in hn.lower()):
                return sysid
        return None

    def get_interface_ip(self, from_node: str, to_node: str) -> Optional[str]:
        """
        Dapatkan IP interface pada from_node yang menghadap ke to_node.
        Digunakan untuk menyusun ERO.
        """
        ed = self.graph.get_edge_data(from_node, to_node)
        if not ed:
            return None
        if ed.get('node_a') == from_node:
            return ed.get('ip_a')
        else:
            return ed.get('ip_b')

    # ----------------------------------------------------------
    # Path Finding
    # ----------------------------------------------------------

    def k_shortest_paths(
        self,
        source: str,
        target: str,
        k: int = 5,
        weight: str = 'metric'
    ) -> List[List[str]]:
        """
        Cari k-shortest simple paths menggunakan Yen's algorithm via NetworkX.
        weight: 'metric' atau 'te_metric'
        """
        src_id = self.resolve(source)
        tgt_id = self.resolve(target)

        if src_id is None:
            raise ValueError(f"Router tidak ditemukan: '{source}'")
        if tgt_id is None:
            raise ValueError(f"Router tidak ditemukan: '{target}'")
        if src_id == tgt_id:
            raise ValueError("Source dan destination sama")

        # Gunakan subgraph tanpa pseudonode agar path lebih bersih
        # Pseudonode tetap dimasukkan sebagai edge connector (LAN segment)
        # tapi kita bisa opsional filter
        graph_to_use = self.graph

        paths = []
        try:
            gen = nx.shortest_simple_paths(graph_to_use, src_id, tgt_id, weight=weight)
            for path in gen:
                paths.append(path)
                if len(paths) >= k:
                    break
        except nx.NetworkXNoPath:
            pass
        except nx.NodeNotFound as e:
            raise ValueError(str(e))

        return paths

    def path_cost(self, path: List[str], weight: str = 'metric') -> int:
        """Hitung total metric cost sepanjang path"""
        total = 0
        for i in range(len(path) - 1):
            ed = self.graph.get_edge_data(path[i], path[i + 1])
            if ed:
                total += ed.get(weight) or ed.get('metric', 0)
        return total

    # ----------------------------------------------------------
    # ERO Generation
    # ----------------------------------------------------------

    def get_ero(self, path: List[str]) -> List[dict]:
        """
        Susun Explicit Route Object (ERO) untuk RSVP-TE.

        Untuk setiap hop:
        - Gunakan IP interface outgoing (sub-TLV) jika tersedia → strict ERO
        - Fallback ke loopback/router-IP → loose ERO

        Returns list of dict per real router hop (pseudonode dilewati).
        """
        ero_hops = []

        # Filter pseudonode dari path untuk ERO output
        real_path = [p for p in path if not self.nodes.get(p, ISISNode('')).is_pseudonode]

        for idx, sysid in enumerate(real_path):
            node = self.nodes.get(sysid)
            label = node.hostname if (node and node.hostname) else sysid

            # Cari next hop (perlu index di path asli untuk dapat edge)
            next_sysid = real_path[idx + 1] if idx < len(real_path) - 1 else None

            # IP outgoing interface (IP pada sysid yang mengarah ke next_sysid)
            outgoing_ip = None
            if next_sysid:
                # Cari di path asli (ada kemungkinan lewat pseudonode)
                pi = path.index(sysid)
                pj = path.index(next_sysid)
                # Traverse edge langsung atau via pseudonode
                if pj == pi + 1:
                    outgoing_ip = self.get_interface_ip(sysid, next_sysid)
                elif pj == pi + 2:
                    # Ada pseudonode di antara
                    pseudo = path[pi + 1]
                    # Interface IP dari sysid ke pseudonode
                    outgoing_ip = self.get_interface_ip(sysid, pseudo)

            router_ips = node.router_ips if node else []
            loopback = router_ips[0] if router_ips else None

            # Tentukan tipe ERO
            ero_type = 'strict' if outgoing_ip else ('loose' if loopback else 'unknown')

            # Cost adjacency ke next hop
            adj_cost = None
            if next_sysid:
                pi = path.index(sysid)
                pj = path.index(next_sysid)
                # Ambil edge data (bisa langsung atau via pseudonode)
                ed = self.graph.get_edge_data(sysid, next_sysid)
                if not ed and pj == pi + 2:
                    # Via pseudonode: cost total = hop ke pseudo + pseudo ke next
                    pseudo = path[pi + 1]
                    ed1 = self.graph.get_edge_data(sysid, pseudo)
                    ed2 = self.graph.get_edge_data(pseudo, next_sysid)
                    if ed1 and ed2:
                        adj_cost = (ed1.get('metric', 0) or 0) + (ed2.get('metric', 0) or 0)
                elif ed:
                    adj_cost = ed.get('metric', 0)

            ero_hops.append({
                'hop_index': idx,
                'router': label,
                'system_id': sysid,
                'outgoing_ip': outgoing_ip,
                'loopback': loopback,
                'all_router_ips': router_ips,
                'ero_type': ero_type,
                'is_source': idx == 0,
                'is_destination': idx == len(real_path) - 1,
                'prefix_sid': node.prefix_sid if node else None,
                'prefix_sid_ip': node.prefix_sid_ip if node else None,
                'adj_cost': adj_cost,   # cost link ke next hop
            })

        return ero_hops

    def build_ero_list(self, ero_hops: List[dict]) -> List[str]:
        """
        Flatten ERO hops ke list IP string untuk RSVP-TE.
        Format: ["strict 10.1.1.1/32", "strict 10.2.2.2/32", ...]
        """
        ero_list = []
        for hop in ero_hops:
            ip = hop.get('outgoing_ip') or hop.get('loopback')
            if ip:
                t = hop.get('ero_type', 'strict')
                ero_list.append(f"{t} {ip}/32")
        return ero_list

    # ----------------------------------------------------------
    # Reporting
    # ----------------------------------------------------------

    def format_path_report(self, path: List[str], path_num: int = 1,
                            weight: str = 'metric') -> str:
        cost = self.path_cost(path, weight)
        ero_hops = self.get_ero(path)
        ero_list = self.build_ero_list(ero_hops)
        real_path = [p for p in path if not self.nodes.get(p, ISISNode('')).is_pseudonode]

        lines = []
        lines.append(f"\n{'═'*64}")
        lines.append(f"  Path #{path_num}  |  Total Metric: {cost}  |  Hops: {len(real_path)}")
        lines.append(f"{'═'*64}")

        for hop in ero_hops:
            idx = hop['hop_index']
            router = hop['router']
            sysid = hop['system_id']
            role = "SRC" if hop['is_source'] else ("DST" if hop['is_destination'] else "   ")

            out_ip = hop.get('outgoing_ip', '')
            lb = hop.get('loopback', '')
            psid = hop.get('prefix_sid')
            adj_cost = hop.get('adj_cost')

            lines.append(f"  [{role}] Hop {idx+1:>2}: {router:<28} ({sysid})")
            if lb:
                sid_info = f"  [Prefix-SID: {psid}]" if psid is not None else ""
                lines.append(f"          Loopback / Router-ID : {lb}{sid_info}")
            if not hop['is_destination']:
                cost_str = f"  [adj-cost: {adj_cost}]" if adj_cost is not None else ""
                if out_ip:
                    lines.append(f"          Outgoing Interface IP  : {out_ip}{cost_str}  ← ERO")
                else:
                    lines.append(f"          Outgoing Interface IP  : (tidak diketahui, gunakan loopback){cost_str}")

        # ERO block
        lines.append(f"\n  ┌─ RSVP-TE Explicit Route Object (ERO) ─────────────────────┐")
        if ero_list:
            for entry in ero_list:
                lines.append(f"  │   {entry:<58} │")
        else:
            lines.append(f"  │   (Tidak ada IP tersedia)                                  │")
        lines.append(f"  └───────────────────────────────────────────────────────────┘")

        # Prefix-SID list (Segment Routing)
        sid_entries = [h for h in ero_hops if h.get('prefix_sid') is not None]
        if sid_entries:
            lines.append(f"\n  ┌─ Segment Routing - Prefix-SID List ───────────────────────┐")
            for h in sid_entries:
                role = "src" if h['is_source'] else ("dst" if h['is_destination'] else "   ")
                sid_line = f"[{role}] {h['router']:<20} {h['prefix_sid_ip'] or h['loopback'] or '?':<18} SID: {h['prefix_sid']}"
                lines.append(f"  │   {sid_line:<58} │")
            lines.append(f"  └───────────────────────────────────────────────────────────┘")

        # Router path shorthand
        route_str = " → ".join(h['router'] for h in ero_hops)
        lines.append(f"\n  Route: {route_str}")

        return '\n'.join(lines)

    def summary(self) -> str:
        real = sum(1 for n in self.nodes.values() if not n.is_pseudonode)
        pseudo = sum(1 for n in self.nodes.values() if n.is_pseudonode)
        edges = self.graph.number_of_edges()
        return f"{real} routers, {pseudo} pseudonodes, {edges} links"

    # ----------------------------------------------------------
    # Export
    # ----------------------------------------------------------

    def to_dict(self) -> dict:
        """Export topology ke dict (untuk JSON)"""
        return {
            'nodes': [
                {
                    'id': sysid,
                    'hostname': node.hostname,
                    'router_ips': node.router_ips,
                    'prefixes': node.prefixes,
                    'is_pseudonode': node.is_pseudonode,
                    'prefix_sid': node.prefix_sid,
                    'prefix_sid_ip': node.prefix_sid_ip,
                }
                for sysid, node in self.nodes.items()
            ],
            'edges': [
                {
                    'from': u,
                    'to': v,
                    'metric': data.get('metric', 0),
                    'te_metric': data.get('te_metric'),
                    'ip_a': data.get('ip_a'),
                    'ip_b': data.get('ip_b'),
                }
                for u, v, data in self.graph.edges(data=True)
            ]
        }

    def to_adjacency_dict(self) -> dict:
        """
        Export adjacency list per router.
        Format mudah dikonsumsi aplikasi lain.
        """
        result = {}
        for sysid, node in self.nodes.items():
            if node.is_pseudonode:
                continue
            neighbors = []
            for nbr_id in self.graph.neighbors(sysid):
                nbr_node = self.nodes.get(nbr_id)
                ed = self.graph[sysid][nbr_id]
                out_ip = self.get_interface_ip(sysid, nbr_id)
                in_ip = self.get_interface_ip(nbr_id, sysid)
                neighbors.append({
                    'neighbor': nbr_node.hostname if (nbr_node and nbr_node.hostname) else nbr_id,
                    'neighbor_sysid': nbr_id,
                    'is_pseudonode': nbr_node.is_pseudonode if nbr_node else False,
                    'metric': ed.get('metric', 0),
                    'te_metric': ed.get('te_metric'),
                    'local_ip': out_ip,
                    'remote_ip': in_ip,
                })
            result[node.hostname or sysid] = {
                'system_id': sysid,
                'router_ips': node.router_ips,
                'neighbors': neighbors,
            }
        return result


# ============================================================
# AUTO-DETECT VENDOR
# ============================================================

def detect_vendor(text: str) -> str:
    """Auto-detect format ISIS LSDB (cisco atau huawei)"""
    # Cisco IOS-XR patterns
    if re.search(r'IS-IS \d+ \(Level-[12]\) Link State Database', text):
        return 'cisco'
    if re.search(r'^\s+Hostname:', text, re.M):
        return 'cisco'
    # Huawei VRP patterns (format nyata)
    if re.search(r'Database information for ISIS', text, re.I):
        return 'huawei'
    if re.search(r'^\s+HOST NAME\s+\S', text, re.M):
        return 'huawei'
    if re.search(r'^\+NBR\s+ID\s+', text, re.M):
        return 'huawei'
    if re.search(r'^\s+INTF ADDR\s+', text, re.M):
        return 'huawei'
    # Default
    return 'cisco'


# ============================================================
# MAIN CLI
# ============================================================

def main():
    ap = argparse.ArgumentParser(
        description='ISIS LSDB Path Finder untuk RSVP-TE',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    ap.add_argument(
        '-f', '--file', nargs='+', required=True,
        help='File ISIS LSDB (bisa lebih dari satu file)'
    )
    ap.add_argument('-s', '--src', help='Source router (hostname atau system-id)')
    ap.add_argument('-d', '--dst', help='Destination router (hostname atau system-id)')
    ap.add_argument(
        '-k', '--k-paths', type=int, default=5,
        help='Jumlah path terpendek yang dicari (default: 5)'
    )
    ap.add_argument(
        '--vendor', choices=['cisco', 'huawei', 'auto'], default='auto',
        help='Vendor router (default: auto-detect)'
    )
    ap.add_argument(
        '--weight', choices=['metric', 'te_metric'], default='metric',
        help='Metric yang digunakan untuk path finding (default: metric)'
    )
    ap.add_argument('--list-routers', action='store_true', help='List semua router')
    ap.add_argument('--export-json', metavar='FILE', help='Export topology ke JSON')
    ap.add_argument(
        '--export-adjacency', metavar='FILE',
        help='Export adjacency list per router ke JSON'
    )
    ap.add_argument(
        '--output-json', action='store_true',
        help='Output hasil path finding dalam format JSON'
    )
    ap.add_argument(
        '--include-pseudonode', action='store_true',
        help='Tampilkan pseudonode dalam list router'
    )

    args = ap.parse_args()

    # --- Baca semua file input ---
    all_text = ""
    for fname in args.file:
        try:
            with open(fname, 'r', encoding='utf-8', errors='ignore') as f:
                all_text += f.read() + "\n"
        except FileNotFoundError:
            print(f"[!] File tidak ditemukan: {fname}")
            sys.exit(1)

    # --- Detect vendor ---
    vendor = args.vendor
    if vendor == 'auto':
        vendor = detect_vendor(all_text)
        print(f"[*] Auto-detect vendor: {vendor.upper()}")

    # --- Parse ---
    print(f"[*] Parsing ISIS LSDB...")
    if vendor == 'cisco':
        nodes = CiscoISISParser().parse(all_text)
    else:
        nodes = HuaweiISISParser().parse(all_text)

    print(f"[*] Ditemukan {len(nodes)} LSP entries")

    # --- Build topology ---
    topo = ISISTopology()
    topo.load(nodes)
    print(f"[*] Topology: {topo.summary()}")

    # --- Export JSON ---
    if args.export_json:
        with open(args.export_json, 'w') as f:
            json.dump(topo.to_dict(), f, indent=2)
        print(f"[*] Topology di-export ke: {args.export_json}")

    if args.export_adjacency:
        with open(args.export_adjacency, 'w') as f:
            json.dump(topo.to_adjacency_dict(), f, indent=2)
        print(f"[*] Adjacency list di-export ke: {args.export_adjacency}")

    # --- List routers ---
    if args.list_routers:
        print(f"\n{'═'*96}")
        print(f"{'DAFTAR ROUTER DALAM ISIS TOPOLOGY':^96}")
        print(f"{'═'*96}")
        print(f"{'No.':<5} {'Hostname':<22} {'System ID':<22} {'Prefix-SID':<12} {'Router IPs'}")
        print(f"{'-'*5} {'-'*22} {'-'*22} {'-'*12} {'-'*30}")
        idx = 1
        for sysid in sorted(topo.nodes):
            node = topo.nodes[sysid]
            if node.is_pseudonode and not args.include_pseudonode:
                continue
            ips = ', '.join(node.router_ips) if node.router_ips else '-'
            pn_marker = ' [PN]' if node.is_pseudonode else ''
            sid_str = str(node.prefix_sid) if node.prefix_sid is not None else '-'
            print(f"{idx:<5} {(node.hostname or '-') + pn_marker:<22} {sysid:<22} {sid_str:<12} {ips}")
            idx += 1

    # --- Path finding ---
    if not (args.src and args.dst):
        if not (args.list_routers or args.export_json or args.export_adjacency):
            print("\n[i] Gunakan --src dan --dst untuk mencari path, atau --list-routers")
        return

    print(f"\n[*] Mencari {args.k_paths} path terpendek: {args.src} → {args.dst}")
    print(f"[*] Weight: {args.weight}")

    try:
        paths = topo.k_shortest_paths(args.src, args.dst, k=args.k_paths, weight=args.weight)
    except ValueError as e:
        print(f"[!] Error: {e}")
        sys.exit(1)

    if not paths:
        print(f"[!] Tidak ada path ditemukan antara '{args.src}' dan '{args.dst}'")
        sys.exit(1)

    print(f"[*] Ditemukan {len(paths)} path\n")

    if args.output_json:
        # Output JSON format
        result = []
        for i, path in enumerate(paths, 1):
            ero_hops = topo.get_ero(path)
            ero_list = topo.build_ero_list(ero_hops)
            result.append({
                'path_index': i,
                'total_metric': topo.path_cost(path, args.weight),
                'hop_count': len([p for p in path if not topo.nodes.get(p, ISISNode('')).is_pseudonode]),
                'path': [topo.nodes[p].hostname or p for p in path
                         if not topo.nodes.get(p, ISISNode('')).is_pseudonode],
                'ero': ero_list,
                'hops': ero_hops,
            })
        print(json.dumps(result, indent=2))
    else:
        # Human-readable output
        for i, path in enumerate(paths, 1):
            print(topo.format_path_report(path, path_num=i, weight=args.weight))

        # Summary table
        print(f"\n{'═'*80}")
        print(f"{'RINGKASAN':^80}")
        print(f"{'═'*80}")
        print(f"{'#':<5} {'Metric':<10} {'Hops':<6} {'Route'}")
        print(f"{'-'*5} {'-'*10} {'-'*6} {'-'*56}")
        for i, path in enumerate(paths, 1):
            real = [p for p in path if not topo.nodes.get(p, ISISNode('')).is_pseudonode]
            cost = topo.path_cost(path, args.weight)
            route = ' → '.join(topo.nodes[p].hostname or p for p in real)
            print(f"{i:<5} {cost:<10} {len(real):<6} {route}")


if __name__ == '__main__':
    main()