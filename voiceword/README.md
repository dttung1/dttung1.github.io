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
| `addin/speech.js` | Ba nguồn giọng nói: nhận dạng của trình duyệt, Azure Speech, nhận chữ từ trang micro |
| `addin/mic.html`, `mic.js` | **Trang micro** mở trong Edge/Chrome cạnh Word desktop, gửi chữ vào add-in qua máy chủ |
| `addin/vendor/` | Azure Speech SDK 1.50.0 cho trình duyệt (giấy phép MIT), host cùng add-in để không phụ thuộc CDN |
| `windows/install-voiceword.ps1` | Cài, gỡ add-in trên Word cho Windows; xóa bộ nhớ đệm add-in |
| `server/` | Máy chủ trung gian gọi Claude: giữ API key, mã truy cập, CORS, giới hạn lượt |
| `server/tools.js` | Danh sách công cụ (tool) Claude được dùng, kèm system prompt |
| `test/` | Kiểm thử tự động: bộ hiểu lệnh, phần thực thi (trên Word giả lập), máy chủ (Claude giả lập) |

## Dùng trên Word desktop (Windows)

Word trên Windows chạy add-in trong WebView2. Theo tài liệu của Microsoft, quyền dùng micro cho add-in mới chỉ được hỗ trợ chính thức trên Office bản web (và Outlook mới), còn nhận dạng giọng nói của trình duyệt cũng không ổn định trong WebView. Vì vậy add-in có **ba nguồn giọng nói**, và nút *Kiểm tra micro & máy chủ* trong Cài đặt sẽ chọn giúp nguồn phù hợp:

| Nguồn | Cách hoạt động | Khi nào dùng |
|---|---|---|
| **Trang micro riêng** (mặc định trên desktop) | Bấm micro trong Word sẽ mở một trang nhỏ trong Edge/Chrome. Bạn nói ở đó, chữ được chuyển vào Word qua máy chủ, độ trễ dưới 1 giây | Luôn chạy được vì micro hoạt động trong trình duyệt thường. Không phải cài thêm gì |
| **Azure Speech ngay trong Word** | Nhận dạng ngay trong khung Word | Nếu bước kiểm tra báo “Micro trong khung Word: dùng được” |
| **Nhận dạng của trình duyệt** | Web Speech API | Word trên web với Chrome hoặc Edge |

```
Word desktop                         Edge/Chrome (trang micro)
┌────────────────────┐   mở trang   ┌──────────────────────┐
│ Khung “Giọng nói”  │ ───────────▶ │ 🎤 Azure Speech vi-VN │
│                    │              └──────────┬───────────┘
│  ◀── chữ (SSE) ────┼── máy chủ trung gian ◀──┘ chữ (POST, mã ghép riêng)
└────────────────────┘
```

### Các bước cài trên một máy Windows

1. **Gộp nhánh vào `main`** để GitHub Pages phục vụ `https://dttung1.github.io/voiceword/`.
2. **Chạy máy chủ** (mục 2 bên dưới) và đưa ra HTTPS. Cách nhanh nhất để thử trên chính máy đó:
   ```powershell
   cd voiceword\server; npm install
   $env:ANTHROPIC_API_KEY="sk-ant-..."; $env:APP_TOKEN="chuoi-bi-mat"
   $env:AZURE_SPEECH_KEY="..."; $env:AZURE_SPEECH_REGION="southeastasia"
   npm start                                        # cửa sổ 1
   cloudflared tunnel --url http://localhost:8787   # cửa sổ 2 → in ra địa chỉ https://….trycloudflare.com
   ```
3. **Cài add-in vào Word:** mở PowerShell bằng quyền quản trị:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\voiceword\windows\install-voiceword.ps1
   ```
   Mở lại Word → *Trang đầu → Add-in → Thêm add-in → Thư mục dùng chung* → chọn **Soạn bằng giọng nói**.
4. Trong khung add-in: *Cài đặt* → nhập địa chỉ máy chủ (https) và mã truy cập → bấm **Kiểm tra micro & máy chủ** → **Lưu**.
5. Bấm nút micro: trang micro mở trong trình duyệt. Đặt cửa sổ đó cạnh Word, bấm micro (hoặc phím Space) và nói.

Khi Word vẫn hiện giao diện cũ sau khi cập nhật: chạy script với `-ClearCache`. Gỡ add-in: chạy với `-Remove`.

**Azure Speech:** tạo tài nguyên *Speech* trên Azure Portal, nên chọn vùng `southeastasia` (Singapore) cho gần Việt Nam. Gói miễn phí F0 có giới hạn số giờ nhận dạng mỗi tháng (xem bảng giá hiện hành). Tiếng Việt (`vi-VN`) được hỗ trợ và tự thêm dấu câu. Khóa Azure chỉ nằm trên máy chủ; trình duyệt chỉ nhận mã ngắn hạn 10 phút.

## Chạy thử trên Word bản web

### 1. Phần giao diện

Giao diện được phục vụ từ GitHub Pages tại `https://dttung1.github.io/voiceword/addin/`, nên **cần gộp nhánh này vào `main`** thì manifest mới dùng được. Nếu muốn host ở nơi khác, sửa các URL trong `manifest.xml`.

**Word trên web:** mở một tài liệu → *Trang đầu → Add-in → Thêm add-in → Tải lên add-in của tôi* → chọn `manifest.xml`.

