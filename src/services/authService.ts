import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export interface AuthUser {
  id: string
  email: string
  name: string
}

/**
 * Đăng nhập bằng Email và Mật khẩu qua Supabase
 */
export async function signIn(email: string, password: string): Promise<{ user: AuthUser | null; error: string | null }> {
  if (!isSupabaseConfigured) {
    // Fallback demo account
    if (email === 'admin@quaypos.vn' && password === '123456') {
      return { user: { id: 'demo-1', email, name: 'Admin' }, error: null }
    }
    return { user: null, error: 'Chưa kết nối Supabase hoặc tài khoản demo không đúng (admin@quaypos.vn / 123456)' }
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { user: null, error: 'Email hoặc mật khẩu không chính xác.' }
      }
      if (error.message.includes('Email not confirmed')) {
        return { user: null, error: 'Email này chưa được xác nhận. Vui lòng kiểm tra hộp thư của bạn.' }
      }
      return { user: null, error: error.message }
    }

    if (!data.user) {
      return { user: null, error: 'Đăng nhập không thành công.' }
    }

    const name = data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'Người dùng'
    return {
      user: {
        id: data.user.id,
        email: data.user.email || '',
        name,
      },
      error: null,
    }
  } catch (err: any) {
    return { user: null, error: err.message || 'Lỗi kết nối máy chủ.' }
  }
}

/**
 * Đăng ký tài khoản mới trên Supabase
 */
export async function signUp(email: string, password: string, fullName: string): Promise<{ success: boolean; message: string; requiresConfirmation: boolean; error: string | null }> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      message: '',
      requiresConfirmation: false,
      error: 'Vui lòng điền thông tin Supabase vào .env.local để tạo tài khoản thật.',
    }
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
        },
      },
    })

    if (error) {
      if (error.message.includes('User already registered')) {
        return { success: false, message: '', requiresConfirmation: false, error: 'Email này đã được đăng ký.' }
      }
      return { success: false, message: '', requiresConfirmation: false, error: error.message }
    }

    // Nếu Supabase bật confirm email thì data.session sẽ null
    const requiresConfirmation = !data.session

    return {
      success: true,
      message: requiresConfirmation
        ? 'Đăng ký thành công! Vui lòng kiểm tra hộp thư email để kích hoạt tài khoản.'
        : 'Đăng ký thành công!',
      requiresConfirmation,
      error: null,
    }
  } catch (err: any) {
    return { success: false, message: '', requiresConfirmation: false, error: err.message || 'Lỗi kết nối máy chủ.' }
  }
}

/**
 * Đăng xuất khỏi hệ thống
 */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Lỗi khi đăng xuất:', err)
    }
  }
}

/**
 * Gửi email đặt lại mật khẩu
 */
export async function sendPasswordReset(email: string): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { success: true, error: null }
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi gửi yêu cầu đặt lại mật khẩu.' }
  }
}

/**
 * Đổi mật khẩu tài khoản hiện tại
 */
export async function updatePassword(newPassword: string): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured) {
    return { success: true, error: null }
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, error: null }
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi đổi mật khẩu.' }
  }
}

/**
 * Lấy phiên đăng nhập hiện tại
 */
export async function getCurrentSession(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured) return null

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || !session.user) return null

    return {
      id: session.user.id,
      email: session.user.email || '',
      name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Người dùng',
    }
  } catch (err) {
    console.error('Lỗi kiểm tra phiên đăng nhập:', err)
    return null
  }
}
