-- ==============================================================================
-- GIẢI PHÁP TRIỆT ĐỂ: TẮT RLS TRÊN TẤT CẢ CÁC BẢNG DỮ LIỆU
-- Giúp ứng dụng POS có toàn quyền Đọc / Ghi / Sửa / Xóa vĩnh viễn không bao giờ bị lỗi quyền
-- Chạy toàn bộ file này trong: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Lưu ý: Không bôi đen bất kỳ dòng nào, bấm trực tiếp nút RUN
-- ==============================================================================

-- 1. TẮT RLS HOÀN TOÀN TRÊN TẤT CẢ CÁC BẢNG DỮ LIỆU CỦA POS
alter table public.products disable row level security;
alter table public.product_variants disable row level security;
alter table public.customers disable row level security;
alter table public.suppliers disable row level security;
alter table public.debt_entries disable row level security;
alter table public.orders disable row level security;
alter table public.order_lines disable row level security;
alter table public.stock_receipts disable row level security;
alter table public.stock_in_items disable row level security;
alter table public.bank_accounts disable row level security;
alter table public.shop_settings disable row level security;

-- 2. TỰ ĐỘNG DỌN DẸP POLICY STORAGE CŨ
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'storage' AND tablename = 'objects'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- 3. ĐẢM BẢO BUCKET STORAGE 'products' TỒN TẠI VÀ PUBLIC
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do update set public = true;

-- 4. CẤP TOÀN QUYỀN CHO STORAGE BUCKET 'products' (XEM, TẢI ẢNH, SỬA, XÓA)
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
