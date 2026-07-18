# Moana — Network Management App

Django + React (Vite) web app dengan fitur ISIS Analyzer untuk visualisasi topologi jaringan.

## Arsitektur

```
Browser
  ↓ https://<IP>:8080
Apache (host, port 8080) — SSL termination
  ↓ http://127.0.0.1:8888
Nginx (Docker) — serve React static + proxy /api
  ↓
Django + Gunicorn (Docker, port 8000)
  ↓
MySQL (external)
```

## Struktur Project

```
django-react/
├── docker-compose.yml
├── Dockerfile.backend        # Django + Gunicorn
├── Dockerfile.nginx          # React build + Nginx
├── entrypoint.sh             # collectstatic → migrate → gunicorn
├── .env.example              # Template environment variables
├── .gitignore
├── nginx/
│   └── nginx.conf
└── main_project/             # Django project root
    ├── manage.py
    ├── requirements.txt
    └── main_project/
        ├── settings.py           # Development settings
        ├── settings_production.py # Production settings
        ├── urls.py
        └── wsgi.py
    └── frontend/             # React + Vite
        ├── package.json
        └── src/
```

---

## Instalasi dari Awal

### Prasyarat

- Ubuntu 22.04+
- Docker & Docker Compose
- Apache2
- MySQL (bisa di server lain)

### 1. Clone Repository

```bash
git clone https://github.com/username/moana.git
cd moana
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
nano .env
```

Isi semua nilai yang diperlukan:

```env
SECRET_KEY=random-string-panjang-minimal-50-karakter
DEBUG=False
ALLOWED_HOSTS=*
DJANGO_SETTINGS_MODULE=main_project.settings_production

DB_NAME=nama_database
DB_USER=username_mysql
DB_PASSWORD=password_mysql
DB_HOST=ip_mysql
DB_PORT=3306
```

> Generate SECRET_KEY: `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`

### 3. Setup SSL & Apache

```bash
# Install & aktifkan module Apache
sudo a2enmod ssl proxy proxy_http headers

# Generate self-signed SSL certificate
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/ssl/private/moana.key \
  -out /etc/ssl/certs/moana.crt \
  -subj "/CN=<IP_SERVER>" \
  -addext "subjectAltName=IP:<IP_SERVER>"

# Deploy Apache config
sudo cp apache-moana.conf /etc/apache2/sites-available/moana.conf

# Edit ServerName sesuai IP server
sudo nano /etc/apache2/sites-available/moana.conf

# Aktifkan dan reload
sudo a2ensite moana.conf
sudo systemctl reload apache2
```

### 4. Build & Jalankan Docker

```bash
sudo docker compose up -d --build
```

Proses ini akan:
- Build image Django (install Python deps)
- Build image Nginx (build React, copy ke Nginx)
- Jalankan `collectstatic` dan `migrate` otomatis
- Start Gunicorn

### 5. Buat Superuser Django

```bash
sudo docker compose exec django python manage.py createsuperuser \
  --settings=main_project.settings_production
```

### 6. Pastikan Docker Auto-start saat Reboot

```bash
sudo systemctl enable docker
```

### 7. Akses Aplikasi

| URL | Keterangan |
|-----|------------|
| `https://<IP>:8080/` | Aplikasi utama (React) |
| `https://<IP>:8080/admin/` | Django Admin |
| `https://<IP>:8080/api/` | REST API |

> Browser akan tampilkan warning SSL karena self-signed cert. Klik **Advanced → Proceed**.

---

## Cara Update / Perubahan Code

### Perubahan React (frontend)

Edit file di `main_project/frontend/src/`, lalu:

```bash
sudo docker compose up -d --build nginx
```

### Perubahan Django (backend)

Edit file di `main_project/` (views, urls, dll), lalu:

```bash
sudo docker compose up -d --build django
```

### Perubahan Django + tambah Model baru

```bash
# Buat migration dulu
python manage.py makemigrations

# Rebuild — migrate jalan otomatis
sudo docker compose up -d --build django
```

### Perubahan keduanya sekaligus

```bash
sudo docker compose up -d --build
```

### Hanya ubah config (.env atau settings)

```bash
# Edit .env atau settings_production.py, lalu:
sudo docker compose restart django
```

---

## Perintah Docker Berguna

```bash
# Cek status container
sudo docker compose ps

# Lihat log Django
sudo docker compose logs django --tail=50

# Lihat log Nginx
sudo docker compose logs nginx --tail=50

# Masuk ke dalam container Django
sudo docker compose exec django bash

# Stop semua container
sudo docker compose stop

# Start ulang semua container
sudo docker compose start

# Rebuild dari nol (hapus cache)
sudo docker compose build --no-cache
sudo docker compose up -d
```

---

## Troubleshooting

**502 Bad Gateway**
```bash
# Django container crash — cek log
sudo docker compose logs django --tail=30
sudo docker compose ps
```

**CSRF Error di Admin**
Pastikan `CSRF_TRUSTED_ORIGINS` di `settings_production.py` sesuai IP dan port server:
```python
CSRF_TRUSTED_ORIGINS = ['https://<IP>:8080']
```

**Static files tidak muncul**
```bash
sudo docker compose exec django python manage.py collectstatic \
  --settings=main_project.settings_production --noinput
```

**Database connection error**
Cek `.env` — pastikan `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` benar.
