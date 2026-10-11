# KidTime: thiết kế tính năng lõi (v0.1)

Phạm vi: app phụ huynh trên iPhone quản lý laptop Windows của con dưới 13 tuổi.
Tài liệu này chỉ gồm **tính năng lõi**. Các phần khác (nhiệm vụ học có thưởng, đa thiết bị, AI, thanh toán…) sẽ cập nhật sau.

## 1. Nguyên tắc trải nghiệm

| Nguyên tắc | Cách thể hiện |
|---|---|
| Đơn giản | 4 tab, mỗi màn hình có một việc chính. Thao tác thường dùng (khóa, thêm giờ, duyệt) nằm ngay ở **Tổng quan** |
| Trực quan | Vòng tròn thời gian còn lại, màu trạng thái cố định (xanh: đang dùng, tím: học, cam: sắp hết, đỏ: đã khóa, xám: offline) |
| Realtime | Trạng thái laptop cập nhật dưới 2 giây. Mỗi lệnh hiển thị "Đang gửi…" và chuyển sang "Đã áp dụng ✓" khi laptop xác nhận |
| Thân thiện | Tiếng Việt, câu ngắn, giao diện kiểu iOS, hỗ trợ chế độ tối, vùng chạm ≥ 44pt |
| Dùng trên iPhone | PWA: mở Safari, chọn Chia sẻ → Thêm vào MH chính. Sau này bọc thành app native (SwiftUI) mà vẫn giữ nguyên API |

## 2. Bảy tính năng lõi

| # | Tính năng | Phụ huynh làm gì (iPhone) | Laptop làm gì (agent Windows) |
|---|---|---|---|
| F1 | **Trạng thái trực tiếp** | Xem online/offline, app đang dùng, thời gian còn lại | Gửi heartbeat 15 giây/lần, gửi ngay khi đổi app (foreground hook) |
| F2 | **Khóa / mở khóa tức thì** | Chạm "Khóa máy" hoặc "Mở khóa" | Hiện màn hình khóa toàn màn hình, gửi xác nhận (ack) |
| F3 | **Giới hạn thời gian mỗi ngày** | Đặt số phút cho ngày thường và cuối tuần, thêm giờ nhanh (+15/+30) | Đếm thời gian dùng thật (bỏ qua lúc rảnh), cảnh báo trước 10 phút, tự khóa khi hết |
| F4 | **Lịch dùng máy và giờ ngủ** | Đặt giờ bắt đầu và giờ ngủ | Ngoài khung giờ thì khóa, kể cả khi mất mạng |
| F5 | **Chế độ học** | Bật trong 30/60/90 phút, sửa danh sách app/web học | Chỉ cho chạy app và web trong danh sách, không trừ vào quỹ giờ giải trí |
| F6 | **Xin thêm giờ** | Nhận thông báo, duyệt bằng một chạm (+15/+30) hoặc từ chối | Nút "Xin thêm giờ" trên màn hình khóa và ở khay hệ thống, kèm lý do |
| F7 | **An toàn web và app** | Bật/tắt danh mục web, SafeSearch, danh sách app bị chặn | Lọc qua DNS, ép SafeSearch, đóng app bị chặn, gửi cảnh báo |

Kèm theo:
- **Báo cáo hôm nay / 7 ngày**: thời gian theo nhóm (học / giải trí / khác) và các app dùng nhiều nhất.
- **Cảnh báo an toàn**: laptop offline lâu, app bị chặn, giờ hệ thống bị đổi.

## 3. Máy trạng thái của laptop

Thứ tự ưu tiên, từ cao xuống thấp. Trạng thái đầu tiên thỏa điều kiện sẽ được áp dụng.

```
OFFLINE        không có heartbeat > 60s           (hiển thị phía phụ huynh)
PARENT_LOCK    phụ huynh khóa                       → khóa
BEDTIME        ngoài khung giờ & không có "tạm mở"  → khóa
STUDY          chế độ học đang bật                  → chỉ allowlist, không trừ quỹ
TIME_UP        còn lại ≤ 0                          → khóa, gợi ý "Xin thêm giờ"
WARNING        còn lại ≤ 10 phút                    → cảnh báo cho con
ACTIVE         còn lại > 10 phút                    → dùng bình thường
```

