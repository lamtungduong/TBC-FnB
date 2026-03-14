# Cấu hình Cloudflare Tunnel + Vercel (chuyển hướng API)

Khi user mở **https://tbc-fnb.vercel.app** (B), nếu tunnel tới server LAN (A) đang chạy và cấu hình đúng, mọi API và ảnh sẽ gọi qua tunnel — URL trình duyệt vẫn là Vercel.

## 1. Cloudflare Tunnel (bạn đã làm)

- Tạo tunnel (vd. tên `tbc`), lấy token.
- Add stack Cloudflare Tunnel trên Portainer (VM 100), nhập token.

## 2. Lấy URL public của tunnel

- Vào **Cloudflare Zero Trust Dashboard** → **Networks** → **Tunnels** → chọn tunnel `tbc`.
- Trong **Published application routes** (hoặc mục cấu hình route tương đương), cấu hình:
  - **Subdomain / Domain:** ví dụ `tbc-fnb` + `duongtunglam.com` → URL public: `https://tbc-fnb.duongtunglam.com`.
  - **Service (Origin):** **HTTP**, URL **bắt buộc** phải trỏ tới nơi app TBC-FnB lắng nghe.

### Quan trọng: Origin khi cloudflared chạy trong Docker (Portainer)

Cloudflared chạy **trong container** nên `localhost` trong container = chính container, **không** phải máy host. Nếu bạn để Service = `http://localhost:3000` sẽ bị lỗi:

```text
Unable to reach the origin service ... dial tcp [::1]:3000: connect: connection refused
```

- **Cách sửa:** Đổi Service (Origin) thành địa chỉ **host** từ trong Docker:
  - Dùng **IP của VM 100** (máy chạy Portainer và app): `http://192.168.10.79:3000`
  - Hoặc nếu Docker hỗ trợ: `http://host.docker.internal:3000` (một số môi trường có sẵn).
- App TBC-FnB phải listen trên `0.0.0.0:3000` (hoặc bind port 3000 ra host) để container cloudflared gọi từ host IP được.

## 3. Cấu hình app

### Trên Vercel (build / runtime)

Trong **Vercel** → Project → **Settings** → **Environment Variables** thêm:

- **Name:** `NUXT_PUBLIC_TUNNEL_ORIGIN`
- **Value:** URL public tunnel (vd. `https://tbc-fnb-lan.xxx.com`) — **không** có dấu `/` cuối.
- Áp dụng cho: Production (và Preview nếu muốn).

Rồi **Redeploy** để biến có hiệu lực.

### Trên VM 100 (khi chạy app qua Portainer)

Nếu bạn build image và chạy container trên VM 100, **không cần** set `NUXT_PUBLIC_TUNNEL_ORIGIN` cho bản chạy trên LAN (truy cập qua `tbc.fnb` hoặc IP:3000). Biến này chỉ cần khi **frontend được serve từ Vercel** (để client biết gọi API qua tunnel).

## 4. CORS

Server LAN (app chạy trên VM 100) đã có middleware CORS (`src/server/middleware/0.cors.ts`) cho phép origin `https://tbc-fnb.vercel.app`. Không cần cấu hình thêm trên Cloudflare Tunnel cho CORS.

## 5. Kiểm tra

1. Deploy lại bản Vercel đã set `NUXT_PUBLIC_TUNNEL_ORIGIN`.
2. Đảm bảo tunnel trên Portainer đang chạy và public hostname trỏ đúng service (HTTP, port 3000).
3. Mở **https://tbc-fnb.vercel.app/admin** (hoặc trang chủ).
4. Mở DevTools → Network: request API và ảnh (vd. `/api/data/products`, `/api/blob-image?...`) phải gửi tới **URL tunnel** (origin của request = URL tunnel), còn thanh địa chỉ vẫn là `tbc-fnb.vercel.app`.

Nếu tunnel chưa chạy hoặc không reachable, app vẫn dùng API trên Vercel (same-origin).

---

