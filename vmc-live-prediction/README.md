# VMC Live Prediction

Web mini game dự đoán realtime cho viewing party MLBB. Stack: React + Vite, Express, Socket.IO, SQLite.

## Tính năng hiện có

- Admin đăng nhập bằng biến môi trường.
- Tạo nhiều phòng và mã phòng tham gia.
- Người chơi vào phòng bằng mã + nickname.
- Admin tạo câu hỏi 2–8 đáp án, mở/khóa/công bố/hủy.
- Một câu hỏi mở tại một thời điểm trong phòng.
- Một lượt dự đoán cho mỗi người/câu hỏi; dự đoán bị khóa ngay sau khi gửi.
- Tỷ lệ lựa chọn cập nhật qua Socket.IO.
- Chấm điểm phía máy chủ, leaderboard realtime.
- Underdog được tính dựa trên tỷ lệ của đáp án đúng tại thời điểm khóa và số lượt tối thiểu.
- SQLite lưu dữ liệu trong `data/vmc.sqlite`, giữ dữ liệu sau khi khởi động lại.
- Giao diện người chơi responsive và màn hình trình chiếu.

## Yêu cầu

- Node.js 20 LTS trở lên khuyên dùng.
- npm.
- Kết nối mạng để cài các package lần đầu; Google Fonts là tùy chọn về mặt giao diện.

## Chạy local trên Windows

1. Giải nén dự án.
2. Mở terminal trong thư mục dự án.
3. Cài package:

   ```bash
   npm install
   ```

4. Tạo file `.env` từ `.env.example`, đổi `ADMIN_PASSWORD` và `JWT_SECRET`.
5. Chạy development:

   ```bash
   npm run dev
   ```

6. Mở `http://localhost:5173`.

Frontend chạy ở cổng 5173 và proxy API/Socket.IO đến backend cổng 3000.

## Chạy như một server duy nhất

```bash
npm install
npm run build
npm start
```

Mở `http://localhost:3000`. Dữ liệu SQLite được lưu trong `data/vmc.sqlite`.

## Cấu hình bắt buộc trước khi public

Tạo `.env`:

```env
PORT=3000
JWT_SECRET=thay-bang-chuoi-ngau-nhien-dai-kho-doan
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mat-khau-rieng-that-manh
APP_ORIGIN=https://ten-mien-cua-ban.example
```

Không dùng mật khẩu mẫu khi public. Không commit `.env`. Bật HTTPS bằng reverse proxy (Caddy/Nginx/IIS reverse proxy) nếu mở internet.

Nếu muốn dùng bcrypt hash thay vì mật khẩu rõ trong file `.env`, tạo hash với:

```bash
node -e "const b=require('bcryptjs'); console.log(b.hashSync('MAT_KHAU_CUA_BAN', 12))"
```

Sau đó dùng `ADMIN_PASSWORD_HASH` trong `.env` và bỏ `ADMIN_PASSWORD` (hoặc để giá trị placeholder không dùng). Server ưu tiên `ADMIN_PASSWORD_HASH` nếu có.

## Cách tổ chức một sự kiện

1. Đăng nhập admin.
2. Tạo phòng, ví dụ `VMC GRAND FINAL`.
3. Gửi mã phòng/link tham gia cho người chơi.
4. Người chơi nhập mã và nickname.
5. Admin tạo câu hỏi nháp, rồi bấm **Mở dự đoán** khi sẵn sàng.
6. Sau khi tình huống trong trận xảy ra, admin bấm **Khóa câu hỏi**.
7. Chọn đáp án đúng rồi bấm **Xác nhận đáp án & chấm điểm**.
8. Bảng điểm cập nhật realtime.

## Luật underdog hiện tại

