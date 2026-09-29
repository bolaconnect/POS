import { supabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * Upload ảnh sản phẩm lên Supabase Storage bucket 'products'
 * @param file File ảnh được chọn từ input
 * @returns Link URL công khai của ảnh, hoặc null nếu lỗi
 */
export async function uploadProductImage(file: File): Promise<string | null> {
  if (!isSupabaseConfigured) {
    // Nếu chưa kết nối Supabase, fallback sang Object URL tạm thời trong phiên
    return URL.createObjectURL(file)
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
