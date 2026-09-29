-- ==============================================================================
-- SCRIPT XÓA TRẮNG TOÀN BỘ DỮ LIỆU & RESET ID TỰ TĂNG VỀ 1
-- Chạy script này trong: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ==============================================================================

-- 1. Xóa sạch dữ liệu trong tất cả các bảng và reset ID tự tăng về 1
truncate table 
  public.order_lines,
  public.orders,
  public.product_variants,
  public.products,
  public.debt_entries,
  public.customers,
  public.stock_in_items,
  public.stock_receipts,
  public.suppliers,
  public.bank_accounts
restart identity cascade;

-- 2. (Tùy chọn) Nếu muốn xóa luôn cả ảnh sản phẩm trong Storage:
-- delete from storage.objects where bucket_id = 'products';
