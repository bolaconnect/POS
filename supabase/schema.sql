-- ==============================================================================
-- SCHEMA CHO ỨNG DỤNG BÁN HÀNG POS (SUPABASE POSTGRESQL)
-- Chạy toàn bộ file này trong: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Lưu ý: Bấm Ctrl + A (chọn tất cả) rồi mới bấm Run để không bị sót dòng lệnh
-- ==============================================================================

-- 1. Bảng Sản phẩm (Products)
create table if not exists public.products (
  id serial primary key,
  name text not null,
  price int not null default 0,
  cost_price int default 0,
  stock int default 0,
  unit text default 'ly',
  category text default 'Khác',
  emoji text default '📦',
  image text,
  created_at timestamptz default now()
);

-- 2. Bảng Biến thể sản phẩm (Product Variants)
create table if not exists public.product_variants (
  id text primary key,
  product_id int not null references public.products(id) on delete cascade,
  name text not null,
  price int not null default 0,
  cost_price int default 0,
  stock int default 0
);

-- 3. Bảng Khách hàng (Customers)
create table if not exists public.customers (
  id serial primary key,
  name text not null,
  phone text,
  note text,
  created_at timestamptz default now()
);

-- 4. Bảng Nhà cung cấp / Đại lý (Suppliers)
create table if not exists public.suppliers (
  id serial primary key,
  name text not null,
  phone text,
  contact_person text,
  address text,
  category text,
  debt int default 0,
  note text,
  created_at timestamptz default now()
);

-- 5. Bảng Sổ nợ khách hàng (Debt Entries)
create table if not exists public.debt_entries (
  id serial primary key,
  customer_id int not null references public.customers(id) on delete cascade,
  type text not null check (type in ('debit', 'credit')),
  amount int not null default 0,
  note text,
  order_id int,
  time timestamptz default now()
);

-- 6. Bảng Đơn hàng (Orders)
create table if not exists public.orders (
  id serial primary key,
  subtotal int not null default 0,
  tax int not null default 0,
  total int not null default 0,
  method text not null default 'cash',
  cash_given int default 0,
  change int default 0,
  time timestamptz default now()
);

-- 7. Bảng Chi tiết đơn hàng (Order Lines)
create table if not exists public.order_lines (
  id serial primary key,
  order_id int not null references public.orders(id) on delete cascade,
  product_id int references public.products(id) on delete set null,
  product_name text not null,
  variant_id text,
  variant_name text,
  qty int not null default 1,
  price int not null default 0
);

-- 8. Bảng Phiếu nhập kho (Stock In Receipts)
create table if not exists public.stock_receipts (
  id serial primary key,
  code text not null,
  date timestamptz default now(),
  supplier text,
  total_cost int not null default 0,
  note text
);

-- 9. Bảng Chi tiết phiếu nhập kho (Stock In Items)
create table if not exists public.stock_in_items (
  id serial primary key,
  receipt_id int not null references public.stock_receipts(id) on delete cascade,
  product_id int,
  product_name text,
  variant_id text,
  variant_name text,
  emoji text default '📦',
  unit text,
  qty int not null default 1,
  cost_price int not null default 0,
  total int not null default 0
);

-- 10. Bảng Tài khoản ngân hàng (Bank Accounts)
create table if not exists public.bank_accounts (
  id serial primary key,
  bank_bin text not null,
  bank_short_name text not null,
  bank_name text not null,
  account_no text not null,
  account_name text not null,
  is_primary boolean default false
);

-- 11. Bảng Cài đặt cửa hàng (Shop Settings)
create table if not exists public.shop_settings (
  key text primary key,
  value text
);

-- ==============================================================================
-- BẬT ROW LEVEL SECURITY (RLS) & CẤP QUYỀN CHO ANON (Dành cho POS kết nối trực tiếp)
-- ==============================================================================

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.debt_entries enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.stock_receipts enable row level security;
alter table public.stock_in_items enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.shop_settings enable row level security;

-- Xóa policy cũ nếu có trước khi tạo mới để tránh lỗi duplicate
drop policy if exists "Anon full access products" on public.products;
drop policy if exists "Allow all access products" on public.products;
create policy "Allow all access products" on public.products for all to public using (true) with check (true);

drop policy if exists "Anon full access product_variants" on public.product_variants;
drop policy if exists "Allow all access product_variants" on public.product_variants;
create policy "Allow all access product_variants" on public.product_variants for all to public using (true) with check (true);

drop policy if exists "Anon full access customers" on public.customers;
drop policy if exists "Allow all access customers" on public.customers;
create policy "Allow all access customers" on public.customers for all to public using (true) with check (true);