### 2. Máy chủ (AI, trang micro, Azure Speech)

Trên Word desktop cần máy chủ để dùng giọng nói. Trên Word bản web, nếu không có máy chủ thì vẫn đọc chữ và dùng lệnh theo quy tắc được.

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
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | (trống) | Bật Azure Speech: máy chủ cấp mã ngắn hạn cho trang micro và add-in |

Phần chuyển tiếp của trang micro lưu phiên ghép trong bộ nhớ. Vì vậy chỉ chạy **một** tiến trình máy chủ (không nhân bản ngang). Phiên ghép hết hạn sau 12 giờ.

Khi triển khai thật, đặt máy chủ sau HTTPS (Render, Fly.io, Azure App Service hoặc Cloudflare Tunnel). Sau đó trong add-in mở *Cài đặt* → nhập địa chỉ máy chủ và mã truy cập → bấm *Kiểm tra kết nối*.

**Chi phí ước tính:** một lệnh AI dùng khoảng 2–3 nghìn token đầu vào và vài trăm token đầu ra. Với Opus 5.5 ($4/$20 cho mỗi triệu token) là khoảng 1,5 cent một lệnh; với Haiku 5.5 thì rẻ hơn khoảng 40 lần. Lệnh theo quy tắc không tốn phí.

**Lưu ý:** máy chủ bật `fallbacks: "default"`. Nếu bộ lọc an toàn của model chính từ chối nhầm một yêu cầu, Anthropic tự chạy lại yêu cầu đó bằng model dự phòng.

### 3. Kiểm thử tự động

```bash
cd server && npm install && npm test   # 31 bài: bộ hiểu lệnh, phần thực thi (Word giả lập), máy chủ (Claude giả lập), trang micro và mã Azure
```

## Đã kiểm chứng

- Bộ hiểu lệnh tiếng Việt: dấu câu, số đọc bằng chữ, các vùng tác động, phân biệt lệnh đơn giản và lệnh cần AI.
- Phần thực thi chạy đúng trên mô hình Word giả lập: định dạng câu/đoạn/cụm từ, danh sách, chèn chữ, thay tất cả, bảng, thể thức NĐ 30, hoàn tác.
- Máy chủ: xác thực, CORS, bỏ công cụ lạ, xử lý khi model từ chối hoặc gặp lỗi API.
- Giao diện chạy trên trình duyệt ở chế độ xem thử, cả nền sáng và tối.
- Trọn luồng trang micro → máy chủ → khung add-in (trên Chromium): ghép mã, chữ tạm, câu hoàn chỉnh, lệnh “Lệnh in đậm…”, trạng thái micro.
- Azure Speech SDK nạp được, mở được micro (giả lập) và gọi đúng máy chủ nhận dạng `southeastasia.stt.speech.microsoft.com`. Chưa nhận dạng thật vì môi trường phát triển chặn mạng tới Azure.

## Chưa kiểm chứng (cần làm đầu tiên trên máy Windows có Word)

1. **Cài bằng `install-voiceword.ps1`** và mở add-in trong Word desktop. Script chưa chạy được ở môi trường phát triển (không có PowerShell và Windows).
2. **Micro trong khung Word desktop:** bấm *Kiểm tra micro & máy chủ*. Nếu dùng được thì chuyển sang “Azure Speech trong Word” để khỏi mở thêm cửa sổ.
3. **`Office.context.ui.openBrowserWindow`** mở trang micro trong trình duyệt mặc định. Nếu bị chặn, sao chép đường dẫn từ add-in.
4. **Nhận dạng tiếng Việt thật** bằng Azure Speech, và **gọi Claude thật**: cần khoảng 100 câu lệnh mẫu để đo độ chính xác và độ trễ.
5. **Kiểm tra manifest** bằng `npx office-addin-manifest validate manifest.xml`.
6. **Hành vi Word API thật**: giãn dòng, danh sách, hoàn tác bằng OOXML trên tài liệu lớn.

## Giới hạn đã biết

- Word API không có lệnh hoàn tác, nên add-in tự chụp lại thân văn bản (OOXML) trước mỗi lệnh và giữ 15 bước gần nhất. Với tài liệu rất lớn, việc này có thể chậm.
- Lề trang theo NĐ 30 chưa đặt tự động được, phải chỉnh trong *Bố cục → Lề*.
- “Câu vừa rồi” được hiểu là câu cuối của đoạn có con trỏ (hoặc của đoạn trước nếu đoạn hiện tại trống).
- Mã truy cập lưu trong bộ nhớ trình duyệt của add-in. Bản thương mại nên đăng nhập bằng tài khoản Microsoft (SSO).

## Quyền riêng tư

- Lệnh theo quy tắc và đọc chữ không gửi nội dung tài liệu đi đâu.
- Âm thanh chỉ đi tới dịch vụ nhận dạng giọng nói (Azure Speech hoặc dịch vụ của trình duyệt). Chữ nhận dạng được từ trang micro đi qua máy chủ trung gian để vào Word; máy chủ chỉ chuyển tiếp, không lưu.
- Lệnh AI gửi câu lệnh, phần đang chọn, đoạn hiện tại và dàn ý (tối đa 120 đoạn, mỗi đoạn 80 ký tự). Không gửi toàn văn.
- Có thể tắt AI trong *Cài đặt*. Máy chủ chỉ ghi số liệu (thời gian xử lý, số token), không ghi nội dung.
