# QuầyPOS — Tài liệu thiết kế

## Tổng quan

QuầyPOS là ứng dụng quản lý quầy bán hàng (Point of Sale) dành cho các cửa hàng nhỏ như quán cà phê, trà sữa, quán ăn. Toàn bộ giao diện được xây dựng bằng **React + Vite + Tailwind CSS v4**, chạy trong Figma Make.

---

## Triết lý thiết kế

### 1. iOS-native feel trên web

Toàn bộ UI mô phỏng ngôn ngữ thiết kế của **Apple iOS/iPadOS** — không phải clone, mà là tinh thần: rõ ràng, có thứ bậc, ưu tiên nội dung. Lý do: ứng dụng POS thường chạy trên iPad hoặc màn hình cảm ứng, người dùng Việt Nam quen với iOS nhiều hơn Material Design trong phân khúc này.

### 2. Không có sidebar, không có tabs nặng

Navigation được giữ phẳng và nhanh:
- **Top navbar** duy nhất — logo, thanh tìm kiếm, 2 nút hành động
- Các màn hình phụ (Admin, Settings, Auth) dùng **full-screen overlay** với animation slide-up/fade-in
- Không dùng router vì đây là single-page app đơn giản

### 3. Màu sắc có ý nghĩa

| Màu | Hex | Dùng cho |
|-----|-----|----------|
| Blue | `#007AFF` | Hành động chính, link, focus ring |
| Green | `#34C759` | Thành công, đã thanh toán, trả nợ |
| Orange | `#FF9500` | Cảnh báo nhẹ, ghi nợ, badge |
| Red | `#FF3B30` | Lỗi, xóa, còn nợ, đăng xuất |
| Gray | `#8E8E93` | Label phụ, icon không active |
| Background | `#F2F2F7` | Nền app (light) |
| Surface | `#FFFFFF` / `#1C1C1E` | Card, panel (light/dark) |

### 4. Typography

Font duy nhất: **Inter** (system-ui fallback). Không dùng font display riêng vì POS cần đọc nhanh, không cần cảm xúc. Kích thước:
- `17px bold` — tiêu đề màn hình
- `15px semibold` — tên sản phẩm, số tiền quan trọng
- `13–14px` — body text, nhãn input
- `11–12px uppercase tracking-wide` — label phân mục

### 5. Spacing và border-radius

- Bo góc chủ đạo: `rounded-2xl` (16px) cho card, `rounded-xl` (12px) cho input/button nhỏ, `rounded-3xl` (24px) cho modal
- Khoảng cách nội dung: `p-4` (16px) cho card, `gap-3` / `gap-4` giữa các phần tử
- Không dùng border dày — chỉ dùng `ring-1 ring-black/[0.05]` (hairline) để phân tách card

### 6. Dark mode

Hỗ trợ đầy đủ dark mode qua class `.dark` trên root element. Mỗi màu surface có cặp light/dark:
- `bg-white dark:bg-[#1C1C1E]` — card
- `bg-[#F2F2F7] dark:bg-black` — page background
- `bg-[#E5E5EA] dark:bg-[#2C2C2E]` — input background

Toggle được đặt trong **Cài đặt → Giao diện**.

---

## Cấu trúc màn hình

```
App
├── AuthScreen          (đăng nhập / đăng ký / quên mật khẩu)
│   ├── Login view
│   ├── Register view
│   └── Forgot password view
│
└── Main POS Screen     (sau khi đăng nhập)
    ├── TopNavbar
    │   ├── Logo + tên app
    │   ├── Search bar (tìm sản phẩm)
    │   ├── ⚙️ Nút Cài đặt  →  AdminPanel (tab settings)
    │   └── ☰  Nút Menu      →  AdminPanel (tab overview)
    │
    ├── Product Panel (left/main)
    │   ├── Category tabs (Tất cả / Đồ uống / Đồ ăn / ...)
    │   └── Product grid
    │
    ├── Cart Panel (right, desktop)
    │   ├── Cart lines
    │   ├── Subtotal / VAT / Total
    │   └── Checkout button  →  PaymentScreen
    │
    ├── AdminPanel (full-screen overlay)
    │   ├── Tab: Tổng quan   — KPI cards, top products
    │   ├── Tab: Sản phẩm    — CRUD danh mục + sản phẩm
    │   ├── Tab: Khách hàng  — danh sách + chi tiết + lịch sử nợ
    │   └── Tab: Đơn hàng    — lịch sử đơn
    │
    ├── SettingsPanel (AdminPanel initialTab='settings')
    │   ├── Thông tin cửa hàng
    │   ├── Thuế VAT
    │   ├── Giao diện (dark mode toggle)
    │   ├── Tài khoản ngân hàng (VietQR)
    │   ├── Tóm tắt hôm nay
    │   └── Tài khoản (đổi mật khẩu / đăng xuất)
    │
    └── ChangePasswordModal
```

