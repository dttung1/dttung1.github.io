# VoiceWord: soạn thảo Word bằng giọng nói tiếng Việt (bản khung 0.1)

Add-in cho Microsoft Word gồm:

- **Đọc chữ:** nói nội dung để gõ vào tài liệu. Tự viết hoa đầu câu, tự thêm khoảng trắng; nói “chấm”, “phẩy”, “xuống dòng”… để chèn dấu.
- **Ra lệnh:** khoảng 30 lệnh định dạng chạy ngay trên máy theo quy tắc, không cần mạng.
- **Trợ lý AI (Claude):** xử lý lệnh tự do hoặc nhiều bước, và viết hoặc viết lại nội dung. Claude chỉ đề xuất thao tác từ một danh sách cố định; add-in mới là bên sửa tài liệu, và mọi thao tác đều hoàn tác được.

```
Micro ─▶ Nhận dạng giọng nói (vi-VN) ─▶ commands.js
                                         ├─ khớp quy tắc ─────────────────────────┐
                                         └─ không khớp ─▶ server/ ─▶ Claude API   │
                                                         (giữ API key)  │          │
                                              danh sách thao tác ◀──────┘          │
                                                         ▼                         ▼
                                              executor.js (Word API, có hoàn tác) ◀┘
```

## Cấu trúc thư mục

| Đường dẫn | Vai trò |
|---|---|
| `manifest.xml` | Khai báo add-in cho Word (nút “Soạn bằng giọng nói” ở thẻ Trang đầu) |
| `addin/taskpane.html/.css/.js` | Khung bên trong Word: micro, chế độ, lịch sử, xác nhận, cài đặt |
| `addin/commands.js` | Hiểu lệnh tiếng Việt theo quy tắc: dấu câu, định dạng, vùng tác động (“câu vừa rồi”, “đoạn này”, “chữ X”…) |
| `addin/executor.js` | Thực thi thao tác bằng Word API, kiểm tra đầu vào, xác nhận thao tác nguy hiểm, hoàn tác |
| `addin/speech.js` | Nhận dạng giọng nói (Web Speech API, vi-VN) |
| `server/` | Máy chủ trung gian gọi Claude: giữ API key, mã truy cập, CORS, giới hạn lượt |
| `server/tools.js` | Danh sách công cụ (tool) Claude được dùng, kèm system prompt |
| `test/` | Kiểm thử tự động: bộ hiểu lệnh, phần thực thi (trên Word giả lập), máy chủ (Claude giả lập) |

## Chạy thử

### 1. Phần giao diện

Giao diện được phục vụ từ GitHub Pages tại `https://dttung1.github.io/voiceword/addin/`, nên **cần gộp nhánh này vào `main`** thì manifest mới dùng được. Nếu muốn host ở nơi khác, sửa các URL trong `manifest.xml`.

**Cài thử (sideload) vào Word:**

- **Word trên web** (dễ nhất, micro chạy ổn trên Edge/Chrome): mở một tài liệu → *Trang đầu → Add-in → Thêm add-in → Tải lên add-in của tôi* → chọn `manifest.xml`.
- **Word trên Windows:** tạo một thư mục chia sẻ chứa `manifest.xml`, khai báo thư mục đó ở *Tệp → Tùy chọn → Trung tâm tin cậy → Danh mục add-in tin cậy*, khởi động lại Word, rồi vào *Add-in → Thư mục dùng chung*.
- **Triển khai cho cả tổ chức:** quản trị viên tải `manifest.xml` lên *Microsoft 365 admin center → Ứng dụng tích hợp*.

### 2. Máy chủ AI (tùy chọn: thiếu máy chủ thì chỉ có lệnh theo quy tắc)

```bash
cd server
npm install
ANTHROPIC_API_KEY=sk-ant-...   \
APP_TOKEN=một-chuỗi-bí-mật-dài \
ALLOWED_ORIGINS=https://dttung1.github.io \
npm start
```

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | (bắt buộc) | API key của Claude, chỉ nằm trên máy chủ |
| `APP_TOKEN` | (bắt buộc) | Mã add-in phải gửi kèm (nhập trong Cài đặt của add-in) |
| `MODEL` | `claude-opus-5-5` | Đổi sang `claude-haiku-5-5` để rẻ và nhanh hơn, nếu đo thấy đủ chính xác |
| `EFFORT` | `low` | Mức suy nghĩ của model. `low` cho phản hồi nhanh khi định dạng; tăng lên nếu lệnh phức tạp hay sai |
| `ALLOWED_ORIGINS` | `https://dttung1.github.io,https://localhost:3000` | Các trang được phép gọi máy chủ (CORS) |
| `RATE_PER_MIN` | `30` | Số lệnh tối đa mỗi phút cho mỗi địa chỉ IP |
| `TLS_CERT`, `TLS_KEY` | (trống) | Chạy HTTPS trực tiếp. Add-in là trang HTTPS nên máy chủ cũng phải dùng HTTPS |

