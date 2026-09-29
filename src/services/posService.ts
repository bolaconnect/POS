import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type {
  Product,
  ProductVariant,
  Customer,
  Supplier,
  DebtEntry,
  Order,
  CartLine,
  StockInReceipt,
  StockInItem,
  BankAccount,
} from '@/types/pos'

// ==============================================================================
// 1. PRODUCTS & VARIANTS
// ==============================================================================

export async function fetchProducts(): Promise<Product[] | null> {
  if (!isSupabaseConfigured) return null

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_variants(*)')
      .order('id', { ascending: true })

    if (error) throw error

    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      costPrice: row.cost_price,
      stock: row.stock,
      unit: row.unit,
      category: row.category,
      emoji: row.emoji,
      image: row.image,
      variants: (row.product_variants || []).map((v: any) => ({
        id: v.id,
        name: v.name,
        price: v.price,
        costPrice: v.cost_price,
        stock: v.stock,
      })),
    }))
  } catch (err) {
    console.error('Lỗi tải sản phẩm từ Supabase:', err)
    return null
  }
}

export async function upsertProduct(product: Product, isEdit: boolean = false): Promise<number | null> {
  if (!isSupabaseConfigured) return product.id

  try {
    const productData: any = {
      name: product.name,
      price: product.price,
      cost_price: product.costPrice ?? null,
      stock: product.stock ?? null,
      unit: product.unit || 'ly',
      category: product.category,
      emoji: product.emoji,
      image: product.image ?? null,
    }

    let productId = product.id
    const shouldUpdate = isEdit === true || (isEdit === undefined && productId > 0 && productId < 1000000000)

    if (shouldUpdate && productId > 0) {
      // Cập nhật sản phẩm
      const { data, error } = await supabase
        .from('products')
        .update(productData)
        .eq('id', productId)
        .select('id')
      if (error) {
        console.error('Lỗi Supabase khi cập nhật sản phẩm:', error)
        throw error
      }
      // Nếu không tìm thấy id cần update (ví dụ do id tạm), chuyển sang thêm mới
      if (!data || data.length === 0) {
        console.warn(`Không tìm thấy sản phẩm id=${productId} để cập nhật, chuyển sang thêm mới...`)
        const { data: insData, error: insError } = await supabase
          .from('products')
          .insert(productData)
          .select('id')
          .single()
        if (insError) {
          console.error('Lỗi Supabase khi thêm mới sản phẩm fallback:', insError)
          throw insError
        }
        productId = insData.id
      }
    } else {
      // Thêm mới hoàn toàn
      const { data, error } = await supabase
        .from('products')
        .insert(productData)
        .select('id')
        .single()
      if (error) {
        console.error('Lỗi Supabase khi thêm mới sản phẩm:', error)
        throw error
      }
      productId = data.id
    }

    // Cập nhật biến thể nếu có
    if (product.variants && product.variants.length > 0) {
      await supabase
        .from('product_variants')
        .delete()
        .eq('product_id', productId)

      const variantRows = product.variants.map((v, idx) => ({
        id: v.id || `v_${productId}_${idx}_${Date.now()}`,
        product_id: productId,
        name: v.name,
        price: v.price,
        cost_price: v.costPrice ?? null,
        stock: v.stock ?? null,
      }))

      const { error: vError } = await supabase
        .from('product_variants')
        .insert(variantRows)
      if (vError) {
        console.error('Lỗi Supabase khi thêm biến thể sản phẩm:', vError)
        throw vError
      }
    } else {
      await supabase
        .from('product_variants')
        .delete()
        .eq('product_id', productId)
    }

    console.log(`✅ Lưu sản phẩm thành công vào Supabase! ID: ${productId}`)
    return productId
  } catch (err: any) {
    console.error('❌ Lỗi lưu sản phẩm vào Supabase:', err?.message || err)
    return null
  }
}

export async function deleteProduct(productId: number): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  try {
    const { error } = await supabase.from('products').delete().eq('id', productId)
    if (error) throw error
    return true
  } catch (err) {
    console.error('Lỗi xóa sản phẩm:', err)
    return false
  }
}

// ==============================================================================
// 2. CUSTOMERS
// ==============================================================================

