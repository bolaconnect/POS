import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import * as posService from '@/services/posService'
import type {
  Product,
  Customer,
  Supplier,
  DebtEntry,
  Order,
  StockInReceipt,
  BankAccount,
} from '@/types/pos'

export interface UsePosSyncOptions {
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>
  setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>
  setDebtEntries: React.Dispatch<React.SetStateAction<DebtEntry[]>>
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>
  setStockReceipts: React.Dispatch<React.SetStateAction<StockInReceipt[]>>
  setBankAccounts: React.Dispatch<React.SetStateAction<BankAccount[]>>
  setShopName: React.Dispatch<React.SetStateAction<string>>
  setVatRate: React.Dispatch<React.SetStateAction<number>>
  setUnits: React.Dispatch<React.SetStateAction<string[]>>
}

export function usePosSync(options: UsePosSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'connected' | 'offline' | 'error'>('idle')
  const isMountedRef = useRef(true)

  const {
    setProducts,
    setCustomers,
    setSuppliers,
    setDebtEntries,
    setOrders,
    setStockReceipts,
    setBankAccounts,
    setShopName,
    setVatRate,
    setUnits,
  } = options

  // 1. Tải toàn bộ dữ liệu ban đầu từ Supabase
  const loadAllData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSyncStatus('offline')
      return
    }

    setIsSyncing(true)
    try {
      const [
        prods,
        custs,
        sups,
        debts,
        ords,
        stocks,
        banks,
        settings,
      ] = await Promise.all([
        posService.fetchProducts(),
        posService.fetchCustomers(),
        posService.fetchSuppliers(),
        posService.fetchDebtEntries(),
        posService.fetchOrders(),
        posService.fetchStockReceipts(),
        posService.fetchBankAccounts(),
        posService.fetchShopSettings(),
      ])

      if (!isMountedRef.current) return

      if (prods !== null) setProducts(prods)
      if (custs !== null) setCustomers(custs)
      if (sups !== null) setSuppliers(sups)
      if (debts !== null) setDebtEntries(debts)
      if (ords !== null) setOrders(ords)
      if (stocks !== null) setStockReceipts(stocks)
      if (banks !== null) setBankAccounts(banks)

      if (settings) {
        if (settings.shop_name) setShopName(settings.shop_name)
        if (settings.vat_rate) setVatRate(Number(settings.vat_rate))
        if (settings.units) {
          try {
            const parsed = JSON.parse(settings.units)
            if (Array.isArray(parsed) && parsed.length > 0) setUnits(parsed)
          } catch {}
        }
      }

      setSyncStatus('connected')
    } catch (err) {
      console.error('Lỗi đồng bộ dữ liệu Supabase:', err)
      setSyncStatus('error')
    } finally {
      if (isMountedRef.current) setIsSyncing(false)
    }
  }, [
    setProducts,
    setCustomers,
    setSuppliers,
    setDebtEntries,
    setOrders,
    setStockReceipts,
    setBankAccounts,
    setShopName,
    setVatRate,
    setUnits,
  ])

  // 2. Chạy load ban đầu và đăng ký Realtime Channels
  useEffect(() => {
    isMountedRef.current = true
    loadAllData()

    if (!isSupabaseConfigured) return

    // Đăng ký Supabase Realtime để đồng bộ trực tiếp giữa các thiết bị
    const channel = supabase
      .channel('pos-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
        const prods = await posService.fetchProducts()
        if (prods && isMountedRef.current) setProducts(prods)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
        const ords = await posService.fetchOrders()
        if (ords && isMountedRef.current) setOrders(ords)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, async () => {
        const custs = await posService.fetchCustomers()
        if (custs && isMountedRef.current) setCustomers(custs)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debt_entries' }, async () => {
        const debts = await posService.fetchDebtEntries()
        if (debts && isMountedRef.current) setDebtEntries(debts)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, async () => {
        const sups = await posService.fetchSuppliers()
        if (sups && isMountedRef.current) setSuppliers(sups)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_receipts' }, async () => {
        const stocks = await posService.fetchStockReceipts()
        if (stocks && isMountedRef.current) setStockReceipts(stocks)
      })
      .subscribe()

    return () => {
      isMountedRef.current = false
      supabase.removeChannel(channel)
    }
  }, [loadAllData, setProducts, setOrders, setCustomers, setDebtEntries, setSuppliers, setStockReceipts])

  // 3. Các hàm đồng bộ dữ liệu ra Supabase khi người dùng thao tác
  const syncOrder = useCallback(async (order: Order) => {
    return await posService.createOrder(order)
  }, [])

  const syncProduct = useCallback(async (product: Product, isEdit: boolean = false) => {
    return await posService.upsertProduct(product, isEdit)
  }, [])

  const syncDeleteProduct = useCallback(async (productId: number) => {
    return await posService.deleteProduct(productId)
  }, [])

  const syncCustomer = useCallback(async (customer: Customer, isEdit: boolean = false) => {
    return await posService.upsertCustomer(customer, isEdit)
  }, [])

  const syncDeleteCustomer = useCallback(async (id: number) => {
    return await posService.deleteCustomer(id)
  }, [])

  const syncSupplier = useCallback(async (supplier: Supplier, isEdit: boolean = false) => {
    return await posService.upsertSupplier(supplier, isEdit)
  }, [])

  const syncDeleteSupplier = useCallback(async (id: number) => {
    return await posService.deleteSupplier(id)
  }, [])

  const syncDebtEntry = useCallback(async (entry: Omit<DebtEntry, 'id'>) => {
    return await posService.addDebtEntry(entry)
  }, [])

  const syncStockReceipt = useCallback(async (receipt: StockInReceipt) => {
    return await posService.createStockReceipt(receipt)
  }, [])

  const syncBankAccounts = useCallback(async (accounts: BankAccount[]) => {
    return await posService.saveBankAccounts(accounts)
  }, [])

  const syncSetting = useCallback(async (key: string, value: string) => {
    return await posService.saveShopSetting(key, value)
  }, [])

  return {
    isSyncing,
    syncStatus,
    isSupabaseConfigured,
    loadAllData,
    syncOrder,
    syncProduct,
    syncDeleteProduct,
    syncCustomer,
    syncDeleteCustomer,
    syncSupplier,
    syncDeleteSupplier,
    syncDebtEntry,
    syncStockReceipt,
    syncBankAccounts,
    syncSetting,
  }
}