Khi triển khai thật, đặt máy chủ sau HTTPS (Render, Fly.io, Azure App Service hoặc Cloudflare Tunnel). Sau đó trong add-in mở *Cài đặt* → nhập địa chỉ máy chủ và mã truy cập → bấm *Kiểm tra kết nối*.

**Chi phí ước tính:** một lệnh AI dùng khoảng 2–3 nghìn token đầu vào và vài trăm token đầu ra. Với Opus 5.5 ($4/$20 cho mỗi triệu token) là khoảng 1,5 cent một lệnh; với Haiku 5.5 thì rẻ hơn khoảng 40 lần. Lệnh theo quy tắc không tốn phí.

**Lưu ý:** máy chủ bật `fallbacks: "default"`. Nếu bộ lọc an toàn của model chính từ chối nhầm một yêu cầu, Anthropic tự chạy lại yêu cầu đó bằng model dự phòng.

### 3. Kiểm thử tự động

```bash
cd server && npm install && npm test   # 26 bài: bộ hiểu lệnh, phần thực thi (Word giả lập), máy chủ (Claude giả lập)
```

## Đã kiểm chứng

- Bộ hiểu lệnh tiếng Việt: dấu câu, số đọc bằng chữ, các vùng tác động, phân biệt lệnh đơn giản và lệnh cần AI.
- Phần thực thi chạy đúng trên mô hình Word giả lập: định dạng câu/đoạn/cụm từ, danh sách, chèn chữ, thay tất cả, bảng, thể thức NĐ 30, hoàn tác.
- Máy chủ: xác thực, CORS, bỏ công cụ lạ, xử lý khi model từ chối hoặc gặp lỗi API.
- Giao diện chạy trên trình duyệt ở chế độ xem thử, cả nền sáng và tối.

## Chưa kiểm chứng (cần làm đầu tiên trên máy có Word)

1. **Micro trong Word desktop.** Word trên Windows dùng WebView2, có thể không cho dùng Web Speech API. Nếu không chạy được, bước tiếp theo là thêm Azure Speech hoặc FPT.AI qua máy chủ trung gian (máy chủ cấp token ngắn hạn, add-in gửi âm thanh). Word trên web với Edge/Chrome là môi trường chắc chắn nhất ở giai đoạn này.
2. **Gọi Claude thật.** Môi trường phát triển không có API key nên mới thử với Claude giả lập. Cần chạy khoảng 100 câu lệnh tiếng Việt thật để đo độ chính xác và độ trễ, rồi chọn model và mức suy nghĩ phù hợp.
3. **Kiểm tra manifest** bằng `npx office-addin-manifest validate manifest.xml`: dịch vụ kiểm tra của Microsoft không truy cập được từ môi trường phát triển.
4. **Hành vi Word API thật**, ví dụ khoảng giãn dòng, kiểu danh sách, và hoàn tác bằng OOXML trên tài liệu lớn.

## Giới hạn đã biết

- Word API không có lệnh hoàn tác, nên add-in tự chụp lại thân văn bản (OOXML) trước mỗi lệnh và giữ 15 bước gần nhất. Với tài liệu rất lớn, việc này có thể chậm.
- Lề trang theo NĐ 30 chưa đặt tự động được, phải chỉnh trong *Bố cục → Lề*.
- “Câu vừa rồi” được hiểu là câu cuối của đoạn có con trỏ (hoặc của đoạn trước nếu đoạn hiện tại trống).
- Mã truy cập lưu trong bộ nhớ trình duyệt của add-in. Bản thương mại nên đăng nhập bằng tài khoản Microsoft (SSO).

## Quyền riêng tư

- Lệnh theo quy tắc và đọc chữ không gửi nội dung tài liệu đi đâu, trừ âm thanh gửi tới dịch vụ nhận dạng giọng nói của trình duyệt.
- Lệnh AI gửi câu lệnh, phần đang chọn, đoạn hiện tại và dàn ý (tối đa 120 đoạn, mỗi đoạn 80 ký tự). Không gửi toàn văn.
- Có thể tắt AI trong *Cài đặt*. Máy chủ chỉ ghi số liệu (thời gian xử lý, số token), không ghi nội dung.