export async function fetchCustomers(): Promise<Customer[] | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('id', { ascending: false })
    if (error) throw error
    return (data || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      note: c.note || '',
    }))
  } catch (err) {
    console.error('Lỗi tải khách hàng:', err)
    return null
  }
}

export async function upsertCustomer(customer: Customer, isEdit?: boolean): Promise<number | null> {
  if (!isSupabaseConfigured) return customer.id
  try {
    const custData = {
      name: customer.name.trim(),
      phone: customer.phone ? customer.phone.trim() : null,
      note: customer.note ? customer.note.trim() : null,
    }
    const shouldUpdate = isEdit === true || (isEdit === undefined && customer.id > 0 && customer.id < 1000000000)

    if (shouldUpdate && customer.id > 0) {
      const { data, error } = await supabase
        .from('customers')
        .update(custData)
        .eq('id', customer.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        console.warn(`Không tìm thấy khách hàng id=${customer.id} để cập nhật, thêm mới...`)
        const { data: insData, error: insErr } = await supabase
          .from('customers')
          .insert(custData)
          .select('id')
          .single()
        if (insErr) throw insErr
        return insData.id
      }
      return customer.id
    } else {
      const { data, error } = await supabase
        .from('customers')
        .insert(custData)
        .select('id')
        .single()
      if (error) throw error
      console.log(`✅ Lưu khách hàng thành công vào Supabase! ID: ${data.id}`)
      return data.id
    }
  } catch (err: any) {
    console.error('❌ Lỗi lưu khách hàng vào Supabase:', err?.message || err)
    return null
  }
}

export async function deleteCustomer(id: number): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  try {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) throw error
    return true
  } catch (err) {
    console.error('Lỗi xóa khách hàng:', err)
    return false
  }
}

// ==============================================================================
// 3. SUPPLIERS
// ==============================================================================

export async function fetchSuppliers(): Promise<Supplier[] | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('id', { ascending: false })
    if (error) throw error
    return (data || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      phone: s.phone || undefined,
      contactPerson: s.contact_person || undefined,
      address: s.address || undefined,
      category: s.category || undefined,
      debt: s.debt || 0,
      note: s.note || undefined,
    }))
  } catch (err) {
    console.error('Lỗi tải nhà cung cấp:', err)
    return null
  }
}

export async function upsertSupplier(supplier: Supplier, isEdit?: boolean): Promise<number | null> {
  if (!isSupabaseConfigured) return supplier.id
  try {
    const row = {
      name: supplier.name.trim(),
      phone: supplier.phone ? supplier.phone.trim() : null,
      contact_person: supplier.contactPerson ? supplier.contactPerson.trim() : null,
      address: supplier.address ? supplier.address.trim() : null,
      category: supplier.category ? supplier.category.trim() : null,
      debt: supplier.debt || 0,
      note: supplier.note ? supplier.note.trim() : null,
    }
    const shouldUpdate = isEdit === true || (isEdit === undefined && supplier.id > 0 && supplier.id < 1000000000)

    if (shouldUpdate && supplier.id > 0) {
      const { data, error } = await supabase.from('suppliers').update(row).eq('id', supplier.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        console.warn(`Không tìm thấy nhà cung cấp id=${supplier.id} để cập nhật, thêm mới...`)
        const { data: insData, error: insErr } = await supabase
          .from('suppliers')
          .insert(row)
          .select('id')
          .single()
        if (insErr) throw insErr
        return insData.id
      }
      return supplier.id
    } else {
      const { data, error } = await supabase.from('suppliers').insert(row).select('id').single()
      if (error) throw error
      console.log(`✅ Lưu nhà cung cấp thành công vào Supabase! ID: ${data.id}`)
      return data.id
    }
  } catch (err: any) {
    console.error('❌ Lỗi lưu nhà cung cấp vào Supabase:', err?.message || err)
    return null
  }
}

export async function deleteSupplier(id: number): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  try {
    const { error } = await supabase.from('suppliers').delete().eq('id', id)
    if (error) throw error
    return true
  } catch (err) {
    console.error('Lỗi xóa nhà cung cấp:', err)
    return false
  }
}

// ==============================================================================
// 4. DEBT ENTRIES (SỔ NỢ)
// ==============================================================================

