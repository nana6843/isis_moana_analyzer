# Panduan Deploy ke Server Baru

## Prasyarat

Pastikan server sudah terinstall:
- Ubuntu 22.04+
- Docker & Docker Compose
- Apache2
- Akses ke MySQL server

---

## Step 1 — Install Docker

```bash
# Update package list
sudo apt update

# Install dependencies
sudo apt install -y ca-certificates curl gnupg

# Tambahkan Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Tambahkan Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Aktifkan Docker auto-start saat reboot
sudo systemctl enable docker
sudo systemctl start docker

# Verifikasi
sudo docker --version
sudo docker compose version
```

---

## Step 2 — Install Apache2

```bash
sudo apt install -y apache2

# Aktifkan module yang diperlukan
sudo a2enmod ssl proxy proxy_http headers

sudo systemctl enable apache2
sudo systemctl start apache2
```

---

## Step 3 — Clone Repository

```bash
cd ~
git clone https://github.com/nana6843/isis_moana_analyzer.git
cd isis_moana_analyzer
```

Kalau repo Private, akan diminta username & token:
```
Username: nana6843
Password: <Personal Access Token dari github.com/settings/tokens>
```

---

## Step 4 — Setup Environment Variables

```bash
cp .env.example .env
nano .env
```

Isi semua nilai:

```env
SECRET_KEY=          # generate: python3 -c "import secrets; print(secrets.token_urlsafe(50))"
DEBUG=False
ALLOWED_HOSTS=*
DJANGO_SETTINGS_MODULE=main_project.settings_production

DB_NAME=             # nama database MySQL
DB_USER=             # username MySQL
DB_PASSWORD=         # password MySQL
DB_HOST=             # IP atau hostname MySQL server
DB_PORT=3306
```

---

## Step 5 — Setup SSL Certificate

```bash
# Ganti <IP_SERVER> dengan IP server baru
IP_SERVER=$(curl -s ifconfig.me)   # atau isi manual

sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/ssl/private/moana.key \
  -out /etc/ssl/certs/moana.crt \
  -subj "/CN=$IP_SERVER" \
  -addext "subjectAltName=IP:$IP_SERVER"
```

---

## Step 6 — Setup Apache

```bash
# Copy config Apache
sudo cp apache-moana.conf /etc/apache2/sites-available/moana.conf

# Edit ServerName sesuai IP server baru
sudo sed -i "s/123.231.138.58/$IP_SERVER/" /etc/apache2/sites-available/moana.conf

# Cek port 8080 sudah ada di ports.conf
grep "8080" /etc/apache2/ports.conf || echo "Listen 8080" | sudo tee -a /etc/apache2/ports.conf

# Aktifkan site
sudo a2ensite moana.conf
sudo systemctl reload apache2
```

---

## Step 7 — Update settings_production.py

```bash
# Tambahkan IP server baru ke CSRF_TRUSTED_ORIGINS
nano main_project/main_project/settings_production.py
```

Cari dan update baris ini:
```python
CSRF_TRUSTED_ORIGINS = ['https://<IP_SERVER_BARU>:8080']
```

---

## Step 8 — Build & Jalankan Docker

```bash
sudo docker compose up -d --build
```

Tunggu hingga selesai (5-10 menit pertama kali karena download image).

Cek status:
```bash
sudo docker compose ps
sudo docker compose logs django --tail=20
```

Harusnya muncul:
```
django-1  | === Starting Gunicorn ===
django-1  | Listening at: http://0.0.0.0:8000
```

---

## Step 9 — Buat Superuser

```bash
sudo docker compose exec django python manage.py createsuperuser \
  --settings=main_project.settings_production
```

---

## Step 10 — Akses Aplikasi

| URL | Keterangan |
|-----|------------|
| `https://<IP_SERVER>:8080/` | Aplikasi utama |
| `https://<IP_SERVER>:8080/admin/` | Django Admin |

> Saat pertama buka di browser, klik **Advanced → Proceed** untuk bypass SSL warning (karena self-signed cert).

---

## Troubleshooting

**Docker compose gagal build**
```bash
sudo docker compose build --no-cache
sudo docker compose up -d
```

**502 Bad Gateway**
```bash
sudo docker compose logs django --tail=30
```

**403 CSRF Error di Admin**
Pastikan `CSRF_TRUSTED_ORIGINS` di `settings_production.py` sudah menggunakan IP server yang benar, lalu rebuild:
```bash
sudo docker compose up -d --build django
```

**Cek semua container berjalan**
```bash
sudo docker compose ps
# Harusnya django dan nginx STATUS = Up
```
