# HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG SHOPHQK (PHIÊN BẢN DOANH NGHIỆP - ENTERPRISE SECURED)

Dự án **ShopHQK** đã được nâng cấp toàn diện lên kiến trúc **Chuẩn Doanh Nghiệp (Enterprise-grade E-Commerce/MMO Store)**, tích hợp đầy đủ các lớp bảo mật đa tầng, cơ chế lưu trữ máy chủ an toàn chống mất mát dữ liệu và hệ thống phân phối tài khoản/key tự động như các sàn thương mại lớn (Shopee, DivineShop, TapHoaMMO).

---

## 🚀 1. Khởi chạy dự án

### Yêu cầu:
* Máy tính đã cài đặt **Node.js** (khuyến nghị phiên bản 18+ hoặc 20+).
* Hỗ trợ mọi hệ điều hành: Windows, Linux (Ubuntu, Debian, CentOS), macOS, Docker.

### Các bước khởi chạy:
1. Mở cửa sổ dòng lệnh (Terminal / PowerShell / CMD) tại thư mục dự án `shophqk`.
2. Cài đặt các thư viện phụ thuộc (nếu chưa có `node_modules`):
   ```bash
   npm install
   ```
3. Khởi động máy chủ:
   ```bash
   npm start
   # hoặc: node server.js
   ```
4. Mở trình duyệt web và truy cập:
   ```
   http://localhost:3000
   ```

---

## 🛡️ 2. Hệ Thống Tính Năng Bảo Mật & Lưu Trữ Máy Chủ Cấp Doanh Nghiệp

### 🔐 A. Bảo Mật Máy Chủ & Tường Lửa API (OWASP Hardening)
1. **OWASP Security Headers**:
   - `Content-Security-Policy`: Ngăn chặn tấn công XSS & nhúng script độc hại.
   - `X-Frame-Options: SAMEORIGIN`: Chống Clickjacking.
   - `X-Content-Type-Options: nosniff`: Ngăn chặn MIME-sniffing.
   - `Strict-Transport-Security (HSTS)`: Ép buộc kết nối mã hóa SSL/HTTPS.
   - Ẩn header `X-Powered-By: Express` tránh lộ cấu trúc máy chủ.
2. **Anti-Brute Force & Rate Limiting (Chống Spam / Tấn công dò mật khẩu & DDOS)**:
   - Giới hạn request thông minh theo IP trên từng cụm API:
     - `/api/auth/login`, `/api/auth/register`, `/api/auth/change-password`: Tối đa 15 req / phút (ngăn chặn mò pass).
     - `/api/orders/buy`: Tối đa 20 lượt mua / phút (ngăn chặn spam đơn).
     - `/api/wallet/*`: Tối đa 30 req / phút.
     - Toàn hệ thống chung: Tối đa 180 req / phút / IP.
3. **Cơ Chế Token JWT HS256 An Toàn**:
   - Xác thực danh tính người dùng và quản trị viên qua `Authorization: Bearer <token>`.
   - Cơ chế thu hồi phiên đăng nhập tự động (`passwordChangedAt`): Ngay khi đổi mật khẩu, toàn bộ token cũ lập tức bị vô hiệu hóa.
4. **Mã Bảo Mật Cấp 2 Cho Admin (Level 2 Security PIN)**:
   - Các hành động nhạy cảm cao (cộng/giảm số dư, khôi phục sao lưu server, xóa user) bắt buộc phải nhập mã PIN bảo mật cấp 2 được thiết lập trong cài đặt Admin.
5. **Khóa / Mở Khóa Tài Khoản Vi Phạm (Ban System)**:
   - Admin có thể lập tức khóa (Ban) người dùng gian lận. Tài khoản bị khóa sẽ bị chặn ngay lập tức khỏi mọi API mua hàng, nạp tiền và đăng nhập.

---

### 🗄️ B. Lưu Trữ Máy Chủ & Chống Xung Đột Dữ Liệu (Enterprise Persistence)
1. **Khóa Bất Đồng Bộ (AsyncMutex) - Loại Bỏ Hoàn Toàn Race Condition**:
   - Các thao tác trừ số dư, xuất kho tài khoản/key số lượng có hạn, và cộng tiền nạp tự động đều được bọc trong Mutex Locking.
   - Đảm bảo tính toàn vẹn (ACID transactions), không bao giờ xảy ra lỗi trừ trùng tiền hoặc mua âm kho khi có hàng trăm request đồng thời.
2. **Ghi Đĩa An Toàn Tuyệt Đối (Atomic Disk Writing)**:
   - Mọi thao tác lưu dữ liệu JSON đều ghi vào file tạm thời `.tmp` kèm checksum trước khi thực hiện rename nguyên tử (`fs.renameSync`). Đảm bảo file database không bao giờ bị hỏng (corrupted) ngay cả khi mất điện đột ngột.