export async function fetchDebtEntries(): Promise<DebtEntry[] | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('debt_entries')
      .select('*')
      .order('time', { ascending: false })
    if (error) throw error
    return (data || []).map((d: any) => ({
      id: d.id,
      customerId: d.customer_id,
      type: d.type,
      amount: d.amount,
      note: d.note || '',
      orderId: d.order_id || undefined,
      time: new Date(d.time),
    }))
  } catch (err) {
    console.error('Lỗi tải sổ nợ:', err)
    return null
  }
}

export async function addDebtEntry(entry: Omit<DebtEntry, 'id'>): Promise<number | null> {
  if (!isSupabaseConfigured) return Date.now()
  // Tránh gửi ID tạm thời vượt giới hạn số nguyên 32-bit (2,147,483,647) của PostgreSQL
  if (entry.customerId >= 2000000000) {
    console.warn('Bỏ qua lưu ghi nợ vì customerId là ID tạm thời chưa có trong DB:', entry.customerId)
    return null
  }
  try {
    const { data, error } = await supabase
      .from('debt_entries')
      .insert({
        customer_id: entry.customerId,
        type: entry.type,
        amount: entry.amount,
        note: entry.note,
        order_id: entry.orderId || null,
        time: entry.time ? entry.time.toISOString() : new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  } catch (err: any) {
    console.error('Lỗi thêm ghi nợ:', err?.message || err)
    return null
  }
}

// ==============================================================================
// 5. ORDERS & ORDER LINES
// ==============================================================================

export async function fetchOrders(): Promise<Order[] | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_lines(*)')
      .order('id', { ascending: false })
    if (error) throw error

    return (data || []).map((o: any) => ({
      id: o.id,
      subtotal: o.subtotal,
      tax: o.tax,
      total: o.total,
      method: o.method,
      cashGiven: o.cash_given,
      change: o.change,
      time: new Date(o.time),
      lines: (o.order_lines || []).map((l: any) => ({
        product: {
          id: l.product_id,
          name: l.product_name,
          price: l.price,
          category: 'Đồ uống',
          emoji: '🛒',
        },
        variant: l.variant_id
          ? {
              id: l.variant_id,
              name: l.variant_name,
              price: l.price,
            }
          : undefined,
        qty: l.qty,
      })),
    }))
  } catch (err) {
    console.error('Lỗi tải đơn hàng:', err)
    return null
  }
}

export async function createOrder(order: Order): Promise<number | null> {
  if (!isSupabaseConfigured) return order.id
  try {
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
        method: order.method,
        cash_given: order.cashGiven,
        change: order.change,
        time: order.time ? order.time.toISOString() : new Date().toISOString(),
      })
      .select('id')
      .single()

    if (orderError) throw orderError
    const orderId = orderData.id

    if (order.lines && order.lines.length > 0) {
      const lineRows = order.lines.map(l => ({
        order_id: orderId,
        product_id: l.product.id || null,
        product_name: l.product.name,
        variant_id: l.variant?.id || null,
        variant_name: l.variant?.name || null,
        qty: l.qty,
        price: l.variant?.price ?? l.product.price,
      }))

      const { error: lineError } = await supabase
        .from('order_lines')
        .insert(lineRows)
      if (lineError) throw lineError
    }

    return orderId
  } catch (err) {
    console.error('Lỗi tạo đơn hàng:', err)
    return null
  }
}

// ==============================================================================
// 6. STOCK RECEIPTS (NHẬP KHO)
// ==============================================================================

export async function fetchStockReceipts(): Promise<StockInReceipt[] | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('stock_receipts')
      .select('*, stock_in_items(*)')
      .order('id', { ascending: false })
    if (error) throw error

    return (data || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      date: new Date(r.date),
      supplier: r.supplier || undefined,
      totalCost: r.total_cost,
      note: r.note || undefined,
      items: (r.stock_in_items || []).map((it: any) => ({
        productId: it.product_id,
        productName: it.product_name,
        variantId: it.variant_id || undefined,
        variantName: it.variant_name || undefined,
        emoji: it.emoji || '📦',
        unit: it.unit || undefined,
        qty: it.qty,
        costPrice: it.cost_price,
        total: it.total,
      })),
    }))
  } catch (err) {
    console.error('Lỗi tải phiếu nhập kho:', err)
    return null
  }
}

