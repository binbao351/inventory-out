import http.server
import socketserver
import json
import os
import urllib.request
import urllib.parse
import openpyxl

PORT = 8000
EXCEL_FILE = os.path.join(os.path.dirname(__file__), "Item.xlsx")
GSHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1HLWmcgSAMUEWc1n_SdLYH3etzRqPj8g_5ipO7Oqg5EI/export?format=csv&gid=424403728"
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "export_history.json")

def load_items_from_excel():
    if not os.path.exists(EXCEL_FILE):
        return []
    try:
        wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
        sheet = wb.active
        rows = list(sheet.iter_rows(values_only=True))
        
        items = []
        for idx, r in enumerate(rows[5:], start=6):
            if not r or len(r) < 6: continue
            kho, ma, ten, mo_ta, dvt, qty = r[0], r[1], r[2], r[3], r[4], r[5]
            nguon_goc = r[6] if len(r) > 6 else ''
            min_qty = r[7] if len(r) > 7 else ''
            
            if ma or ten:
                items.append({
                    'id': str(ma or f'ITEM_{idx}'),
                    'sku': str(ma or ''),
                    'name': str(ten or ''),
                    'warehouse': str(kho or 'KHO TỔNG'),
                    'location': str(mo_ta or ''),
                    'unit': str(dvt or 'Cái'),
                    'stock': int(qty) if isinstance(qty, (int, float)) else 0,
                    'supplier': str(nguon_goc or ''),
                    'min_stock': int(min_qty) if isinstance(min_qty, (int, float)) else 0
                })
        return items
    except Exception as e:
        print("Error reading Excel:", e)
        return []

class InventoryHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/items":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            items = load_items_from_excel()
            self.wfile.write(json.dumps(items, ensure_ascii=False).encode('utf-8'))
            return
            
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/export":
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len).decode('utf-8')
            try:
                data = json.loads(body)
                
                # Append to local history
                history = []
                if os.path.exists(HISTORY_FILE):
                    try:
                        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                            history = json.load(f)
                    except: pass
                
                history.append(data)
                with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                    json.dump(history, f, ensure_ascii=False, indent=2)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Ghi nhận xuất kho thành công"}).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
                return

if __name__ == "__main__":
    os.chdir(os.path.dirname(__file__))
    print(f"=== Warehouse Export Web Server running on http://localhost:{PORT} ===")
    with socketserver.TCPServer(("", PORT), InventoryHandler) as httpd:
        httpd.serve_forever()