3. **Hệ Thống Sao Lưu Tự Động & Phục Hồi Thảm Họa (Auto-Backup & Disaster Recovery)**:
   - Server tự động tạo snapshot toàn bộ dữ liệu (users, products, transactions, settings, logs) mỗi 12 tiếng vào thư mục `data/backups/`.
   - Giao diện Admin có tab riêng **Sao Lưu Server** cho phép:
     - Tạo bản sao lưu thủ công tức thì chỉ với 1 click.
     - Tải file sao lưu `.json` về máy tính an toàn.
     - Khôi phục máy chủ (Restore) nhanh chóng khi cần rollback dữ liệu.

---

### 📦 C. Quản Lý Kho Hàng Kỹ Thuật Số Tự Động (Auto Stock Delivery)
1. **Phân phối Tài Khoản / Key bản quyền tự động**:
   - Khi tạo hoặc sửa sản phẩm, Admin có thể chọn loại phân phối:
     - **Link Tải / Tài Liệu**: Trả link download sau khi thanh toán.
     - **Kho Acc / Key Tự Động**: Nhập danh sách tài khoản hoặc mã kích hoạt (mỗi dòng 1 key/tài khoản).
   - Hệ thống tự động đếm tồn kho theo số dòng thực tế.
   - Khi khách hàng thanh toán thành công, hệ thống tự động bốc đúng số lượng key/acc tương ứng, giao ngay lập tức trên màn hình và lưu vào Lịch Sử Mua Hàng của khách, đồng thời tự động trừ kho.

---

### 🔍 D. Nhật Ký Kiểm Toán & Giám Sát Webhook (Audit Logs & Webhook Inspector)
1. **Nhật Ký Bảo Mật (Audit Logs)**:
   - Ghi lại mọi hành động rủi ro cao: Đăng nhập Admin, Đổi mật khẩu, Thay đổi số dư thành viên, Cập nhật cài đặt ví/ngân hàng, Khôi phục sao lưu server kèm IP và User-Agent chi tiết.
2. **Trình Giám Sát Webhook (Webhook Inspector)**:
   - Lưu vết toàn bộ request từ VietQR / SeABank / MBBank / GachTheFast tới server.
   - Hiển thị trực quan IP gửi tới, trạng thái xác thực (`PASS` / `FAIL`), mã giao dịch và mã lỗi để Admin dễ dàng đối soát đối tác thanh toán.

---

## 👤 3. Tài Khoản Quản Trị & Thông Tin Đăng Nhập

* **Tài khoản Admin mặc định:** `hqk`
* **Mật khẩu ban đầu:** `khanh2k9`
* **Mã PIN Cấp 2 mặc định:** `123456` *(Admin hãy vào tab Cấu Hình Web để đổi mã PIN bảo mật cấp 2 ngay)*

---

## ⚙️ 4. Cấu Hình Biến Môi Trường (`.env`)

```env
# Cổng chạy ứng dụng
PORT=3000

# Khóa bí mật JWT (Hãy thay đổi thành chuỗi ngẫu nhiên dài trong môi trường thực tế)
JWT_SECRET=shophqk_jwt_secret_key_change_me_in_production_2026

# Mật khẩu khởi tạo ban đầu cho Admin hqk
ADMIN_PASSWORD=khanh2k9
```

---

## 📂 5. Cấu Trúc Thư Mục Dữ Liệu Trên Máy Chủ

```
shophqk/
├── server.js               # Backend Node.js lõi (OWASP, Mutex, JWT, Backup Engine)
├── package.json            # Cấu hình dependency
├── .env                    # Cấu hình bí mật môi trường
├── HUONG_DAN_SU_DUNG.md    # Tài liệu hướng dẫn chi tiết này
├── data/                   # Toàn bộ database của máy chủ
│   ├── users.json          # Danh sách thành viên, số dư, trạng thái khóa
│   ├── products.json       # Danh mục sản phẩm, kho key tự động
│   ├── transactions.json   # Lịch sử nạp tiền và đơn mua hàng
│   ├── settings.json       # Cấu hình shop, ngân hàng, PIN cấp 2, webhook key
│   ├── audit_logs.json     # Nhật ký bảo mật hành động admin
│   ├── webhook_logs.json   # Lịch sử gọi webhook đối tác nạp tiền
│   └── backups/            # Các bản sao lưu tự động và thủ công của máy chủ
└── public/                 # Giao diện người dùng & quản trị (SPA)
    ├── index.html          # Khung giao diện HTML5, Tailwind, Modal, Tab Admin
    ├── app.js              # Xử lý logic Frontend, JWT Fetch Interceptor
    ├── style.css           # Hiệu ứng giao diện, Dark Glassmorphism
    └── uploads/            # Thư mục lưu ảnh sản phẩm tải lên
```