export async function createStockReceipt(receipt: StockInReceipt): Promise<number | null> {
  if (!isSupabaseConfigured) return receipt.id
  try {
    const { data: recData, error: recError } = await supabase
      .from('stock_receipts')
      .insert({
        code: receipt.code,
        date: receipt.date ? receipt.date.toISOString() : new Date().toISOString(),
        supplier: receipt.supplier || null,
        total_cost: receipt.totalCost,
        note: receipt.note || null,
      })
      .select('id')
      .single()

    if (recError) throw recError
    const receiptId = recData.id

    if (receipt.items && receipt.items.length > 0) {
      const itemRows = receipt.items.map(it => ({
        receipt_id: receiptId,
        product_id: it.productId,
        product_name: it.productName,
        variant_id: it.variantId || null,
        variant_name: it.variantName || null,
        emoji: it.emoji,
        unit: it.unit || null,
        qty: it.qty,
        cost_price: it.costPrice,
        total: it.total,
      }))

      const { error: itemsError } = await supabase
        .from('stock_in_items')
        .insert(itemRows)
      if (itemsError) throw itemsError
    }

    return receiptId
  } catch (err) {
    console.error('Lỗi tạo phiếu nhập kho:', err)
    return null
  }
}

// ==============================================================================
// 7. BANK ACCOUNTS
// ==============================================================================

export async function fetchBankAccounts(): Promise<BankAccount[] | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('id', { ascending: true })
    if (error) throw error
    return (data || []).map((b: any) => ({
      id: b.id,
      bankBin: b.bank_bin,
      bankShortName: b.bank_short_name,
      bankName: b.bank_name,
      accountNo: b.account_no,
      accountName: b.account_name,
      isPrimary: b.is_primary,
    }))
  } catch (err) {
    console.error('Lỗi tải tài khoản ngân hàng:', err)
    return null
  }
}

export async function saveBankAccounts(accounts: BankAccount[]): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  try {
    // Xóa hết rồi chèn lại danh sách mới
    await supabase.from('bank_accounts').delete().neq('id', 0)
    if (accounts.length > 0) {
      const rows = accounts.map(a => ({
        bank_bin: a.bankBin,
        bank_short_name: a.bankShortName,
        bank_name: a.bankName,
        account_no: a.accountNo,
        account_name: a.accountName,
        is_primary: a.isPrimary,
      }))
      const { error } = await supabase.from('bank_accounts').insert(rows)
      if (error) throw error
    }
    return true
  } catch (err) {
    console.error('Lỗi lưu tài khoản ngân hàng:', err)
    return false
  }
}

// ==============================================================================
// 8. SHOP SETTINGS
// ==============================================================================

export async function fetchShopSettings(): Promise<Record<string, string> | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase.from('shop_settings').select('*')
    if (error) throw error
    const map: Record<string, string> = {}
    ;(data || []).forEach((row: any) => {
      map[row.key] = row.value
    })
    return map
  } catch (err) {
    console.error('Lỗi tải cài đặt:', err)
    return null
  }
}

export async function saveShopSetting(key: string, value: string): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  try {
    const { error } = await supabase
      .from('shop_settings')
      .upsert({ key, value })
    if (error) throw error
    return true
  } catch (err) {
    console.error('Lỗi lưu cài đặt:', err)
    return false
  }
}

// ==============================================================================
// 9. WIPE ALL DATA (XÓA TRẮNG DỮ LIỆU)
// ==============================================================================

export async function wipeAllData(): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  try {
    // Xóa lần lượt theo thứ tự khóa ngoại (foreign key dependencies)
    await supabase.from('order_lines').delete().neq('id', 0)
    await supabase.from('orders').delete().neq('id', 0)
    await supabase.from('product_variants').delete().neq('id', '')
    await supabase.from('products').delete().neq('id', 0)
    await supabase.from('debt_entries').delete().neq('id', 0)
    await supabase.from('customers').delete().neq('id', 0)
    await supabase.from('stock_in_items').delete().neq('id', 0)
    await supabase.from('stock_receipts').delete().neq('id', 0)
    await supabase.from('suppliers').delete().neq('id', 0)
    await supabase.from('bank_accounts').delete().neq('id', 0)
    return true
  } catch (err) {
    console.error('Lỗi xóa trắng dữ liệu:', err)
    return false
  }
}

