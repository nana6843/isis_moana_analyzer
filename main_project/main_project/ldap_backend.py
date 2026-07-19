# main_project/main_project/ldap_backend.py
# Custom Django authentication backend via LDAP (Active Directory)
#
# Flow:
#   1. Bind dengan service account (LDAP_BIND_DN)
#   2. Cari user berdasarkan sAMAccountName = username
#   3. Bind ulang pakai DN user + password → verifikasi credentials
#   4. Get-or-create Django User, update info dari LDAP
#   5. Return User → SimpleJWT lanjut issue token

import logging
from django.contrib.auth import get_user_model
from django.conf import settings
from ldap3 import Server, Connection, ALL, SUBTREE

logger = logging.getLogger(__name__)
User   = get_user_model()


class LDAPBackend:
    """
    Autentikasi via Active Directory LDAP.
    Tambahkan ke AUTHENTICATION_BACKENDS di settings.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None

        cfg = getattr(settings, 'LDAP_CONFIG', {})
        server_host   = cfg.get('SERVER',        'localhost')
        server_port   = cfg.get('PORT',          389)
        bind_dn       = cfg.get('BIND_DN',       '')
        bind_password = cfg.get('BIND_PASSWORD', '')
        base_dn       = cfg.get('BASE_DN',       '')

        # DEBUG — hapus setelah selesai testing
        print(f"[LDAP DEBUG] server={server_host}, bind_dn={bind_dn[:30] if bind_dn else 'EMPTY'}, base_dn={base_dn}")

        try:
            server = Server(server_host, port=server_port, get_info=ALL)

            # Step 1: bind service account
            svc = Connection(server, user=bind_dn, password=bind_password, auto_bind=False)
            bind_ok = svc.bind()
            print(f"[LDAP DEBUG] bind result: {bind_ok}, result: {svc.result}")
            if not bind_ok:
                logger.error("LDAP service account bind failed: %s", svc.result)
                return None

            # Step 2: cari user
            search_ok = svc.search(
                search_base=base_dn,
                search_filter=f"(sAMAccountName={username})",
                search_scope=SUBTREE,
                attributes=["cn", "mail", "sAMAccountName",
                            "givenName", "sn", "distinguishedName",
                            "userAccountControl"],
            )
            print(f"[LDAP DEBUG] search result: {search_ok}, entries: {len(svc.entries)}, result: {svc.result}")
            svc.unbind()

            if not svc.entries:
                logger.warning("LDAP: user '%s' tidak ditemukan", username)
                return None

            entry   = svc.entries[0]
            user_dn = entry.distinguishedName.value
            uac     = int(entry.userAccountControl.value) if entry.userAccountControl else 0

            # Cek akun disabled (bit 2 dari userAccountControl)
            if uac & 2:
                logger.warning("LDAP: akun '%s' dinonaktifkan", username)
                return None

            # Step 3: bind sebagai user → verifikasi password
            user_conn = Connection(server, user=user_dn, password=password, auto_bind=False)
            if not user_conn.bind():
                logger.warning("LDAP: password salah untuk '%s': %s", username, user_conn.result)
                return None
            user_conn.unbind()

            # Step 4: get-or-create Django user
            email      = entry.mail.value      if entry.mail      else f"{username}@{server_host}"
            first_name = entry.givenName.value  if entry.givenName  else ''
            last_name  = entry.sn.value         if entry.sn         else ''
            cn         = entry.cn.value         if entry.cn         else username

            # Jika givenName / sn kosong, coba parse dari CN
            if not first_name and not last_name and cn:
                parts      = cn.split(' ', 1)
                first_name = parts[0]
                last_name  = parts[1] if len(parts) > 1 else ''

            django_user, created = User.objects.get_or_create(username=username)
            django_user.email      = email
            django_user.first_name = first_name
            django_user.last_name  = last_name
            # Password Django tidak dipakai (auth via LDAP), set unusable agar aman
            if created or not django_user.has_usable_password():
                django_user.set_unusable_password()
            django_user.save()

            logger.info("LDAP: login %s '%s' (%s)", "baru" if created else "existing", username, cn)
            return django_user

        except Exception as e:
            logger.exception("LDAP authenticate error untuk '%s': %s", username, e)
            return None

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None