- Mặc định điểm cơ bản: 100.
- Mặc định ngưỡng underdog: tỷ lệ đáp án đúng <= 15%.
- Mặc định hệ số: x2 tổng điểm (không phải cộng thêm x2).
- Mặc định cần ít nhất 10 lượt dự đoán hợp lệ.
- Tỷ lệ tính trên tổng lượt dự đoán hợp lệ đã ghi nhận cho câu hỏi tại thời điểm khóa.
- Nếu điều kiện underdog không đạt, câu trả lời đúng nhận điểm cơ bản.
- Người trả lời sai nhận 0.
- Các ngưỡng có thể đặt theo từng câu hỏi.

## API cơ bản

- `GET /api/health`
- `POST /api/admin/login`
- `GET /api/admin/rooms`
- `POST /api/admin/rooms`
- `POST /api/admin/rooms/:id/questions`
- `POST /api/admin/questions/:id/open`
- `POST /api/admin/questions/:id/lock`
- `POST /api/admin/questions/:id/resolve`
- `POST /api/rooms/join`
- `GET /api/player/state`
- `POST /api/player/questions/:id/predict`

## Lưu ý bảo mật / giới hạn bản MVP

- Đây là MVP cho một máy chủ Node.js. Không chạy nhiều process/replica cùng lúc nếu chưa chuyển sang adapter Socket.IO và storage dùng chung.
- SQLite phù hợp với một sự kiện nhỏ và tải ghi thấp; backup file database trước/sau sự kiện.
- Người chơi được nhận diện bằng token lưu trong trình duyệt; nickname phải duy nhất trong phòng. Nếu mất local storage, người chơi không thể tự khôi phục phiên bằng nickname cũ.
- Bản này chưa có tự động đồng bộ dữ liệu trận đấu MLBB; admin xác nhận kết quả thủ công.
- Không có countdown server-side trong bản đầu; admin chủ động khóa câu hỏi. Có thể thêm timer ở phiên bản sau.
- Trước sự kiện thật, hãy thử nghiệm nhiều trình duyệt/điện thoại, kiểm tra Wi-Fi quán, HTTPS và backup database.
- Nếu triển khai public, nên bổ sung rate limiting, audit log admin, sao lưu tự động, quản lý phiên và kiểm thử bảo mật trước khi dùng cho sự kiện lớn.


## Mobile UX, player recovery and logo

- The player screen is optimized for mobile: large tap targets, single-column answer buttons, readable question cards, and responsive leaderboard/history.
- A player's identity, predictions and score are stored on the server. Closing a tab or turning off the phone does not remove them. The browser keeps the login token locally for up to 30 days, unless browser data is cleared.
- Each new player chooses a 6-digit recovery PIN. To return after logging out, use the same room code, nickname and PIN. This restores the existing player record, prediction history and score; it does not create a second player. Do not use a PIN that is easy to guess. If browser storage is cleared, the PIN is needed to recover the account.
- To change the brand mark, replace `public/logo.svg` with your own SVG while keeping the same filename. For a PNG logo, change `/logo.svg` to `/logo.png` in `src/App.jsx` and add `public/logo.png`. A square transparent logo works best.
- Note: players created before the recovery PIN feature was added have no PIN on file. They should keep using their still-valid session; their record cannot be claimed through the new recovery flow until an administrator-assisted migration is provided.


## Chế độ nhiều câu hỏi cùng lúc

- Admin có thể tạo và mở nhiều câu hỏi trong cùng một phòng mà không cần khóa câu hỏi đang mở trước.
- Mỗi câu hỏi có trạng thái độc lập: nháp → đang mở → đã khóa → đã công bố kết quả.
- Người chơi thấy tất cả câu hỏi đang mở cùng lúc và có thể gửi dự đoán riêng cho từng câu. Mỗi câu vẫn chỉ được chọn một lần.
- Admin khóa từng câu ngay trên thẻ câu hỏi tương ứng; sau khi khóa, chọn đáp án đúng và chấm điểm câu đó mà không ảnh hưởng câu khác.
- Màn hình chiếu hiển thị nhiều câu hỏi đang mở cùng lúc. Giao diện tự xếp thành hai cột trên màn hình lớn và một cột trên điện thoại.