drop policy if exists "Anon full access suppliers" on public.suppliers;
drop policy if exists "Allow all access suppliers" on public.suppliers;
create policy "Allow all access suppliers" on public.suppliers for all to public using (true) with check (true);

drop policy if exists "Anon full access debt_entries" on public.debt_entries;
drop policy if exists "Allow all access debt_entries" on public.debt_entries;
create policy "Allow all access debt_entries" on public.debt_entries for all to public using (true) with check (true);

drop policy if exists "Anon full access orders" on public.orders;
drop policy if exists "Allow all access orders" on public.orders;
create policy "Allow all access orders" on public.orders for all to public using (true) with check (true);

drop policy if exists "Anon full access order_lines" on public.order_lines;
drop policy if exists "Allow all access order_lines" on public.order_lines;
create policy "Allow all access order_lines" on public.order_lines for all to public using (true) with check (true);

drop policy if exists "Anon full access stock_receipts" on public.stock_receipts;
drop policy if exists "Allow all access stock_receipts" on public.stock_receipts;
create policy "Allow all access stock_receipts" on public.stock_receipts for all to public using (true) with check (true);

drop policy if exists "Anon full access stock_in_items" on public.stock_in_items;
drop policy if exists "Allow all access stock_in_items" on public.stock_in_items;
create policy "Allow all access stock_in_items" on public.stock_in_items for all to public using (true) with check (true);

drop policy if exists "Anon full access bank_accounts" on public.bank_accounts;
drop policy if exists "Allow all access bank_accounts" on public.bank_accounts;
create policy "Allow all access bank_accounts" on public.bank_accounts for all to public using (true) with check (true);

drop policy if exists "Anon full access shop_settings" on public.shop_settings;
drop policy if exists "Allow all access shop_settings" on public.shop_settings;
create policy "Allow all access shop_settings" on public.shop_settings for all to public using (true) with check (true);

-- ==============================================================================
-- CẤU HÌNH SUPABASE STORAGE CHO ẢNH SẢN PHẨM
-- ==============================================================================
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do update set public = true;

drop policy if exists "Public view product images" on storage.objects;
drop policy if exists "Anon upload product images" on storage.objects;
drop policy if exists "Anon delete product images" on storage.objects;
drop policy if exists "Allow all view product images" on storage.objects;
drop policy if exists "Allow all upload product images" on storage.objects;
drop policy if exists "Allow all update product images" on storage.objects;
drop policy if exists "Allow all delete product images" on storage.objects;

create policy "Allow all view product images"
  on storage.objects for select
  to public
  using (bucket_id = 'products');

create policy "Allow all upload product images"
  on storage.objects for insert
  to public
  with check (bucket_id = 'products');

create policy "Allow all update product images"
  on storage.objects for update
  to public
  using (bucket_id = 'products');

create policy "Allow all delete product images"
  on storage.objects for delete
  to public
  using (bucket_id = 'products');

-- ==============================================================================
-- DỮ LIỆU MẪU BAN ĐẦU (SEED DATA)
-- ==============================================================================

-- Cài đặt mặc định
insert into public.shop_settings (key, value) values
  ('shop_name', 'Cửa hàng của tôi'),
  ('vat_rate', '10'),
  ('units', '["ly","cốc","chai","lon","phần","suất","đĩa","tô","bát","ổ","cái","kg","lạng","g","hộp","gói","bịch","thanh","cây","trái"]')
on conflict (key) do nothing;

-- Dữ liệu mẫu Nhà cung cấp
insert into public.suppliers (id, name, phone, contact_person, address, category, debt, note) values
  (1, 'Đại lý Bia & Nước ngọt Hoàng Phát', '0908 123 456', 'Anh Hoàng (Giao sáng 8h-11h)', '45/2 Tô Hiến Thành, Q.10, TP.HCM', 'Đồ uống & Giải khát', 3500000, 'Chiết khấu 3% đơn trên 5 triệu, nợ gối đầu'),
  (2, 'Công ty Nguyên liệu Trà Sữa Phúc Thịnh', '0933 888 999', 'Chị Mai Sale', 'Lô C Chợ Đầu Mối Bình Điền', 'Trà & Bột & Thạch', 0, 'Giao thứ 2 và thứ 5 hàng tuần'),
  (3, 'Xưởng Bánh & Bao bì Minh Tâm', '0912 345 678', 'Chú Tâm', '120 Kha Vạn Cân, Thủ Đức', 'Bao bì & Ly hộp', 1200000, 'Cung cấp ly giấy, ống hút, hộp mang về')
