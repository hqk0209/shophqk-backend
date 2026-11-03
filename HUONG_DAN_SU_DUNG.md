# HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG SHOPHQK (PHIÊN BẢN ĐÃ SỬA LỖI & BẢO MẬT TOÀN DIỆN)

Dự án này đã được tối ưu hóa và vá toàn bộ các lỗ hổng bảo mật nghiêm trọng (Bypass Admin, Webhook injection, Xung đột file, Mất mật khẩu).

---

## 🚀 1. Khởi chạy dự án

### Yêu cầu:
* Cài đặt **Node.js** (khuyến nghị phiên bản 18+ hoặc 20+).

### Các bước chạy:
1. Mở cửa sổ dòng lệnh (Terminal / PowerShell / CMD) tại thư mục dự án.
2. Cài đặt các gói thư viện (nếu chưa cài):
   ```bash
   npm install
   ```
3. Khởi động máy chủ:
   ```bash
   npm start
   # hoặc: node server.js
   ```
4. Truy cập giao diện website tại trình duyệt:
   ```
   http://localhost:3000
   ```

---

## 🔒 2. Danh sách các lỗi đã được sửa triệt để (Security & Logic Fixes)

1. **Bảo mật quyền Quản trị viên (Admin Authentication):**
   * **Trước đây:** Bất kỳ ai cũng có thể giả mạo `x-admin-username: hqk` hoặc gắn `?adminUsername=hqk` vào URL để chiếm quyền Admin và tự cộng tiền.
   * **Hiện tại:** Hệ thống sử dụng cơ chế token **JWT (HS256)** mã hóa bằng khóa bí mật. Mọi request quản trị bắt buộc phải có Bearer Token hợp lệ được cấp khi đăng nhập tài khoản Admin.

2. **Khắc phục lỗi thêm/sửa/xóa sản phẩm trái phép:**
   * **Trước đây:** Nếu không gửi `adminUsername`, các API `/api/products` (POST, PUT, DELETE) và `/api/admin/upload-image` cho phép khách vãng lai xóa/sửa sản phẩm tự do.
   * **Hiện tại:** Tất cả các endpoint này đều được bảo vệ nghiêm ngặt bằng middleware `requireAdmin`.

3. **Vá lỗ hổng giả mạo Webhook nạp tiền (Fake Payment Injection):**
   * **Trước đây:** Điều kiện kiểm tra token bị lỗi logic `if (secretKey && providedKey && ...)`, khiến kẻ gian chỉ cần không gửi token là tiền tự động được cộng vào ví.
   * **Hiện tại:** Bắt buộc request webhook phải có đúng `webhookSecretKey`. Nếu sai hoặc thiếu key, hệ thống lập tức từ chối `401 Unauthorized`.

4. **Xác thực Webhook Callback Thẻ cào (GachTheFast):**
   * **Trước đây:** Bất kỳ ai gửi request tới `/api/webhook/card` đều có thể tự kích hoạt nạp thẻ thành công.
   * **Hiện tại:** Bổ sung cơ chế xác thực `cardCallbackSecret` và kiểm tra chữ ký số MD5 từ cổng gạch thẻ.

5. **Khắc phục lỗi mất mật khẩu Admin khi khởi động server:**
   * **Trước đây:** Mỗi lần restart server, hàm `seedAdminUser` ép mật khẩu tài khoản `hqk` về `khanh2k9`, làm mất mật khẩu admin vừa đổi.
   * **Hiện tại:** Server chỉ khởi tạo tài khoản nếu chưa có; giữ nguyên mật khẩu nếu admin đã thay đổi.

6. **Tính năng Đổi Mật Khẩu An Toàn:**
   * Đã bổ sung API `/api/auth/change-password` và giao diện Đổi Mật Khẩu ngay trên Navbar, kiểm tra mật khẩu cũ trước khi mã hóa mật khẩu mới bằng `bcrypt`.

7. **Chống xung đột ghi đè dữ liệu (Race Condition & Atomic File I/O):**
   * Cơ chế ghi file JSON được nâng cấp thành **Atomic Write** (ghi ra file tạm trước khi rename), đảm bảo file dữ liệu không bao giờ bị rỗng hay hỏng khi có nhiều giao dịch đồng thời.

8. **Bảo vệ thông tin cấu hình nhạy cảm:**
   * API công khai `/api/settings` được làm sạch, không để lộ Secret Key hay Partner Key ra ngoài client. Admin có endpoint riêng `/api/admin/settings` (yêu cầu quyền Admin) để quản lý.

---

## ⚙️ 3. Cấu hình biến môi trường (`.env`)

Bạn có thể chỉnh sửa file `.env` tại thư mục gốc để thay đổi cấu hình:

```env
# Cổng chạy ứng dụng
PORT=3000

# Khóa bí mật dùng để ký và xác thực JWT
JWT_SECRET=shophqk_jwt_secret_key_change_me_in_production_2026

# Mật khẩu khởi tạo ban đầu cho Admin hqk
ADMIN_PASSWORD=khanh2k9
```

---

## 👤 4. Tài khoản Admin mặc định

* **Tài khoản:** `hqk`
* **Mật khẩu ban đầu:** `khanh2k9` (Bạn nên đổi mật khẩu ngay sau khi đăng nhập bằng nút biểu tượng Chìa Khóa trên thanh điều hướng).
