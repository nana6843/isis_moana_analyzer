from netmiko import ConnectHandler
from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException
import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

def get_huawei_isis_lsdb(ip, username, password, output_filename="isis_lsdb_output.txt"):
    """
    Fungsi untuk SSH ke router Huawei, mengambil output 'dis isis lsdb verbose',
    dan menyimpannya ke dalam file .txt (selalu diperbarui/overwrite).
    """
    
    # Konfigurasi device untuk Huawei VRP
    huawei_device = {
        'device_type': 'huawei',
        'ip': ip,
        'username': username,
        'password': password,
        'port': 22,          # Port default SSH
        'secret': '',        # Isi jika butuh password super/enable
    }
    
    print(f"[*] Menghubungkan ke router {ip}...")
    
    try:
        # 1. Melakukan koneksi SSH
        net_connect = ConnectHandler(**huawei_device)
        
        # Masuk ke mode system-view jika diperlukan (opsional, tergantung hak akses user)
        # net_connect.enable() 
        
        print("[*] Mengatur screen-length...")
        # 2. Eksekusi command screen-length agar output tidak terpotong (tanpa--More--)
        net_connect.send_command("screen-length 0 temporary")
        
        print("[*] Mengambil data ISIS LSDB verbose (proses ini mungkin memakan waktu)...")
        # 3. Eksekusi command utama untuk mengambil LSDB
        # read_timeout diperbesar ke 90 detik karena output LSDB verbose biasanya sangat panjang
        output = net_connect.send_command("display isis lsdb verbose", read_timeout=90)
        
        # 4. Memutuskan koneksi SSH
        net_connect.disconnect()
        print("[*] Koneksi SSH ditutup.")
        
        # 5. Menyimpan output ke file .txt dengan mode 'w' (write/overwrite)
        # Mode 'w' otomatis menghapus isi file lama dan memperbaharuinya dengan yang baru
        with open(output_filename, "w", encoding="utf-8") as file:
            file.write(output)
            
        print(f"[✓] Berhasil! Output telah diperbarui dan disimpan di: {output_filename}")
        return True

    except NetmikoTimeoutException:
        print(f"[✗] Error: Gagal terhubung ke {ip}. Waktu koneksi habis (Timeout).")
    except NetmikoAuthenticationException:
        print(f"[✗] Error: Autentikasi gagal. Periksa kembali username/password untuk {ip}.")
    except Exception as e:
        print(f"[✗] Terjadi kesalahan yang tidak terduga: {e}")
        
    return False

# ==============================================================================
# CONTOH PENGGUNAAN FUNGSI
# ==============================================================================
if __name__ == "__main__":
    # Ubah sesuai dengan detail perangkat Anda
    ROUTER_IP = "10.66.180.0"
    USER = "bt-mngd"
    PASSWORD = "!@#$%^&*"
    FILE_NAME = "lsdb.txt"
    ISIS_LSDB_FILE = os.path.join(BASE_DIR, "isis_analyzer", "management", "commands", FILE_NAME)
    
    # Jalankan fungsi
    get_huawei_isis_lsdb(
        ip=ROUTER_IP, 
        username=USER, 
        password=PASSWORD, 
        output_filename=ISIS_LSDB_FILE
    )