---

## Các component chính

### AuthScreen
- **3 view nội tuyến**: login, register, forgot — không dùng routing
- Accounts lưu trong `useState` (mảng `AuthAccount`) — không có backend
- Tài khoản mặc định: `admin@quaypos.vn` / `123456`
- Validate client-side: email bắt buộc, pass ≥ 6 ký tự, confirm match
- `fakeDelay(700ms)` mô phỏng API call, hiện spinner trên button
- Error dùng banner đỏ, success dùng banner xanh lá

### ChangePasswordModal
- Bottom sheet trên mobile, centered modal trên desktop
- **Password strength bar** — 3 điều kiện: độ dài ≥ 6, có chữ hoa, có số
- Input `type="password"` với toggle hiện/ẩn cho cả 3 field
- Sau khi đổi thành công: hiện màn hình success 1.4s rồi tự đóng

### AdminPanel
- Nhận prop `initialTab` để mở thẳng tab cần thiết (dùng cho nút Settings)
- Nhận prop `currentUser`, `onLogout`, `onChangePassword` để render phần tài khoản trong Settings
- Tab "Cài đặt" đã bị ẩn khỏi tab bar (không hiện nút tab), chỉ truy cập qua nút gear trên navbar

### ProductGrid
- Responsive: grid 2 cột mobile, 3–4 cột desktop
- Mỗi card có emoji, tên, giá — tap/click để thêm vào giỏ
- Image fallback: emoji hiển thị nếu không có ảnh

### CartPanel
- Chỉ hiện trên màn hình ≥ tablet (hidden trên mobile, dùng drawer thay thế)
- Quantity stepper (+/−) ngay trên cart line
- Live tính VAT theo `vatRate` từ settings

### PaymentScreen
- 3 phương thức: Tiền mặt, Chuyển khoản (VietQR), Ghi nợ
- Chuyển khoản: tạo QR động từ VietQR API (`img.vietqr.io`)
- Ghi nợ: chọn khách hàng từ danh sách, tự tạo `DebtEntry`
- Animation slide khi chuyển tab thanh toán (up/down direction)

---

## Dữ liệu & State

Toàn bộ state lưu trong memory (useState), không có localStorage hay backend:

| State | Type | Mô tả |
|-------|------|-------|
| `isLoggedIn` | boolean | Gate render toàn bộ app |
| `currentUser` | string | Tên người dùng đang đăng nhập |
| `products` | Product[] | Danh mục sản phẩm |
| `cart` | CartLine[] | Giỏ hàng hiện tại |
| `orders` | Order[] | Lịch sử đơn hàng phiên này |
| `customers` | Customer[] | Danh sách khách hàng |
| `debtEntries` | DebtEntry[] | Giao dịch nợ (debit/credit) |
| `bankAccounts` | BankAccount[] | TK ngân hàng để tạo VietQR |
| `shopName` | string | Tên cửa hàng |
| `vatRate` | number | % thuế VAT |
| `dark` | boolean | Dark mode |

---

## Các pattern UI tái sử dụng

### Modal / Bottom Sheet
```
fixed inset-0 z-60 flex items-end sm:items-center
→ mobile: slide-up từ dưới (rounded-t-3xl)
→ desktop: centered dialog (rounded-3xl)
Backdrop: bg-black/50 backdrop-blur-sm, click để đóng
```

### Input field
```
px-4 py-3 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E]
outline-none focus:ring-2 focus:ring-[#007AFF]/30
```

### Primary button
```
py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold
hover:bg-[#0066CC] active:scale-[0.98] disabled:opacity-30
```

### Section label (trong form/settings)
```
text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider
```

### Card container
```
bg-white dark:bg-[#1C1C1E] rounded-2xl
ring-1 ring-black/[0.05] dark:ring-white/[0.05]
```

---

## Những gì đã được xóa / refactor

