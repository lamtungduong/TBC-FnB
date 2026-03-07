# Cấu hình Vercel Blob cho upload ảnh sản phẩm

Khi deploy lên Vercel, ảnh kéo-thả được lưu qua **Vercel Blob**. Cần tạo Blob Store và **kết nối với project** (để token được tự động thêm).

**Lưu ý:** Store **Private** chỉ hoạt động với `@vercel/blob` phiên bản **2.3 trở lên** (project đã dùng ^2.3.0).

## Các bước trên Vercel (quan trọng)

### 1. Tạo Blob Store **từ chính project POS**

1. Vào [vercel.com](https://vercel.com) → chọn **project POS** (không tạo từ team).
2. Vào tab **Storage** của project đó.
3. Bấm **Create Database** / **Create Store** → chọn **Blob**.
4. Đặt tên (ví dụ: `pos-images`). Chọn **Private** hoặc **Public** đều được (app đã hỗ trợ cả hai).
5. Bấm **Create**.

Khi tạo từ **project**, biến `BLOB_READ_WRITE_TOKEN` thường được **tự động** thêm vào project. Nếu không thấy:

- Vào **Storage** → chọn store vừa tạo → **Connect to Project** (chọn đúng project POS).

### 2. Redeploy

Sau khi store đã **Connected** với project:

- Vào **Deployments** → bấm **...** ở deployment mới nhất → **Redeploy**.

Hoặc push commit mới để tạo deployment mới. **Env mới chỉ có hiệu lực sau khi redeploy.**

### 3. Nếu vẫn không upload được

Khi kéo-thả ảnh trên web Vercel, nếu lỗi bạn sẽ thấy **alert** với nội dung lỗi (ví dụ: token sai, chưa kết nối store, ảnh quá lớn). Ghi lại nội dung đó để kiểm tra:

- **Settings** → **Environment Variables**: có biến `BLOB_READ_WRITE_TOKEN` cho môi trường Production (và Preview nếu cần).
- Storage → Blob store đã **Connect to Project** đúng project POS.
- Đã **Redeploy** sau khi thêm/env thay đổi.

Ảnh **quá lớn** (> khoảng 3MB) sẽ báo lỗi; nên dùng ảnh nhỏ hơn hoặc resize trước khi kéo-thả.

---

## Local (localhost)

- Chạy `npm install` rồi `npm run dev`.
- **Không cần** token; ảnh vẫn lưu vào `src/public/images`, không dùng Blob → không bị chậm do load package.

## Kết quả

- **Local:** Ảnh lưu vào `src/public/images`, hiển thị qua `/images/...`.
- **Vercel:** Có `BLOB_READ_WRITE_TOKEN` → ảnh upload lên Blob. Nếu store **Private**, ảnh hiển thị qua proxy `/api/blob-image?url=...`; nếu **Public** thì dùng URL Blob trực tiếp. Sản phẩm cũ (chỉ có tên file) vẫn dùng `/images/...`.
