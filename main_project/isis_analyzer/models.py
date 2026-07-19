import re
from django.db import models


class ISISRouter(models.Model):
    hostname    = models.CharField(max_length=100, db_index=True)
    system_id   = models.CharField(max_length=60, unique=True)
    router_ips  = models.JSONField(default=list)
    prefixes    = models.JSONField(default=list)
    prefix_sid  = models.IntegerField(null=True, blank=True)
    prefix_sid_ip = models.CharField(max_length=50, blank=True)
    is_pseudonode = models.BooleanField(default=False)
    level       = models.IntegerField(default=2)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['hostname']

    def __str__(self):
        return self.hostname or self.system_id


class ISISLink(models.Model):
    node_a    = models.ForeignKey(ISISRouter, on_delete=models.CASCADE, related_name='links_as_a')
    node_b    = models.ForeignKey(ISISRouter, on_delete=models.CASCADE, related_name='links_as_b')
    metric    = models.IntegerField(default=10)
    te_metric = models.IntegerField(null=True, blank=True)
    ip_a      = models.CharField(max_length=50, blank=True)   # IP sisi node_a
    ip_b      = models.CharField(max_length=50, blank=True)   # IP sisi node_b

    class Meta:
        unique_together = ('node_a', 'node_b')

    def __str__(self):
        return f"{self.node_a.hostname} <-> {self.node_b.hostname} [{self.metric}]"






def extract_capacity(intf, description):
    """
    Ekstrak kapasitas port dari nama interface atau description.
    Priority: description (lebih spesifik) > interface name
    """
    # Cek description dulu karena lebih eksplisit (e.g. "1600G", "800G")
    if description:
        for cap in ['1600G', '800G', '400G', '100G', '40G', '25G', '10G', '1G', '2G', '20G','30G', '40G', '50G' ]:
            if re.search(r'(?<!\d)' + re.escape(cap) + r'(?!\d)', description, re.I):
                return cap
 
    # Fallback ke nama interface
    # if intf:
    #     u = intf.upper()
    #     if '400GE' in u or 'FOURHUNDREDGIGE' in u or 'FOURHUNDREDGE' in u:
    #         return '400G'
    #     if '100GE' in u or 'HUNDREDGIGE' in u:
    #         return '100G'
    #     if '40GE' in u or 'FORTYGIGE' in u:
    #         return '40G'
    #     if '25GE' in u:
    #         return '25G'
    #     if '10GE' in u or 'TENGIGE' in u:
    #         return '10G'
    #     if 'GIGABITETHERNET' in u or u.startswith('GI'):
    #         return '1G'
 
    return None
 
 
def normalize_ip(ip_str):
    """Hapus subnet mask jika ada (/30, /31, dll)"""
    if ip_str and '/' in ip_str:
        return ip_str.split('/')[0].strip()
    return (ip_str or '').strip()
 
 
class IpAddWan(models.Model):
    """
    Model read-only untuk tabel app1_ip_add_wan di database primbon2.
    Tabel tidak di-manage oleh Django (sudah ada di primbon2).
    """
    hostname    = models.CharField(max_length=100)
    ip          = models.CharField(max_length=50)   # bisa "x.x.x.x" atau "x.x.x.x/30"
    tipe        = models.CharField(max_length=20, blank=True, null=True)
    intf        = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    cost        = models.IntegerField(blank=True, null=True)
    created_at  = models.DateTimeField(auto_now_add=False, blank=True, null=True)
    node_type   = models.CharField(max_length=20, blank=True, null=True)
 
    class Meta:
        db_table = 'app1_ip_add_wan'
        managed  = False          # Django tidak buat/hapus tabel ini
        app_label = 'isis_analyzer'
 
    def __str__(self):
        return f'{self.hostname} — {self.ip} ({self.intf})'
 
    @property
    def ip_clean(self):
        return normalize_ip(self.ip)
 
    @property
    def capacity(self):
        return extract_capacity(self.intf, self.description)