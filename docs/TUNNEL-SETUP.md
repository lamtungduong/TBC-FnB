# Cloudflare Tunnel + Vercel — Hướng dẫn thực tế

App TBC-FnB chạy ở **hai nơi**:

- **(A) LAN:** Trên VM (vd. qua Portainer), truy cập: `http://tbc.fnb/admin` hoặc `http://IP:3000/admin`.
- **(B) Vercel:** `https://tbc-fnb.vercel.app/admin`.

Khi user mở **(B)** từ trình duyệt, app tự kiểm tra: nếu **tunnel** tới (A) đang bật và reachable thì **mọi API và ảnh** sẽ gọi qua tunnel (nhanh, dùng data LAN), **URL thanh địa chỉ vẫn là Vercel**. Nếu tunnel tắt hoặc không tới được thì API gọi về chính Vercel (same-origin).

---

## 1. Chuẩn bị Cloudflare Tunnel

1. Vào **Cloudflare Zero Trust** (hoặc Cloudflare Dashboard) → **Networks** → **Tunnels**.
2. Tạo tunnel mới (vd. tên `tbc`), chọn **Cloudflared** → lấy **Token**.
3. Trên **Portainer (VM chạy app hoặc VM riêng):**
   - Tạo stack mới (vd. từ [Cloudflare Tunnel template](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
   - Dán token, deploy. Container **cloudflared** chạy và kết nối về Cloudflare.

---

## 2. Cấu hình Published application route (URL public + Origin)

1. Vào **Cloudflare Zero Trust** → **Networks** → **Tunnels** → chọn tunnel `tbc`.
2. Mở tab **Published application routes**.
3. Bấm **+ Add a published application route**.
4. Điền:
   - **Domain:** domain bạn đã add vào Cloudflare (vd. `123zo.uk`).
   - **Subdomain:** vd. `tbc-fnb` → URL public sẽ là `https://tbc-fnb.123zo.uk`.
   - **Path:** để `*` (tất cả đường dẫn).
   - **Service (Origin):** **HTTP**, URL phải trỏ tới **máy + cổng** nơi app TBC-FnB đang lắng nghe.

### Origin khi cloudflared chạy trong Docker (Portainer)

Cloudflared chạy **trong container**, nên `localhost` trong container = chính container, **không** phải máy chạy app. **Không dùng** `http://localhost:3000`.

- Dùng **IP của máy chạy app TBC-FnB** (cùng LAN với máy chạy cloudflared):  
  `http://10.10.1.10:3000` (thay đúng IP và port của bạn).
- Nếu app và cloudflared cùng một máy: dùng IP của máy đó, vd. `http://10.10.1.10:3000`.
- App phải listen `0.0.0.0:3000` (hoặc bind port 3000 ra host) để cloudflared gọi tới được.

5. Lưu. Sẽ có thêm dòng **Catch-all rule: http_status:404** — đó là rule mặc định cho request không khớp hostname nào; **không ảnh hưởng** tới hostname bạn vừa thêm, không cần tắt.

---

## 3. Cấu hình Vercel

1. **Vercel** → Project TBC-FnB → **Settings** → **Environment Variables**.
2. Thêm:
   - **Name:** `NUXT_PUBLIC_TUNNEL_ORIGIN`
   - **Value:** URL public tunnel, **không** có `/` cuối (vd. `https://tbc-fnb.123zo.uk`).
   - Áp dụng: Production (và Preview nếu muốn).
3. **Redeploy** để env có hiệu lực.

Bản chạy trên LAN (tbc.fnb hoặc IP:3000) **không cần** biến này; chỉ bản frontend trên Vercel mới dùng để biết gọi API qua tunnel khi tunnel reachable.

---

## 4. CORS

App đã có middleware CORS (`src/server/middleware/0.cors.ts`) cho origin `https://tbc-fnb.vercel.app`. Không cần cấu hình thêm CORS trên Cloudflare Tunnel.

---

## 5. Kiểm tra khi chạy đúng

1. Tunnel (container cloudflared) đang chạy trên Portainer.
2. App TBC-FnB đang chạy và listen đúng port (vd. 3000) trên IP đã cấu hình trong Published application route.
3. Mở **https://tbc-fnb.vercel.app/admin** (hoặc trang chủ).
4. F12 → **Network**: request tới `/api/data/products`, `/api/data/sales`, `/api/data/imports`, … phải có **Request URL** = `https://tbc-fnb.123zo.uk/api/...` và **Status 200**. Thanh địa chỉ trình duyệt vẫn là `tbc-fnb.vercel.app`.

Nếu tunnel tắt hoặc không tới được, app vẫn chạy nhưng API sẽ gọi về Vercel (same-origin).

---

## 6. Xử lý lỗi thường gặp

### 502 / "Unable to reach the origin service" — log cloudflared: `connection refused` với `localhost:3000`

**Nguyên nhân:** Service (Origin) đang để `http://localhost:3000`. Trong container, localhost không phải máy chạy app.

**Cách sửa:** Trong **Published application routes** → Edit route của `tbc-fnb.123zo.uk` → đổi **Service** thành `http://<IP-máy-chạy-app>:3000` (vd. `http://192.168.10.201:3000`). Lưu, đợi vài giây rồi thử lại.

---

### Root 200 nhưng /api/data/... trả 502 hoặc CORS error

502 từ gateway thường không kèm CORS header nên trình duyệt có thể báo **CORS error**.

**Cần kiểm tra:**

1. **Origin trả 200 cho /api:** Từ máy có thể truy cập IP origin (vd. trong LAN), chạy:
   ```bash
   curl -i http://<IP-origin>:3000/api/data/products
   ```
   Nếu không 200 hoặc không kết nối được → app chưa chạy đúng hoặc sai IP/port; sửa app hoặc sửa Service trong Published application route cho đúng IP/port.

2. **Log cloudflared:** Khi F12 báo 502, xem log container cloudflared trong Portainer. Nếu có `Unable to reach the origin service` hoặc `connection refused` / `timeout` → cloudflared không tới được origin (sai IP, firewall, app tắt).

3. **Catch-all http_status:404:** Giữ nguyên; không ảnh hưởng tới hostname đã cấu hình.

---

## Tóm tắt luồng

| Bạn truy cập              | API / ảnh gửi tới        | Ghi chú                          |
|---------------------------|--------------------------|-----------------------------------|
| `tbc.fnb/admin` (LAN)     | `http://tbc.fnb/api/...` | Same-origin, không qua tunnel    |
| `tbc-fnb.vercel.app/admin`| `https://tbc-fnb.123zo.uk/api/...` | Qua tunnel khi tunnel reachable |
| `tbc-fnb.vercel.app/admin`| `https://tbc-fnb.vercel.app/api/...`      | Fallback khi tunnel không dùng được |
