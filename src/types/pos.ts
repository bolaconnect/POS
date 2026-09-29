export type PayMethod = 'cash' | 'transfer' | 'debt'

export interface ProductVariant {
  id: string
  name: string
  price: number
  costPrice?: number
  stock?: number
}

export interface Product {
  id: number
  name: string
  price: number
  costPrice?: number
  stock?: number
  unit?: string
  category: string
  emoji: string
  image?: string
  variants?: ProductVariant[]
}

export interface StockInItem {
  productId: number
  productName: string
  variantId?: string
  variantName?: string
  emoji: string
  unit?: string
  qty: number
  costPrice: number
  total: number
}

export interface StockInReceipt {
  id: number
  code: string
  date: Date
  supplier?: string
  items: StockInItem[]
  totalCost: number
  note?: string
}

export interface CartLine {
  product: Product
  variant?: ProductVariant
  qty: number
}

export interface Order {
  id: number
  lines: CartLine[]
  subtotal: number
  tax: number
  total: number
  method: PayMethod
  cashGiven: number
  change: number
  time: Date
}

export interface Customer {
  id: number
  name: string
  phone: string
  note: string
}

export interface Supplier {
  id: number
  name: string
  phone?: string
  contactPerson?: string
  address?: string
  category?: string
  debt: number
  note?: string
}

export interface DebtEntry {
  id: number
  customerId: number
  type: 'debit' | 'credit'
  amount: number
  note: string
  orderId?: number
  time: Date
}

export interface BankAccount {
  id: number
  bankBin: string
  bankShortName: string
  bankName: string
  accountNo: string
  accountName: string
  isPrimary: boolean
}