## 6. Xử lý lỗi 502 / "Unable to reach the origin service"

**Triệu chứng:** Vercel load xong, nhưng API tới `https://tbc-fnb.duongtunglam.com/api/...` trả **502 Bad Gateway**. Log container cloudflared:

```text
Unable to reach the origin service ... originService=http://localhost:3000
dial tcp [::1]:3000: connect: connection refused
```

**Nguyên nhân:** Origin đang cấu hình là `http://localhost:3000`. Trong container, `localhost` là bên trong container, không phải host nên cloudflared không tới được app.

**Cách sửa:**

1. Vào **Cloudflare Zero Trust** → **Networks** → **Tunnels** → tunnel `tbc`.
2. Mở **Published application routes** → chọn route tương ứng (vd. `tbc-fnb.duongtunglam.com`) → **Edit** (hoặc nơi bạn sửa Service/Origin).
3. Đổi **Service / Origin URL** từ `http://localhost:3000` thành:
   - `http://192.168.10.79:3000` (thay bằng đúng IP của VM 100 nếu khác).
4. Lưu. Cloudflare áp dụng cấu hình xuống cloudflared; vài giây sau thử lại Vercel.

Sau khi đổi, request từ Vercel tới tunnel sẽ được cloudflared chuyển tiếp đúng tới app trên host và trả 200.

---

## 7. Root 200 nhưng /api/data/... vẫn 502 (hoặc CORS error)

**Triệu chứng:** Request tới `https://tbc-fnb.duongtunglam.com/` (root) trả **200**, nhưng `https://tbc-fnb.duongtunglam.com/api/data/products` (và sales, imports) trả **502** hoặc trình duyệt báo **CORS error**. (502 từ gateway thường không kèm CORS header nên browser có thể hiển thị là CORS error.)

**Catch-all rule `http_status:404`:** Đây là rule mặc định cho mọi request không khớp hostname nào — không ảnh hưởng tới `tbc-fnb.duongtunglam.com` vì request đã khớp rule đầu tiên. Không cần tắt.

**Cần kiểm tra:**

1. **Origin có thực sự trả 200 cho /api không**  
   Từ máy có thể truy cập được IP origin (vd. VM 100 hoặc máy trong cùng LAN), chạy:
   ```bash
   curl -i http://192.168.10.201:3000/api/data/products
   ```
   - Nếu **200** → app trên 192.168.10.201 đang chạy đúng; vấn đề nằm ở tunnel/Cloudflare (xem bước 2, 3).
   - Nếu **lỗi / không nối được** → app trên 192.168.10.201 chưa chạy hoặc không listen đúng port; cần khởi động app và đảm bảo listen `0.0.0.0:3000`.

2. **Log cloudflared lúc gửi request lỗi**  
   Khi bạn mở trang Vercel và gọi API (sao cho F12 báo 502/CORS), xem log container **cloudflared-tunnel** trong Portainer. Nếu có dòng lỗi kiểu `Unable to reach the origin service` hoặc `connection refused` / `timeout` cho `http://192.168.10.201:3000` → cloudflared không kết nối được tới origin (firewall, sai IP, app tắt, hoặc app trên máy khác chưa bind đúng).

3. **Host header và timeout**  
   Request qua tunnel thường giữ `Host: tbc-fnb.duongtunglam.com`. App Nuxt thường chấp nhận mọi Host. Nếu phía trước app có reverse proxy (NPM, Nginx) chỉ cho phép một vài host, cần cấu hình proxy cho phép host này hoặc bỏ kiểm tra host.  
   Nếu `/api/data/products` xử lý chậm, Cloudflare có thể hết timeout và trả 502 — khi đó cần tăng timeout trong Cloudflare Tunnel (Origin Request / Timeout) hoặc tối ưu API.

**Tóm tắt:** Đảm bảo app trên **192.168.10.201:3000** đang chạy và `curl http://192.168.10.201:3000/api/data/products` trả 200; sau đó xem log cloudflared khi 502 để biết lỗi kết nối hay timeout.
