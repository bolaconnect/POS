import { createClient } from '@supabase/supabase-js'

// Tự động chuẩn hóa URL (bỏ /rest/v1 hoặc dấu / ở cuối nếu có)
const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string || '').trim()
const SUPABASE_URL = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string || '').trim()

if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
  console.warn(
    '[Supabase] Chưa cấu hình .env.local — dữ liệu sẽ chỉ lưu trong bộ nhớ.\n' +
    'Tạo file .env.local và điền VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder'
)

/** Kiểm tra xem Supabase đã được cấu hình chưa */
export const isSupabaseConfigured =
  !!SUPABASE_URL &&
  !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
  !!SUPABASE_ANON_KEY &&
  !SUPABASE_ANON_KEY.includes('YOUR_ANON_KEY')
