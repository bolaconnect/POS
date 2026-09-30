import { supabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * Upload ảnh sản phẩm lên Supabase Storage bucket 'products'
 * @param file File ảnh được chọn từ input
 * @returns Link URL công khai của ảnh, hoặc null nếu lỗi
 */
export async function uploadProductImage(file: File): Promise<string | null> {
  if (!isSupabaseConfigured) {
    // Không có Supabase → trả null, base64 từ caller sẽ được dùng
    return null
  }

  try {
    const fileExt = file.name.split('.').pop() || 'png'
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`
    const filePath = `items/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('products')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      console.error('Lỗi khi tải ảnh lên Supabase Storage:', uploadError)
      return null
    }

    const { data } = supabase.storage.from('products').getPublicUrl(filePath)
    return data.publicUrl
  } catch (err) {
    console.error('Lỗi ngoại lệ khi upload ảnh:', err)
    return null
  }
}