- **Màn hình Sổ ghi nợ** (`DebtScreen`) — đã xóa hoàn toàn. Thông tin nợ vẫn hiển thị trong tab Khách hàng của AdminPanel và trong flow thanh toán ghi nợ.
- **Nút Sổ ghi nợ** trên top navbar — đã xóa.
- **Tab "Cài đặt"** trong AdminPanel tab bar — đã ẩn, tách ra thành nút riêng.
- **Nút gear** → đổi thành nút gear mở Settings, thêm nút hamburger mở AdminPanel.

---

## Hướng phát triển tiếp theo

- [ ] Kết nối backend (Supabase) để lưu đơn hàng, sản phẩm, khách hàng
- [ ] Auth thật sự (JWT, session) thay vì useState mock
- [ ] Barcode scanner (camera API) để thêm sản phẩm vào giỏ
- [ ] In hóa đơn (browser print / Bluetooth receipt printer)
- [ ] Báo cáo doanh thu theo ngày/tuần/tháng với biểu đồ (Recharts)
- [ ] Offline mode với IndexedDB / localStorage
- [ ] PWA (installable, fullscreen trên iPad)

---

## Đề nghị thiết kế trong tương lai

Những ý tưởng dưới đây chưa được triển khai nhưng có giá trị cao nếu sản phẩm phát triển thêm. Mỗi mục ghi rõ lý do thiết kế, không chỉ mô tả tính năng.

---

### 1. Onboarding flow sau đăng ký

**Vấn đề hiện tại:** Người dùng mới đăng ký xong được đẩy thẳng vào màn hình POS với dữ liệu mẫu — không biết bắt đầu từ đâu.

**Đề nghị:** Thêm một wizard 3 bước sau lần đăng nhập đầu tiên:
1. Đặt tên cửa hàng + chọn loại hình (quán cà phê, shop thời trang, tạp hóa...)
2. Thêm sản phẩm đầu tiên (hoặc import từ Excel)
3. Cài đặt ngân hàng để nhận chuyển khoản

**Lý do:** First-run experience quyết định retention. Người dùng bỏ cuộc trong 5 phút đầu nếu không hiểu giá trị của app.

---

### 2. Màn hình khoá quầy (Lock Screen)

**Vấn đề hiện tại:** Không có cơ chế bảo vệ khi nhân viên rời quầy — ai cũng có thể thao tác.

**Đề nghị:** Nút khoá trên navbar → màn hình mờ hiển thị tên cửa hàng + logo, yêu cầu nhập PIN 4 số để mở lại. PIN khác với mật khẩu tài khoản — dùng riêng cho ca làm việc.

**Lý do:** Quán cà phê, shop nhỏ thường có nhiều nhân viên dùng chung máy tính tiền. Lock screen ngăn thao tác ngoài ý muốn mà không cần đăng xuất/đăng nhập lại mỗi lần.

---

### 3. Chế độ hiển thị khách hàng (Customer Display)

**Vấn đề hiện tại:** Khách hàng đứng trước quầy không thấy gì trong lúc nhân viên tính tiền.

**Đề nghị:** Một tab/window thứ hai (hoặc màn hình thứ 2 qua `window.open`) hiển thị giỏ hàng, tổng tiền, QR thanh toán theo thời gian thực. Thiết kế tối giản: font lớn, nền trắng sạch, chỉ hiện những gì khách cần biết.

**Lý do:** Tạo sự minh bạch, tăng tin tưởng, đặc biệt quan trọng với khách mới. Là chuẩn của POS chuyên nghiệp.

---

### 4. Quản lý ca làm việc (Shift Management)

**Vấn đề hiện tại:** Không phân biệt được đơn hàng của ca sáng và ca chiều — tổng quan hiển thị tất cả trong ngày.

**Đề nghị:** Nút "Bắt đầu ca" / "Kết thúc ca" trong navbar hoặc màn hình lock. Khi kết thúc ca, hiển thị tổng kết: số đơn, doanh thu, so sánh với ca trước. Mỗi `Order` được gắn `shiftId`.

**Lý do:** Cửa hàng nhiều ca (sáng/chiều/tối) cần quyết toán theo ca, không phải theo ngày. Đây là nhu cầu thực tế của phần lớn quán ăn nhỏ.

---

### 5. Combo & biến thể sản phẩm

**Vấn đề hiện tại:** Mỗi sản phẩm chỉ có một giá cố định — không hỗ trợ size (S/M/L), topping, hay combo.

