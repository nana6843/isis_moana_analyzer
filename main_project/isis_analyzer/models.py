from django.db import models

# Create your models here.
# isis_analyzer/models.py

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