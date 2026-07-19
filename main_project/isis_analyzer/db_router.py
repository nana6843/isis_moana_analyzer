
# isis/db_router.py
# Taruh file ini di: <app_isis>/db_router.py
 
class PrimbonRouter:
    """
    Mengarahkan model dengan db_table 'app1_ip_add_wan' ke database 'primbon2'.
    Model lain tetap menggunakan 'default'.
    """
    PRIMBON_TABLES = {'app1_ip_add_wan'}
 
    def db_for_read(self, model, **hints):
        if model._meta.db_table in self.PRIMBON_TABLES:
            return 'primbon2'
        return None
 
    def db_for_write(self, model, **hints):
        if model._meta.db_table in self.PRIMBON_TABLES:
            return 'primbon2'
        return None
 
    def allow_relation(self, obj1, obj2, **hints):
        # Izinkan relasi antar model dalam DB yang sama
        db_set = {self.db_for_read(obj1.__class__), self.db_for_read(obj2.__class__)}
        if None in db_set:
            db_set.discard(None)
        if len(db_set) <= 1:
            return True
        return False
 
    def allow_migrate(self, db, app_label, model_name=None, **hints):
        # Jangan migrate model primbon ke DB manapun (table sudah ada)
        if model_name == 'ipaddwan':
            return False
        return None