on conflict (id) do nothing;

-- Dữ liệu mẫu Khách hàng
insert into public.customers (id, name, phone, note) values
  (1, 'Nguyễn Văn Bình', '0901 234 567', 'Khách quen buổi sáng'),
  (2, 'Trần Thị Mai', '0912 345 678', ''),
  (3, 'Lê Hoàng Nam', '0923 456 789', 'Nhân viên văn phòng gần đây')
on conflict (id) do nothing;

-- Dữ liệu mẫu Sản phẩm
insert into public.products (id, name, price, cost_price, stock, unit, category, emoji) values
  (1, 'Trà sữa trân châu', 35000, 15000, 45, 'ly', 'Đồ uống', '🧋'),
  (2, 'Cà phê sữa đá', 25000, 9000, 80, 'ly', 'Đồ uống', '☕'),
  (3, 'Nước cam ép', 30000, 12000, 35, 'ly', 'Đồ uống', '🍊'),
  (4, 'Sinh tố xoài', 40000, 18000, 20, 'ly', 'Đồ uống', '🥭'),
  (5, 'Nước dừa tươi', 28000, 16000, 15, 'trái', 'Đồ uống', '🥥'),
  (6, 'Soda chanh muối', 22000, 8000, 25, 'ly', 'Đồ uống', '🍋'),
  (7, 'Bánh mì thịt', 20000, 9000, 40, 'ổ', 'Đồ ăn', '🥖'),
  (8, 'Xôi gà', 30000, 14000, 25, 'hộp', 'Đồ ăn', '🍱'),
  (9, 'Phở bò tái', 55000, 28000, 30, 'tô', 'Đồ ăn', '🍜'),
  (10, 'Bún bò Huế', 50000, 25000, 35, 'tô', 'Đồ ăn', '🍲'),
  (11, 'Bánh cuốn', 25000, 11000, 20, 'đĩa', 'Đồ ăn', '🫔'),
  (12, 'Cơm sườn nướng', 45000, 22000, 30, 'đĩa', 'Đồ ăn', '🍛'),
  (13, 'Kem vani', 15000, 7000, 4, 'cây', 'Bánh & Kem', '🍦'),
  (14, 'Kem dâu', 18000, 8000, 18, 'cây', 'Bánh & Kem', '🍓'),
  (15, 'Bánh tiramisu', 45000, 24000, 12, 'cái', 'Bánh & Kem', '🎂'),
  (16, 'Bánh croissant', 22000, 10000, 15, 'cái', 'Bánh & Kem', '🥐'),
  (17, 'Nước suối 500ml', 8000, 3500, 120, 'chai', 'Khác', '💧'),
  (18, 'Kẹo dừa Bến Tre', 12000, 6000, 40, 'gói', 'Khác', '🍬'),
  (19, 'Snack khoai tây', 15000, 8000, 50, 'gói', 'Khác', '🥔'),
  (20, 'Kẹo cao su', 5000, 2500, 65, 'thanh', 'Khác', '🍃')
on conflict (id) do nothing;

-- Dữ liệu mẫu Biến thể
insert into public.product_variants (id, product_id, name, price, cost_price, stock) values
  ('v1_m', 1, 'Size M', 30000, 12000, 25),
  ('v1_l', 1, 'Size L', 38000, 16000, 15),
  ('v1_bottle', 1, 'Chai 500ml', 45000, 20000, 5),
  ('v7_reg', 7, 'Ổ thường', 20000, 9000, 25),
  ('v7_spec', 7, 'Ổ đặc biệt nhiều thịt', 30000, 14000, 15),
  ('v8_25', 8, 'Hộp 25k', 25000, 11000, 10),
  ('v8_30', 8, 'Hộp 30k', 30000, 14000, 10),
  ('v8_50', 8, 'Hộp 50k (đặc biệt)', 50000, 25000, 5),
  ('v9_reg', 9, 'Tô vừa', 50000, 25000, 15),
  ('v9_big', 9, 'Tô lớn', 60000, 30000, 10),
  ('v9_spec', 9, 'Tô đặc biệt', 75000, 40000, 5)
on conflict (id) do nothing;

-- Đồng bộ lại sequence id tự tăng
select setval(pg_get_serial_sequence('public.products', 'id'), coalesce((select max(id) from public.products), 1));
select setval(pg_get_serial_sequence('public.customers', 'id'), coalesce((select max(id) from public.customers), 1));
select setval(pg_get_serial_sequence('public.suppliers', 'id'), coalesce((select max(id) from public.suppliers), 1));