**Đề nghị:**
- **Biến thể:** Mỗi sản phẩm có thể có nhiều option (Size: S/M/L, Đá: ít/vừa/nhiều, Đường: 30%/50%/100%). Option có thể điều chỉnh giá.
- **Combo:** Nhóm nhiều sản phẩm lại, đặt giá combo thấp hơn tổng lẻ.
- **UX đề nghị:** Khi tap sản phẩm có biến thể → mở bottom sheet chọn option trước khi thêm vào giỏ.

**Lý do:** Đây là điểm đau lớn nhất của quán trà sữa và cà phê — 90% sản phẩm có size và topping. Thiếu tính năng này khiến app không dùng được cho phần lớn cửa hàng mục tiêu.

---

### 6. Tìm kiếm toàn cục với shortcut bàn phím

**Vấn đề hiện tại:** Thanh tìm kiếm hiện tại chỉ lọc sản phẩm theo tên. Không có shortcut bàn phím.

**Đề nghị:**
- `Cmd/Ctrl + K` → mở command palette toàn cục: tìm sản phẩm, khách hàng, đơn hàng cũ, mở màn hình settings
- Hiện kết quả theo nhóm (sản phẩm / khách hàng / lệnh)
- Nhấn `Esc` để đóng

**Lý do:** Nhân viên quầy thao tác nhanh hơn nhiều với bàn phím. Command palette là pattern đã được chứng minh (Linear, Notion, Raycast). Đặc biệt hữu ích trên desktop/laptop.

---

### 7. Thông báo trong app (In-app Notifications)

**Vấn đề hiện tại:** Không có cơ chế thông báo — người dùng không biết khi nào có đơn hàng mới từ thiết bị khác, hay khi sắp hết hàng.

**Đề nghị:** Bell icon trên navbar, dropdown hiển thị:
- Cảnh báo hết hàng (số lượng tồn < ngưỡng cài đặt)
- Nhắc nhở khách hàng chưa trả nợ lâu ngày
- Tóm tắt cuối ngày (tự động lúc 22:00)

**Lý do:** Thông báo chủ động giảm tải nhận thức — người dùng không cần nhớ hay kiểm tra thủ công.

---

### 8. Giao diện tablet hai cột tối ưu hơn

**Vấn đề hiện tại:** Layout hai cột (sản phẩm + giỏ hàng) chỉ được chia theo breakpoint `lg`. Trên iPad 11" theo chiều dọc, tỷ lệ cột chưa tối ưu.

**Đề nghị:**
- Cho phép kéo thả thanh chia (drag handle) để điều chỉnh tỷ lệ hai cột
- Ghi nhớ tỷ lệ ưa thích vào localStorage
- Cột giỏ hàng có thể thu gọn hoàn toàn thành icon badge khi cần xem toàn bộ sản phẩm

**Lý do:** Mỗi quán có mật độ menu khác nhau. Quán ít món cần cột giỏ to hơn; quán nhiều món cần cột sản phẩm to hơn.

---

### 9. Theme màu theo thương hiệu

**Vấn đề hiện tại:** Màu chủ đạo cố định là `#007AFF` (xanh Apple). Mọi cửa hàng đều trông giống nhau.

**Đề nghị:** Trong Settings → Giao diện, cho phép chọn màu accent từ bảng preset (xanh lam, xanh lá, cam, tím, hồng). Màu được lưu vào CSS custom property `--color-accent` và áp dụng toàn bộ app ngay lập tức.

**Lý do:** Nhận diện thương hiệu quan trọng với chủ cửa hàng. Chi phí triển khai thấp nhưng giá trị cảm nhận cao — tạo cảm giác app "là của mình".

---

### 10. Lịch sử chỉnh sửa đơn hàng (Order Edit Log)

**Vấn đề hiện tại:** Sau khi đơn được tạo, không thể sửa và không có audit trail.

**Đề nghị:**
- Cho phép void (huỷ) đơn hàng với lý do bắt buộc
- Cho phép refund một phần (trả lại tiền một mặt hàng cụ thể)
- Mỗi thao tác void/refund được ghi log: ai làm, lúc mấy giờ, lý do gì

**Lý do:** Sai sót khi nhập đơn là thường xuyên. Không có cách sửa khiến số liệu doanh thu bị sai và tạo ra sự khó chịu lớn cho người dùng. Audit trail cũng bảo vệ chủ cửa hàng khi có tranh chấp với nhân viên.
