# isis_analyzer/management/commands/import_lsdb.py
#
# Jalankan dengan:
#   python manage.py import_lsdb
#   python manage.py import_lsdb --file /path/to/lsdb.txt
#
# Script rutin bisa jalankan command ini setiap kali file LSDB diperbarui.

from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import transaction
from isis_analyzer.models import ISISRouter, ISISLink
from isis_analyzer.management.commands.isis_path_finder import (
    CiscoISISParser, HuaweiISISParser,
    ISISTopology, detect_vendor
)
import os


class Command(BaseCommand):
    help = 'Parse file ISIS LSDB dan simpan ke database'

    def add_arguments(self, parser):
        parser.add_argument(
            '--file', '-f',
            default=None,
            help='Path file LSDB (default: settings.ISIS_LSDB_FILE)'
        )

    def handle(self, *args, **options):
        filepath = options['file'] or getattr(settings, 'ISIS_LSDB_FILE', None)
        if not filepath:
            self.stderr.write('[!] Set ISIS_LSDB_FILE di settings.py atau gunakan --file')
            return

        if not os.path.exists(filepath):
            self.stderr.write(f'[!] File tidak ditemukan: {filepath}')
            return

        self.stdout.write(f'[*] Membaca file: {filepath}')
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()

        vendor = detect_vendor(text)
        self.stdout.write(f'[*] Vendor: {vendor.upper()}')

        if vendor == 'cisco':
            nodes = CiscoISISParser().parse(text)
        else:
            nodes = HuaweiISISParser().parse(text)

        self.stdout.write(f'[*] Parsed {len(nodes)} LSP entries')

        topo = ISISTopology()
        topo.load(nodes)
        self.stdout.write(f'[*] Topology: {topo.summary()}')

        # Simpan ke DB dalam satu transaksi
        with transaction.atomic():
            # Hapus data lama
            ISISLink.objects.all().delete()
            ISISRouter.objects.all().delete()
            self.stdout.write('[*] Data lama dihapus')

            # Simpan routers
            router_map = {}  # system_id -> ISISRouter instance
            for sysid, node in topo.nodes.items():
                r = ISISRouter.objects.create(
                    hostname=node.hostname or sysid,
                    system_id=sysid,
                    router_ips=node.router_ips,
                    prefixes=node.prefixes,
                    prefix_sid=node.prefix_sid,
                    prefix_sid_ip=node.prefix_sid_ip or '',
                    is_pseudonode=node.is_pseudonode,
                )
                router_map[sysid] = r

            self.stdout.write(f'[+] {len(router_map)} router disimpan')

            # Simpan links
            link_count = 0
            seen = set()
            for u, v, data in topo.graph.edges(data=True):
                key = tuple(sorted([u, v]))
                if key in seen:
                    continue
                seen.add(key)

                r_a = router_map.get(u)
                r_b = router_map.get(v)
                if not r_a or not r_b:
                    continue

                # ip_a = IP pada sisi u, ip_b = IP pada sisi v
                ip_a = data.get('ip_a') or ''
                ip_b = data.get('ip_b') or ''
                if data.get('node_a') != u:
                    ip_a, ip_b = ip_b, ip_a

                ISISLink.objects.create(
                    node_a=r_a,
                    node_b=r_b,
                    metric=data.get('metric', 10),
                    te_metric=data.get('te_metric'),
                    ip_a=ip_a,
                    ip_b=ip_b,
                )
                link_count += 1

            self.stdout.write(f'[+] {link_count} link disimpan')

        self.stdout.write(self.style.SUCCESS('[✓] Import selesai!'))