Công thức: `còn lại = giới hạn hôm nay + giờ thưởng hôm nay − phút giải trí đã dùng`

## 4. Giao thức realtime

```
iPhone ──insert command──▶ Cloud ──realtime push──▶ Agent
   ▲                                                  │ áp dụng
   └──── realtime update (status, command=done) ◀─────┘
```

- **Lệnh** (`commands`): `lock`, `unlock`, `add_time{minutes}`, `study_start{minutes}`, `study_stop`, `bedtime_override{minutes}`.
  - Trạng thái: `sent` → `done` (hoặc `failed`).
  - Phía iPhone hiện "Đang gửi…" cho đến khi nhận `done`. Nếu quá 10 giây thì báo "Laptop chưa phản hồi".
- **Chính sách** (`policies`): một bản JSON có `version`. Agent luôn áp dụng bản có version mới nhất và lưu cache để chạy offline.
- **Trạng thái** (`devices.status`): agent ghi khi đổi app hoặc đổi trạng thái, và mỗi 15 giây.
- **Yêu cầu** (`time_requests`): con tạo, phụ huynh trả lời. Khi đồng ý, iPhone gửi kèm lệnh `add_time`.
- **Lựa chọn hạ tầng MVP**: Supabase (Postgres + Realtime + Auth + RLS). Xem `supabase/schema.sql`.

## 5. Bản đồ màn hình (iPhone)

```
Tab bar: [Tổng quan] [Thời gian] [An toàn] [Báo cáo]

Tổng quan
 ├─ Thẻ yêu cầu chờ duyệt (nổi trên cùng nếu có)
 ├─ Vòng thời gian còn lại + trạng thái + online
 ├─ Đang dùng: app, nhóm, thời lượng
 ├─ Nút lớn: Khóa máy / Mở khóa
 ├─ Nút nhanh: +15 phút · +30 phút · Chế độ học
 └─ Hoạt động gần đây (cảnh báo, lệnh đã áp dụng)

Thời gian:  Giới hạn ngày thường / cuối tuần · Lịch (bắt đầu, giờ ngủ) · Chế độ học + danh sách cho phép
An toàn:    Danh mục web · SafeSearch · App bị chặn (thêm/xóa)
Báo cáo:    Tổng hôm nay · Theo nhóm · Top app · 7 ngày
```

## 6. Tiêu chí hoàn thành (acceptance)

- [ ] Từ lúc chạm "Khóa máy" đến khi laptop khóa: < 3 giây (mạng 4G).
- [ ] Laptop mất mạng vẫn khóa đúng giờ ngủ và đúng khi hết quỹ.
- [ ] Con là Standard User, không tắt được service, không sửa được cache chính sách (có chữ ký).
- [ ] Chế độ học không trừ quỹ giải trí. App ngoài danh sách bị đóng trong vòng 2 giây.
- [ ] Yêu cầu xin giờ đến iPhone < 3 giây. Duyệt chỉ cần 1 chạm.
- [ ] Phụ huynh hiểu được trạng thái trong 3 giây nhìn màn hình Tổng quan (kiểm thử với 5 phụ huynh).

## 7. Bản demo trong repo

| File | Vai trò |
|---|---|
| `index.html` + `app.js` | App phụ huynh (PWA cho iPhone) |
| `laptop.html` | Mô phỏng agent Windows: đếm giờ, đổi app, màn hình khóa, xin thêm giờ |
| `store.js` | Lớp dữ liệu realtime. Chế độ demo dùng `BroadcastChannel` + `localStorage` (đồng bộ giữa các tab trên cùng thiết bị) |
| `store-supabase.js` | Adapter cho Supabase khi điền `config.js`, đồng bộ thật giữa iPhone và laptop |

Ở chế độ demo, **1 giây = 1 phút** để dễ thấy thời gian chạy và máy tự khóa khi hết giờ.
