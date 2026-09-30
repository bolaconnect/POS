import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { usePosSync } from '@/hooks/usePosSync'
import { uploadProductImage } from '@/services/storageService'
import * as authService from '@/services/authService'
import * as posService from '@/services/posService'
import { supabase, isSupabaseConfigured as hasSupabaseConfigured } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type PayMethod = 'cash' | 'transfer' | 'debt'

interface ProductVariant {
  id: string
  name: string
  price: number
  costPrice?: number
  stock?: number
}

interface Product {
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

interface StockInItem {
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

interface StockInReceipt {
  id: number
  code: string
  date: Date
  supplier?: string
  items: StockInItem[]
  totalCost: number
  note?: string
}

interface CartLine {
  product: Product
  variant?: ProductVariant
  qty: number
}

interface Order {
  id: number
  lines: CartLine[]
  subtotal: number
  tax: number
  total: number
  method: PayMethod
  cashGiven: number
  change: number
  time: Date
  customerId?: number
}

interface Customer {
  id: number
  name: string
  phone: string
  note: string
}

interface Supplier {
  id: number
  name: string
  phone?: string
  contactPerson?: string
  address?: string
  category?: string
  debt: number
  note?: string
}

interface DebtEntry {
  id: number
  customerId: number
  type: 'debit' | 'credit'
  amount: number
  note: string
  orderId?: number
  time: Date
}

interface BankAccount {
  id: number
  bankBin: string
  bankShortName: string
  bankName: string
  accountNo: string
  accountName: string
  isPrimary: boolean
}

// ── Data ──────────────────────────────────────────────────────────────────────

// Fallback khi API chưa load xong
const VN_BANKS_FALLBACK = [
  { bin: '970436', short: 'VCB',  name: 'Vietcombank' },
  { bin: '970418', short: 'BIDV', name: 'BIDV' },
  { bin: '970415', short: 'CTG',  name: 'VietinBank' },
  { bin: '970405', short: 'AGR',  name: 'Agribank' },
  { bin: '970422', short: 'MB',   name: 'MBBank' },
  { bin: '970407', short: 'TCB',  name: 'Techcombank' },
  { bin: '970432', short: 'VPB',  name: 'VPBank' },
  { bin: '970416', short: 'ACB',  name: 'ACB' },
  { bin: '970423', short: 'TPB',  name: 'TPBank' },
  { bin: '970403', short: 'STB',  name: 'Sacombank' },
]

// Alias dùng ở chỗ hiển thị tên ngân hàng đã lưu
const VN_BANKS = VN_BANKS_FALLBACK

const CATEGORIES = ['Tất cả', 'Đồ uống', 'Đồ ăn', 'Bánh & Kem', 'Khác']

const DEFAULT_UNITS = [
  'ly', 'cốc', 'chai', 'lon',
  'phần', 'suất', 'đĩa', 'tô', 'bát', 'ổ', 'cái',
  'kg', 'lạng', 'g',
  'hộp', 'gói', 'bịch', 'thanh', 'cây', 'trái'
]

const SAMPLE_CUSTOMERS: Customer[] = [
  { id: 1, name: 'Nguyễn Văn Bình', phone: '0901 234 567', note: 'Khách quen buổi sáng' },
  { id: 2, name: 'Trần Thị Mai',    phone: '0912 345 678', note: '' },
  { id: 3, name: 'Lê Hoàng Nam',    phone: '0923 456 789', note: 'Nhân viên văn phòng gần đây' },
]

const SAMPLE_SUPPLIERS: Supplier[] = [
  {
    id: 1,
    name: 'Đại lý Bia & Nước ngọt Hoàng Phát',
    phone: '0908 123 456',
    contactPerson: 'Anh Hoàng (Giao sáng 8h-11h)',
    address: '45/2 Tô Hiến Thành, Q.10, TP.HCM',
    category: 'Đồ uống & Giải khát',
    debt: 3500000,
    note: 'Chiết khấu 3% đơn trên 5 triệu, nợ gối đầu',
  },
  {
    id: 2,
    name: 'Công ty Nguyên liệu Trà Sữa Phúc Thịnh',
    phone: '0933 888 999',
    contactPerson: 'Chị Mai Sale',
    address: 'Lô C Chợ Đầu Mối Bình Điền',
    category: 'Trà & Bột & Thạch',
    debt: 0,
    note: 'Giao thứ 2 và thứ 5 hàng tuần',
  },
  {
    id: 3,
    name: 'Xưởng Bánh & Bao bì Minh Tâm',
    phone: '0912 345 678',
    contactPerson: 'Chú Tâm',
    address: '120 Kha Vạn Cân, Thủ Đức',
    category: 'Bao bì & Ly hộp',
    debt: 1200000,
    note: 'Cung cấp ly giấy, ống hút, hộp mang về',
  },
  {
    id: 4,
    name: 'Nhà phân phối Sữa & Kem Vinamilk / TH',
    phone: '0988 776 655',
    contactPerson: 'Nguyễn Văn Nam',
    address: 'Kho vận Tân Bình',
    category: 'Sữa tươi & Sữa đặc',
    debt: 0,
    note: 'Chuyển khoản ngay khi nhận hàng',
  },
]

const now = Date.now()
const SAMPLE_DEBTS: DebtEntry[] = [
  { id: 1, customerId: 1, type: 'debit',  amount: 75000,  note: 'Trà sữa + bánh mì',        time: new Date(now - 2*864e5) },
  { id: 2, customerId: 1, type: 'debit',  amount: 55000,  note: 'Phở bò tái',               time: new Date(now - 864e5) },
  { id: 3, customerId: 1, type: 'credit', amount: 50000,  note: 'Trả một phần tiền mặt',    time: new Date(now - 864e5 + 36e5) },
  { id: 4, customerId: 2, type: 'debit',  amount: 120000, note: '4 ly cà phê sữa đá',       time: new Date(now - 3*864e5) },
  { id: 5, customerId: 2, type: 'credit', amount: 120000, note: 'Trả đủ',                   time: new Date(now - 2*864e5 + 36e5) },
  { id: 6, customerId: 3, type: 'debit',  amount: 35000,  note: 'Trà sữa trân châu',        time: new Date(now - 36e5) },
  { id: 7, customerId: 3, type: 'debit',  amount: 50000,  note: 'Bún bò + nước dừa',        time: new Date(now - 36e5 / 2) },
]

const PRODUCTS: Product[] = [
  {
    id: 1,
    name: 'Trà sữa trân châu',
    price: 35000,
    costPrice: 15000,
    stock: 45,
    unit: 'ly',
    category: 'Đồ uống',
    emoji: '🧋',
    variants: [
      { id: 'v1_m', name: 'Size M', price: 30000, costPrice: 12000, stock: 25 },
      { id: 'v1_l', name: 'Size L', price: 38000, costPrice: 16000, stock: 15 },
      { id: 'v1_bottle', name: 'Chai 500ml', price: 45000, costPrice: 20000, stock: 5 },
    ],
  },
  { id: 2,  name: 'Cà phê sữa đá',     price: 25000, costPrice: 9000,  stock: 80,  unit: 'ly',   category: 'Đồ uống',   emoji: '☕' },
  { id: 3,  name: 'Nước cam ép',        price: 30000, costPrice: 12000, stock: 35,  unit: 'ly',   category: 'Đồ uống',   emoji: '🍊' },
  { id: 4,  name: 'Sinh tố xoài',       price: 40000, costPrice: 18000, stock: 20,  unit: 'ly',   category: 'Đồ uống',   emoji: '🥭' },
  { id: 5,  name: 'Nước dừa tươi',      price: 28000, costPrice: 16000, stock: 15,  unit: 'trái', category: 'Đồ uống',   emoji: '🥥' },
  { id: 6,  name: 'Soda chanh muối',    price: 22000, costPrice: 8000,  stock: 25,  unit: 'ly',   category: 'Đồ uống',   emoji: '🍋' },
  {
    id: 7,
    name: 'Bánh mì thịt',
    price: 20000,
    costPrice: 9000,
    stock: 40,
    unit: 'ổ',
    category: 'Đồ ăn',
    emoji: '🥖',
    variants: [
      { id: 'v7_reg', name: 'Ổ thường', price: 20000, costPrice: 9000, stock: 25 },
      { id: 'v7_spec', name: 'Ổ đặc biệt nhiều thịt', price: 30000, costPrice: 14000, stock: 15 },
    ],
  },
  {
    id: 8,
    name: 'Xôi gà',
    price: 30000,
    costPrice: 14000,
    stock: 25,
    unit: 'hộp',
    category: 'Đồ ăn',
    emoji: '🍱',
    variants: [
      { id: 'v8_25', name: 'Hộp 25k', price: 25000, costPrice: 11000, stock: 10 },
      { id: 'v8_30', name: 'Hộp 30k', price: 30000, costPrice: 14000, stock: 10 },
      { id: 'v8_50', name: 'Hộp 50k (đặc biệt)', price: 50000, costPrice: 25000, stock: 5 },
    ],
  },
  {
    id: 9,
    name: 'Phở bò tái',
    price: 55000,
    costPrice: 28000,
    stock: 30,
    unit: 'tô',
    category: 'Đồ ăn',
    emoji: '🍜',
    variants: [
      { id: 'v9_reg', name: 'Tô vừa', price: 50000, costPrice: 25000, stock: 15 },
      { id: 'v9_big', name: 'Tô lớn', price: 60000, costPrice: 30000, stock: 10 },
      { id: 'v9_spec', name: 'Tô đặc biệt', price: 75000, costPrice: 40000, stock: 5 },
    ],
  },
  { id: 10, name: 'Bún bò Huế',         price: 50000, costPrice: 25000, stock: 35,  unit: 'tô',   category: 'Đồ ăn',     emoji: '🍲' },
  { id: 11, name: 'Bánh cuốn',          price: 25000, costPrice: 11000, stock: 20,  unit: 'đĩa',  category: 'Đồ ăn',     emoji: '🫔' },
  { id: 12, name: 'Cơm sườn nướng',     price: 45000, costPrice: 22000, stock: 30,  unit: 'đĩa',  category: 'Đồ ăn',     emoji: '🍛' },
  { id: 13, name: 'Kem vani',           price: 15000, costPrice: 7000,  stock: 4,   unit: 'cây',  category: 'Bánh & Kem', emoji: '🍦' },
  { id: 14, name: 'Kem dâu',            price: 18000, costPrice: 8000,  stock: 18,  unit: 'cây',  category: 'Bánh & Kem', emoji: '🍓' },
  { id: 15, name: 'Bánh tiramisu',      price: 45000, costPrice: 24000, stock: 12,  unit: 'cái',  category: 'Bánh & Kem', emoji: '🎂' },
  { id: 16, name: 'Bánh croissant',     price: 22000, costPrice: 10000, stock: 15,  unit: 'cái',  category: 'Bánh & Kem', emoji: '🥐' },
  { id: 17, name: 'Nước suối 500ml',    price: 8000,  costPrice: 3500,  stock: 120, unit: 'chai', category: 'Khác',       emoji: '💧' },
  { id: 18, name: 'Kẹo dừa Bến Tre',   price: 12000, costPrice: 6000,  stock: 40,  unit: 'gói',  category: 'Khác',       emoji: '🍬' },
  { id: 19, name: 'Snack khoai tây',    price: 15000, costPrice: 8000,  stock: 50,  unit: 'gói',  category: 'Khác',       emoji: '🥔' },
  { id: 20, name: 'Kẹo cao su',         price: 5000,  costPrice: 2500,  stock: 65,  unit: 'thanh',category: 'Khác',       emoji: '🍃' },
]

const SAMPLE_STOCK_RECEIPTS: StockInReceipt[] = [
  {
    id: 1,
    code: 'PN-1001',
    date: new Date(now - 864e5 * 2),
    supplier: 'Đại lý đồ uống & nước ngọt Minh Phát',
    totalCost: 1250000,
    note: 'Nhập nước suối và các size trà sữa',
    items: [
      { productId: 17, productName: 'Nước suối 500ml', emoji: '💧', unit: 'chai', qty: 100, costPrice: 3500, total: 350000 },
      { productId: 1,  productName: 'Trà sữa trân châu', variantId: 'v1_m', variantName: 'Size M', emoji: '🧋', unit: 'ly', qty: 35, costPrice: 12000, total: 420000 },
      { productId: 1,  productName: 'Trà sữa trân châu', variantId: 'v1_l', variantName: 'Size L', emoji: '🧋', unit: 'ly', qty: 30, costPrice: 16000, total: 480000 },
    ],
  },
  {
    id: 2,
    code: 'PN-1002',
    date: new Date(now - 864e5),
    supplier: 'Tiệm bánh & đồ ăn sáng Kim Vy',
    totalCost: 650000,
    note: 'Bánh mì, pate và bánh ngọt',
    items: [
      { productId: 7,  productName: 'Bánh mì thịt', variantId: 'v7_reg', variantName: 'Ổ thường', emoji: '🥖', unit: 'ổ', qty: 40, costPrice: 9000, total: 360000 },
      { productId: 16, productName: 'Bánh croissant', emoji: '🥐', unit: 'cái', qty: 29, costPrice: 10000, total: 290000 },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

// Phân cách hàng nghìn bằng dấu . (cố định, không phụ thuộc locale hệ thống)
const fmtNum = (n: number) =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const fmt = (n: number) => fmtNum(n) + ' ₫'

const shortFmt = (n: number) => fmtNum(n) + '₫'

function roundUp(total: number, step: number) {
  return Math.ceil(total / step) * step
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
)

const XIcon = ({ size = 'w-4 h-4' }: { size?: string }) => (
  <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

const CartEmptyIcon = () => (
  <svg className="w-14 h-14 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
  </svg>
)

const HistoryIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const SunIcon = () => (
  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.166 17.834a.75.75 0 00-1.06 1.06l1.59 1.591a.75.75 0 101.061-1.06l-1.59-1.591zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.166 6.166a.75.75 0 00-1.06 1.06l1.59 1.591a.75.75 0 101.061-1.06L6.166 6.166z" />
  </svg>
)

const MoonIcon = () => (
  <svg className="w-5 h-5 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clipRule="evenodd" />
  </svg>
)

// ── Product Thumbnail ─────────────────────────────────────────────────────────

function ProductThumb({ product, size = 'md' }: { product: Product; size?: 'sm' | 'md' | 'lg' }) {
  const dims  = size === 'lg' ? 'w-16 h-16' : size === 'sm' ? 'w-9 h-9' : 'w-12 h-12'
  const emoji = size === 'lg' ? 'text-4xl'  : size === 'sm' ? 'text-xl'  : 'text-3xl'
  return (
    <div className={`${dims} rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-slate-100 to-gray-50 dark:from-slate-800/50 dark:to-gray-800/30 flex items-center justify-center`}>
      {product.image
        ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
        : <span className={`${emoji} leading-none`}>{product.emoji}</span>
      }
    </div>
  )
}

// ── Admin Panel ───────────────────────────────────────────────────────────────

const PROD_CATEGORIES = ['Đồ uống', 'Đồ ăn', 'Bánh & Kem', 'Khác']

const EMOJIS = ['🧋','☕','🍊','🥭','🥥','🍋','💧','🍵','🧃','🥤',
                '🥖','🍱','🍜','🍲','🫔','🍛','🍣','🌮','🥗','🍔',
                '🍦','🎂','🥐','🍓','🍩','🧁','🍪','🍡','🥮','🍮',
                '🍬','🍃','🥔','🍫','🍭','🧆','🥜','🫘','🍿','🧀']

interface AdminPanelProps {
  dark: boolean
  setDark: (v: boolean) => void
  orders: Order[]
  setOrders?: React.Dispatch<React.SetStateAction<Order[]>>
  products: Product[]
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  customers: Customer[]
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>
  debtEntries: DebtEntry[]
  setDebtEntries: React.Dispatch<React.SetStateAction<DebtEntry[]>>
  suppliers?: Supplier[]
  setSuppliers?: React.Dispatch<React.SetStateAction<Supplier[]>>
  bankAccounts: BankAccount[]
  setBankAccounts: React.Dispatch<React.SetStateAction<BankAccount[]>>
  units?: string[]
  setUnits?: React.Dispatch<React.SetStateAction<string[]>>
  stockReceipts?: StockInReceipt[]
  setStockReceipts?: React.Dispatch<React.SetStateAction<StockInReceipt[]>>
  shopName: string
  setShopName: (v: string) => void
  vatRate: number
  setVatRate: (v: number) => void
  onClose: () => void
  initialTab?: 'overview' | 'products' | 'suppliers' | 'customers' | 'orders' | 'settings'
  currentUser?: string
  onLogout?: () => void
  onChangePassword?: () => void
  onInstallPwa?: (() => void) | null
  syncProduct?: (p: Product, isEdit?: boolean) => Promise<any>
  syncDeleteProduct?: (id: number) => Promise<any>
  syncSupplier?: (s: Supplier, isEdit?: boolean) => Promise<any>
  syncDeleteSupplier?: (id: number) => Promise<any>
  syncCustomer?: (c: Customer, isEdit?: boolean) => Promise<any>
  syncDeleteCustomer?: (id: number) => Promise<any>
  syncStockReceipt?: (r: StockInReceipt) => Promise<any>
  syncDebtEntry?: (d: any) => Promise<any>
  syncBankAccounts?: (b: BankAccount[]) => Promise<any>
  syncSetting?: (k: string, v: string) => Promise<any>
}

// ── Order Detail Modal ────────────────────────────────────────────────────────

interface OrderDetailModalProps {
  order: Order | null
  onClose: () => void
  customers?: Customer[]
  shopName?: string
  onViewCustomer?: (customer: Customer) => void
}

function OrderDetailModal({ order, onClose, customers = [], shopName = 'QuầyPOS', onViewCustomer }: OrderDetailModalProps) {
  if (!order) return null

  const customer = order.customerId ? customers.find(c => c.id === order.customerId) : null
  const orderDate = new Date(order.time)
  const timeFormatted = orderDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateFormatted = orderDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-slide-up">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-black/[0.07] dark:border-white/[0.07] shrink-0 no-print">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#007AFF]/10 text-[#007AFF] flex items-center justify-center text-base">
              🧾
            </div>
            <div>
              <h3 className="font-bold text-[16px] leading-tight">Chi tiết hóa đơn #{order.id}</h3>
              <p className="text-[11px] text-[#8E8E93]">{dateFormatted} lúc {timeFormatted}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:bg-[#D1D1D6] transition-colors"
          >
            <XIcon size="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Receipt Body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-hide">
          <div id="printable-order-receipt" className="space-y-4 text-[#1C1C1E] dark:text-white">
            {/* Receipt Header */}
            <div className="text-center pb-3 border-b border-dashed border-black/15 dark:border-white/15">
              <p className="text-[17px] font-black tracking-tight uppercase">{shopName}</p>
              <p className="text-[12px] font-bold text-[#8E8E93] tracking-widest uppercase mt-0.5">PHIẾU THANH TOÁN</p>
              <p className="text-[14px] font-bold mt-1">Mã đơn: #{order.id}</p>
              <p className="text-[11px] text-[#8E8E93] mt-0.5">{dateFormatted} • {timeFormatted}</p>
            </div>

            {/* Customer & Payment info */}
            <div className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-3.5 space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-[#8E8E93]">Khách hàng:</span>
                {customer ? (
                  <div className="flex items-center gap-1.5 font-semibold text-right">
                    <span>{customer.name}</span>
                    {onViewCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onViewCustomer(customer)
                        }}
                        className="no-print text-[11px] text-[#007AFF] hover:underline bg-[#007AFF]/10 px-2 py-0.5 rounded-lg font-medium"
                      >
                        Hồ sơ
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="font-medium text-[#8E8E93]">Khách lẻ</span>
                )}
              </div>
              {customer?.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-[#8E8E93]">Số điện thoại:</span>
                  <span className="font-medium tabular-nums">{customer.phone}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-black/[0.05] dark:border-white/[0.05]">
                <span className="text-[#8E8E93]">Phương thức:</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  order.method === 'cash'     ? 'bg-[#FFF3E0] dark:bg-[rgba(255,149,0,0.15)] text-[#FF9500]' :
                  order.method === 'transfer' ? 'bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.15)] text-[#34C759]' :
                                                'bg-[#F3E8FF] dark:bg-[rgba(175,82,222,0.15)] text-[#AF52DE]'
                }`}>
                  {order.method === 'cash' ? '💵 Tiền mặt' : order.method === 'transfer' ? '📱 Chuyển khoản' : '📒 Ghi nợ'}
                </span>
              </div>
            </div>

            {/* Items list */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#8E8E93] mb-2 px-1">
                Danh sách mặt hàng ({order.lines.length})
              </p>
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] border-y border-black/[0.06] dark:border-white/[0.06]">
                {order.lines.map((line, idx) => {
                  const unitPrice = line.variant ? line.variant.price : line.product.price
                  const lineTotal = unitPrice * line.qty
                  return (
                    <div key={idx} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base shrink-0">{line.product.emoji}</span>
                          <span className="font-semibold text-[13px] truncate">{line.product.name}</span>
                        </div>
                        {line.variant && (
                          <span className="text-[11px] text-[#007AFF] font-medium ml-6 block truncate">
                            {line.variant.name}
                          </span>
                        )}
                        <p className="text-[11px] text-[#8E8E93] ml-6 tabular-nums">
                          {shortFmt(unitPrice)} × {line.qty} {line.product.unit || ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-[13px] tabular-nums text-[#1C1C1E] dark:text-white">
                          {shortFmt(lineTotal)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Pricing breakdown */}
            <div className="space-y-1.5 pt-2 text-[13px]">
              <div className="flex justify-between text-[#8E8E93]">
                <span>Tạm tính</span>
                <span className="tabular-nums font-medium">{shortFmt(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-[#8E8E93]">
                <span>Thuế VAT</span>
                <span className="tabular-nums font-medium">{shortFmt(order.tax)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-2 border-t border-black/10 dark:border-white/10 text-base font-bold">
                <span>Tổng cộng</span>
                <span className="text-xl font-extrabold text-[#007AFF] tabular-nums">{fmt(order.total)}</span>
              </div>

              {/* Cash payment detail */}
              {order.method === 'cash' && (
                <div className="bg-[#F2F2F7]/70 dark:bg-[#2C2C2E]/70 rounded-xl p-3 mt-2 space-y-1 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#8E8E93]">Khách đưa:</span>
                    <span className="font-semibold tabular-nums">{fmt(order.cashGiven)}</span>
                  </div>
                  <div className="flex justify-between text-[#34C759]">
                    <span className="font-semibold">Tiền thối lại:</span>
                    <span className="font-bold tabular-nums text-[13px]">{fmt(order.change)}</span>
                  </div>
                </div>
              )}

              {/* Debt detail */}
              {order.method === 'debt' && (
                <div className="bg-[#FFF8E7] dark:bg-[rgba(255,149,0,0.08)] border border-[#FF9500]/20 rounded-xl p-3 mt-2 text-[12px] text-[#FF9500]">
                  <p className="font-semibold">📒 Đã ghi vào sổ nợ khách hàng</p>
                  <p className="text-[11px] opacity-80 mt-0.5">Số tiền nợ: {fmt(order.total)}</p>
                </div>
              )}

              {/* Transfer detail */}
              {order.method === 'transfer' && (
                <div className="bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.08)] border border-[#34C759]/20 rounded-xl p-3 mt-2 text-[12px] text-[#34C759]">
                  <p className="font-semibold">✓ Đã thanh toán chuyển khoản thành công</p>
                </div>
              )}
            </div>

            {/* Receipt Footer */}
            <div className="text-center pt-3 border-t border-dashed border-black/15 dark:border-white/15 text-[11px] text-[#8E8E93]">
              <p>Cảm ơn quý khách và hẹn gặp lại!</p>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-black/[0.07] dark:border-white/[0.07] flex gap-2 shrink-0 no-print bg-[#F9F9F9] dark:bg-[#18181A]">
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 py-3 px-4 rounded-2xl bg-[#007AFF] text-white font-semibold text-[14px] hover:bg-[#0066CC] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <span>🖨️</span>
            <span>In hóa đơn</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="py-3 px-5 rounded-2xl bg-[#E5E5EA] dark:bg-[#2C2C2E] text-[#1C1C1E] dark:text-white font-semibold text-[14px] hover:bg-[#D1D1D6] active:scale-[0.98] transition-all"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}

function AdminPanel({ dark, setDark, orders, setOrders, products, setProducts, customers, setCustomers, debtEntries, setDebtEntries, suppliers = SAMPLE_SUPPLIERS, setSuppliers, bankAccounts, setBankAccounts, units = DEFAULT_UNITS, setUnits, stockReceipts = [], setStockReceipts, shopName, setShopName, vatRate, setVatRate, onClose, initialTab = 'overview', currentUser = '', onLogout, onChangePassword, onInstallPwa, syncProduct, syncDeleteProduct, syncSupplier, syncDeleteSupplier, syncCustomer, syncDeleteCustomer, syncStockReceipt, syncDebtEntry, syncBankAccounts, syncSetting }: AdminPanelProps) {
  const [tab, setTab] = useState<'overview' | 'products' | 'suppliers' | 'customers' | 'orders' | 'settings'>(initialTab)

  // ── Products state ──
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [showProductForm, setShowProductForm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [prodSearch, setProdSearch] = useState('')
  const [prodView, setProdView] = useState<'list' | 'grid'>('list')
  const [prodCatFilter, setProdCatFilter] = useState('Tất cả')

  // ── Stock In (Nhập hàng) state ──
  const [showStockInModal, setShowStockInModal] = useState(false)
  const [showStockHistoryModal, setShowStockHistoryModal] = useState(false)
  const [stockInSupplier, setStockInSupplier] = useState('')
  const [stockInIsDebt, setStockInIsDebt] = useState(false)
  const [stockInNote, setStockInNote] = useState('')
  const [stockInItems, setStockInItems] = useState<{ productId: number; variantId?: string; qty: string; costPrice: string }[]>([])

  const openStockIn = (initProdId?: number, defaultSupplier?: string) => {
    const firstProd = (initProdId ? products.find(p => p.id === initProdId) : products[0]) || products[0]
    setStockInSupplier(defaultSupplier || (suppliers[0]?.name || ''))
    setStockInIsDebt(false)
    setStockInNote('')
    if (firstProd) {
      const v0 = firstProd.variants?.[0]
      setStockInItems([{
        productId: firstProd.id,
        variantId: v0 ? v0.id : undefined,
        qty: '10',
        costPrice: (v0?.costPrice || firstProd.costPrice || Math.round((v0?.price || firstProd.price) * 0.6)).toString(),
      }])
    } else {
      setStockInItems([])
    }
    setShowStockInModal(true)
  }

  const addStockInRow = () => {
    const unselected = products.find(p => !stockInItems.some(i => i.productId === p.id)) || products[0]
    if (!unselected) return
    const v0 = unselected.variants?.[0]
    setStockInItems(prev => [
      ...prev,
      {
        productId: unselected.id,
        variantId: v0 ? v0.id : undefined,
        qty: '10',
        costPrice: (v0?.costPrice || unselected.costPrice || Math.round((v0?.price || unselected.price) * 0.6)).toString(),
      }
    ])
  }

  const addAllVariantsOfProduct = (productId: number, replaceIdx?: number) => {
    const p = products.find(x => x.id === productId)
    if (!p || !p.variants || p.variants.length === 0) return
    const newRows = p.variants.map(v => ({
      productId: p.id,
      variantId: v.id,
      qty: '10',
      costPrice: (v.costPrice || p.costPrice || Math.round(v.price * 0.6)).toString(),
    }))
    setStockInItems(prev => {
      if (replaceIdx !== undefined && replaceIdx >= 0) {
        const copy = [...prev]
        copy.splice(replaceIdx, 1, ...newRows)
        return copy
      }
      return [...prev, ...newRows]
    })
  }

  const removeStockInRow = (index: number) => {
    setStockInItems(prev => prev.filter((_, i) => i !== index))
  }

  const saveStockIn = () => {
    const validItems: StockInItem[] = stockInItems
      .filter(item => {
        const q = parseInt(item.qty.replace(/\D/g, '') || '0')
        const c = parseInt(item.costPrice.replace(/\D/g, '') || '0')
        return item.productId && q > 0 && c > 0
      })
      .map(item => {
        const prod = products.find(p => p.id === item.productId)!
        const vObj = prod.variants?.find(v => v.id === item.variantId)
        const qty = parseInt(item.qty.replace(/\D/g, '') || '0')
        const costPrice = parseInt(item.costPrice.replace(/\D/g, '') || '0')
        return {
          productId: prod.id,
          productName: prod.name,
          variantId: item.variantId,
          variantName: vObj?.name,
          emoji: prod.emoji,
          unit: prod.unit,
          qty,
          costPrice,
          total: qty * costPrice,
        }
      })

    if (validItems.length === 0) return

    const totalCost = validItems.reduce((s, i) => s + i.total, 0)
    const code = `PN-${1000 + (stockReceipts.length + 1)}`
    const newReceipt: StockInReceipt = {
      id: Date.now(),
      code,
      date: new Date(),
      supplier: stockInSupplier.trim() || 'Nhập lẻ / Tự do',
      items: validItems,
      totalCost,
      note: stockInNote.trim() || undefined,
    }

    // Cộng tồn kho và cập nhật giá vốn mới cho từng sản phẩm và biến thể
    const modifiedProducts: Product[] = []
    setProducts(prev => {
      const next = prev.map(p => {
        const matchingItems = validItems.filter(i => i.productId === p.id)
        if (matchingItems.length === 0) return p

        const totalInQty = matchingItems.reduce((s, i) => s + i.qty, 0)
        let updatedVariants = p.variants

        if (p.variants && p.variants.length > 0) {
          updatedVariants = p.variants.map(v => {
            const vItem = matchingItems.find(i => i.variantId === v.id)
            if (vItem) {
              return {
                ...v,
                stock: (v.stock || 0) + vItem.qty,
                costPrice: vItem.costPrice,
              }
            }
            return v
          })
        }

        const hasVariantStocks = updatedVariants?.some(v => v.stock !== undefined)
        const newProductStock = hasVariantStocks
          ? updatedVariants!.reduce((s, v) => s + (v.stock || 0), 0)
          : (p.stock || 0) + totalInQty

        const lastCost = matchingItems[matchingItems.length - 1].costPrice

        const updated = {
          ...p,
          variants: updatedVariants,
          stock: newProductStock,
          costPrice: lastCost || p.costPrice,
        }
        modifiedProducts.push(updated)
        return updated
      })
      return next
    })

    // Sync updated stock & cost to Supabase
    modifiedProducts.forEach(p => {
      syncProduct?.(p, true)
    })

    if (setStockReceipts) {
      setStockReceipts(prev => [newReceipt, ...prev])
      syncStockReceipt?.(newReceipt)
    }

    // Nếu chọn ghi nợ đại lý thì cộng dồn vào công nợ của đại lý
    if (stockInIsDebt && setSuppliers && stockInSupplier.trim()) {
      const supName = stockInSupplier.trim()
      setSuppliers(prev => {
        const found = prev.some(s => s.name.toLowerCase() === supName.toLowerCase())
        if (found) {
          return prev.map(s => {
            if (s.name.toLowerCase() === supName.toLowerCase()) {
              const updated = { ...s, debt: s.debt + totalCost }
              syncSupplier?.(updated, true)
              return updated
            }
            return s
          })
        } else {
          const newSup: Supplier = {
            id: Date.now() % 1000000000,
            name: supName,
            debt: totalCost,
            category: 'Nhà cung cấp',
          }
          syncSupplier?.(newSup, false)
          return [newSup, ...prev]
        }
      })
    }

    setShowStockInModal(false)
  }

  // ── Suppliers (Đại lý) state ──
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState<'all' | 'debt' | 'no-debt'>('all')
  const [supplierView, setSupplierView] = useState<'list' | 'detail'>('list')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [supplierFormData, setSupplierFormData] = useState({
    name: '',
    phone: '',
    contactPerson: '',
    address: '',
    category: 'Đồ uống & Giải khát',
    initialDebt: '',
    note: '',
  })
  const [confirmDeleteSupplier, setConfirmDeleteSupplier] = useState<number | null>(null)
  const [supplierIdCounter, setSupplierIdCounter] = useState(30)
  const [isSavingSupplier, setIsSavingSupplier] = useState(false)

  // Trả nợ đại lý modal state
  const [showSupplierPayModal, setShowSupplierPayModal] = useState(false)
  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null)
  const [paySupplierAmount, setPaySupplierAmount] = useState('')
  const [paySupplierMethod, setPaySupplierMethod] = useState<'cash' | 'transfer'>('transfer')
  const [paySupplierNote, setPaySupplierNote] = useState('')

  const openAddSupplier = () => {
    setEditSupplier(null)
    setSupplierFormData({
      name: '',
      phone: '',
      contactPerson: '',
      address: '',
      category: 'Đồ uống & Giải khát',
      initialDebt: '',
      note: '',
    })
    setShowSupplierForm(true)
  }

  const openEditSupplier = (s: Supplier) => {
    setEditSupplier(s)
    setSupplierFormData({
      name: s.name,
      phone: s.phone || '',
      contactPerson: s.contactPerson || '',
      address: s.address || '',
      category: s.category || 'Đồ uống & Giải khát',
      initialDebt: s.debt.toString(),
      note: s.note || '',
    })
    setShowSupplierForm(true)
  }

  const saveSupplier = async () => {
    if (isSavingSupplier || !supplierFormData.name.trim() || !setSuppliers) return
    const debtVal = parseInt(supplierFormData.initialDebt.replace(/\D/g, '') || '0')

    try {
      setIsSavingSupplier(true)
      if (editSupplier) {
        const updatedSup: Supplier = {
          id: editSupplier.id,
          name: supplierFormData.name.trim(),
          phone: supplierFormData.phone.trim() || undefined,
          contactPerson: supplierFormData.contactPerson.trim() || undefined,
          address: supplierFormData.address.trim() || undefined,
          category: supplierFormData.category.trim() || undefined,
          debt: debtVal,
          note: supplierFormData.note.trim() || undefined,
        }
        setSuppliers(prev => prev.map(s => s.id === editSupplier.id ? updatedSup : s))
        await syncSupplier?.(updatedSup, true)
        if (selectedSupplier?.id === editSupplier.id) {
          setSelectedSupplier(updatedSup)
        }
      } else {
        const tempId = Date.now()
        const newSup: Supplier = {
          id: tempId,
          name: supplierFormData.name.trim(),
          phone: supplierFormData.phone.trim() || undefined,
          contactPerson: supplierFormData.contactPerson.trim() || undefined,
          address: supplierFormData.address.trim() || undefined,
          category: supplierFormData.category.trim() || undefined,
          debt: debtVal,
          note: supplierFormData.note.trim() || undefined,
        }
        setSuppliers(prev => [newSup, ...prev])
        setSupplierIdCounter(n => n + 1)
        const realId = await syncSupplier?.(newSup, false)
        if (realId) {
          setSuppliers(prev => {
            if (prev.some(s => s.id === realId)) {
              return prev.filter(s => s.id !== tempId)
            }
            return prev.map(s => s.id === tempId ? { ...s, id: realId } : s)
          })
        }
      }
      setShowSupplierForm(false)
    } catch (err) {
      console.error('Lỗi khi lưu nhà cung cấp:', err)
    } finally {
      setIsSavingSupplier(false)
    }
  }

  const deleteSupplier = (id: number) => {
    if (setSuppliers) setSuppliers(prev => prev.filter(s => s.id !== id))
    if (selectedSupplier?.id === id) setSupplierView('list')
    setConfirmDeleteSupplier(null)
    syncDeleteSupplier?.(id)
  }

  const openPaySupplier = (s: Supplier) => {
    setPayingSupplier(s)
    setPaySupplierAmount(s.debt > 0 ? s.debt.toString() : '')
    setPaySupplierMethod('transfer')
    setPaySupplierNote(`Trả tiền hàng cho ${s.name}`)
    setShowSupplierPayModal(true)
  }

  const confirmPaySupplier = () => {
    if (!payingSupplier || !setSuppliers) return
    const amt = parseInt(paySupplierAmount.replace(/\D/g, '') || '0')
    if (amt <= 0) return

    const newDebt = Math.max(0, payingSupplier.debt - amt)
    const updatedSup = { ...payingSupplier, debt: newDebt }
    setSuppliers(prev =>
      prev.map(s => (s.id === payingSupplier.id ? updatedSup : s))
    )
    syncSupplier?.(updatedSup, true)
    if (selectedSupplier?.id === payingSupplier.id) {
      setSelectedSupplier(prev => (prev ? { ...prev, debt: newDebt } : null))
    }
    setShowSupplierPayModal(false)
  }

  const filteredSuppliers = useMemo(() => {
    let list = suppliers
    if (supplierFilter === 'debt') list = list.filter(s => s.debt > 0)
    if (supplierFilter === 'no-debt') list = list.filter(s => s.debt <= 0)
    if (supplierSearch.trim()) {
      const q = supplierSearch.toLowerCase()
      list = list.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          (s.phone && s.phone.includes(q)) ||
          (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
          (s.address && s.address.toLowerCase().includes(q)) ||
          (s.category && s.category.toLowerCase().includes(q))
      )
    }
    return list
  }, [suppliers, supplierFilter, supplierSearch])

  // ── Customers state ──
  const [custSearch, setCustSearch] = useState('')
  const [custView, setCustView] = useState<'list' | 'detail'>('list')
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null)
  const [showCustForm, setShowCustForm] = useState(false)
  const [editCust, setEditCust] = useState<Customer | null>(null)
  const [custFormData, setCustFormData] = useState({ name: '', phone: '', note: '', initialDebt: '' })
  const [confirmDeleteCust, setConfirmDeleteCust] = useState<number | null>(null)
  const [custIdCounter, setCustIdCounter] = useState(30)
  const [isSavingCust, setIsSavingCust] = useState(false)

  // Trả nợ / Ghi nợ khách hàng modal state
  const [showCustPayModal, setShowCustPayModal] = useState(false)
  const [custPayType, setCustPayType] = useState<'credit' | 'debit'>('credit')
  const [custPayAmount, setCustPayAmount] = useState('')
  const [custPayNote, setCustPayNote] = useState('')
  const [isSavingCustDebt, setIsSavingCustDebt] = useState(false)

  const [orderFilter, setOrderFilter] = useState<'all' | 'cash' | 'transfer' | 'debt'>('all')
  const [orderDateFilter, setOrderDateFilter] = useState<'today' | 'week' | 'month' | 'year' | 'all' | 'custom'>('all')
  const [customDate, setCustomDate] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  // ── Bank account state ──
  const [showBankForm, setShowBankForm] = useState(false)
  const [editBank, setEditBank] = useState<BankAccount | null>(null)
  const [bankForm, setBankForm] = useState({ bankBin: '970436', accountNo: '', accountName: '' })
  const [bankIdCounter, setBankIdCounter] = useState(1)
  const [bankQrPreview, setBankQrPreview] = useState<BankAccount | null>(null)
  const [vietqrBanks, setVietqrBanks] = useState<{ bin: string; short: string; name: string; logo?: string }[]>(VN_BANKS_FALLBACK)
  const [banksLoading, setBanksLoading] = useState(false)
  const [bankSearch, setBankSearch] = useState('')

  useEffect(() => {
    if (!showBankForm || vietqrBanks !== VN_BANKS_FALLBACK) return
    setBanksLoading(true)
    fetch('https://api.vietqr.io/v2/banks')
      .then(r => r.json())
      .then(data => {
        if (data.code === '00' && Array.isArray(data.data)) {
          setVietqrBanks(data.data.map((b: { bin: string; shortName: string; name: string; logo: string }) => ({
            bin: b.bin,
            short: b.shortName,
            name: b.name,
            logo: b.logo,
          })))
          setBankForm(f => ({ ...f, bankBin: f.bankBin || data.data[0]?.bin || '970436' }))
        }
      })
      .catch(() => {})
      .finally(() => setBanksLoading(false))
  }, [showBankForm])
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    costPrice: '',
    stock: '',
    unit: 'ly',
    category: 'Đồ uống',
    emoji: '🧋',
    image: '',
    hasVariants: false,
    variants: [] as { id: string; name: string; price: string; costPrice?: string; stock?: string }[],
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [nextId, setNextId] = useState(100)
  const [isSavingProduct, setIsSavingProduct] = useState(false)

  const totalRevenue   = orders.reduce((s, o) => s + o.total, 0)
  const avgOrder       = orders.length ? Math.round(totalRevenue / orders.length) : 0
  const totalItems     = orders.reduce((s, o) => s + o.lines.reduce((ss, l) => ss + l.qty, 0), 0)

  // Top products by qty sold
  const topProducts = useMemo(() => {
    const map = new Map<number, { product: Product; qty: number; revenue: number }>()
    orders.forEach(o => o.lines.forEach(l => {
      const e = map.get(l.product.id) ?? { product: l.product, qty: 0, revenue: 0 }
      map.set(l.product.id, { product: l.product, qty: e.qty + l.qty, revenue: e.revenue + (l.variant?.price ?? l.product.price) * l.qty })
    }))
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)
  }, [orders])

  // Hourly distribution (0–23)
  const hourlyData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ h, total: 0, count: 0 }))
    orders.forEach(o => {
      const h = o.time.getHours()
      buckets[h].total += o.total
      buckets[h].count++
    })
    return buckets
  }, [orders])

  const activeHours = hourlyData.filter(b => b.count > 0)
  const maxHourly   = Math.max(...hourlyData.map(b => b.total), 1)

  // Payment method split
  const cashCount     = orders.filter(o => o.method === 'cash').length
  const transferCount = orders.filter(o => o.method === 'transfer').length
  const debtCount     = orders.filter(o => o.method === 'debt').length

  const [isCustomUnit, setIsCustomUnit] = useState(false)

  const openAdd = () => {
    setEditProduct(null)
    setIsCustomUnit(false)
    setFormData({
      name: '',
      price: '',
      costPrice: '',
      stock: '20',
      unit: 'ly',
      category: 'Đồ uống',
      emoji: '🧋',
      image: '',
      hasVariants: false,
      variants: [],
    })
    setShowProductForm(true)
  }

  const openEdit = (p: Product) => {
    setEditProduct(p)
    const currentUnit = p.unit || 'ly'
    setIsCustomUnit(Boolean(p.unit && !units.includes(p.unit)))
    setFormData({
      name: p.name,
      price: p.price.toString(),
      costPrice: p.costPrice != null ? p.costPrice.toString() : '',
      stock: p.stock != null ? p.stock.toString() : '0',
      unit: currentUnit,
      category: p.category,
      emoji: p.emoji,
      image: p.image ?? '',
      hasVariants: Boolean(p.variants && p.variants.length > 0),
      variants: p.variants
        ? p.variants.map(v => ({
            id: v.id,
            name: v.name,
            price: v.price.toString(),
            costPrice: v.costPrice != null ? v.costPrice.toString() : '',
            stock: v.stock != null ? v.stock.toString() : '',
          }))
        : [],
    })
    setShowProductForm(true)
  }

  const saveProduct = async () => {
    if (isSavingProduct) return

    const rawPrice = parseInt(formData.price.replace(/\D/g, '') || '0')
    const validVariants: ProductVariant[] = formData.hasVariants
      ? formData.variants
          .filter(v => v.name.trim() && parseInt(v.price.replace(/\D/g, '') || '0') > 0)
          .map(v => ({
            id: v.id || `v_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            name: v.name.trim(),
            price: parseInt(v.price.replace(/\D/g, '') || '0'),
            costPrice: v.costPrice ? parseInt(v.costPrice.replace(/\D/g, '') || '0') : undefined,
            stock: v.stock !== undefined && v.stock !== '' ? parseInt(v.stock.replace(/\D/g, '') || '0') : undefined,
          }))
      : []

    const finalPrice = validVariants.length > 0 ? validVariants[0].price : rawPrice
    if (!formData.name.trim() || finalPrice <= 0) return

    const cleanUnit = formData.unit.trim()
    if (cleanUnit && !units.includes(cleanUnit)) {
      const nextUnits = [...units, cleanUnit]
      if (setUnits) setUnits(nextUnits)
      try {
        localStorage.setItem('quaypos_units', JSON.stringify(nextUnits))
      } catch {}
    }

    const hasVariantStocks = validVariants.some(v => v.stock !== undefined)
    const computedStock = hasVariantStocks
      ? validVariants.reduce((s, v) => s + (v.stock || 0), 0)
      : (formData.stock !== '' ? parseInt(formData.stock.replace(/\D/g, '') || '0') : 0)

    const payload = {
      name: formData.name.trim(),
      price: finalPrice,
      unit: cleanUnit || undefined,
      category: formData.category,
      emoji: formData.emoji,
      image: formData.image || undefined,
      variants: validVariants.length > 0 ? validVariants : undefined,
      costPrice: formData.costPrice ? parseInt(formData.costPrice.replace(/\D/g, '') || '0') : undefined,
      stock: computedStock,
    }

    try {
      setIsSavingProduct(true)
      if (editProduct) {
        const updated = { ...editProduct, ...payload }
        setProducts(ps => ps.map(p => p.id === editProduct.id ? updated : p))
        await syncProduct?.(updated, true)
      } else {
        const tempId = Date.now()
        const newProd = { id: tempId, ...payload }
        setProducts(ps => [...ps, newProd])
        setNextId(n => n + 1)
        const realId = await syncProduct?.(newProd, false)
        if (realId && realId !== tempId) {
          setProducts(ps => {
            // Nếu Realtime đã đồng bộ sản phẩm này về rồi thì bỏ tempId
            if (ps.some(p => p.id === realId)) {
              return ps.filter(p => p.id !== tempId)
            }
            return ps.map(p => p.id === tempId ? { ...p, id: realId } : p)
          })
        }
      }
      setShowProductForm(false)
    } catch (err) {
      console.error('Lỗi khi lưu sản phẩm:', err)
    } finally {
      setIsSavingProduct(false)
    }
  }

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    // Đọc base64 ngay để preview và làm fallback (hoạt động trên mọi máy)
    const toBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result as string)
      reader.onerror = rej
      reader.readAsDataURL(f)
    })
    const base64 = await toBase64(file)
    setFormData(f => ({ ...f, image: base64 }))
    try {
      const publicUrl = await uploadProductImage(file)
      if (publicUrl) {
        setFormData(f => ({ ...f, image: publicUrl }))
      }
    } catch (err) {
      console.error('Lỗi upload ảnh:', err)
    }
  }

  const deleteProduct = (id: number) => {
    setProducts(ps => ps.filter(p => p.id !== id))
    setConfirmDelete(null)
    syncDeleteProduct?.(id)
  }

  const filteredOrders = useMemo(() => {
    const now = new Date()
    const startOf = (unit: 'day' | 'week' | 'month' | 'year') => {
      const d = new Date(now)
      if (unit === 'day')   { d.setHours(0,0,0,0) }
      if (unit === 'week')  {
        const day = d.getDay()
        const diff = d.getDate() - day + (day === 0 ? -6 : 1)
        d.setDate(diff)
        d.setHours(0,0,0,0)
      }
      if (unit === 'month') { d.setDate(1); d.setHours(0,0,0,0) }
      if (unit === 'year')  { d.setMonth(0,1); d.setHours(0,0,0,0) }
      return d
    }
    return orders.filter(o => {
      const t = new Date(o.time)
      if (customDate) {
        const orderDateStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
        if (orderDateStr !== customDate) return false
      } else {
        if (orderDateFilter === 'today' && t < startOf('day'))  return false
        if (orderDateFilter === 'week'  && t < startOf('week')) return false
        if (orderDateFilter === 'month' && t < startOf('month'))return false
        if (orderDateFilter === 'year'  && t < startOf('year')) return false
      }
      if (orderFilter !== 'all' && o.method !== orderFilter)  return false
      return true
    })
  }, [orders, orderFilter, orderDateFilter, customDate])

  // Customer helpers
  const custBalances = useMemo(() => {
    const m = new Map<number, number>()
    customers.forEach(c => m.set(c.id, 0))
    debtEntries.forEach(e => {
      const cur = m.get(e.customerId) ?? 0
      m.set(e.customerId, e.type === 'debit' ? cur + e.amount : cur - e.amount)
    })
    return m
  }, [customers, debtEntries])

  const custOrderTotals = useMemo(() => {
    const m = new Map<number, { count: number; spent: number }>()
    customers.forEach(c => m.set(c.id, { count: 0, spent: 0 }))
    orders.filter(o => o.method === 'debt').forEach(() => {/* linked by debtEntries */})
    // count debt-linked orders per customer via debtEntries orderId
    debtEntries.filter(e => e.orderId).forEach(e => {
      const cur = m.get(e.customerId) ?? { count: 0, spent: 0 }
      m.set(e.customerId, { count: cur.count + 1, spent: cur.spent + e.amount })
    })
    return m
  }, [customers, debtEntries, orders])

  const filteredCustomers = useMemo(() => {
    const q = custSearch.toLowerCase()
    return customers
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.note.toLowerCase().includes(q))
      .sort((a, b) => (custBalances.get(b.id) ?? 0) - (custBalances.get(a.id) ?? 0))
  }, [customers, custSearch, custBalances])

  const openAddCust = () => {
    setEditCust(null)
    setCustFormData({ name: '', phone: '', note: '', initialDebt: '' })
    setShowCustForm(true)
  }
  const openEditCust = (c: Customer) => {
    setEditCust(c)
    setCustFormData({ name: c.name, phone: c.phone, note: c.note, initialDebt: '' })
    setShowCustForm(true)
  }
  const saveCust = async () => {
    if (isSavingCust || !custFormData.name.trim()) return
    const { initialDebt: debtStr, ...rest } = custFormData

    try {
      setIsSavingCust(true)
      if (editCust) {
        const updatedCust: Customer = { ...editCust, ...rest, name: rest.name.trim() }
        setCustomers(cs => cs.map(c => c.id === editCust.id ? updatedCust : c))
        if (selectedCust?.id === editCust.id) setSelectedCust(updatedCust)
        await syncCustomer?.(updatedCust, true)
      } else {
        const tempId = Date.now()
        const newCust: Customer = { id: tempId, ...rest, name: rest.name.trim() }
        setCustomers(cs => [...cs, newCust])
        setCustIdCounter(n => n + 1)
        const realId = await syncCustomer?.(newCust, false)
        if (realId) {
          setCustomers(cs => {
            if (cs.some(c => c.id === realId)) {
              return cs.filter(c => c.id !== tempId)
            }
            return cs.map(c => c.id === tempId ? { ...c, id: realId } : c)
          })
          const initAmt = parseInt(debtStr.replace(/\D/g, '') || '0')
          if (initAmt > 0) {
            const debtObj = {
              id: Date.now(),
              customerId: realId,
              type: 'debit' as const,
              amount: initAmt,
              note: 'Dư nợ ban đầu',
              time: new Date(),
            }
            setDebtEntries(prev => [debtObj, ...prev])
            await syncDebtEntry?.(debtObj)
          }
        }
      }
      setShowCustForm(false)
    } catch (err) {
      console.error('Lỗi khi lưu khách hàng:', err)
    } finally {
      setIsSavingCust(false)
    }
  }
  const deleteCust = (id: number) => {
    setCustomers(cs => cs.filter(c => c.id !== id))
    if (selectedCust?.id === id) setCustView('list')
    setConfirmDeleteCust(null)
    syncDeleteCustomer?.(id)
  }

  const confirmCustDebtAction = async () => {
    if (!selectedCust || isSavingCustDebt) return
    const amt = parseInt(custPayAmount.replace(/\D/g, '') || '0')
    if (amt <= 0) return

    try {
      setIsSavingCustDebt(true)
      const debtObj = {
        id: Date.now(),
        customerId: selectedCust.id,
        type: custPayType,
        amount: amt,
        note: custPayNote.trim() || (custPayType === 'credit' ? 'Khách trả nợ' : 'Ghi nợ phát sinh'),
        time: new Date(),
      }
      setDebtEntries(prev => [debtObj, ...prev])
      await syncDebtEntry?.(debtObj)
      setShowCustPayModal(false)
      setCustPayAmount('')
      setCustPayNote('')
    } catch (err) {
      console.error('Lỗi khi lưu giao dịch nợ khách hàng:', err)
    } finally {
      setIsSavingCustDebt(false)
    }
  }

  // Filtered products
  const filteredProducts = useMemo(() => {
    let p = products
    if (prodCatFilter !== 'Tất cả') p = p.filter(x => x.category === prodCatFilter)
    if (prodSearch.trim()) {
      const q = prodSearch.toLowerCase()
      p = p.filter(x => x.name.toLowerCase().includes(q))
    }
    return p
  }, [products, prodCatFilter, prodSearch])

  const TABS = [
    { id: 'overview',   label: 'Tổng quan',  icon: '📊' },
    { id: 'products',   label: 'Sản phẩm',   icon: '🛍️' },
    { id: 'suppliers',  label: 'Đại lý',     icon: '🏢' },
    { id: 'customers',  label: 'Khách hàng', icon: '👥' },
    { id: 'orders',     label: 'Đơn hàng',   icon: '📋' },
  ] as const

  return (
    <div className="fixed inset-0 z-50 animate-fade-in">
      <div className="h-full flex flex-col bg-[#F2F2F7] dark:bg-black text-[#1C1C1E] dark:text-white" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>

        {/* Header */}
        <header className="flex items-center gap-3 px-4 pt-safe min-h-14 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-b border-black/[0.07] dark:border-white/[0.08] shrink-0">
          {tab === 'customers' && custView === 'detail' ? (
            <button onClick={() => setCustView('list')} className="flex items-center gap-1 text-[#007AFF] font-medium text-[15px]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
              <span className="hidden sm:inline">Khách hàng</span>
            </button>
          ) : tab === 'suppliers' && supplierView === 'detail' ? (
            <button onClick={() => setSupplierView('list')} className="flex items-center gap-1 text-[#007AFF] font-medium text-[15px]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
              <span className="hidden sm:inline">Đại lý</span>
            </button>
          ) : (
            <button onClick={onClose} className="flex items-center gap-1.5 text-[#007AFF] font-medium text-[15px] mr-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
              <span className="hidden sm:inline">Quầy bán</span>
            </button>
          )}
          <h1 className="font-bold text-[17px] flex-1 text-center sm:text-left">
            {tab === 'settings'
              ? 'Cài đặt'
              : tab === 'customers' && custView === 'detail' && selectedCust
              ? selectedCust.name
              : tab === 'suppliers' && supplierView === 'detail' && selectedSupplier
              ? selectedSupplier.name
              : 'Quản lý cửa hàng'}
          </h1>
          <p className="text-[13px] text-[#8E8E93] hidden sm:block">{shopName}</p>
        </header>

        {/* Tab Bar (chỉ hiển thị khi quản lý cửa hàng, ẩn khi ở trang Cài đặt riêng) */}
        {tab !== 'settings' && (
          <div className="flex border-b border-black/[0.07] dark:border-white/[0.08] bg-white dark:bg-[#1C1C1E] shrink-0 overflow-x-auto scrollbar-hide">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-5 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-all ${
                  tab === t.id
                    ? 'border-[#007AFF] text-[#007AFF]'
                    : 'border-transparent text-[#8E8E93] hover:text-[#3C3C43] dark:hover:text-white'
                }`}
              >
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">

          {/* ── Tổng quan ── */}
          {tab === 'overview' && (
            <div className="p-4 space-y-4 max-w-4xl mx-auto">

              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Doanh thu hôm nay', value: shortFmt(totalRevenue), sub: `${orders.length} đơn hàng`, color: 'text-[#007AFF]', bg: 'bg-white dark:bg-[#1C1C1E]' },
                  { label: 'Giá trị TB / đơn',  value: shortFmt(avgOrder),     sub: 'trung bình',               color: 'text-[#34C759]', bg: 'bg-white dark:bg-[#1C1C1E]' },
                  { label: 'Sản phẩm đã bán',   value: totalItems.toString(),  sub: 'tổng số lượng',            color: 'text-[#FF9500]', bg: 'bg-white dark:bg-[#1C1C1E]' },
                  { label: 'Sản phẩm danh mục', value: products.length.toString(), sub: `${PROD_CATEGORIES.length} danh mục`, color: 'text-[#AF52DE]', bg: 'bg-white dark:bg-[#1C1C1E]' },
                ].map(c => (
                  <div key={c.label} className={`${c.bg} rounded-2xl p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.05]`}>
                    <p className="text-[11px] text-[#8E8E93] font-medium uppercase tracking-wide mb-1">{c.label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
                    <p className="text-[11px] text-[#8E8E93] mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Hourly Revenue Chart */}
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                  <p className="text-[13px] font-semibold mb-3">Doanh thu theo giờ</p>
                  {orders.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-[#C7C7CC] text-sm">Chưa có dữ liệu</div>
                  ) : (
                    <div className="flex items-end gap-1 h-32">
                      {hourlyData.filter((_, i) => i >= 6 && i <= 22).map(b => (
                        <div key={b.h} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                            <div
                              className="w-full rounded-t-sm bg-[#007AFF]/80 transition-all"
                              style={{ height: `${Math.round((b.total / maxHourly) * 100)}px`, minHeight: b.count > 0 ? '3px' : '0' }}
                            />
                          </div>
                          {b.h % 3 === 0 && <p className="text-[9px] text-[#C7C7CC]">{b.h}h</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Payment Method Split */}
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                  <p className="text-[13px] font-semibold mb-3">Hình thức thanh toán</p>
                  {orders.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-[#C7C7CC] text-sm">Chưa có dữ liệu</div>
                  ) : (
                    <div className="space-y-3">
                      {[
                        { label: 'Tiền mặt',    count: cashCount,     color: 'bg-[#FF9500]', textColor: 'text-[#FF9500]' },
                        { label: 'Chuyển khoản',count: transferCount, color: 'bg-[#34C759]', textColor: 'text-[#34C759]' },
                        { label: 'Ghi nợ',       count: debtCount,     color: 'bg-[#AF52DE]', textColor: 'text-[#AF52DE]' },
                      ].map(m => (
                        <div key={m.label}>
                          <div className="flex justify-between text-[12px] mb-1">
                            <span className="text-[#3C3C43] dark:text-[rgba(235,235,245,0.8)]">{m.label}</span>
                            <span className={`font-semibold ${m.textColor}`}>{m.count} đơn</span>
                          </div>
                          <div className="h-2 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-full overflow-hidden">
                            <div
                              className={`h-full ${m.color} rounded-full transition-all`}
                              style={{ width: `${orders.length ? Math.round((m.count / orders.length) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Top Products */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                  <p className="text-[13px] font-semibold">Sản phẩm bán chạy nhất</p>
                </div>
                {topProducts.length === 0 ? (
                  <div className="py-8 text-center text-[#C7C7CC] text-sm">Chưa có dữ liệu</div>
                ) : (
                  topProducts.map((tp, i) => (
                    <div key={tp.product.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 border-black/[0.04] dark:border-white/[0.04]">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                        i === 0 ? 'bg-amber-100 text-amber-600' : i === 1 ? 'bg-slate-100 dark:bg-slate-700 text-slate-500' : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]'
                      }`}>{i + 1}</span>
                      <ProductThumb product={tp.product} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{tp.product.name}</p>
                        <p className="text-[11px] text-[#8E8E93]">{tp.qty} đã bán</p>
                      </div>
                      <p className="text-[13px] font-semibold tabular-nums text-[#007AFF]">{shortFmt(tp.revenue)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── Sản phẩm ── */}
          {/* ── Sản phẩm ── */}
          {tab === 'products' && (
            <div className="flex flex-col h-full">
              {/* Toolbar */}
              <div className="px-4 pt-4 pb-2 space-y-2 shrink-0">
                <div className="flex gap-2">
                  {/* Search */}
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    <input type="search" placeholder="Tìm sản phẩm..." value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] text-[14px] outline-none ring-1 ring-black/[0.07] dark:ring-white/[0.07] focus:ring-2 focus:ring-[#007AFF]/30" />
                  </div>
                  {/* View toggle */}
                  <div className="flex bg-white dark:bg-[#1C1C1E] rounded-xl ring-1 ring-black/[0.07] dark:ring-white/[0.07] overflow-hidden shrink-0">
                    {(['list','grid'] as const).map(v => (
                      <button key={v} onClick={() => setProdView(v)}
                        className={`px-3 py-2.5 transition-colors ${prodView === v ? 'bg-[#007AFF] text-white' : 'text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white'}`}>
                        {v === 'list'
                          ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                          : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/></svg>
                        }
                      </button>
                    ))}
                  </div>
                  {/* Nhập hàng */}
                  <button
                    onClick={() => openStockIn()}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#34C759] text-white rounded-xl text-[13px] font-semibold hover:bg-[#2DB34A] transition-colors shrink-0 shadow-xs"
                    title="Nhập hàng vào kho"
                  >
                    <span>📦</span>
                    <span className="hidden sm:inline">Nhập hàng</span>
                  </button>

                  {/* Lịch sử nhập hàng */}
                  <button
                    onClick={() => setShowStockHistoryModal(true)}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-white dark:bg-[#1C1C1E] text-[#1C1C1E] dark:text-white rounded-xl text-[13px] font-semibold ring-1 ring-black/[0.07] dark:ring-white/[0.07] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors shrink-0"
                    title="Xem lịch sử phiếu nhập hàng"
                  >
                    <span>📜</span>
                    <span className="hidden md:inline">Lịch sử</span>
                    {stockReceipts.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-[#007AFF] text-white text-[10px] font-bold">
                        {stockReceipts.length}
                      </span>
                    )}
                  </button>

                  {/* Add */}
                  <button onClick={openAdd}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] transition-colors shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    <span className="hidden sm:inline">Thêm</span>
                  </button>
                </div>
                {/* Category filter */}
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                  {['Tất cả', ...PROD_CATEGORIES].map(c => (
                    <button key={c} onClick={() => setProdCatFilter(c)}
                      className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all ${prodCatFilter === c ? 'bg-[#007AFF] text-white' : 'bg-white dark:bg-[#1C1C1E] text-[#8E8E93] ring-1 ring-black/[0.07] dark:ring-white/[0.07]'}`}>
                      {c}
                    </button>
                  ))}
                  <span className="ml-auto shrink-0 self-center text-[11px] text-[#8E8E93] tabular-nums">{filteredProducts.length} sản phẩm</span>
                </div>
              </div>

              {/* Product list / grid */}
              <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-6">
                {filteredProducts.length === 0 ? (
                  <div className="py-16 text-center text-[#8E8E93]"><p className="text-4xl mb-2">🔍</p><p className="text-sm">Không tìm thấy sản phẩm</p></div>
                ) : prodView === 'list' ? (
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {filteredProducts.map(p => (
                      <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-slate-100 to-gray-50 dark:from-slate-800/60 dark:to-gray-800/30 flex items-center justify-center">
                          {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-3xl">{p.emoji}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[14px] font-medium truncate">{p.name}</p>
                            {p.stock !== undefined && (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                p.stock <= 5
                                  ? 'bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.15)] text-[#FF3B30]'
                                  : 'bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.15)] text-[#34C759]'
                              }`}>
                                Kho: {p.stock} {p.unit || ''}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-[#8E8E93]">{p.category}{p.unit ? ` • ĐVT: ${p.unit}` : ''}{p.costPrice ? ` • Vốn: ${shortFmt(p.costPrice)}` : ''}</p>
                          <p className="text-[13px] font-semibold text-[#007AFF] tabular-nums mt-0.5">
                            {shortFmt(p.price)}{p.unit ? <span className="text-[11px] font-normal text-[#8E8E93]">/{p.unit}</span> : ''}
                          </p>
                          {p.variants && p.variants.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {p.variants.map(v => (
                                <span
                                  key={v.id}
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-[#E5E5EA]"
                                >
                                  <span className="font-semibold">{v.name}:</span>
                                  <span className="text-[#007AFF] font-medium">{shortFmt(v.price)}</span>
                                  {v.stock !== undefined && (
                                    <span className="text-[#8E8E93] text-[10px]">({v.stock} {p.unit || ''})</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => openStockIn(p.id)}
                            title="Nhập thêm hàng"
                            className="px-2.5 py-2 rounded-xl bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.12)] text-[#34C759] font-semibold text-[11px] hover:bg-[#D7EED9] transition-colors flex items-center gap-1"
                          >
                            <span>+</span> Nhập
                          </button>
                          <button onClick={() => openEdit(p)} className="p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-white hover:bg-[#E5E5EA] transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                          </button>
                          <button onClick={() => setConfirmDelete(p.id)} className="p-2 rounded-xl bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.1)] text-[#FF3B30] hover:bg-[#FFE0DE] transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {filteredProducts.map(p => (
                      <div key={p.id} className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                        <div className="relative w-full h-28 bg-gradient-to-br from-slate-100 to-gray-50 dark:from-slate-800/60 dark:to-gray-800/30 flex items-center justify-center overflow-hidden">
                          {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-5xl">{p.emoji}</span>}
                          {p.stock !== undefined && (
                            <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs ${
                              p.stock <= 5
                                ? 'bg-[#FF3B30] text-white'
                                : 'bg-black/60 backdrop-blur-md text-white'
                            }`}>
                              Kho: {p.stock}
                            </span>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-[12px] font-medium truncate">{p.name}</p>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-[12px] font-bold text-[#007AFF] tabular-nums">
                              {shortFmt(p.price)}{p.unit ? <span className="text-[10px] font-normal text-[#8E8E93]">/{p.unit}</span> : ''}
                            </p>
                            {p.costPrice ? (
                              <span className="text-[10px] text-[#8E8E93] tabular-nums">Vốn: {shortFmt(p.costPrice)}</span>
                            ) : null}
                          </div>
                          {p.variants && p.variants.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {p.variants.slice(0, 3).map(v => (
                                <span key={v.id} className="text-[10px] px-1.5 py-0.5 rounded bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#636366] dark:text-[#AEAEB2] truncate max-w-full">
                                  {v.name}{v.stock !== undefined ? `: ${v.stock}` : ''}
                                </span>
                              ))}
                              {p.variants.length > 3 && (
                                <span className="text-[10px] text-[#8E8E93]">+{p.variants.length - 3}</span>
                              )}
                            </div>
                          )}
                          <div className="flex gap-1.5 mt-2">
                            <button onClick={() => openStockIn(p.id)} className="py-1.5 px-2 rounded-lg bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.12)] text-[11px] font-semibold text-[#34C759]">
                              + Nhập
                            </button>
                            <button onClick={() => openEdit(p)} className="flex-1 py-1.5 rounded-lg bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[11px] font-medium text-[#3C3C43] dark:text-white">Sửa</button>
                            <button onClick={() => setConfirmDelete(p.id)} className="py-1.5 px-2 rounded-lg bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.1)] text-[#FF3B30]">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Đại lý / Nhà cung cấp (List View) ── */}
          {tab === 'suppliers' && supplierView === 'list' && (
            <div className="flex flex-col h-full">
              {/* Toolbar */}
              <div className="px-4 pt-4 pb-3 space-y-2 shrink-0">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="search"
                      placeholder="Tìm tên đại lý, SĐT, địa chỉ, người liên hệ..."
                      value={supplierSearch}
                      onChange={e => setSupplierSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] text-[14px] outline-none ring-1 ring-black/[0.07] dark:ring-white/[0.07] focus:ring-2 focus:ring-[#007AFF]/30"
                    />
                  </div>
                  {/* Nhập hàng nhanh */}
                  <button
                    onClick={() => openStockIn()}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#34C759] text-white rounded-xl text-[13px] font-semibold hover:bg-[#2DB34A] transition-colors shrink-0 shadow-xs"
                    title="Tạo phiếu nhập hàng"
                  >
                    <span>📦</span>
                    <span className="hidden sm:inline">Nhập hàng</span>
                  </button>
                  {/* Thêm đại lý */}
                  <button
                    onClick={openAddSupplier}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] transition-colors shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="hidden sm:inline">Thêm đại lý</span>
                  </button>
                </div>

                {/* Filter tags & count */}
                <div className="flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide">
                  <div className="flex gap-1.5 shrink-0">
                    {(['all', 'debt', 'no-debt'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setSupplierFilter(f)}
                        className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                          supplierFilter === f
                            ? 'bg-[#007AFF] text-white'
                            : 'bg-white dark:bg-[#1C1C1E] text-[#8E8E93] ring-1 ring-black/[0.07] dark:ring-white/[0.07]'
                        }`}
                      >
                        {f === 'all' ? 'Tất cả' : f === 'debt' ? 'Đang có công nợ' : 'Đã hết nợ'}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-[#8E8E93] shrink-0 tabular-nums">
                    {filteredSuppliers.length} đại lý
                  </span>
                </div>

                {/* KPI Metrics */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-xl px-3 py-2 ring-1 ring-black/[0.05] dark:ring-white/[0.05] text-center">
                    <p className="text-xl font-bold text-[#007AFF]">{suppliers.length}</p>
                    <p className="text-[10px] text-[#8E8E93]">Tổng đại lý</p>
                  </div>
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-xl px-3 py-2 ring-1 ring-black/[0.05] dark:ring-white/[0.05] text-center">
                    <p className="text-xl font-bold text-[#FF9500]">
                      {suppliers.filter(s => s.debt > 0).length}
                    </p>
                    <p className="text-[10px] text-[#8E8E93]">Đang có nợ</p>
                  </div>
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-xl px-3 py-2 ring-1 ring-black/[0.05] dark:ring-white/[0.05] text-center">
                    <p className="text-xl font-bold text-[#FF3B30] tabular-nums">
                      {shortFmt(suppliers.reduce((s, x) => s + (x.debt || 0), 0))}
                    </p>
                    <p className="text-[10px] text-[#8E8E93]">Tổng nợ cần trả</p>
                  </div>
                </div>
              </div>

              {/* Supplier List */}
              <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-6 space-y-2.5">
                {filteredSuppliers.length === 0 ? (
                  <div className="py-16 text-center text-[#8E8E93]">
                    <p className="text-4xl mb-2">🏢</p>
                    <p className="text-sm font-semibold">Không tìm thấy đại lý nào</p>
                    <p className="text-xs text-[#C7C7CC] mt-1">Bấm nút "Thêm đại lý" để lưu thông tin nhà cung cấp mới.</p>
                  </div>
                ) : (
                  filteredSuppliers.map(s => {
                    const supReceipts = stockReceipts.filter(r => r.supplier?.toLowerCase().includes(s.name.toLowerCase()))
                    const totalSpent = supReceipts.reduce((sum, r) => sum + r.totalCost, 0)

                    return (
                      <div
                        key={s.id}
                        className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden shadow-2xs"
                      >
                        <button
                          onClick={() => {
                            setSelectedSupplier(s)
                            setSupplierView('detail')
                          }}
                          className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-[#F9F9F9] dark:hover:bg-[#242424] transition-colors"
                        >
                          {/* Avatar */}
                          <div
                            className={`w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center text-[18px] font-bold ${
                              s.debt > 0
                                ? 'bg-[#FFF3E0] dark:bg-[rgba(255,149,0,0.15)] text-[#FF9500]'
                                : 'bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.15)] text-[#007AFF]'
                            }`}
                          >
                            🏢
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[15px] font-semibold truncate">{s.name}</p>
                              {s.category && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]">
                                  {s.category}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mt-1 flex-wrap text-[12px] text-[#8E8E93]">
                              {s.contactPerson && <span>👤 {s.contactPerson}</span>}
                              {s.phone && (
                                <span className="hover:text-[#007AFF] font-mono">
                                  📞 {s.phone}
                                </span>
                              )}
                            </div>

                            {s.address && (
                              <p className="text-[11px] text-[#8E8E93] truncate mt-0.5">
                                📍 {s.address}
                              </p>
                            )}

                            {s.note && (
                              <p className="text-[11px] text-[#C7C7CC] dark:text-[#636366] truncate mt-0.5 italic">
                                💬 {s.note}
                              </p>
                            )}

                            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#8E8E93]">
                              <span>Đã nhập: <strong className="font-semibold text-[#1C1C1E] dark:text-white tabular-nums">{supReceipts.length} đợt</strong> ({shortFmt(totalSpent)})</span>
                            </div>
                          </div>

                          {/* Debt status */}
                          <div className="shrink-0 text-right">
                            {s.debt > 0 ? (
                              <>
                                <p className="text-[14px] font-bold text-[#FF3B30] tabular-nums">{shortFmt(s.debt)}</p>
                                <p className="text-[10px] font-semibold text-[#FF3B30]/75">còn nợ</p>
                              </>
                            ) : (
                              <>
                                <p className="text-lg text-[#34C759]">✓</p>
                                <p className="text-[10px] text-[#34C759]/80">hết nợ</p>
                              </>
                            )}
                          </div>
                          <svg className="w-4 h-4 text-[#C7C7CC] shrink-0 ml-1 self-center" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>

                        {/* Action buttons */}
                        <div className="flex border-t border-black/[0.05] dark:border-white/[0.05] divide-x divide-black/[0.05] dark:divide-white/[0.05] bg-[#FAFAFC] dark:bg-[#1C1C1E]">
                          <button
                            onClick={() => openStockIn(undefined, s.name)}
                            className="flex-1 py-2.5 text-[12px] font-semibold text-[#34C759] hover:bg-[#E8F5E9] dark:hover:bg-[rgba(52,199,89,0.08)] transition-colors flex items-center justify-center gap-1.5"
                          >
                            <span>📦</span> Nhập hàng
                          </button>
                          {s.debt > 0 && (
                            <button
                              onClick={() => openPaySupplier(s)}
                              className="flex-1 py-2.5 text-[12px] font-semibold text-[#FF9500] hover:bg-[#FFF3E0] dark:hover:bg-[rgba(255,149,0,0.08)] transition-colors flex items-center justify-center gap-1.5"
                            >
                              <span>💵</span> Trả nợ
                            </button>
                          )}
                          <button
                            onClick={() => openEditSupplier(s)}
                            className="flex-1 py-2.5 text-[12px] font-medium text-[#3C3C43] dark:text-[rgba(235,235,245,0.7)] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors flex items-center justify-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Sửa
                          </button>
                          <button
                            onClick={() => setConfirmDeleteSupplier(s.id)}
                            className="px-3.5 py-2.5 text-[12px] font-medium text-[#FF3B30] hover:bg-[#FFF0EF] dark:hover:bg-[rgba(255,59,48,0.05)] transition-colors flex items-center justify-center"
                            title="Xóa đại lý"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* ── Đại lý (Detail View) ── */}
          {tab === 'suppliers' && supplierView === 'detail' && selectedSupplier && (() => {
            const s = selectedSupplier
            const supReceipts = stockReceipts.filter(r => r.supplier?.toLowerCase().includes(s.name.toLowerCase()))
            const totalSpent = supReceipts.reduce((sum, r) => sum + r.totalCost, 0)

            return (
              <div className="p-4 space-y-4 max-w-2xl mx-auto pb-10">
                {/* Supplier Profile Card */}
                <div className="bg-white dark:bg-[#1C1C1E] rounded-3xl p-5 ring-1 ring-black/[0.05] dark:ring-white/[0.05] shadow-xs space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.15)] flex items-center justify-center text-3xl shrink-0">
                      🏢
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-[18px] font-bold">{s.name}</h2>
                        {s.category && (
                          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#007AFF]/10 text-[#007AFF]">
                            {s.category}
                          </span>
                        )}
                      </div>
                      {s.contactPerson && (
                        <p className="text-[13px] text-[#8E8E93] mt-1">👤 Người liên hệ: <strong className="text-[#1C1C1E] dark:text-white font-medium">{s.contactPerson}</strong></p>
                      )}
                      {s.phone && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[13px] font-mono text-[#007AFF]">📞 {s.phone}</span>
                          <a href={`tel:${s.phone}`} className="text-[11px] px-2 py-0.5 rounded-md bg-[#007AFF] text-white font-semibold">
                            Gọi ngay
                          </a>
                        </div>
                      )}
                      {s.address && (
                        <p className="text-[12px] text-[#8E8E93] mt-1">📍 {s.address}</p>
                      )}
                      {s.note && (
                        <p className="text-[12px] text-[#8E8E93] mt-2 italic bg-[#F2F2F7] dark:bg-[#2C2C2E] p-2.5 rounded-xl">
                          💬 {s.note}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Financial & Inbound Summary */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-black/[0.05] dark:border-white/[0.05]">
                    <div className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-3.5">
                      <p className="text-[11px] text-[#8E8E93] font-medium">Công nợ hiện tại</p>
                      <p className={`text-xl font-bold tabular-nums mt-0.5 ${s.debt > 0 ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                        {s.debt > 0 ? shortFmt(s.debt) : 'Không có nợ'}
                      </p>
                      {s.debt > 0 && (
                        <button
                          onClick={() => openPaySupplier(s)}
                          className="mt-2 w-full py-1.5 rounded-xl bg-[#FF9500] text-white text-[12px] font-semibold hover:bg-[#E68900] transition-colors"
                        >
                          💵 Trả nợ cho đại lý
                        </button>
                      )}
                    </div>

                    <div className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-3.5">
                      <p className="text-[11px] text-[#8E8E93] font-medium">Tổng tiền đã nhập</p>
                      <p className="text-xl font-bold text-[#007AFF] tabular-nums mt-0.5">
                        {shortFmt(totalSpent)}
                      </p>
                      <p className="text-[11px] text-[#8E8E93] mt-1">{supReceipts.length} đợt nhập hàng</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => openStockIn(undefined, s.name)}
                      className="flex-1 py-3 rounded-2xl bg-[#34C759] text-white font-semibold text-[14px] hover:bg-[#2DB34A] transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <span>📦</span> Tạo phiếu nhập từ đại lý này
                    </button>
                    <button
                      onClick={() => openEditSupplier(s)}
                      className="px-4 py-3 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[13px] font-semibold text-[#3C3C43] dark:text-white hover:bg-[#E5E5EA] transition-colors"
                    >
                      Sửa
                    </button>
                  </div>
                </div>

                {/* Inbound Receipts History */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="font-bold text-[15px]">Lịch sử phiếu nhập từ đại lý ({supReceipts.length})</h3>
                  </div>

                  {supReceipts.length === 0 ? (
                    <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-8 text-center text-[#8E8E93] ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                      <p className="text-3xl mb-1.5">📦</p>
                      <p className="text-sm">Chưa có phiếu nhập nào từ đại lý này</p>
                    </div>
                  ) : (
                    supReceipts.map(r => (
                      <div
                        key={r.id}
                        className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.05] space-y-2 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-2 py-0.5 rounded-lg">
                              #{r.code}
                            </span>
                            <span className="text-[12px] text-[#8E8E93]">
                              {new Date(r.date).toLocaleDateString('vi-VN')} {new Date(r.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="text-[14px] font-bold text-[#34C759] tabular-nums">
                            {shortFmt(r.totalCost)}
                          </span>
                        </div>
                        {r.note && <p className="text-[11px] italic text-[#8E8E93]">💬 {r.note}</p>}
                        <div className="space-y-1 pt-1 border-t border-black/[0.04] dark:border-white/[0.04]">
                          {r.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between text-[12px]">
                              <span>{it.emoji} {it.productName} × {it.qty} {it.unit || ''}</span>
                              <span className="font-medium tabular-nums">{shortFmt(it.total)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Khách hàng ── */}
          {tab === 'customers' && custView === 'list' && (
            <div className="flex flex-col h-full">
              {/* Toolbar */}
              <div className="px-4 pt-4 pb-3 space-y-2 shrink-0">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    <input type="search" placeholder="Tìm tên, SĐT, ghi chú..." value={custSearch} onChange={e => setCustSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] text-[14px] outline-none ring-1 ring-black/[0.07] dark:ring-white/[0.07] focus:ring-2 focus:ring-[#007AFF]/30" />
                  </div>
                  <button onClick={openAddCust}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] transition-colors shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    <span className="hidden sm:inline">Thêm khách</span>
                  </button>
                </div>
                {/* Summary row */}
                <div className="flex gap-3">
                  {[
                    { label: 'Tổng khách', value: customers.length, color: 'text-[#007AFF]' },
                    { label: 'Còn nợ', value: [...custBalances.values()].filter(v => v > 0).length, color: 'text-[#FF3B30]' },
                    { label: 'Đã trả', value: [...custBalances.values()].filter(v => v <= 0).length, color: 'text-[#34C759]' },
                  ].map(s => (
                    <div key={s.label} className="flex-1 bg-white dark:bg-[#1C1C1E] rounded-xl px-3 py-2 ring-1 ring-black/[0.05] dark:ring-white/[0.05] text-center">
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-[10px] text-[#8E8E93]">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Customer list */}
              <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-6 space-y-2">
                {filteredCustomers.length === 0 ? (
                  <div className="py-16 text-center text-[#8E8E93]"><p className="text-4xl mb-2">👥</p><p className="text-sm">Chưa có khách hàng</p></div>
                ) : filteredCustomers.map(c => {
                  const bal   = custBalances.get(c.id) ?? 0
                  const stats = custOrderTotals.get(c.id) ?? { count: 0, spent: 0 }
                  return (
                    <div key={c.id} className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                      <button onClick={() => { setSelectedCust(c); setCustView('detail') }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[#F9F9F9] dark:hover:bg-[#242424] transition-colors">
                        {/* Avatar */}
                        <div className={`w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-[18px] font-bold ${bal > 0 ? 'bg-[#FFF0EF] text-[#FF3B30]' : 'bg-[#E8F5E9] text-[#34C759]'}`}>
                          {c.name.split(' ').pop()?.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-semibold truncate">{c.name}</p>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            {c.phone && <span className="text-[12px] text-[#8E8E93]">📞 {c.phone}</span>}
                            {stats.count > 0 && <span className="text-[11px] text-[#8E8E93]">{stats.count} đơn nợ</span>}
                          </div>
                          {c.note && <p className="text-[11px] text-[#C7C7CC] dark:text-[#636366] truncate mt-0.5">{c.note}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          {bal > 0
                            ? <><p className="text-[14px] font-bold text-[#FF3B30] tabular-nums">{shortFmt(bal)}</p><p className="text-[10px] text-[#FF3B30]/70">còn nợ</p></>
                            : <><p className="text-lg text-[#34C759]">✓</p><p className="text-[10px] text-[#34C759]/80">hết nợ</p></>
                          }
                        </div>
                        <svg className="w-4 h-4 text-[#C7C7CC] shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                      </button>
                      <div className="flex border-t border-black/[0.05] dark:border-white/[0.05] divide-x divide-black/[0.05] dark:divide-white/[0.05]">
                        <button onClick={() => openEditCust(c)} className="flex-1 py-2.5 text-[12px] font-medium text-[#3C3C43] dark:text-[rgba(235,235,245,0.7)] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors flex items-center justify-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                          Sửa thông tin
                        </button>
                        <button onClick={() => setConfirmDeleteCust(c.id)} className="flex-1 py-2.5 text-[12px] font-medium text-[#FF3B30] hover:bg-[#FFF0EF] dark:hover:bg-[rgba(255,59,48,0.05)] transition-colors flex items-center justify-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          Xóa
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Customer Detail ── */}
          {tab === 'customers' && custView === 'detail' && selectedCust && (() => {
            const bal = custBalances.get(selectedCust.id) ?? 0
            const custDebts = [...debtEntries].filter(e => e.customerId === selectedCust.id).sort((a, b) => b.time.getTime() - a.time.getTime())
            const custOrders = orders.filter(o => {
              if (o.customerId === selectedCust.id) return true
              return debtEntries.some(e => e.orderId === o.id && e.customerId === selectedCust.id)
            }).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            const totalSpent = custDebts.filter(e => e.type === 'debit').reduce((s, e) => s + e.amount, 0)
            const totalPaid  = custDebts.filter(e => e.type === 'credit').reduce((s, e) => s + e.amount, 0)
            const formatTime = (d: Date) => {
              const diff = Date.now() - d.getTime()
              if (diff < 60000)     return 'Vừa xong'
              if (diff < 3600000)   return `${Math.floor(diff / 60000)} phút trước`
              if (diff < 86400000)  return `Hôm nay ${d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' })}`
              if (diff < 172800000) return `Hôm qua ${d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' })}`
              return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' })
            }
            return (
              <div className="flex flex-col h-full">
                {/* Profile card */}
                <div className="px-4 pt-4 shrink-0">
                  <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                    <div className="flex items-start gap-4">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0 ${bal > 0 ? 'bg-[#FFF0EF] text-[#FF3B30]' : 'bg-[#E8F5E9] text-[#34C759]'}`}>
                        {selectedCust.name.split(' ').pop()?.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[18px] font-bold">{selectedCust.name}</p>
                        {selectedCust.phone && <p className="text-[13px] text-[#8E8E93] mt-0.5">📞 {selectedCust.phone}</p>}
                        {selectedCust.note && <p className="text-[12px] text-[#C7C7CC] dark:text-[#636366] mt-0.5">{selectedCust.note}</p>}
                      </div>
                      <button onClick={() => openEditCust(selectedCust)} className="shrink-0 p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                      </button>
                    </div>
                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 mt-4">
                      {[
                        { label: 'Tổng nợ',  value: shortFmt(totalSpent), color: 'text-[#FF9500]' },
                        { label: 'Đã trả',    value: shortFmt(totalPaid),  color: 'text-[#34C759]' },
                        { label: 'Dư nợ',     value: bal > 0 ? shortFmt(bal) : '✓', color: bal > 0 ? 'text-[#FF3B30]' : 'text-[#34C759]' },
                      ].map(s => (
                        <div key={s.label} className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-xl py-2.5 px-3 text-center">
                          <p className={`text-[14px] font-bold tabular-nums ${s.color}`}>{s.value}</p>
                          <p className="text-[10px] text-[#8E8E93] mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons: Thu tiền nợ / Ghi nợ */}
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.05]">
                      <button
                        onClick={() => {
                          setCustPayType('credit')
                          setCustPayAmount(bal > 0 ? bal.toString() : '')
                          setCustPayNote('Khách trả nợ')
                          setShowCustPayModal(true)
                        }}
                        className="py-2.5 rounded-xl bg-[#34C759] text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 shadow-sm hover:bg-[#2DB34E] active:scale-[0.98] transition-all"
                      >
                        <span>💵</span> Thu tiền nợ
                      </button>
                      <button
                        onClick={() => {
                          setCustPayType('debit')
                          setCustPayAmount('')
                          setCustPayNote('Ghi nợ phát sinh')
                          setShowCustPayModal(true)
                        }}
                        className="py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#FF3B30] text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] active:scale-[0.98] transition-all"
                      >
                        <span>📝</span> Ghi nợ thêm
                      </button>
                    </div>
                  </div>
                </div>

                {/* Customer orders */}
                {custOrders.length > 0 && (
                  <div className="px-4 mt-3 shrink-0">
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider mb-2">
                      {custOrders.length} đơn hàng • Tổng chi tiêu: <span className="text-[#007AFF]">{shortFmt(custOrders.reduce((s, o) => s + o.total, 0))}</span>
                    </p>
                    <div className="space-y-1.5">
                      {custOrders.map(o => (
                        <button key={o.id} onClick={() => setSelectedOrder(o)}
                          className="w-full flex items-center gap-3 bg-white dark:bg-[#1C1C1E] rounded-xl px-3 py-2.5 ring-1 ring-black/[0.05] dark:ring-white/[0.05] text-left hover:ring-[#007AFF]/30 hover:shadow-sm transition-all active:scale-[0.99]">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            o.method === 'cash' ? 'bg-[#FFF3E0] text-[#FF9500]' :
                            o.method === 'transfer' ? 'bg-[#E8F5E9] text-[#34C759]' : 'bg-[#F3E8FF] text-[#AF52DE]'
                          }`}>{o.method === 'cash' ? 'TM' : o.method === 'transfer' ? 'CK' : 'Nợ'}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-bold">#{o.id}</p>
                            <p className="text-[11px] text-[#8E8E93] truncate">{o.lines.map(l => `${l.product.emoji} ${l.product.name}`).join(' • ')}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[13px] font-bold text-[#007AFF] tabular-nums">{shortFmt(o.total)}</p>
                            <p className="text-[10px] text-[#8E8E93]">{new Date(o.time).toLocaleDateString('vi-VN')}</p>
                          </div>
                          <svg className="w-3.5 h-3.5 text-[#C7C7CC] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Debt timeline */}
                <div className="px-4 mt-3 shrink-0">
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider mb-2">Lịch sử giao dịch ({custDebts.length})</p>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-6">
                  {custDebts.length === 0 ? (
                    <div className="py-10 text-center text-[#8E8E93]"><p className="text-3xl mb-2">📝</p><p className="text-sm">Chưa có giao dịch</p></div>
                  ) : (
                    <div className="space-y-2">
                      {custDebts.map(e => (
                        <div key={e.id} className="flex items-start gap-3 bg-white dark:bg-[#1C1C1E] rounded-2xl px-4 py-3 ring-1 ring-black/[0.05] dark:ring-white/[0.05]">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-base font-bold mt-0.5 ${e.type === 'debit' ? 'bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.1)] text-[#FF3B30]' : 'bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.1)] text-[#34C759]'}`}>
                            {e.type === 'debit' ? '↑' : '↓'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[13px] font-semibold ${e.type === 'debit' ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                              {e.type === 'debit' ? 'Ghi nợ' : 'Trả nợ'}
                              {e.orderId && <span className="text-[#8E8E93] font-normal ml-1.5">• Đơn #{e.orderId}</span>}
                            </p>
                            {e.note && <p className="text-[12px] text-[#3C3C43] dark:text-[rgba(235,235,245,0.8)] mt-0.5 truncate">{e.note}</p>}
                            <p className="text-[10px] text-[#C7C7CC] dark:text-[#636366] mt-0.5">{formatTime(e.time)}</p>
                          </div>
                          <p className={`text-[15px] font-bold tabular-nums shrink-0 ${e.type === 'debit' ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                            {e.type === 'debit' ? '+' : '−'}{shortFmt(e.amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Đơn hàng ── */}
          {tab === 'orders' && (
            <div className="p-4 max-w-3xl mx-auto space-y-3">
              {/* Date filter */}
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 items-center">
                {([
                  { id: 'today', label: 'Hôm nay' },
                  { id: 'week',  label: 'Tuần này' },
                  { id: 'month', label: 'Tháng này' },
                  { id: 'year',  label: 'Năm này' },
                  { id: 'all',   label: 'Tất cả' },
                ] as { id: typeof orderDateFilter; label: string }[]).map(f => (
                  <button key={f.id} onClick={() => { setOrderDateFilter(f.id); setCustomDate('') }}
                    className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${orderDateFilter === f.id && !customDate ? 'bg-[#007AFF] text-white' : 'bg-white dark:bg-[#1C1C1E] text-[#3C3C43] dark:text-[rgba(235,235,245,0.6)] hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E]'}`}>
                    {f.label}
                  </button>
                ))}
                <div className="flex items-center gap-1.5 bg-white dark:bg-[#1C1C1E] px-3 py-1 rounded-full text-[12px] ring-1 ring-black/[0.06] dark:ring-white/[0.06] shrink-0">
                  <span className="text-xs text-[#8E8E93]">📅</span>
                  <input
                    type="date"
                    value={customDate}
                    onChange={e => {
                      setCustomDate(e.target.value)
                      if (e.target.value) setOrderDateFilter('custom')
                    }}
                    className="bg-transparent text-[#1C1C1E] dark:text-white text-[12px] font-medium outline-none cursor-pointer"
                    title="Chọn ngày cụ thể"
                  />
                  {customDate && (
                    <button
                      type="button"
                      onClick={() => { setCustomDate(''); setOrderDateFilter('all') }}
                      className="text-[#8E8E93] hover:text-[#FF3B30] text-[11px] ml-0.5"
                      title="Bỏ chọn ngày"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {/* Method filter */}
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 items-center">
                {([
                  { id: 'all',      label: 'Tất cả' },
                  { id: 'cash',     label: '💵 Tiền mặt' },
                  { id: 'transfer', label: '📱 Chuyển khoản' },
                  { id: 'debt',     label: '📒 Ghi nợ' },
                ] as { id: typeof orderFilter; label: string }[]).map(f => (
                  <button key={f.id} onClick={() => setOrderFilter(f.id)}
                    className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all ${orderFilter === f.id ? 'bg-[#34C759] text-white' : 'bg-white dark:bg-[#1C1C1E] text-[#3C3C43] dark:text-[rgba(235,235,245,0.6)] hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E]'}`}>
                    {f.label}
                  </button>
                ))}
                <span className="ml-auto shrink-0 text-[12px] text-[#8E8E93] tabular-nums font-medium">
                  {filteredOrders.length} đơn • {shortFmt(filteredOrders.reduce((s, o) => s + o.total, 0))}
                </span>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="py-16 text-center text-[#8E8E93]">
                  <p className="text-4xl mb-2">📋</p>
                  <p className="text-sm">Không có đơn hàng</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredOrders.map(order => {
                    const cust = order.customerId ? customers.find(c => c.id === order.customerId) : null
                    return (
                      <button key={order.id} onClick={() => setSelectedOrder(order)}
                        className="w-full bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 ring-1 ring-black/[0.05] dark:ring-white/[0.05] text-left hover:ring-[#007AFF]/40 hover:shadow-md transition-all active:scale-[0.99]">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-[15px]">#{order.id}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              order.method === 'cash'     ? 'bg-[#FFF3E0] dark:bg-[rgba(255,149,0,0.1)] text-[#FF9500]'  :
                              order.method === 'transfer' ? 'bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.1)] text-[#34C759]'  :
                                                            'bg-[#F3E8FF] dark:bg-[rgba(175,82,222,0.1)] text-[#AF52DE]'
                            }`}>
                              {order.method === 'cash' ? 'Tiền mặt' : order.method === 'transfer' ? 'Chuyển khoản' : 'Ghi nợ'}
                            </span>
                            <span className="text-[11px] text-[#8E8E93]">
                              {new Date(order.time).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                            </span>
                          </div>
                          <span className="font-bold text-[15px] tabular-nums text-[#007AFF]">{shortFmt(order.total)}</span>
                        </div>
                        <p className="text-[12px] text-[#8E8E93] truncate">
                          {order.lines.map(l => `${l.product.emoji} ${l.product.name}${l.variant ? ` (${l.variant.name})` : ''} ×${l.qty}`).join('  •  ')}
                        </p>
                        {cust && (
                          <p className="text-[11px] text-[#007AFF] mt-1 font-medium">👤 {cust.name}</p>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Cài đặt ── */}
          {tab === 'settings' && (
            <div className="p-4 max-w-lg mx-auto space-y-4 pb-10">

              {/* Store Info */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Thông tin cửa hàng</p>
                </div>
                <div className="px-4 py-3">
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Tên cửa hàng</label>
                  <input
                    type="text"
                    value={shopName}
                    onChange={e => setShopName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                  />
                </div>
              </div>

              {/* Tax Rate */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Thuế & Phí</p>
                </div>
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-[14px] font-medium">Thuế VAT</p>
                    <p className="text-[12px] text-[#8E8E93]">Áp dụng cho tất cả đơn hàng</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={vatRate}
                      onChange={e => {
                        const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0))
                        setVatRate(v)
                        syncSetting?.('vat_rate', v.toString())
                      }}
                      className="w-16 px-2.5 py-1.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[15px] font-bold text-[#007AFF] tabular-nums text-center outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                    />
                    <span className="text-[15px] font-bold text-[#007AFF]">%</span>
                  </div>
                </div>
              </div>

              {/* Appearance */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Giao diện</p>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] flex items-center justify-center">
                      {dark ? <MoonIcon /> : <SunIcon />}
                    </div>
                    <div>
                      <p className="text-[14px] font-medium">{dark ? 'Chế độ tối' : 'Chế độ sáng'}</p>
                      <p className="text-[12px] text-[#8E8E93]">Chuyển giao diện sáng / tối</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDark(!dark)}
                    className={`relative w-12 h-7 rounded-full transition-colors duration-200 outline-none ${dark ? 'bg-[#007AFF]' : 'bg-[#E5E5EA] dark:bg-[#3A3A3C]'}`}
                  >
                    <span
                      className="absolute top-[3px] w-[22px] h-[22px] bg-white rounded-full shadow-md transition-all duration-200"
                      style={{ left: dark ? 'calc(100% - 25px)' : '3px' }}
                    />
                  </button>
                </div>
              </div>

              {/* ── Bank Accounts ── */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05] flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Tài khoản ngân hàng</p>
                    <p className="text-[11px] text-[#C7C7CC] mt-0.5">Dùng để tạo QR VietQR khi thanh toán</p>
                  </div>
                  <button
                    onClick={() => { setEditBank(null); setBankForm({ bankBin: '970436', accountNo: '', accountName: '' }); setBankSearch(''); setShowBankForm(true) }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#007AFF] text-white rounded-xl text-[12px] font-semibold hover:bg-[#0066CC] transition-colors shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    Thêm
                  </button>
                </div>
                {bankAccounts.length === 0 ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-[#C7C7CC]">
                    <span className="text-3xl">🏦</span>
                    <p className="text-[12px]">Chưa có tài khoản nào</p>
                  </div>
                ) : (
                  <div className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {bankAccounts.map(acc => {
                      const bank = VN_BANKS.find(b => b.bin === acc.bankBin)
                      return (
                        <div key={acc.id} className="flex items-center gap-3 px-4 py-3">
                          {/* Bank logo */}
                          {acc.bankBin && vietqrBanks.find(b => b.bin === acc.bankBin)?.logo
                            ? <img src={vietqrBanks.find(b => b.bin === acc.bankBin)!.logo} alt={acc.bankShortName} className="w-12 h-12 rounded-xl object-contain bg-white p-1 ring-1 ring-black/[0.06] shrink-0" />
                            : <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#E5F0FF] to-[#D0E4FF] dark:from-[rgba(0,122,255,0.15)] dark:to-[rgba(0,122,255,0.08)] flex items-center justify-center shrink-0">
                                <span className="text-[11px] font-bold text-[#007AFF]">{acc.bankShortName}</span>
                              </div>
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[14px] font-semibold truncate">{acc.bankShortName}</p>
                              {acc.isPrimary && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-[#007AFF] text-white rounded-full font-semibold shrink-0">Mặc định</span>
                              )}
                            </div>
                            <p className="text-[12px] text-[#8E8E93] tabular-nums">{acc.accountNo}</p>
                            <p className="text-[11px] text-[#C7C7CC] dark:text-[#636366]">{acc.accountName}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => setBankQrPreview(acc)}
                              className="p-2 rounded-xl bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.1)] text-[#007AFF] hover:bg-[#D0E4FF] transition-colors"
                              title="Xem QR"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 3.5V16M4 4l.01.01M20 4l-.01.01M4 20l.01-.01M20 20l-.01-.01M12 8V4m0 0H8m4 0h4" /></svg>
                            </button>
                            {!acc.isPrimary && (
                              <button
                                onClick={() => {
                                  const next = bankAccounts.map(a => ({ ...a, isPrimary: a.id === acc.id }))
                                  setBankAccounts(next)
                                  syncBankAccounts?.(next)
                                }}
                                className="p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#E5E5EA] transition-colors"
                                title="Đặt làm mặc định"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                              </button>
                            )}
                            <button
                              onClick={() => { setEditBank(acc); setBankForm({ bankBin: acc.bankBin, accountNo: acc.accountNo, accountName: acc.accountName }); setBankSearch(''); setShowBankForm(true) }}
                              className="p-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-white hover:bg-[#E5E5EA] transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button
                              onClick={() => {
                                const next = bankAccounts.filter(a => a.id !== acc.id)
                                if (acc.isPrimary && next.length > 0) next[0].isPrimary = true
                                setBankAccounts(next)
                                syncBankAccounts?.(next)
                              }}
                              className="p-2 rounded-xl bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.1)] text-[#FF3B30] hover:bg-[#FFE0DE] transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Stats summary */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Tóm tắt hôm nay</p>
                </div>
                {[
                  { label: 'Tổng đơn',         value: orders.length.toString() },
                  { label: 'Doanh thu',          value: shortFmt(orders.reduce((s, o) => s + o.total, 0)) },
                  { label: 'Số mặt hàng',        value: products.length.toString() },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center px-4 py-3 border-b last:border-0 border-black/[0.04] dark:border-white/[0.04]">
                    <span className="text-[14px]">{r.label}</span>
                    <span className="text-[14px] font-semibold tabular-nums">{r.value}</span>
                  </div>
                ))}
              </div>

              {/* PWA Install */}
              {onInstallPwa && (
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                  <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Ứng dụng</p>
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-sm border border-black/[0.08] dark:border-white/[0.08] bg-white">
                      <img src="./icon-192.png" alt="QuầyPOS" className="w-full h-full object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium">Cài QuầyPOS lên thiết bị</p>
                      <p className="text-[12px] text-[#8E8E93]">Dùng như app, không cần trình duyệt</p>
                    </div>
                    <button
                      onClick={onInstallPwa}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] active:scale-[0.97] transition-all shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Cài ngay
                    </button>
                  </div>
                </div>
              )}

              {/* Account */}
              {(onChangePassword || onLogout) && (
                <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                  <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider">Tài khoản</p>
                    {currentUser && <p className="text-[12px] text-[#8E8E93] mt-0.5">Đang đăng nhập: <span className="font-semibold text-[#1C1C1E] dark:text-white">{currentUser}</span></p>}
                  </div>
                  {onChangePassword && (
                    <button onClick={onChangePassword}
                      className="w-full flex items-center justify-between px-4 py-3.5 border-b border-black/[0.04] dark:border-white/[0.04] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.12)] flex items-center justify-center">
                          <svg className="w-4 h-4 text-[#007AFF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                        </div>
                        <span className="text-[14px] font-medium">Đổi mật khẩu</span>
                      </div>
                      <svg className="w-4 h-4 text-[#C7C7CC]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                    </button>
                  )}
                  {onLogout && (
                    <button onClick={onLogout}
                      className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#FFF0EF] dark:hover:bg-[rgba(255,59,48,0.06)] transition-colors text-left">
                      <div className="w-8 h-8 rounded-xl bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.12)] flex items-center justify-center">
                        <svg className="w-4 h-4 text-[#FF3B30]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                      </div>
                      <span className="text-[14px] font-medium text-[#FF3B30]">Đăng xuất</span>
                    </button>
                  )}
                </div>
              )}

              {/* Dữ liệu hệ thống: Xóa trắng dữ liệu */}
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05]">
                  <p className="text-[11px] font-semibold text-[#FF3B30] uppercase tracking-wider">Dữ liệu hệ thống</p>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-[12px] text-[#8E8E93]">
                    Xóa sạch toàn bộ đơn hàng, sản phẩm mẫu, khách hàng, đại lý và sổ nợ để bắt đầu mới từ đầu.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm('⚠️ BẠN CÓ CHẮC CHẮN MUỐN XÓA TRẮNG DỮ LIỆU?\n\nToàn bộ đơn hàng, sản phẩm, khách hàng, đại lý và sổ nợ sẽ bị xóa vĩnh viễn và không thể khôi phục!')) {
                        setProducts([])
                        if (setOrders) setOrders([])
                        setCustomers([])
                        setDebtEntries([])
                        if (setSuppliers) setSuppliers([])
                        if (setStockReceipts) setStockReceipts([])
                        setBankAccounts([])
                        await posService.wipeAllData()
                        alert('Đã xóa trắng toàn bộ dữ liệu thành công!')
                      }
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.12)] text-[#FF3B30] font-semibold text-[13px] hover:bg-[#FFE0DE] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>🗑️</span>
                    <span>Xóa trắng toàn bộ dữ liệu (Reset POS)</span>
                  </button>
                </div>
              </div>

              <div className="text-center pb-4 space-y-0.5">
                <p className="text-[11px] text-[#C7C7CC]">QuầyPOS v{__APP_VERSION__}</p>
                <p className="text-[10px] text-[#C7C7CC]/60">
                  Build: {new Date(__BUILD_TIME__).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Product Form Modal ── */}
      {showProductForm && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowProductForm(false)} />
          <div className="relative w-full sm:max-w-sm bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-[#C7C7CC]" />
            </div>
            <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-black/[0.07] dark:border-white/[0.07]">
              <h3 className="font-bold text-[17px]">{editProduct ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h3>
              <button onClick={() => setShowProductForm(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">
                <XIcon />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto scrollbar-hide">

              {/* Image Upload */}
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-2">Hình ảnh sản phẩm</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }}
                />
                {formData.image ? (
                  <div className="relative rounded-2xl overflow-hidden aspect-square w-full max-w-[200px] mx-auto group">
                    <img src={formData.image} alt="preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-white/90 rounded-xl text-[12px] font-semibold text-[#1C1C1E]"
                      >
                        📷 Đổi ảnh
                      </button>
                      <button
                        onClick={() => setFormData(f => ({ ...f, image: '' }))}
                        className="px-3 py-1.5 bg-[#FF3B30]/90 rounded-xl text-[12px] font-semibold text-white"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f) }}
                    className={`w-full aspect-[4/3] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all ${
                      dragOver
                        ? 'border-[#007AFF] bg-[#007AFF]/8'
                        : 'border-[#C7C7CC] dark:border-[#48484A] hover:border-[#007AFF] hover:bg-[#007AFF]/5'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] flex items-center justify-center text-2xl">
                      📷
                    </div>
                    <p className="text-[13px] font-medium text-[#3C3C43] dark:text-white">Thêm ảnh sản phẩm</p>
                    <p className="text-[11px] text-[#8E8E93]">Nhấn để chọn hoặc kéo thả ảnh vào đây</p>
                    <p className="text-[10px] text-[#C7C7CC]">JPG, PNG, WEBP • Tối đa 5MB</p>
                  </button>
                )}
              </div>

              {/* Emoji picker — chỉ hiển thị khi chưa có ảnh */}
              {!formData.image && <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-2">
                  Biểu tượng <span className="text-[#C7C7CC]">(hiển thị khi chưa có ảnh)</span>
                </label>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-xl flex items-center justify-center text-3xl shrink-0">{formData.emoji}</div>
                  <div className="flex-1 flex flex-wrap gap-1 max-h-24 overflow-y-auto scrollbar-hide">
                    {EMOJIS.map(e => (
                      <button
                        key={e}
                        onClick={() => setFormData(f => ({ ...f, emoji: e }))}
                        className={`text-xl p-1 rounded-lg transition-all ${formData.emoji === e ? 'bg-[#007AFF]/15 ring-1 ring-[#007AFF]' : 'hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]'}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </div>}

              {/* Name */}
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Tên sản phẩm</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ví dụ: Cà phê đen"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
              </div>

              {/* Biến thể / Mức giá Toggle */}
              <div className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-[#1C1C1E] dark:text-white">Nhiều biến thể / Mức giá</p>
                    <p className="text-[11px] text-[#8E8E93]">Bật nếu món có các hộp 25k/30k/50k, size, lạng/kg...</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !formData.hasVariants
                      setFormData(f => ({
                        ...f,
                        hasVariants: next,
                        variants: next && f.variants.length === 0 ? [
                          { id: '1', name: 'Hộp 25k', price: '25000' },
                          { id: '2', name: 'Hộp 30k', price: '30000' },
                          { id: '3', name: 'Hộp 50k', price: '50000' },
                        ] : f.variants
                      }))
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 outline-none shrink-0 ${formData.hasVariants ? 'bg-[#007AFF]' : 'bg-[#D1D1D6] dark:bg-[#3A3A3C]'}`}
                  >
                    <span
                      className="absolute top-[2px] w-[20px] h-[20px] bg-white rounded-full shadow-md transition-all duration-200"
                      style={{ left: formData.hasVariants ? 'calc(100% - 22px)' : '2px' }}
                    />
                  </button>
                </div>

                {formData.hasVariants && (
                  <div className="space-y-2.5 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
                    {/* Gợi ý mẫu biến thể nhanh */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-[#8E8E93] font-medium">Mẫu nhanh:</span>
                      <button
                        type="button"
                        onClick={() => setFormData(f => ({
                          ...f,
                          variants: [
                            { id: '1', name: 'Hộp 25k', price: '25000', costPrice: '11000', stock: '10' },
                            { id: '2', name: 'Hộp 30k', price: '30000', costPrice: '14000', stock: '10' },
                            { id: '3', name: 'Hộp 50k', price: '50000', costPrice: '25000', stock: '5' },
                          ]
                        }))}
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-[#1C1C1E] text-[10px] font-medium text-[#007AFF] shadow-2xs hover:bg-[#E5E5EA]"
                      >
                        🏷️ Hộp 25k/30k/50k
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData(f => ({
                          ...f,
                          variants: [
                            { id: '1', name: 'Size S', price: '25000', costPrice: '10000', stock: '15' },
                            { id: '2', name: 'Size M', price: '30000', costPrice: '12000', stock: '20' },
                            { id: '3', name: 'Size L', price: '38000', costPrice: '16000', stock: '15' },
                          ]
                        }))}
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-[#1C1C1E] text-[10px] font-medium text-[#007AFF] shadow-2xs hover:bg-[#E5E5EA]"
                      >
                        🥤 Size S/M/L
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData(f => ({
                          ...f,
                          variants: [
                            { id: '1', name: 'Tô vừa', price: '45000', costPrice: '22000', stock: '15' },
                            { id: '2', name: 'Tô lớn', price: '55000', costPrice: '27000', stock: '10' },
                            { id: '3', name: 'Đặc biệt', price: '70000', costPrice: '35000', stock: '5' },
                          ]
                        }))}
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-[#1C1C1E] text-[10px] font-medium text-[#007AFF] shadow-2xs hover:bg-[#E5E5EA]"
                      >
                        🍲 Vừa/Lớn/ĐB
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData(f => ({
                          ...f,
                          variants: [
                            { id: '1', name: '1 lạng', price: '30000', costPrice: '15000', stock: '20' },
                            { id: '2', name: '2 lạng', price: '60000', costPrice: '30000', stock: '15' },
                            { id: '3', name: '0.5 kg', price: '140000', costPrice: '70000', stock: '10' },
                            { id: '4', name: '1 kg', price: '270000', costPrice: '135000', stock: '5' },
                          ]
                        }))}
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-[#1C1C1E] text-[10px] font-medium text-[#007AFF] shadow-2xs hover:bg-[#E5E5EA]"
                      >
                        ⚖️ Lạng / kg
                      </button>
                    </div>

                    {/* Danh sách các dòng biến thể */}
                    <div className="space-y-2">
                      {formData.variants.map((v, idx) => (
                        <div key={v.id || idx} className="p-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] ring-1 ring-black/[0.06] dark:ring-white/[0.06] space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="Tên biến thể (Hộp 25k, Size M...)"
                              value={v.name}
                              onChange={e => {
                                const val = e.target.value
                                setFormData(f => ({
                                  ...f,
                                  variants: f.variants.map((x, i) => i === idx ? { ...x, name: val } : x)
                                }))
                              }}
                              className="flex-1 px-3 py-1.5 rounded-lg bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[13px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 font-medium"
                            />
                            <div className="relative w-28 shrink-0">
                              <input
                                type="number"
                                placeholder="Giá bán"
                                value={v.price}
                                onChange={e => {
                                  const val = e.target.value
                                  setFormData(f => ({
                                    ...f,
                                    variants: f.variants.map((x, i) => i === idx ? { ...x, price: val } : x)
                                  }))
                                }}
                                className="w-full pl-2.5 pr-6 py-1.5 rounded-lg bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[13px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 tabular-nums text-right font-semibold"
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#8E8E93]">₫</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFormData(f => ({
                                  ...f,
                                  variants: f.variants.filter((_, i) => i !== idx)
                                }))
                              }}
                              className="p-1.5 text-[#8E8E93] hover:text-[#FF3B30] transition-colors shrink-0"
                              title="Xóa biến thể"
                            >
                              ✕
                            </button>
                          </div>

                          {/* Giá vốn & Tồn kho riêng cho biến thể này */}
                          <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-black/[0.04] dark:border-white/[0.04]">
                            <div className="flex items-center gap-1.5 bg-[#F2F2F7] dark:bg-[#2C2C2E] px-2.5 py-1 rounded-lg">
                              <span className="text-[10px] text-[#8E8E93] shrink-0 font-medium">Vốn:</span>
                              <input
                                type="number"
                                placeholder="Giá vốn ₫"
                                value={v.costPrice ?? ''}
                                onChange={e => {
                                  const val = e.target.value
                                  setFormData(f => ({
                                    ...f,
                                    variants: f.variants.map((x, i) => i === idx ? { ...x, costPrice: val } : x)
                                  }))
                                }}
                                className="w-full bg-transparent text-[12px] tabular-nums outline-none text-right font-medium"
                              />
                              <span className="text-[10px] text-[#8E8E93]">₫</span>
                            </div>

                            <div className="flex items-center gap-1.5 bg-[#F2F2F7] dark:bg-[#2C2C2E] px-2.5 py-1 rounded-lg">
                              <span className="text-[10px] text-[#8E8E93] shrink-0 font-medium">Tồn kho:</span>
                              <input
                                type="number"
                                placeholder="SL tồn"
                                value={v.stock ?? ''}
                                onChange={e => {
                                  const val = e.target.value
                                  setFormData(f => ({
                                    ...f,
                                    variants: f.variants.map((x, i) => i === idx ? { ...x, stock: val } : x)
                                  }))
                                }}
                                className="w-full bg-transparent text-[12px] tabular-nums outline-none text-right font-medium"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setFormData(f => ({
                          ...f,
                          variants: [
                            ...f.variants,
                            { id: `new_${Date.now()}`, name: '', price: f.price || '0', costPrice: f.costPrice || '', stock: '' }
                          ]
                        }))
                      }}
                      className="w-full py-2 border border-dashed border-[#007AFF]/40 text-[#007AFF] rounded-xl text-[12px] font-semibold hover:bg-[#007AFF]/5 transition-colors flex items-center justify-center gap-1"
                    >
                      + Thêm biến thể
                    </button>
                  </div>
                )}
              </div>

              {/* Price & Unit (Chỉ hiện khi KHÔNG dùng biến thể) */}
              {!formData.hasVariants && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Giá bán (₫)</label>
                      <input
                        type="number"
                        value={formData.price}
                        onChange={e => setFormData(f => ({ ...f, price: e.target.value }))}
                        placeholder="25000"
                        className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 tabular-nums"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[12px] text-[#8E8E93] font-medium">Đơn vị tính</label>
                        {isCustomUnit && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomUnit(false)
                              setFormData(f => ({ ...f, unit: units[0] || 'ly' }))
                            }}
                            className="text-[11px] text-[#007AFF] hover:underline"
                          >
                            Chọn từ danh sách
                          </button>
                        )}
                      </div>

                      {!isCustomUnit ? (
                        <select
                          value={units.includes(formData.unit) ? formData.unit : '__custom__'}
                          onChange={e => {
                            if (e.target.value === '__custom__') {
                              setIsCustomUnit(true)
                              setFormData(f => ({ ...f, unit: '' }))
                            } else {
                              setIsCustomUnit(false)
                              setFormData(f => ({ ...f, unit: e.target.value }))
                            }
                          }}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 font-medium cursor-pointer"
                        >
                          <optgroup label="Khối lượng">
                            <option value="kg">kg (kilogram)</option>
                            <option value="lạng">lạng (100g)</option>
                            <option value="g">g (gram)</option>
                          </optgroup>
                          <optgroup label="Đồ uống / Pha chế">
                            <option value="ly">ly</option>
                            <option value="cốc">cốc</option>
                            <option value="chai">chai</option>
                            <option value="lon">lon</option>
                          </optgroup>
                          <optgroup label="Món ăn / Suất ăn">
                            <option value="phần">phần</option>
                            <option value="suất">suất</option>
                            <option value="tô">tô</option>
                            <option value="bát">bát</option>
                            <option value="đĩa">đĩa</option>
                            <option value="ổ">ổ</option>
                            <option value="cái">cái</option>
                            <option value="cây">cây</option>
                            <option value="trái">trái</option>
                          </optgroup>
                          <optgroup label="Đóng gói / Khác">
                            <option value="hộp">hộp</option>
                            <option value="gói">gói</option>
                            <option value="bịch">bịch</option>
                            <option value="thanh">thanh</option>
                          </optgroup>
                          {units.filter(u => !DEFAULT_UNITS.includes(u)).length > 0 && (
                            <optgroup label="Đơn vị đã lưu">
                              {units.filter(u => !DEFAULT_UNITS.includes(u)).map(u => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </optgroup>
                          )}
                          <option value="__custom__">➕ Nhập đơn vị mới...</option>
                        </select>
                      ) : (
                        <div className="relative">
                          <input
                            type="text"
                            autoFocus
                            value={formData.unit}
                            onChange={e => setFormData(f => ({ ...f, unit: e.target.value }))}
                            placeholder="Nhập ĐVT mới (VD: thùng, xâu...)"
                            className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 pr-8"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomUnit(false)
                              setFormData(f => ({ ...f, unit: units[0] || 'ly' }))
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white"
                            title="Quay lại danh sách"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick unit chips */}
                  <div className="flex items-center gap-1.5 flex-wrap -mt-2">
                    <span className="text-[11px] text-[#8E8E93]">Nhanh:</span>
                    {['kg', 'lạng', 'g', 'ly', 'phần', 'tô', 'đĩa', 'ổ', 'cái', 'chai', 'hộp'].map(u => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => {
                          setIsCustomUnit(false)
                          setFormData(f => ({ ...f, unit: u }))
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                          formData.unit === u && !isCustomUnit
                            ? 'bg-[#007AFF] text-white'
                            : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Giá vốn & Tồn kho */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Giá vốn (₫)</label>
                  <input
                    type="number"
                    value={formData.costPrice}
                    onChange={e => setFormData(f => ({ ...f, costPrice: e.target.value }))}
                    placeholder="VD: 15000"
                    className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Số lượng tồn kho</label>
                  <input
                    type="number"
                    value={formData.stock}
                    onChange={e => setFormData(f => ({ ...f, stock: e.target.value }))}
                    placeholder="20"
                    className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 tabular-nums"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Danh mục</label>
                <div className="grid grid-cols-2 gap-2">
                  {PROD_CATEGORIES.map(c => (
                    <button
                      key={c}
                      onClick={() => setFormData(f => ({ ...f, category: c }))}
                      className={`py-2 rounded-xl text-[13px] font-medium transition-all ${
                        formData.category === c
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-white hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>


              <button
                onClick={saveProduct}
                disabled={isSavingProduct || !formData.name.trim() || (!formData.price && (!formData.hasVariants || formData.variants.length === 0))}
                className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {isSavingProduct ? 'Đang lưu...' : (editProduct ? 'Lưu thay đổi' : 'Thêm sản phẩm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Product Confirm ── */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl max-w-xs w-full text-center animate-pop-in">
            <div className="w-12 h-12 bg-[#FFE5E5] dark:bg-[rgba(255,59,48,0.12)] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#FF3B30]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </div>
            <p className="font-bold text-[16px]">Xóa sản phẩm?</p>
            <p className="text-[13px] text-[#8E8E93] mt-1 mb-5">Hành động này không thể hoàn tác.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-3 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] font-semibold">Hủy</button>
              <button onClick={() => deleteProduct(confirmDelete)} className="flex-1 py-3 rounded-xl bg-[#FF3B30] text-white text-[14px] font-semibold">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Customer Confirm ── */}
      {confirmDeleteCust !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDeleteCust(null)} />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl max-w-xs w-full text-center animate-pop-in">
            <div className="w-12 h-12 bg-[#FFE5E5] dark:bg-[rgba(255,59,48,0.12)] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#FF3B30]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
            </div>
            <p className="font-bold text-[16px]">Xóa khách hàng?</p>
            <p className="text-[13px] text-[#8E8E93] mt-1 mb-5">Lịch sử ghi nợ của khách vẫn được giữ lại.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteCust(null)} className="flex-1 py-3 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] font-semibold">Hủy</button>
              <button onClick={() => deleteCust(confirmDeleteCust)} className="flex-1 py-3 rounded-xl bg-[#FF3B30] text-white text-[14px] font-semibold">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Customer Form Modal ── */}
      {showCustForm && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCustForm(false)} />
          <div className="relative w-full sm:max-w-sm bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-center pt-3 pb-1 sm:hidden"><div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" /></div>
            <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-black/[0.07] dark:border-white/[0.07]">
              <h3 className="font-bold text-[17px]">{editCust ? 'Sửa thông tin khách' : 'Thêm khách hàng'}</h3>
              <button onClick={() => setShowCustForm(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]"><XIcon /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Avatar preview */}
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.15)] flex items-center justify-center text-2xl font-bold text-[#007AFF]">
                  {custFormData.name.split(' ').pop()?.charAt(0) || '?'}
                </div>
              </div>
              {[
                { key: 'name',  label: 'Tên khách hàng *', placeholder: 'Nguyễn Văn A',           type: 'text' },
                { key: 'phone', label: 'Số điện thoại',    placeholder: '0901 234 567',            type: 'tel' },
                { key: 'note',  label: 'Ghi chú',          placeholder: 'Khách quen, nhân viên...', type: 'text' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={custFormData[f.key as keyof typeof custFormData]}
                    onChange={e => setCustFormData(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25" />
                </div>
              ))}
              {!editCust && (
                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Dư nợ ban đầu</label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="0"
                      min="0"
                      value={custFormData.initialDebt}
                      onChange={e => setCustFormData(p => ({ ...p, initialDebt: e.target.value }))}
                      className="w-full px-3.5 py-2.5 pr-8 rounded-xl bg-[#FFF8E7] dark:bg-[rgba(255,149,0,0.08)] text-[14px] font-semibold text-[#FF9500] outline-none focus:ring-2 focus:ring-[#FF9500]/30 placeholder:text-[#C7C7CC] placeholder:font-normal"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#C7C7CC] pointer-events-none">₫</span>
                  </div>
                  {parseInt(custFormData.initialDebt || '0') > 0 && (
                    <p className="text-[11px] text-[#FF9500] mt-1 pl-1">
                      Sẽ ghi nợ ban đầu: {shortFmt(parseInt(custFormData.initialDebt))}
                    </p>
                  )}
                </div>
              )}
              <button onClick={saveCust} disabled={isSavingCust || !custFormData.name.trim()}
                className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all disabled:opacity-40 mt-1">
                {isSavingCust ? 'Đang lưu...' : (editCust ? 'Lưu thay đổi' : 'Thêm khách hàng')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Supplier Confirm ── */}
      {confirmDeleteSupplier !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDeleteSupplier(null)} />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl max-w-xs w-full text-center animate-pop-in">
            <div className="w-12 h-12 bg-[#FFE5E5] dark:bg-[rgba(255,59,48,0.12)] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#FF3B30]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <p className="font-bold text-[16px]">Xóa đại lý này?</p>
            <p className="text-[13px] text-[#8E8E93] mt-1 mb-5">Lịch sử các phiếu nhập trước đó vẫn được lưu trữ.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteSupplier(null)} className="flex-1 py-3 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] font-semibold">Hủy</button>
              <button onClick={() => deleteSupplier(confirmDeleteSupplier)} className="flex-1 py-3 rounded-xl bg-[#FF3B30] text-white text-[14px] font-semibold">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Supplier Form Modal ── */}
      {showSupplierForm && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSupplierForm(false)} />
          <div className="relative w-full sm:max-w-md bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
            </div>
            <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-black/[0.07] dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏢</span>
                <h3 className="font-bold text-[17px]">{editSupplier ? 'Sửa thông tin đại lý' : 'Thêm đại lý mới'}</h3>
              </div>
              <button onClick={() => setShowSupplierForm(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">
                <XIcon />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[75vh] overflow-y-auto scrollbar-hide">
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Tên đại lý / Nhà phân phối *</label>
                <input
                  type="text"
                  placeholder="VD: Đại lý Nước ngọt Hoàng Phát"
                  value={supplierFormData.name}
                  onChange={e => setSupplierFormData(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    placeholder="0901 234 567"
                    value={supplierFormData.phone}
                    onChange={e => setSupplierFormData(p => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Người liên hệ</label>
                  <input
                    type="text"
                    placeholder="VD: Anh Hoàng (Sale)"
                    value={supplierFormData.contactPerson}
                    onChange={e => setSupplierFormData(p => ({ ...p, contactPerson: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Nhóm hàng cung cấp</label>
                <input
                  type="text"
                  placeholder="VD: Đồ uống & Giải khát, Nguyên liệu..."
                  value={supplierFormData.category}
                  onChange={e => setSupplierFormData(p => ({ ...p, category: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
                <div className="flex gap-1.5 flex-wrap mt-1.5">
                  {['Đồ uống & Giải khát', 'Trà & Nguyên liệu', 'Bánh & Thực phẩm', 'Bao bì & Ly hộp', 'Khác'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSupplierFormData(p => ({ ...p, category: c }))}
                      className={`text-[11px] px-2 py-0.5 rounded-lg transition-colors ${
                        supplierFormData.category === c
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Địa chỉ kho / đại lý</label>
                <input
                  type="text"
                  placeholder="VD: 45/2 Tô Hiến Thành, Q.10"
                  value={supplierFormData.address}
                  onChange={e => setSupplierFormData(p => ({ ...p, address: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
              </div>

              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Ghi chú (chiết khấu, giao nhận...)</label>
                <input
                  type="text"
                  placeholder="VD: Chiết khấu 3%, giao thứ 2..."
                  value={supplierFormData.note}
                  onChange={e => setSupplierFormData(p => ({ ...p, note: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
              </div>

              {!editSupplier && (
                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Công nợ ban đầu (nếu có)</label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="0"
                      value={supplierFormData.initialDebt}
                      onChange={e => setSupplierFormData(p => ({ ...p, initialDebt: e.target.value }))}
                      className="w-full px-3.5 py-2.5 pr-8 rounded-xl bg-[#FFF8E7] dark:bg-[rgba(255,149,0,0.08)] text-[14px] font-semibold text-[#FF9500] outline-none focus:ring-2 focus:ring-[#FF9500]/30 tabular-nums"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#C7C7CC] pointer-events-none">₫</span>
                  </div>
                  {parseInt(supplierFormData.initialDebt || '0') > 0 && (
                    <p className="text-[11px] text-[#FF9500] mt-1 pl-1">
                      Ghi nhận đang nợ đại lý: {shortFmt(parseInt(supplierFormData.initialDebt))}
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={saveSupplier}
                disabled={isSavingSupplier || !supplierFormData.name.trim()}
                className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all disabled:opacity-40 mt-2"
              >
                {isSavingSupplier ? 'Đang lưu...' : (editSupplier ? 'Lưu thay đổi' : 'Thêm đại lý')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pay Supplier Debt Modal ── */}
      {showSupplierPayModal && payingSupplier && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSupplierPayModal(false)} />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-2xl max-w-sm w-full p-5 space-y-4 animate-pop-in">
            <div className="flex items-center justify-between border-b border-black/[0.07] dark:border-white/[0.07] pb-3">
              <div>
                <h3 className="font-bold text-[17px]">Trả nợ đại lý</h3>
                <p className="text-[12px] text-[#8E8E93]">{payingSupplier.name}</p>
              </div>
              <button onClick={() => setShowSupplierPayModal(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">
                <XIcon />
              </button>
            </div>

            {/* Current debt badge */}
            <div className="bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.12)] p-3 rounded-2xl flex items-center justify-between">
              <span className="text-[12px] text-[#FF3B30] font-medium">Đang nợ đại lý:</span>
              <span className="text-[16px] font-bold text-[#FF3B30] tabular-nums">{shortFmt(payingSupplier.debt)}</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] text-[#8E8E93] font-medium">Số tiền trả (₫)</label>
                <button
                  type="button"
                  onClick={() => setPaySupplierAmount(payingSupplier.debt.toString())}
                  className="text-[11px] text-[#007AFF] font-semibold hover:underline"
                >
                  Trả hết nợ ({shortFmt(payingSupplier.debt)})
                </button>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max={payingSupplier.debt}
                  placeholder="0"
                  value={paySupplierAmount}
                  onChange={e => setPaySupplierAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-8 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[15px] font-bold text-[#34C759] outline-none focus:ring-2 focus:ring-[#34C759]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#8E8E93] pointer-events-none">₫</span>
              </div>
            </div>

            {/* Payment method */}
            <div>
              <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Hình thức chi trả</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaySupplierMethod('transfer')}
                  className={`py-2 rounded-xl text-[13px] font-semibold transition-all ${
                    paySupplierMethod === 'transfer'
                      ? 'bg-[#007AFF] text-white'
                      : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]'
                  }`}
                >
                  📱 Chuyển khoản
                </button>
                <button
                  type="button"
                  onClick={() => setPaySupplierMethod('cash')}
                  className={`py-2 rounded-xl text-[13px] font-semibold transition-all ${
                    paySupplierMethod === 'cash'
                      ? 'bg-[#007AFF] text-white'
                      : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]'
                  }`}
                >
                  💵 Tiền mặt
                </button>
              </div>
            </div>

            <div>
              <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Ghi chú</label>
              <input
                type="text"
                placeholder="VD: Thanh toán đợt hàng tháng 10"
                value={paySupplierNote}
                onChange={e => setPaySupplierNote(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[13px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
              />
            </div>

            <button
              type="button"
              onClick={confirmPaySupplier}
              disabled={!parseInt(paySupplierAmount || '0')}
              className="w-full py-3.5 rounded-2xl bg-[#34C759] text-white font-bold text-[14px] hover:bg-[#2DB34A] active:scale-[0.98] transition-all disabled:opacity-40"
            >
              ✓ Xác nhận đã trả {shortFmt(parseInt(paySupplierAmount || '0'))}
            </button>
          </div>
        </div>
      )}

      {/* ── Customer Pay / Add Debt Modal ── */}
      {showCustPayModal && selectedCust && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !isSavingCustDebt && setShowCustPayModal(false)} />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-2xl max-w-sm w-full p-5 space-y-4 animate-pop-in">
            <div className="flex items-center justify-between border-b border-black/[0.07] dark:border-white/[0.07] pb-3">
              <div>
                <h3 className="font-bold text-[17px]">{custPayType === 'credit' ? 'Thu tiền nợ' : 'Ghi nợ cho khách'}</h3>
                <p className="text-[12px] text-[#8E8E93]">{selectedCust.name}</p>
              </div>
              <button onClick={() => !isSavingCustDebt && setShowCustPayModal(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">
                <XIcon />
              </button>
            </div>

            {/* Current balance badge */}
            <div className="bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.12)] p-3 rounded-2xl flex items-center justify-between">
              <span className="text-[12px] text-[#FF3B30] font-medium">Dư nợ hiện tại:</span>
              <span className="text-[16px] font-bold text-[#FF3B30] tabular-nums">
                {shortFmt(custBalances.get(selectedCust.id) ?? 0)}
              </span>
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCustPayType('credit')}
                className={`py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  custPayType === 'credit'
                    ? 'bg-[#34C759] text-white shadow-sm'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]'
                }`}
              >
                💵 Khách trả nợ
              </button>
              <button
                type="button"
                onClick={() => setCustPayType('debit')}
                className={`py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  custPayType === 'debit'
                    ? 'bg-[#FF3B30] text-white shadow-sm'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#8E8E93]'
                }`}
              >
                📝 Ghi nợ thêm
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] text-[#8E8E93] font-medium">Số tiền (₫)</label>
                {custPayType === 'credit' && (custBalances.get(selectedCust.id) ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setCustPayAmount((custBalances.get(selectedCust.id) ?? 0).toString())}
                    className="text-[11px] text-[#007AFF] font-semibold hover:underline"
                  >
                    Thu hết nợ ({shortFmt(custBalances.get(selectedCust.id) ?? 0)})
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={custPayAmount}
                  onChange={e => setCustPayAmount(e.target.value)}
                  className={`w-full px-3.5 py-2.5 pr-8 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[15px] font-bold outline-none focus:ring-2 tabular-nums ${
                    custPayType === 'credit' ? 'text-[#34C759] focus:ring-[#34C759]/30' : 'text-[#FF3B30] focus:ring-[#FF3B30]/30'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#8E8E93] pointer-events-none">₫</span>
              </div>
            </div>

            <div>
              <label className="text-[12px] text-[#8E8E93] font-medium block mb-1">Ghi chú</label>
              <input
                type="text"
                placeholder={custPayType === 'credit' ? 'VD: Trả tiền mặt, chuyển khoản...' : 'VD: Nợ tiền nước, bánh mì...'}
                value={custPayNote}
                onChange={e => setCustPayNote(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[13px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
              />
            </div>

            <button
              type="button"
              onClick={confirmCustDebtAction}
              disabled={isSavingCustDebt || !parseInt(custPayAmount || '0')}
              className={`w-full py-3.5 rounded-2xl text-white font-bold text-[14px] active:scale-[0.98] transition-all disabled:opacity-40 ${
                custPayType === 'credit' ? 'bg-[#34C759] hover:bg-[#2DB34A]' : 'bg-[#FF3B30] hover:bg-[#E0352B]'
              }`}
            >
              {isSavingCustDebt
                ? 'Đang lưu...'
                : `✓ Xác nhận ${custPayType === 'credit' ? 'thu' : 'ghi nợ'} ${shortFmt(parseInt(custPayAmount || '0'))}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Bank Account Form Modal ── */}
      {showBankForm && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowBankForm(false)} />
          <div className="relative w-full sm:max-w-sm bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex justify-center pt-3 pb-1 sm:hidden"><div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" /></div>
            <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-black/[0.07] dark:border-white/[0.07]">
              <h3 className="font-bold text-[17px]">{editBank ? 'Sửa tài khoản' : 'Thêm tài khoản NH'}</h3>
              <button onClick={() => setShowBankForm(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]"><XIcon /></button>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[80vh]">
              {/* Bank selector */}
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">
                  Ngân hàng
                  {banksLoading && <span className="ml-2 text-[#007AFF]">đang tải...</span>}
                </label>
                {/* Selected bank preview */}
                {(() => {
                  const sel = vietqrBanks.find(b => b.bin === bankForm.bankBin)
                  return sel ? (
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.1)] mb-2">
                      {sel.logo
                        ? <img src={sel.logo} alt={sel.short} className="w-9 h-9 rounded-lg object-contain bg-white p-0.5" />
                        : <div className="w-9 h-9 rounded-lg bg-[#007AFF] flex items-center justify-center text-white text-[10px] font-bold">{sel.short.slice(0,4)}</div>
                      }
                      <span className="text-[13px] font-semibold text-[#007AFF]">{sel.short}</span>
                    </div>
                  ) : null
                })()}
                {/* Search */}
                <div className="relative mb-2">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8E8E93] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  <input
                    type="search"
                    placeholder="Tìm ngân hàng..."
                    value={bankSearch}
                    onChange={e => setBankSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[13px] outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                  />
                </div>
                {/* Bank list */}
                <div className="max-h-36 overflow-y-auto rounded-xl ring-1 ring-black/[0.07] dark:ring-white/[0.07] divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {vietqrBanks
                    .filter(b => !bankSearch || b.name.toLowerCase().includes(bankSearch.toLowerCase()) || b.short.toLowerCase().includes(bankSearch.toLowerCase()))
                    .map(b => (
                      <button
                        key={b.bin}
                        type="button"
                        onClick={() => { setBankForm(p => ({ ...p, bankBin: b.bin })); setBankSearch('') }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                          bankForm.bankBin === b.bin
                            ? 'bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.12)]'
                            : 'bg-white dark:bg-[#1C1C1E] hover:bg-[#F9F9F9] dark:hover:bg-[#242424]'
                        }`}
                      >
                        {b.logo
                          ? <img src={b.logo} alt={b.short} className="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shrink-0" />
                          : <div className="w-9 h-9 rounded-lg bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.1)] flex items-center justify-center text-[9px] font-bold text-[#007AFF] shrink-0">{b.short.slice(0,4)}</div>
                        }
                        <span className="text-[13px] font-semibold flex-1 truncate">{b.short}</span>
                        <span className="text-[11px] text-[#8E8E93] shrink-0 truncate max-w-[120px] text-right">{b.name}</span>
                        {bankForm.bankBin === b.bin && (
                          <svg className="w-4 h-4 text-[#007AFF] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                        )}
                      </button>
                    ))
                  }
                </div>
              </div>
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Số tài khoản</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0123456789"
                  value={bankForm.accountNo}
                  onChange={e => setBankForm(p => ({ ...p, accountNo: e.target.value.replace(/\s/g, '') }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] font-mono outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
              </div>
              <div>
                <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">Tên chủ tài khoản</label>
                <input
                  type="text"
                  placeholder="NGUYEN VAN A"
                  value={bankForm.accountName}
                  onChange={e => setBankForm(p => ({ ...p, accountName: e.target.value.toUpperCase() }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] font-mono outline-none focus:ring-2 focus:ring-[#007AFF]/25"
                />
                <p className="text-[11px] text-[#8E8E93] mt-1 pl-1">Nhập IN HOA, đúng tên trong tài khoản</p>
              </div>
              {/* Preview QR */}
              {bankForm.accountNo.trim() && bankForm.accountName.trim() && (
                <div className="rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] p-3 flex items-center gap-3">
                  <img
                    src={`https://img.vietqr.io/image/${bankForm.bankBin}-${bankForm.accountNo}-qr_only.png`}
                    alt="VietQR preview"
                    className="w-16 h-16 rounded-lg bg-white object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8E8E93]">Preview QR</p>
                    <p className="text-[13px] font-semibold truncate">{bankForm.accountName || '—'}</p>
                    <p className="text-[12px] text-[#8E8E93] font-mono">{bankForm.accountNo}</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  if (!bankForm.accountNo.trim() || !bankForm.accountName.trim()) return
                  const bank = vietqrBanks.find(b => b.bin === bankForm.bankBin) ?? { short: bankForm.bankBin, name: bankForm.bankBin }
                  const isFirst = bankAccounts.length === 0
                  if (editBank) {
                    const next = bankAccounts.map(a => a.id === editBank.id
                      ? { ...a, bankBin: bankForm.bankBin, bankShortName: bank.short, bankName: bank.name, accountNo: bankForm.accountNo, accountName: bankForm.accountName }
                      : a
                    )
                    setBankAccounts(next)
                    syncBankAccounts?.(next)
                  } else {
                    const base = bankAccounts.length === 0 ? [] : bankAccounts.map(a => ({ ...a, isPrimary: false }))
                    const newAcc = { id: bankIdCounter, bankBin: bankForm.bankBin, bankShortName: bank.short, bankName: bank.name, accountNo: bankForm.accountNo, accountName: bankForm.accountName, isPrimary: bankAccounts.length === 0 }
                    const next = [...base, newAcc]
                    setBankAccounts(next)
                    setBankIdCounter(n => n + 1)
                    syncBankAccounts?.(next)
                  }
                  setShowBankForm(false)
                }}
                disabled={!bankForm.accountNo.trim() || !bankForm.accountName.trim()}
                className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all disabled:opacity-30"
              >
                {editBank ? 'Lưu thay đổi' : 'Thêm tài khoản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bank QR Preview Modal ── */}
      {bankQrPreview && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setBankQrPreview(null)} />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-2xl overflow-hidden w-full max-w-xs animate-pop-in">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div>
                <h3 className="font-bold text-[17px]">{VN_BANKS.find(b => b.bin === bankQrPreview.bankBin)?.name}</h3>
                <p className="text-[12px] text-[#8E8E93]">{bankQrPreview.accountName}</p>
              </div>
              <button onClick={() => setBankQrPreview(null)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]"><XIcon /></button>
            </div>
            <div className="flex flex-col items-center px-6 pb-6 gap-3">
              <div className="bg-white rounded-2xl p-3 shadow-sm w-full flex justify-center">
                <img
                  src={`https://img.vietqr.io/image/${bankQrPreview.bankBin}-${bankQrPreview.accountNo}-compact2.png?accountName=${encodeURIComponent(bankQrPreview.accountName)}`}
                  alt="VietQR"
                  className="w-56 h-auto object-contain"
                />
              </div>
              <p className="text-[13px] text-[#8E8E93] font-mono text-center">{bankQrPreview.accountNo}</p>
            </div>
          </div>
        </div>
      )}
      {/* ── Stock In Modal (Tạo phiếu nhập hàng) ── */}
      {showStockInModal && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowStockInModal(false)} />
          <div className="relative w-full sm:max-w-lg bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up flex flex-col max-h-[90vh]">
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-black/[0.07] dark:border-white/[0.07] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.15)] flex items-center justify-center text-lg">
                  📦
                </div>
                <div>
                  <h3 className="font-bold text-[17px] leading-tight">Phiếu nhập hàng</h3>
                  <p className="text-[12px] text-[#8E8E93]">Cộng dồn tồn kho và cập nhật giá vốn</p>
                </div>
              </div>
              <button
                onClick={() => setShowStockInModal(false)}
                className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors"
              >
                <XIcon />
              </button>
            </div>

            {/* Form body */}
            <div className="px-5 py-4 space-y-4 overflow-y-auto scrollbar-hide flex-1">
              {/* Supplier & Note */}
              <div className="space-y-3 bg-[#F2F2F7] dark:bg-[#2C2C2E]/60 p-3.5 rounded-2xl">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[12px] text-[#8E8E93] font-medium">
                      Đại lý / Nhà cung cấp
                    </label>
                    <span className="text-[11px] text-[#007AFF] font-medium">
                      {suppliers.length} đại lý đã lưu
                    </span>
                  </div>

                  {/* Dropdown chọn đại lý */}
                  <select
                    value={suppliers.some(s => s.name === stockInSupplier) ? stockInSupplier : '__other__'}
                    onChange={e => {
                      if (e.target.value === '__other__') {
                        setStockInSupplier('')
                      } else {
                        setStockInSupplier(e.target.value)
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] text-[13px] font-semibold outline-none ring-1 ring-black/[0.06] dark:ring-white/[0.06] mb-2 cursor-pointer"
                  >
                    <option value="__other__">-- Chọn đại lý có sẵn hoặc tự nhập tên khác --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.name}>
                        🏢 {s.name} {s.debt > 0 ? `(Đang nợ: ${shortFmt(s.debt)})` : ''}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={stockInSupplier}
                    onChange={e => setStockInSupplier(e.target.value)}
                    placeholder="Tên đại lý hoặc nguồn hàng nhập..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] text-[14px] outline-none ring-1 ring-black/[0.06] dark:ring-white/[0.06] focus:ring-2 focus:ring-[#007AFF]/30"
                  />
                  {/* Quick supplier chips */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className="text-[11px] text-[#8E8E93]">Gợi ý:</span>
                    {['Đại lý phân phối', 'Chợ đầu mối', 'Siêu thị', 'Tự sản xuất', 'Nhập lẻ'].map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStockInSupplier(s)}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                          stockInSupplier === s
                            ? 'bg-[#34C759] text-white'
                            : 'bg-white dark:bg-[#1C1C1E] text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Option ghi nợ đại lý */}
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] ring-1 ring-black/[0.05] dark:ring-white/[0.05] cursor-pointer hover:bg-slate-50 dark:hover:bg-[#252528] transition-colors">
                  <input
                    type="checkbox"
                    checked={stockInIsDebt}
                    onChange={e => setStockInIsDebt(e.target.checked)}
                    className="w-4 h-4 accent-[#FF9500] rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#FF9500] leading-tight">Ghi nợ đại lý (Chưa thanh toán ngay)</p>
                    <p className="text-[11px] text-[#8E8E93] leading-tight mt-0.5">Tự động cộng tiền phiếu nhập này vào công nợ cần trả đại lý</p>
                  </div>
                </label>

                <div>
                  <label className="text-[12px] text-[#8E8E93] font-medium block mb-1.5">
                    Ghi chú phiếu nhập (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={stockInNote}
                    onChange={e => setStockInNote(e.target.value)}
                    placeholder="VD: Hàng date mới tháng 10, đợt khuyến mãi..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#1C1C1E] text-[14px] outline-none ring-1 ring-black/[0.06] dark:ring-white/[0.06] focus:ring-2 focus:ring-[#007AFF]/30"
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold">Danh sách mặt hàng nhập ({stockInItems.length})</p>
                  <button
                    type="button"
                    onClick={addStockInRow}
                    className="text-[12px] font-semibold text-[#007AFF] hover:underline flex items-center gap-1"
                  >
                    <span>+ Thêm món</span>
                  </button>
                </div>

                {stockInItems.map((row, idx) => {
                  const selProd = products.find(p => p.id === row.productId) || products[0]
                  const rowQty = parseInt(row.qty.replace(/\D/g, '') || '0')
                  const rowCost = parseInt(row.costPrice.replace(/\D/g, '') || '0')
                  const rowTotal = rowQty * rowCost

                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl bg-white dark:bg-[#2C2C2E] ring-1 ring-black/[0.07] dark:ring-white/[0.07] space-y-2.5 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide">
                            Mặt hàng #{idx + 1}
                          </span>
                          {row.variantId && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#007AFF]/10 text-[#007AFF] truncate">
                              {selProd?.variants?.find(v => v.id === row.variantId)?.name || 'Biến thể'}
                            </span>
                          )}
                        </div>
                        {stockInItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeStockInRow(idx)}
                            className="text-[#FF3B30] hover:text-[#D70015] text-[12px] font-medium flex items-center gap-0.5 shrink-0"
                          >
                            <span>✕ Xóa dòng</span>
                          </button>
                        )}
                      </div>

                      {/* Select product */}
                      <div>
                        <select
                          value={row.productId}
                          onChange={e => {
                            const newId = parseInt(e.target.value)
                            const pObj = products.find(p => p.id === newId)
                            const v0 = pObj?.variants?.[0]
                            setStockInItems(prev =>
                              prev.map((r, i) =>
                                i === idx
                                  ? {
                                      ...r,
                                      productId: newId,
                                      variantId: v0 ? v0.id : undefined,
                                      costPrice: (v0?.costPrice || pObj?.costPrice || Math.round((v0?.price || pObj?.price || 0) * 0.6)).toString(),
                                    }
                                  : r
                              )
                            )
                          }}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] text-[13px] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/25 cursor-pointer"
                        >
                          {products.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.emoji} {p.name} (Tồn hiện tại: {p.stock ?? 0} {p.unit || ''}{p.variants && p.variants.length > 0 ? ` • ${p.variants.length} biến thể` : ''})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Select variant if product has variants */}
                      {selProd?.variants && selProd.variants.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] ring-1 ring-black/[0.04] dark:ring-white/[0.04] space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-semibold text-[#007AFF] flex items-center gap-1">
                              <span>🏷️</span> Biến thể / Phân loại:
                            </label>
                            <button
                              type="button"
                              onClick={() => addAllVariantsOfProduct(selProd.id, idx)}
                              className="text-[11px] font-semibold text-[#007AFF] hover:underline flex items-center gap-0.5"
                              title="Tạo các dòng riêng cho tất cả biến thể của món này"
                            >
                              <span>⚡ Tách ({selProd.variants.length}) biến thể</span>
                            </button>
                          </div>
                          <select
                            value={row.variantId || ''}
                            onChange={e => {
                              const vId = e.target.value || undefined
                              const vObj = selProd.variants?.find(v => v.id === vId)
                              setStockInItems(prev =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        variantId: vId,
                                        costPrice: (vObj?.costPrice || selProd.costPrice || (vObj ? Math.round(vObj.price * 0.6) : Math.round(selProd.price * 0.6))).toString(),
                                      }
                                    : r
                                )
                              )
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#2C2C2E] text-[13px] font-medium outline-none ring-1 ring-black/[0.06] dark:ring-white/[0.06] cursor-pointer"
                          >
                            <option value="">-- Dùng chung toàn bộ món (không phân loại) --</option>
                            {selProd.variants.map(v => (
                              <option key={v.id} value={v.id}>
                                {v.name} (Tồn: {v.stock ?? 0} {selProd.unit || ''} • Bán: {shortFmt(v.price)}{v.costPrice ? ` • Vốn: ${shortFmt(v.costPrice)}` : ''})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Quantity & Cost Price */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[11px] text-[#8E8E93] font-medium block mb-1">
                            Số lượng nhập {selProd?.unit ? `(${selProd.unit})` : ''}
                          </label>
                          <div className="flex items-center bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-xl overflow-hidden">
                            <button
                              type="button"
                              onClick={() => {
                                const q = Math.max(1, (parseInt(row.qty.replace(/\D/g, '') || '1') - 1))
                                setStockInItems(prev => prev.map((r, i) => i === idx ? { ...r, qty: q.toString() } : r))
                              }}
                              className="w-8 h-9 flex items-center justify-center text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white active:bg-black/5"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={row.qty}
                              onChange={e => {
                                const val = e.target.value
                                setStockInItems(prev => prev.map((r, i) => i === idx ? { ...r, qty: val } : r))
                              }}
                              className="flex-1 py-1.5 text-center bg-transparent text-[13px] font-bold tabular-nums outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const q = parseInt(row.qty.replace(/\D/g, '') || '0') + 1
                                setStockInItems(prev => prev.map((r, i) => i === idx ? { ...r, qty: q.toString() } : r))
                              }}
                              className="w-8 h-9 flex items-center justify-center text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white active:bg-black/5"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] text-[#8E8E93] font-medium block mb-1">
                            Giá vốn đơn vị (₫)
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              value={row.costPrice}
                              onChange={e => {
                                const val = e.target.value
                                setStockInItems(prev => prev.map((r, i) => i === idx ? { ...r, costPrice: val } : r))
                              }}
                              placeholder="Giá vốn"
                              className="w-full px-3 py-2 pr-7 rounded-xl bg-[#F2F2F7] dark:bg-[#1C1C1E] text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#007AFF]/25 tabular-nums text-right"
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#8E8E93] pointer-events-none">
                              ₫
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Row Subtotal */}
                      <div className="flex items-center justify-between pt-1 border-t border-black/[0.04] dark:border-white/[0.04] text-[12px]">
                        <span className="text-[#8E8E93]">Thành tiền dòng:</span>
                        <span className="font-semibold tabular-nums text-[#34C759]">{shortFmt(rowTotal)}</span>
                      </div>
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={addStockInRow}
                  className="w-full py-2.5 border border-dashed border-[#007AFF]/40 text-[#007AFF] rounded-xl text-[13px] font-semibold hover:bg-[#007AFF]/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Thêm mặt hàng khác vào phiếu</span>
                </button>
              </div>
            </div>

            {/* Footer Summary & Submit */}
            <div className="p-4 border-t border-black/[0.07] dark:border-white/[0.07] bg-[#F9F9FB] dark:bg-[#1C1C1E] space-y-3 shrink-0">
              {(() => {
                const totalQty = stockInItems.reduce((s, i) => s + (parseInt(i.qty.replace(/\D/g, '') || '0')), 0)
                const totalCost = stockInItems.reduce((s, i) => {
                  const q = parseInt(i.qty.replace(/\D/g, '') || '0')
                  const c = parseInt(i.costPrice.replace(/\D/g, '') || '0')
                  return s + q * c
                }, 0)

                return (
                  <>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-[#8E8E93]">Tổng số lượng: <strong className="text-[#1C1C1E] dark:text-white font-semibold">{totalQty}</strong></span>
                      <div className="text-right">
                        <span className="text-[12px] text-[#8E8E93] mr-1.5">Tổng tiền nhập:</span>
                        <span className="text-[18px] font-bold tabular-nums text-[#34C759]">{shortFmt(totalCost)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowStockInModal(false)}
                        className="flex-1 py-3.5 rounded-2xl bg-[#E5E5EA] dark:bg-[#2C2C2E] text-[14px] font-semibold text-[#3C3C43] dark:text-white hover:bg-[#D1D1D6] transition-colors"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={saveStockIn}
                        disabled={totalQty <= 0 || totalCost <= 0}
                        className="flex-[2] py-3.5 rounded-2xl bg-[#34C759] text-white text-[14px] font-bold hover:bg-[#2DB34A] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        ✓ Hoàn tất nhập kho ({shortFmt(totalCost)})
                      </button>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Stock In History Modal (Lịch sử phiếu nhập) ── */}
      {showStockHistoryModal && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowStockHistoryModal(false)} />
          <div className="relative w-full sm:max-w-lg bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up flex flex-col max-h-[85vh]">
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-black/[0.07] dark:border-white/[0.07] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.15)] flex items-center justify-center text-lg">
                  📜
                </div>
                <div>
                  <h3 className="font-bold text-[17px] leading-tight">Lịch sử nhập hàng</h3>
                  <p className="text-[12px] text-[#8E8E93]">
                    {stockReceipts.length} phiếu nhập • Tổng vốn:{' '}
                    <span className="font-semibold text-[#34C759] tabular-nums">
                      {shortFmt(stockReceipts.reduce((s, r) => s + r.totalCost, 0))}
                    </span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowStockHistoryModal(false)}
                className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors"
              >
                <XIcon />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto scrollbar-hide px-5 py-4 space-y-3">
              {stockReceipts.length === 0 ? (
                <div className="py-16 text-center text-[#8E8E93]">
                  <p className="text-4xl mb-2">📦</p>
                  <p className="text-sm font-semibold">Chưa có phiếu nhập hàng nào</p>
                  <p className="text-xs text-[#C7C7CC] mt-1">Bấm nút "Nhập hàng" để tạo phiếu nhập kho đầu tiên.</p>
                </div>
              ) : (
                stockReceipts.map(receipt => {
                  const d = new Date(receipt.date)
                  const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

                  return (
                    <div
                      key={receipt.id}
                      className="bg-white dark:bg-[#2C2C2E] rounded-2xl p-4 ring-1 ring-black/[0.07] dark:ring-white/[0.07] space-y-2.5 shadow-2xs"
                    >
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-2 py-0.5 rounded-lg">
                              #{receipt.code}
                            </span>
                            <span className="text-[12px] font-medium text-[#1C1C1E] dark:text-white">
                              {receipt.supplier}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8E8E93] mt-0.5">
                            {dateStr} • {timeStr}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[15px] font-bold text-[#34C759] tabular-nums">
                            {shortFmt(receipt.totalCost)}
                          </p>
                          <p className="text-[10px] text-[#8E8E93]">{receipt.items.length} mặt hàng</p>
                        </div>
                      </div>

                      {receipt.note && (
                        <p className="text-[11px] italic text-[#8E8E93] bg-[#F2F2F7] dark:bg-[#1C1C1E] px-2.5 py-1.5 rounded-lg">
                          💬 {receipt.note}
                        </p>
                      )}

                      {/* Items breakdown */}
                      <div className="space-y-1 pt-1 border-t border-black/[0.04] dark:border-white/[0.04]">
                        {receipt.items.map((it, i) => (
                          <div key={i} className="flex items-center justify-between text-[12px] py-0.5">
                            <div className="flex items-center gap-1.5 truncate">
                              <span>{it.emoji}</span>
                              <span className="font-medium truncate">{it.productName}</span>
                              {it.variantName && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-[#007AFF]/10 text-[#007AFF] font-semibold shrink-0">
                                  {it.variantName}
                                </span>
                              )}
                              <span className="text-[#8E8E93] text-[11px] shrink-0">
                                × {it.qty} {it.unit || ''}
                              </span>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <span className="font-semibold tabular-nums">{shortFmt(it.total)}</span>
                              <span className="text-[10px] text-[#8E8E93] ml-1">(@{shortFmt(it.costPrice)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-black/[0.07] dark:border-white/[0.07] bg-[#F9F9FB] dark:bg-[#1C1C1E] flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowStockHistoryModal(false)
                  openStockIn()
                }}
                className="flex-1 py-3 rounded-2xl bg-[#34C759] text-white text-[13px] font-semibold hover:bg-[#2DB34A] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>📦</span>
                <span>Tạo phiếu mới</span>
              </button>
              <button
                type="button"
                onClick={() => setShowStockHistoryModal(false)}
                className="flex-1 py-3 rounded-2xl bg-[#E5E5EA] dark:bg-[#2C2C2E] text-[13px] font-semibold text-[#3C3C43] dark:text-white hover:bg-[#D1D1D6] transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order Detail Modal ── */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          customers={customers}
          shopName={shopName}
          onViewCustomer={(cust) => {
            setSelectedCust(cust)
            setCustView('detail')
            setTab('customers')
            setSelectedOrder(null)
          }}
        />
      )}
    </div>
  )
}

// ── Auth Screen ───────────────────────────────────────────────────────────────

type AuthView = 'login' | 'register' | 'forgot'

interface AuthAccount { email: string; password: string; name: string }

interface AuthScreenProps {
  dark: boolean
  onLogin: (name: string) => void
}

function AuthScreen({ dark, onLogin }: AuthScreenProps) {
  const [view, setView]           = useState<AuthView>('login')
  const [name, setName]           = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [showConf, setShowConf]   = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [accounts, setAccounts]   = useState<AuthAccount[]>([
    { email: 'admin@quaypos.vn', password: '123456', name: 'Admin' }
  ])

  const reset = (v: AuthView) => {
    setView(v); setError(''); setSuccess('')
    setName(''); setEmail(''); setPassword(''); setConfirm('')
  }

  const fakeDelay = (cb: () => void) => {
    setLoading(true); setError('')
    setTimeout(() => { setLoading(false); cb() }, 700)
  }

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError('Vui lòng nhập đủ thông tin.'); return }
    setLoading(true); setError('')
    const { user, error: loginErr } = await authService.signIn(email, password)
    setLoading(false)
    if (loginErr || !user) {
      setError(loginErr || 'Đăng nhập không thành công.')
      return
    }
    onLogin(user.name)
  }

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password || !confirm) { setError('Vui lòng nhập đủ thông tin.'); return }
    if (password.length < 6) { setError('Mật khẩu phải có ít nhất 6 ký tự.'); return }
    if (password !== confirm) { setError('Mật khẩu xác nhận không khớp.'); return }
    setLoading(true); setError('')
    const res = await authService.signUp(email, password, name)
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setSuccess(res.message)
    if (!res.requiresConfirmation) {
      setTimeout(() => onLogin(name.trim()), 1200)
    } else {
      setTimeout(() => reset('login'), 3000)
    }
  }

  const handleForgot = async () => {
    if (!email.trim()) { setError('Vui lòng nhập email.'); return }
    setLoading(true); setError('')
    const res = await authService.sendPasswordReset(email)
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setSuccess('Đã gửi link đặt lại mật khẩu vào email của bạn. Vui lòng kiểm tra hộp thư.')
  }

  const EyeIcon = ({ open }: { open: boolean }) => open
    ? <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
    : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>

  const inputBase = "w-full px-4 py-3 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[15px] outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-shadow placeholder-[#C7C7CC]"

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-[#F2F2F7] dark:bg-black flex flex-col items-center justify-center px-5 py-12" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>

        {/* Logo */}
        <div className="flex flex-col items-center mb-8 select-none">
          <div className="w-16 h-16 rounded-[22px] bg-[#007AFF] flex items-center justify-center shadow-lg shadow-[#007AFF]/30 mb-4">
            <span className="text-3xl">🛒</span>
          </div>
          <p className="text-[24px] font-bold tracking-tight text-[#1C1C1E] dark:text-white">QuầyPOS</p>
          <p className="text-[13px] text-[#8E8E93] mt-0.5">
            {view === 'login' ? 'Đăng nhập để tiếp tục' : view === 'register' ? 'Tạo tài khoản mới' : 'Lấy lại mật khẩu'}
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (view === 'login') handleLogin()
            else if (view === 'register') handleRegister()
            else handleForgot()
          }}
          className="w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-xl shadow-black/[0.06] dark:shadow-black/30 p-6 space-y-4"
        >

          {/* Register: name field */}
          {view === 'register' && (
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Họ và tên</label>
              <input
                type="text" placeholder="Nguyễn Văn A"
                value={name} onChange={e => setName(e.target.value)}
                className={inputBase}
              />
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Email</label>
            <input
              type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              className={inputBase}
            />
          </div>

          {/* Password */}
          {view !== 'forgot' && (
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Mật khẩu</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'} placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  className={inputBase + ' pr-12'}
                />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors">
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>
          )}

          {/* Confirm password */}
          {view === 'register' && (
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Xác nhận mật khẩu</label>
              <div className="relative">
                <input
                  type={showConf ? 'text' : 'password'} placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  className={inputBase + ' pr-12'}
                />
                <button type="button" onClick={() => setShowConf(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors">
                  <EyeIcon open={showConf} />
                </button>
              </div>
            </div>
          )}

          {/* Forgot password link */}
          {view === 'login' && (
            <div className="flex justify-end -mt-2">
              <button type="button" onClick={() => reset('forgot')} className="text-[13px] text-[#007AFF] font-medium hover:opacity-70 transition-opacity">
                Quên mật khẩu?
              </button>
            </div>
          )}

          {/* Error / success */}
          {error && (
            <div className="flex items-start gap-2.5 bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.1)] rounded-2xl px-4 py-3">
              <svg className="w-4 h-4 text-[#FF3B30] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
              <p className="text-[13px] text-[#FF3B30] font-medium">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2.5 bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.1)] rounded-2xl px-4 py-3">
              <svg className="w-4 h-4 text-[#34C759] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <p className="text-[13px] text-[#34C759] font-medium">{success}</p>
            </div>
          )}

          {/* CTA button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
          >
            {loading
              ? <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
              : view === 'login' ? 'Đăng nhập' : view === 'register' ? 'Tạo tài khoản' : 'Gửi link đặt lại'
            }
          </button>

        </form>

        {/* Footer links */}
        <div className="mt-6 text-center text-[14px]">
          {view === 'login' && (
            <p className="text-[#8E8E93]">Chưa có tài khoản?{' '}
              <button onClick={() => reset('register')} className="text-[#007AFF] font-semibold hover:opacity-70 transition-opacity">Đăng ký ngay</button>
            </p>
          )}
          {view === 'register' && (
            <p className="text-[#8E8E93]">Đã có tài khoản?{' '}
              <button onClick={() => reset('login')} className="text-[#007AFF] font-semibold hover:opacity-70 transition-opacity">Đăng nhập</button>
            </p>
          )}
          {view === 'forgot' && (
            <p className="text-[#8E8E93]">
              <button onClick={() => reset('login')} className="text-[#007AFF] font-semibold hover:opacity-70 transition-opacity">← Quay lại đăng nhập</button>
            </p>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Change Password Modal ──────────────────────────────────────────────────────

interface ChangePasswordModalProps {
  dark: boolean
  onClose: () => void
}

function ChangePasswordModal({ dark, onClose }: ChangePasswordModalProps) {
  const [current, setCurrent]   = useState('')
  const [next, setNext]         = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showCur, setShowCur]   = useState(false)
  const [showNew, setShowNew]   = useState(false)
  const [showCon, setShowCon]   = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState(false)

  const DUMMY_CURRENT = '123456'

  const handle = async () => {
    if (!next || !confirm) { setError('Vui lòng nhập đủ thông tin.'); return }
    if (next.length < 6)   { setError('Mật khẩu mới phải có ít nhất 6 ký tự.'); return }
    if (next !== confirm)  { setError('Mật khẩu xác nhận không khớp.'); return }
    const res = await authService.updatePassword(next)
    if (res.error) {
      setError(res.error)
      return
    }
    setError('')
    setSuccess(true)
    setTimeout(onClose, 1400)
  }

  const EyeBtn = ({ show, toggle }: { show: boolean; toggle: () => void }) => (
    <button type="button" onClick={toggle}
      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors">
      {show
        ? <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
        : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
      }
    </button>
  )

  const inputBase = "w-full px-4 py-3 pr-12 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[15px] outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-shadow placeholder-[#C7C7CC]"

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-black/[0.07] dark:border-white/[0.07]">
          <div>
            <h3 className="font-bold text-[17px]">Đổi mật khẩu</h3>
            <p className="text-[12px] text-[#8E8E93] mt-0.5">Nhập mật khẩu hiện tại để xác nhận</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {success ? (
            <div className="py-6 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.15)] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
              </div>
              <p className="font-semibold text-[16px]">Đổi mật khẩu thành công!</p>
              <p className="text-[13px] text-[#8E8E93] text-center">Mật khẩu của bạn đã được cập nhật.</p>
            </div>
          ) : (
            <>
              {/* Current password */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Mật khẩu hiện tại</label>
                <div className="relative">
                  <input type={showCur ? 'text' : 'password'} placeholder="••••••••"
                    value={current} onChange={e => setCurrent(e.target.value)} className={inputBase} />
                  <EyeBtn show={showCur} toggle={() => setShowCur(p => !p)} />
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Mật khẩu mới</label>
                <div className="relative">
                  <input type={showNew ? 'text' : 'password'} placeholder="Tối thiểu 6 ký tự"
                    value={next} onChange={e => setNext(e.target.value)} className={inputBase} />
                  <EyeBtn show={showNew} toggle={() => setShowNew(p => !p)} />
                </div>
                {next.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {[next.length >= 6, /[A-Z]/.test(next), /\d/.test(next)].map((ok, i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${ok ? 'bg-[#34C759]' : 'bg-[#E5E5EA] dark:bg-[#2C2C2E]'}`} />
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Xác nhận mật khẩu mới</label>
                <div className="relative">
                  <input type={showCon ? 'text' : 'password'} placeholder="••••••••"
                    value={confirm} onChange={e => setConfirm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handle()}
                    className={inputBase + (confirm && confirm !== next ? ' ring-2 ring-[#FF3B30]/40' : '')} />
                  <EyeBtn show={showCon} toggle={() => setShowCon(p => !p)} />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2.5 bg-[#FFF0EF] dark:bg-[rgba(255,59,48,0.1)] rounded-2xl px-4 py-3">
                  <svg className="w-4 h-4 text-[#FF3B30] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                  <p className="text-[13px] text-[#FF3B30] font-medium">{error}</p>
                </div>
              )}

              <button onClick={handle}
                className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all mt-1">
                Cập nhật mật khẩu
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [isLoggedIn, setIsLoggedIn]   = useState(false)
  const [currentUser, setCurrentUser] = useState('')
  const [authChecking, setAuthChecking] = useState(true)

  useEffect(() => {
    // 1. Kiểm tra session hiện tại
    authService.getCurrentSession().then(user => {
      if (user) {
        setIsLoggedIn(true)
        setCurrentUser(user.name)
      }
      setAuthChecking(false)
    })

    if (!isSupabaseConfigured) {
      setAuthChecking(false)
      return
    }

    // 2. Lắng nghe thay đổi trạng thái đăng nhập từ Supabase
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Người dùng'
        setIsLoggedIn(true)
        setCurrentUser(name)
      } else {
        setIsLoggedIn(false)
        setCurrentUser('')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('quaypos_theme')
      if (saved) return saved === 'dark'
    } catch {}
    return false // Mặc định giao diện sáng (Light mode)
  })

  useEffect(() => {
    try {
      localStorage.setItem('quaypos_theme', dark ? 'dark' : 'light')
    } catch {}
    if (dark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [dark])
  const [category, setCategory] = useState('Tất cả')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [showPay, setShowPay] = useState(false)
  const [payMethod, setPayMethod] = useState<PayMethod>('cash')
  const [payDir, setPayDir] = useState<'up' | 'down'>('up')
  const prevPayRef = useRef<PayMethod>('cash')
  const PAY_ORDER: PayMethod[] = ['cash', 'transfer', 'debt']

  // ── Units state ──
  const [units, setUnits] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('quaypos_units')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return DEFAULT_UNITS
  })

  // ── PWA Install Prompt ──
  const [pwaPrompt, setPwaPrompt] = useState<Event & { prompt: () => Promise<void> } | null>(null)
  const [showPwaBanner, setShowPwaBanner] = useState(false)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPwaPrompt(e as Event & { prompt: () => Promise<void> })
      setShowPwaBanner(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const installPwa = async () => {
    if (!pwaPrompt) return
    await pwaPrompt.prompt()
    setPwaPrompt(null)
    setShowPwaBanner(false)
  }

  const changePayMethod = (m: PayMethod) => {
    const dir = PAY_ORDER.indexOf(m) > PAY_ORDER.indexOf(prevPayRef.current) ? 'up' : 'down'
    setPayDir(dir)
    prevPayRef.current = m
    setPayMethod(m)
  }
  const [cashInput, setCashInput] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyDateFilter, setHistoryDateFilter] = useState<'today' | 'week' | 'month' | 'year' | 'all' | 'custom'>('today')
  const [historyCustomDate, setHistoryCustomDate] = useState('')
  const [historyMethodFilter, setHistoryMethodFilter] = useState<'all' | 'cash' | 'transfer' | 'debt'>('all')
  const [historySelectedOrder, setHistorySelectedOrder] = useState<Order | null>(null)
  const [showMobileCart, setShowMobileCart] = useState(false)
  const [success, setSuccess] = useState<Order | null>(null)
  const [orderNum, setOrderNum] = useState(1001)
  const [products, setProducts] = useState<Product[]>(hasSupabaseConfigured ? [] : PRODUCTS)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showChangePass, setShowChangePass] = useState(false)
  const [shopName, setShopName] = useState('Cửa hàng của tôi')
  const [vatRate, setVatRate] = useState(10)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [customers, setCustomers] = useState<Customer[]>(hasSupabaseConfigured ? [] : SAMPLE_CUSTOMERS)
  const [debtEntries, setDebtEntries] = useState<DebtEntry[]>(hasSupabaseConfigured ? [] : SAMPLE_DEBTS)
  const [debtCustomerId, setDebtCustomerId] = useState<number | null>(null)
  const [debtCustomerSearch, setDebtCustomerSearch] = useState('')
  const [debtEntryCounter, setDebtEntryCounter] = useState(50)
  const [stockReceipts, setStockReceipts] = useState<StockInReceipt[]>(hasSupabaseConfigured ? [] : SAMPLE_STOCK_RECEIPTS)
  const [suppliers, setSuppliers] = useState<Supplier[]>(hasSupabaseConfigured ? [] : SAMPLE_SUPPLIERS)

  const {
    isSyncing,
    syncStatus,
    isSupabaseConfigured,
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
  } = usePosSync({
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
  })

  const availableCategories = useMemo(() => {
    const cats = new Set<string>(CATEGORIES)
    products.forEach(p => {
      if (p.category && p.category.trim()) cats.add(p.category.trim())
    })
    return Array.from(cats)
  }, [products])

  const filtered = useMemo(() => {
    let p = products
    if (category !== 'Tất cả') p = p.filter(x => x.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      p = p.filter(x => x.name.toLowerCase().includes(q))
    }
    return p
  }, [products, category, search])

  const filteredHistoryOrders = useMemo(() => {
    const now = new Date()
    const startOf = (unit: 'day' | 'week' | 'month' | 'year') => {
      const d = new Date(now)
      if (unit === 'day')   { d.setHours(0,0,0,0) }
      if (unit === 'week')  {
        const day = d.getDay()
        const diff = d.getDate() - day + (day === 0 ? -6 : 1)
        d.setDate(diff)
        d.setHours(0,0,0,0)
      }
      if (unit === 'month') { d.setDate(1); d.setHours(0,0,0,0) }
      if (unit === 'year')  { d.setMonth(0,1); d.setHours(0,0,0,0) }
      return d
    }
    return orders.filter(o => {
      const t = new Date(o.time)
      if (historyCustomDate) {
        const orderDateStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
        if (orderDateStr !== historyCustomDate) return false
      } else {
        if (historyDateFilter === 'today' && t < startOf('day'))   return false
        if (historyDateFilter === 'week'  && t < startOf('week'))  return false
        if (historyDateFilter === 'month' && t < startOf('month')) return false
        if (historyDateFilter === 'year'  && t < startOf('year'))  return false
      }
      if (historyMethodFilter !== 'all' && o.method !== historyMethodFilter) return false
      return true
    })
  }, [orders, historyDateFilter, historyCustomDate, historyMethodFilter])

  const historyRevenue = useMemo(() => {
    return filteredHistoryOrders.reduce((s, o) => s + o.total, 0)
  }, [filteredHistoryOrders])

  const [variantModalProduct, setVariantModalProduct] = useState<Product | null>(null)
  // ── Chọn khách hàng (dùng chung mọi phương thức) ──
  const [payCustomerId, setPayCustomerId] = useState<number | null>(null)
  const [payCustomerSearch, setPayCustomerSearch] = useState('')
  // ── Qty Numpad ──
  const [qtyNumpadTarget, setQtyNumpadTarget] = useState<{ id: number; variantId: string | undefined } | null>(null)
  const [qtyNumpadInput, setQtyNumpadInput] = useState('1')

  const openQtyNumpad = (line: CartLine) => {
    setQtyNumpadTarget({ id: line.product.id, variantId: line.variant?.id })
    setQtyNumpadInput('0')
  }
  const closeQtyNumpad = () => setQtyNumpadTarget(null)
  const confirmQtyNumpad = () => {
    if (!qtyNumpadTarget) return
    const val = parseFloat(qtyNumpadInput) || 0
    if (val <= 0) {
      setCart(c => c.filter(l => !(l.product.id === qtyNumpadTarget.id && l.variant?.id === qtyNumpadTarget.variantId)))
    } else {
      setCart(c => c.map(l =>
        l.product.id === qtyNumpadTarget.id && l.variant?.id === qtyNumpadTarget.variantId
          ? { ...l, qty: val }
          : l
      ))
    }
    closeQtyNumpad()
  }
  const handleQtyNumpad = (key: string) => {
    if (key === '⌫') {
      setQtyNumpadInput(p => p.length > 1 ? p.slice(0, -1) : '0')
    } else if (key === '.') {
      setQtyNumpadInput(p => p.includes('.') ? p : p + '.')
    } else {
      setQtyNumpadInput(p => {
        const raw = p === '0' ? key : p + key
        if (raw.includes('.')) return raw
        return parseFloat(raw).toString()
      })
    }
  }

  const subtotal = cart.reduce((s, l) => s + (l.variant?.price ?? l.product.price) * l.qty, 0)
  const tax      = Math.round(subtotal * vatRate / 100)
  const total    = subtotal + tax
  const cashNum  = parseFloat(cashInput || '0') || 0
  const change   = payMethod === 'cash' ? cashNum - total : 0

  const addToCart = useCallback((product: Product, variant?: ProductVariant) => {
    setCart(c => {
      const idx = c.findIndex(l => l.product.id === product.id && l.variant?.id === variant?.id)
      if (idx >= 0) {
        const next = [...c]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...c, { product, variant, qty: 1 }]
    })
  }, [])

  const updateQty = useCallback((id: number, variantId: string | undefined, delta: number) => {
    setCart(c =>
      c.map(l => (l.product.id === id && l.variant?.id === variantId) ? { ...l, qty: l.qty + delta } : l)
       .filter(l => l.qty > 0)
    )
  }, [])

  const handleProductClick = (product: Product) => {
    if (product.variants && product.variants.length > 0) {
      setVariantModalProduct(product)
    } else {
      addToCart(product)
    }
  }

  const handleNumpad = (key: string) => {
    if (key === '⌫') {
      setCashInput(p => p.slice(0, -1))
    } else if (key === '.') {
      // Chỉ cho phép một dấu chấm
      setCashInput(p => p.includes('.') ? p : (p || '0') + '.')
    } else {
      setCashInput(p => {
        const raw = p + key
        // Nếu đang nhập phần thập phân, giữ nguyên string (không parse lại để tránh mất trailing zeros)
        if (raw.includes('.')) {
          const num = parseFloat(raw)
          return isNaN(num) ? p : raw
        }
        const num = parseFloat(raw)
        return isNaN(num) ? p : num.toString()
      })
    }
  }

  const confirmPay = () => {
    if (!cart.length) return
    if (payMethod === 'cash' && cashNum < total) return
    if (payMethod === 'debt' && !debtCustomerId) return
    const oid = orderNum
    const order: Order = {
      id: oid,
      lines: [...cart],
      subtotal,
      tax,
      total,
      method: payMethod,
      cashGiven: payMethod === 'cash' ? cashNum : total,
      change:    payMethod === 'cash' ? cashNum - total : 0,
      time: new Date(),
      customerId: payMethod === 'debt' ? debtCustomerId ?? undefined : payCustomerId ?? undefined,
    }
    setOrders(prev => [order, ...prev])
    setOrderNum(n => n + 1)
    syncOrder(order)

    if (payMethod === 'debt' && debtCustomerId) {
      const cust = customers.find(c => c.id === debtCustomerId)
      const debtObj = {
        id: debtEntryCounter,
        customerId: debtCustomerId,
        type: 'debit' as const,
        amount: total,
        note: cart.map(l => `${l.product.name}${l.variant ? ` (${l.variant.name})` : ''} ×${l.qty}`).join(', '),
        orderId: oid,
        time: new Date(),
      }
      setDebtEntries(prev => [debtObj, ...prev])
      setDebtEntryCounter(n => n + 1)
      syncDebtEntry(debtObj)
      setSuccess({ ...order, change: 0 })
      void cust
    } else {
      setSuccess(order)
    }

    // Trừ tồn kho các sản phẩm vừa bán (bao gồm cả biến thể nếu có)
    setProducts(prevProds => {
      const nextProds = prevProds.map(p => {
        const soldLines = cart.filter(l => l.product.id === p.id)
        if (soldLines.length === 0) return p
        const totalSold = soldLines.reduce((sum, l) => sum + l.qty, 0)

        let newVariants = p.variants
        if (p.variants && p.variants.length > 0) {
          newVariants = p.variants.map(v => {
            const soldForVariant = soldLines
              .filter(l => l.variant?.id === v.id)
              .reduce((sum, l) => sum + l.qty, 0)
            if (soldForVariant > 0 && v.stock !== undefined) {
              return { ...v, stock: Math.max(0, v.stock - soldForVariant) }
            }
            return v
          })
        }

        const newStock = p.stock !== undefined ? Math.max(0, p.stock - totalSold) : undefined
        return {
          ...p,
          variants: newVariants,
          stock: newStock,
        }
      })
      nextProds.forEach(p => {
        if (cart.some(l => l.product.id === p.id)) {
          syncProduct(p, true)
        }
      })
      return nextProds
    })

    setCart([])
    setShowPay(false)
    setCashInput('')
    setPayMethod('cash')
    setDebtCustomerId(null)
    setDebtCustomerSearch('')
    setPayCustomerId(null)
    setPayCustomerSearch('')
    setTimeout(() => setSuccess(null), 3500)
  }

  const closePayment = () => {
    setShowPay(false)
    setCashInput('')
    setPayCustomerId(null)
    setPayCustomerSearch('')
  }

  // Quick-preset amounts for cash
  const presets = useMemo(() => {
    const s = new Set<number>()
    s.add(total)
    s.add(roundUp(total, 50000))
    s.add(roundUp(total, 100000))
    return [...s].slice(0, 3)
  }, [total])

  // ── Render ──────────────────────────────────────────────────────────────────

  const todayRevenue = orders.reduce((s, o) => s + o.total, 0)

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] dark:bg-black flex flex-col items-center justify-center" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-16 h-16 rounded-[22px] bg-[#007AFF] flex items-center justify-center shadow-lg shadow-[#007AFF]/30 mb-4 animate-pulse">
          <span className="text-3xl">🛒</span>
        </div>
        <p className="text-[14px] text-[#8E8E93] font-medium animate-pulse">Đang tải...</p>
      </div>
    )
  }

  if (!isLoggedIn) {
    return <AuthScreen dark={dark} onLogin={name => { setCurrentUser(name); setIsLoggedIn(true) }} />
  }

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="h-screen overflow-hidden flex flex-col bg-[#F2F2F7] dark:bg-black text-[#1C1C1E] dark:text-white" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>

        {/* ── PWA Install Banner ── */}
        {showPwaBanner && (
          <div className="fixed bottom-4 left-4 right-4 z-[200] animate-fade-in">
            <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-xl ring-1 ring-black/[0.08] dark:ring-white/[0.08] flex items-center gap-3 px-4 py-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-sm border border-black/[0.08] dark:border-white/[0.08] bg-white">
                <img src="./icon-192.png" alt="QuầyPOS" className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold">Cài QuầyPOS</p>
                <p className="text-[12px] text-[#8E8E93]">Dùng như app, ngay màn hình chính</p>
              </div>
              <button
                onClick={installPwa}
                className="px-3.5 py-2 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] transition-colors shrink-0"
              >
                Cài ngay
              </button>
              <button
                onClick={() => setShowPwaBanner(false)}
                className="p-1.5 text-[#8E8E93] hover:text-[#3C3C43] dark:hover:text-white transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Header ── */}
        <header className="flex items-center gap-3 px-4 pt-safe min-h-14 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-xl border-b border-black/[0.07] dark:border-white/[0.08] shrink-0 z-10">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl overflow-hidden shadow-sm flex items-center justify-center bg-white border border-black/[0.08] dark:border-white/[0.08]">
              <img src="./icon-192.png" alt="QuầyPOS" className="w-full h-full object-contain" />
            </div>
            <div className="hidden sm:block">
              <p className="text-[15px] font-semibold leading-none tracking-tight">QuầyPOS</p>
              <p className="text-[10px] text-[#8E8E93] leading-none mt-0.5">v{__APP_VERSION__}</p>
            </div>
          </div>

          {/* Supabase Cloud Status Indicator */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer select-none"
            onClick={() => setShowSettings(true)}
            style={{
              backgroundColor: syncStatus === 'connected' ? 'rgba(52, 199, 89, 0.12)' : 'rgba(142, 142, 147, 0.12)',
              color: syncStatus === 'connected' ? '#34C759' : '#8E8E93',
            }}
            title={
              isSupabaseConfigured
                ? (syncStatus === 'connected' ? 'Đã kết nối Supabase (Đang đồng bộ real-time)' : 'Đang kết nối Supabase...')
                : 'Chưa cấu hình .env.local (Dữ liệu lưu tạm trên máy)'
            }
          >
            <span className={`w-2 h-2 rounded-full ${syncStatus === 'connected' ? 'bg-[#34C759] animate-pulse' : 'bg-[#8E8E93]'}`} />
            <span className="hidden sm:inline">
              {isSyncing ? 'Đang tải...' : syncStatus === 'connected' ? 'Cloud' : 'Offline'}
            </span>
          </div>

          {/* Search */}
          <div className="flex-1 relative max-w-sm mx-2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93] pointer-events-none">
              <SearchIcon />
            </span>
            <input
              type="search"
              placeholder="Tìm sản phẩm..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#E5E5EA] dark:bg-[#2C2C2E] text-sm outline-none placeholder-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/25 transition-shadow"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors">
                <XIcon />
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            {/* Lịch sử đơn hàng */}
            <button
              onClick={() => setShowHistory(true)}
              className="relative p-2.5 rounded-xl hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition-colors text-[#8E8E93]"
              title="Lịch sử đơn hàng"
            >
              <HistoryIcon />
              {orders.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#007AFF]" />
              )}
            </button>

            {/* Chuyển đổi giao diện Sáng / Tối */}
            <button
              onClick={() => setDark(!dark)}
              className="p-2.5 rounded-xl hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition-colors text-[#8E8E93]"
              title={dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="p-2.5 rounded-xl hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition-colors text-[#8E8E93]"
              title="Cài đặt"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={() => setShowAdmin(true)}
              className="p-2.5 rounded-xl hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition-colors text-[#8E8E93]"
              title="Menu quản lý"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="flex flex-1 overflow-hidden">

          {/* ── Products Panel ── */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* Category Tabs */}
            <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide shrink-0">
              {availableCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                    category === cat
                      ? 'bg-[#007AFF] text-white shadow-sm'
                      : 'bg-white dark:bg-[#1C1C1E] text-[#3C3C43] dark:text-[rgba(235,235,245,0.6)] hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Product Grid */}
            <div className={`flex-1 overflow-y-auto scrollbar-hide px-4 ${cart.length > 0 ? 'md:pb-4' : 'pb-4'}`}
              style={cart.length > 0 ? { paddingBottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 72px)' } : undefined}>
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-[#8E8E93]">
                  <span className="text-4xl mb-2">🔍</span>
                  <p className="text-sm">Không tìm thấy sản phẩm</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filtered.map(product => {
                    const line = cart.find(l => l.product.id === product.id)
                    const catGradient: Record<string, string> = {
                      'Đồ uống':   'from-sky-100 to-cyan-50 dark:from-sky-900/40 dark:to-cyan-900/20',
                      'Đồ ăn':     'from-orange-100 to-amber-50 dark:from-orange-900/40 dark:to-amber-900/20',
                      'Bánh & Kem':'from-pink-100 to-rose-50 dark:from-pink-900/40 dark:to-rose-900/20',
                      'Khác':      'from-slate-100 to-gray-50 dark:from-slate-800/60 dark:to-gray-800/30',
                    }
                    const grad = catGradient[product.category] ?? catGradient['Khác']
                    const productCartQty = cart.filter(l => l.product.id === product.id).reduce((s, l) => s + l.qty, 0)
                    const hasVar = Boolean(product.variants && product.variants.length > 0)
                    const minPrice = hasVar ? Math.min(...product.variants!.map(v => v.price)) : product.price

                    return (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        className={`relative bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden text-left transition-all active:scale-[0.96] hover:shadow-lg hover:-translate-y-0.5 ${
                          productCartQty > 0 ? 'ring-2 ring-[#007AFF]' : 'ring-1 ring-black/[0.06] dark:ring-white/[0.06]'
                        }`}
                      >
                        {/* Badge số lượng trong giỏ */}
                        {productCartQty > 0 && (
                          <span className="absolute top-2 right-2 z-10 min-w-[22px] h-[22px] bg-[#007AFF] rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1.5 shadow-sm">
                            {productCartQty}
                          </span>
                        )}

                        {/* Image zone */}
                        <div className="w-full h-28 sm:h-32 relative overflow-hidden">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className={`w-full h-full bg-gradient-to-br ${grad} flex items-center justify-center`}>
                              <span className="text-5xl drop-shadow-sm select-none">{product.emoji}</span>
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white/60 dark:from-[#1C1C1E]/60 to-transparent pointer-events-none" />
                        </div>

                        {/* Info */}
                        <div className="px-3 pt-2 pb-3">
                          <p className="text-[12px] font-medium text-[#1C1C1E] dark:text-white leading-snug line-clamp-2 min-h-[2.25rem]">
                            {product.name}
                          </p>
                          <div className="flex items-baseline justify-between mt-1 gap-1">
                            <span className="text-[13px] font-bold text-[#007AFF] tabular-nums">
                              {hasVar ? `Từ ${shortFmt(minPrice)}` : shortFmt(product.price)}
                            </span>
                            {hasVar ? (
                              <span className="text-[10px] text-[#007AFF] bg-[#007AFF]/10 dark:bg-[#007AFF]/20 px-1.5 py-0.5 rounded-md font-semibold">
                                {product.variants!.length} loại
                              </span>
                            ) : product.unit ? (
                              <span className="text-[10px] text-[#8E8E93] shrink-0 font-medium">/{product.unit}</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Cart Panel (tablet/desktop only) ── */}
          <div className="hidden md:flex w-[280px] lg:w-[320px] xl:w-[360px] flex-col border-l border-black/[0.07] dark:border-white/[0.08] bg-white dark:bg-[#1C1C1E] shrink-0">

            {/* Cart Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-black/[0.06] dark:border-white/[0.06] shrink-0">
              <div>
                <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-widest">Đơn hàng</p>
                <p className="text-[17px] font-bold leading-tight">#{orderNum}</p>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-[#FF3B30] text-[13px] font-semibold px-3 py-1.5 rounded-xl hover:bg-[#FFF0EF] dark:hover:bg-[rgba(255,59,48,0.1)] transition-colors"
                >
                  Hủy đơn
                </button>
              )}
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-[#8E8E93]">
                  <CartEmptyIcon />
                  <p className="text-sm mt-3 font-medium">Chưa có sản phẩm</p>
                  <p className="text-xs mt-1 opacity-60">Chọn sản phẩm bên trái</p>
                </div>
              ) : (
                <div className="divide-y divide-black/[0.05] dark:divide-white/[0.05]">
                  {cart.map(line => {
                    const lineKey = `${line.product.id}_${line.variant?.id ?? 'base'}`
                    const linePrice = line.variant ? line.variant.price : line.product.price
                    return (
                      <div key={lineKey} className="flex items-center gap-3 px-4 py-3">
                        <ProductThumb product={line.product} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium leading-snug truncate">{line.product.name}</p>
                          {line.variant && (
                            <p className="text-[11px] font-semibold text-[#007AFF] truncate">{line.variant.name}</p>
                          )}
                          <p className="text-[11px] text-[#8E8E93] tabular-nums">
                            {shortFmt(linePrice)}{line.product.unit ? ` / ${line.product.unit}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => updateQty(line.product.id, line.variant?.id, -1)}
                            className="w-7 h-7 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] flex items-center justify-center text-[#1C1C1E] dark:text-white text-lg font-light leading-none hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-colors active:scale-90"
                          >
                            −
                          </button>
                          <button
                            onClick={() => openQtyNumpad(line)}
                            className="min-w-[2.5rem] px-2 py-1 text-center text-[14px] font-bold tabular-nums bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-xl hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-colors active:scale-95"
                          >{line.qty}</button>
                          <button
                            onClick={() => updateQty(line.product.id, line.variant?.id, 1)}
                            className="w-7 h-7 rounded-full bg-[#007AFF] flex items-center justify-center text-white text-lg font-light leading-none hover:bg-[#0066CC] transition-colors active:scale-90"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Cart Footer */}
            {cart.length > 0 && (
              <div className="border-t border-black/[0.07] dark:border-white/[0.07] px-4 pt-3.5 pb-4 shrink-0">
                <div className="space-y-1 mb-3">
                  <div className="flex justify-between text-[13px] text-[#8E8E93]">
                    <span>Tạm tính ({cart.reduce((s, l) => s + l.qty, 0)} món)</span>
                    <span className="tabular-nums">{shortFmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px] text-[#8E8E93]">
                    <span>VAT (10%)</span>
                    <span className="tabular-nums">{shortFmt(tax)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[15px] pt-2 border-t border-black/[0.07] dark:border-white/[0.07]">
                    <span>Tổng cộng</span>
                    <span className="tabular-nums text-[#007AFF]">{shortFmt(total)}</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowPay(true)}
                  className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all shadow-sm"
                >
                  Thanh toán
                </button>
              </div>
            )}
          </div>
        </main>

        {/* ── Mobile Cart Bar (phone only) ── */}
        {cart.length > 0 && (
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 px-4 pt-3 pb-safe bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-t border-black/[0.08] dark:border-white/[0.08] animate-slide-up" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
            <button
              onClick={() => setShowMobileCart(true)}
              className="w-full flex items-center justify-between bg-[#007AFF] text-white rounded-2xl px-4 py-3.5 shadow-lg active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 bg-white/25 rounded-full flex items-center justify-center text-xs font-bold">
                  {cart.reduce((s, l) => s + l.qty, 0)}
                </span>
                <span className="font-semibold text-[15px]">Xem giỏ hàng</span>
              </div>
              <span className="font-bold text-[15px] tabular-nums">{shortFmt(total)}</span>
            </button>
          </div>
        )}

        {/* ── Mobile Cart Sheet ── */}
        {showMobileCart && (
          <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end animate-fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
            <div className="relative bg-white dark:bg-[#1C1C1E] rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up">
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
              </div>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-black/[0.07] dark:border-white/[0.07] shrink-0">
                <div>
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-widest">Đơn hàng</p>
                  <p className="text-[17px] font-bold">#{orderNum}</p>
                </div>
                <div className="flex items-center gap-3">
                  {cart.length > 0 && (
                    <button onClick={() => { setCart([]); setShowMobileCart(false) }} className="text-[#FF3B30] text-[13px] font-semibold">Hủy đơn</button>
                  )}
                  <button onClick={() => setShowMobileCart(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">
                    <XIcon />
                  </button>
                </div>
              </div>
              {/* Items */}
              <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-black/[0.05] dark:divide-white/[0.05]">
                {cart.map(line => {
                  const lineKey = `${line.product.id}_${line.variant?.id ?? 'base'}`
                  const linePrice = line.variant ? line.variant.price : line.product.price
                  return (
                    <div key={lineKey} className="flex items-center gap-3 px-5 py-3">
                      <ProductThumb product={line.product} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate">{line.product.name}</p>
                        {line.variant && (
                          <p className="text-[12px] font-semibold text-[#007AFF] truncate">{line.variant.name}</p>
                        )}
                        <p className="text-[12px] text-[#8E8E93] tabular-nums">
                          {shortFmt(linePrice)}{line.product.unit ? ` / ${line.product.unit}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => updateQty(line.product.id, line.variant?.id, -1)} className="w-8 h-8 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] flex items-center justify-center text-lg font-light active:scale-90 transition-transform">−</button>
                        <button
                          onClick={() => openQtyNumpad(line)}
                          className="min-w-[2.5rem] px-2 py-1 text-center text-[14px] font-bold tabular-nums bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-xl hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-colors active:scale-95"
                        >{line.qty}</button>
                        <button onClick={() => updateQty(line.product.id, line.variant?.id, 1)} className="w-8 h-8 rounded-full bg-[#007AFF] flex items-center justify-center text-white text-lg font-light active:scale-90 transition-transform">+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Footer */}
              <div className="border-t border-black/[0.07] dark:border-white/[0.07] px-5 pt-3.5 shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
                <div className="space-y-1 mb-3">
                  <div className="flex justify-between text-[13px] text-[#8E8E93]">
                    <span>Tạm tính</span><span className="tabular-nums">{shortFmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px] text-[#8E8E93]">
                    <span>VAT (10%)</span><span className="tabular-nums">{shortFmt(tax)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[16px] pt-2 border-t border-black/[0.07] dark:border-white/[0.07]">
                    <span>Tổng cộng</span><span className="tabular-nums text-[#007AFF]">{shortFmt(total)}</span>
                  </div>
                </div>
                <button
                  onClick={() => { setShowMobileCart(false); setShowPay(true) }}
                  className="w-full py-4 rounded-2xl bg-[#007AFF] text-white font-semibold text-[15px] hover:bg-[#0066CC] active:scale-[0.98] transition-all"
                >
                  Thanh toán
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal chọn biến thể / phân loại ── */}
        {variantModalProduct && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setVariantModalProduct(null)} />
            <div className="relative w-full sm:max-w-md bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up max-h-[85vh] flex flex-col">
              {/* Grab bar on mobile */}
              <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
              </div>

              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-black/[0.07] dark:border-white/[0.07]">
                <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-3xl overflow-hidden shrink-0 shadow-2xs">
                  {variantModalProduct.image ? (
                    <img src={variantModalProduct.image} alt={variantModalProduct.name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{variantModalProduct.emoji}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[16px] text-[#1C1C1E] dark:text-white truncate">{variantModalProduct.name}</h3>
                  <p className="text-[12px] text-[#8E8E93]">Chọn các loại hộp / mức giá cần thêm</p>
                </div>
                <button
                  onClick={() => setVariantModalProduct(null)}
                  className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:text-[#1C1C1E] dark:hover:text-white transition-colors"
                >
                  <XIcon />
                </button>
              </div>

              {/* Danh sách biến thể */}
              <div className="p-4 overflow-y-auto space-y-2.5 flex-1 divide-y-0">
                {variantModalProduct.variants?.map(v => {
                  const currentInCart = cart.find(l => l.product.id === variantModalProduct.id && l.variant?.id === v.id)
                  return (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-3.5 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-all"
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-semibold text-[#1C1C1E] dark:text-white truncate">{v.name}</p>
                          {currentInCart && (
                            <span className="px-2 py-0.5 rounded-full bg-[#007AFF] text-white text-[10px] font-bold">
                              ×{currentInCart.qty}
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] font-bold text-[#007AFF] tabular-nums mt-0.5">{shortFmt(v.price)}</p>
                      </div>

                      {/* Nút thêm hoặc tăng giảm */}
                      {currentInCart ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => updateQty(variantModalProduct.id, v.id, -1)}
                            className="w-8 h-8 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center text-lg font-light shadow-2xs active:scale-90"
                          >
                            −
                          </button>
                          <span className="w-5 text-center text-[13px] font-bold tabular-nums">{currentInCart.qty}</span>
                          <button
                            onClick={() => updateQty(variantModalProduct.id, v.id, 1)}
                            className="w-8 h-8 rounded-full bg-[#007AFF] text-white flex items-center justify-center text-lg font-light shadow-2xs active:scale-90"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => addToCart(variantModalProduct, v)}
                          className="px-4 py-2 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] active:scale-95 transition-all shrink-0"
                        >
                          + Thêm
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Footer nút Đóng / Xong */}
              <div className="p-4 border-t border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-[#1C1C1E]">
                <button
                  onClick={() => setVariantModalProduct(null)}
                  className="w-full py-3.5 rounded-2xl bg-[#007AFF] text-white font-semibold text-[14px] hover:bg-[#0066CC] transition-colors"
                >
                  Xong ({cart.filter(l => l.product.id === variantModalProduct.id).reduce((s, l) => s + l.qty, 0)} phần đã chọn)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Payment Modal ── */}
        {showPay && (
          <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closePayment} />
            <div className="relative w-full sm:max-w-[420px] bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">

              {/* Drag handle (mobile) */}
              <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
              </div>

              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-black/[0.07] dark:border-white/[0.07]">
                <div>
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-widest">Thanh toán đơn #{orderNum}</p>
                  <p className="text-3xl font-bold tabular-nums text-[#007AFF] mt-0.5">{fmt(total)}</p>
                </div>
                <button onClick={closePayment} className="w-9 h-9 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:bg-[#D1D1D6] transition-colors">
                  <XIcon />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 max-h-[80vh] overflow-y-auto scrollbar-hide">

                {/* Payment Methods */}
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'cash',     label: 'Tiền mặt',    icon: '💵', sub: 'Tiền thối' },
                    { id: 'transfer', label: 'Chuyển khoản', icon: '📱', sub: 'QR Code' },
                    { id: 'debt',     label: 'Ghi nợ',       icon: '📒', sub: 'Trả sau' },
                  ] as { id: PayMethod; label: string; icon: string; sub: string }[]).map(m => (
                    <button
                      key={m.id}
                      onClick={() => changePayMethod(m.id)}
                      className={`py-3 px-2 rounded-2xl flex flex-col items-center gap-0.5 transition-all text-center ${
                        payMethod === m.id
                          ? 'bg-[#007AFF] text-white ring-2 ring-[#007AFF] ring-offset-2 ring-offset-white dark:ring-offset-[#1C1C1E]'
                          : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-[rgba(235,235,245,0.6)] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                      }`}
                    >
                      <span className="text-2xl">{m.icon}</span>
                      <span className="text-[12px] font-semibold leading-tight">{m.label}</span>
                      <span className={`text-[10px] leading-tight ${payMethod === m.id ? 'text-white/70' : 'text-[#8E8E93]'}`}>{m.sub}</span>
                    </button>
                  ))}
                </div>

                {/* ── Chọn khách hàng (cash / transfer) ── */}
                {payMethod !== 'debt' && (() => {
                  const q = payCustomerSearch.trim()
                  const filtered = customers.filter(c => !q ||
                    c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q))
                  const selectedCust = customers.find(c => c.id === payCustomerId)
                  return (
                    <div className="space-y-2">
                      {selectedCust ? (
                        <div className="flex items-center gap-2.5 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl px-3.5 py-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#007AFF]/15 flex items-center justify-center text-[13px] font-bold text-[#007AFF] shrink-0">
                            {selectedCust.name.split(' ').pop()?.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold truncate">{selectedCust.name}</p>
                            <p className="text-[11px] text-[#8E8E93]">{selectedCust.phone || 'Chưa có SĐT'}</p>
                          </div>
                          <button
                            onClick={() => { setPayCustomerId(null); setPayCustomerSearch('') }}
                            className="text-[#8E8E93] hover:text-[#FF3B30] transition-colors p-1"
                          >✕</button>
                        </div>
                      ) : (
                        <div className="relative">
                          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <input
                            type="text"
                            placeholder="Chọn khách hàng (không bắt buộc)"
                            value={payCustomerSearch}
                            onChange={e => setPayCustomerSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                          />
                          {q && (
                            <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-[#2C2C2E] rounded-2xl shadow-lg ring-1 ring-black/[0.06] dark:ring-white/[0.06] max-h-40 overflow-y-auto scrollbar-hide z-10">
                              {filtered.length === 0 && (
                                <p className="px-4 py-3 text-[13px] text-[#8E8E93]">Không tìm thấy khách hàng</p>
                              )}
                              {filtered.map(c => (
                                <button
                                  key={c.id}
                                  onClick={() => { setPayCustomerId(c.id); setPayCustomerSearch('') }}
                                  className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-[#F2F2F7] dark:hover:bg-[#3A3A3C] text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                                >
                                  <div className="w-7 h-7 rounded-full bg-[#E5E5EA] dark:bg-[#3A3A3C] flex items-center justify-center text-[12px] font-bold shrink-0">
                                    {c.name.split(' ').pop()?.charAt(0)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold truncate">{c.name}</p>
                                    {c.phone && <p className="text-[11px] text-[#8E8E93]">{c.phone}</p>}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ── Payment content with slide animation ── */}
                <div
                  key={payMethod}
                  className={payDir === 'up' ? 'animate-pay-up' : 'animate-pay-down'}
                >

                {/* ── Cash ── */}
                {payMethod === 'cash' && (
                  <div className="space-y-3">
                    {/* Cash amount display */}
                    <div className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-4">
                      <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Khách đưa</p>
                      <p className="text-2xl font-bold tabular-nums">
                        {cashNum > 0 || cashInput.includes('.')
                          ? (cashInput.endsWith('.') || (cashInput.includes('.') && cashInput.endsWith('0'))
                              ? <span>{cashInput} ₫</span>
                              : fmt(cashNum))
                          : <span className="text-[#C7C7CC]">0 ₫</span>}
                      </p>
                      {cashNum >= total && (
                        <div className="mt-2 flex items-center gap-1.5 text-[#34C759]">
                          <span className="text-base">✓</span>
                          <span className="text-sm font-semibold tabular-nums">Tiền thối: {fmt(cashNum - total)}</span>
                        </div>
                      )}
                      {cashNum > 0 && cashNum < total && (
                        <p className="mt-2 text-sm text-[#FF3B30] font-medium tabular-nums">
                          Còn thiếu: {fmt(total - cashNum)}
                        </p>
                      )}
                    </div>

                    {/* Quick amounts */}
                    <div className="flex gap-2">
                      {presets.map(v => (
                        <button
                          key={v}
                          onClick={() => setCashInput(v.toString())}
                          className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold tabular-nums transition-all ${
                            cashNum === v
                              ? 'bg-[#007AFF] text-white'
                              : 'bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.12)] text-[#007AFF] hover:bg-[#CCE2FF] dark:hover:bg-[rgba(0,122,255,0.2)]'
                          }`}
                        >
                          {shortFmt(v)}
                        </button>
                      ))}
                    </div>

                    {/* Numpad */}
                    <div className="grid grid-cols-3 gap-2">
                      {['7','8','9','4','5','6','1','2','3','⌫','0','.'].map(k => (
                        <button
                          key={k}
                          onClick={() => handleNumpad(k)}
                          className={`py-4 rounded-2xl text-lg font-semibold transition-all active:scale-95 select-none ${
                            k === '⌫'
                              ? 'bg-[#FFE5E5] dark:bg-[rgba(255,59,48,0.12)] text-[#FF3B30] hover:bg-[#FFCCCC] dark:hover:bg-[rgba(255,59,48,0.2)]'
                              : k === '.'
                              ? 'bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.12)] text-[#007AFF] hover:bg-[#CCE2FF] dark:hover:bg-[rgba(0,122,255,0.2)] font-bold text-xl'
                              : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1C1C1E] dark:text-white hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Transfer ── */}
                {payMethod === 'transfer' && (() => {
                  const primaryBank = bankAccounts.find(a => a.isPrimary) ?? bankAccounts[0]
                  const addInfo = encodeURIComponent(`THICHPHUONG ${orderNum}`)
                  return (
                    <div className="flex flex-col items-center gap-2">
                      {primaryBank ? (
                        <>
                          <div className="bg-white dark:bg-[#F8F8F8] rounded-2xl p-1.5 shadow-sm">
                            <img
                              key={`${primaryBank.id}-${total}`}
                              src={`https://img.vietqr.io/image/${primaryBank.bankBin}-${primaryBank.accountNo}-qr_only.png?amount=${total}&addInfo=${addInfo}`}
                              alt="VietQR"
                              className="w-52 h-52 object-contain rounded-xl"
                              onError={e => { (e.target as HTMLImageElement).src = `https://img.vietqr.io/image/${primaryBank.bankBin}-${primaryBank.accountNo}-qr_only.png?amount=${total}` }}
                            />
                          </div>
                          {bankAccounts.length > 1 && (
                            <div className="flex gap-2 flex-wrap justify-center">
                              {bankAccounts.filter(a => !a.isPrimary).map(acc => (
                                <button
                                  key={acc.id}
                                  onClick={() => setBankAccounts(prev => prev.map(a => ({ ...a, isPrimary: a.id === acc.id })))}
                                  className="px-3 py-1.5 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[12px] font-medium text-[#8E8E93] hover:bg-[#E5E5EA] transition-colors"
                                >
                                  Dùng {acc.bankShortName}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="py-6 flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] flex items-center justify-center text-3xl">🏦</div>
                          <div>
                            <p className="font-semibold text-[15px]">Chưa cài tài khoản ngân hàng</p>
                            <p className="text-[13px] text-[#8E8E93] mt-1">Vào Quản lý → Cài đặt để thêm tài khoản</p>
                          </div>
                          <p className="text-2xl font-bold tabular-nums text-[#007AFF]">{fmt(total)}</p>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ── Ghi nợ: Customer Selector ── */}
                {payMethod === 'debt' && (
                  <div className="space-y-3">
                    <div className="bg-[#FFF8E7] dark:bg-[rgba(255,149,0,0.08)] border border-[#FF9500]/20 rounded-2xl p-3.5 flex gap-2.5">
                      <span className="text-xl shrink-0 mt-0.5">📒</span>
                      <div>
                        <p className="text-[13px] font-semibold text-[#FF9500]">Ghi nợ {fmt(total)}</p>
                        <p className="text-[11px] text-[#8E8E93] mt-0.5">Chọn khách hàng để ghi vào sổ nợ</p>
                      </div>
                    </div>

                    {/* Search */}
                    {(() => {
                      const q = debtCustomerSearch.trim()
                      const filtered = customers.filter(c => !q ||
                        c.name.toLowerCase().includes(q.toLowerCase()) ||
                        c.phone.includes(q))
                      const exactMatch = customers.some(c => c.name.toLowerCase() === q.toLowerCase())
                      const createAndSelect = () => {
                        if (!q) return
                        const newC: Customer = { id: Date.now(), name: q, phone: '', note: '' }
                        setCustomers(cs => [...cs, newC])
                        setDebtCustomerId(newC.id)
                        setDebtCustomerSearch('')
                      }
                      return (
                        <>
                          <div className="relative">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                              type="text"
                              placeholder="Gõ tên khách, Enter để lưu nhanh..."
                              value={debtCustomerSearch}
                              onChange={e => {
                                setDebtCustomerSearch(e.target.value)
                                // auto-select single match
                                const val = e.target.value.trim()
                                if (val) {
                                  const matches = customers.filter(c =>
                                    c.name.toLowerCase().includes(val.toLowerCase()) || c.phone.includes(val))
                                  if (matches.length === 1) setDebtCustomerId(matches[0].id)
                                }
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  if (filtered.length === 1) {
                                    setDebtCustomerId(filtered[0].id)
                                    setDebtCustomerSearch('')
                                  } else if (q && !exactMatch) {
                                    createAndSelect()
                                  }
                                }
                              }}
                              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[14px] outline-none focus:ring-2 focus:ring-[#FF9500]/30"
                            />
                            {q && !exactMatch && (
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#FF9500] font-semibold pointer-events-none">↵ Lưu</span>
                            )}
                          </div>

                          <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-hide">
                            {/* Quick-create row — shown first when no exact match */}
                            {q && !exactMatch && (
                              <button
                                onClick={createAndSelect}
                                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-[#FF9500] text-white text-left active:scale-[0.98] transition-all"
                              >
                                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg shrink-0">+</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] font-bold truncate">"{q}"</p>
                                  <p className="text-[10px] text-white/70">Tạo mới & chọn ngay</p>
                                </div>
                                <span className="text-[11px] bg-white/20 rounded-lg px-2 py-1 font-semibold shrink-0">↵</span>
                              </button>
                            )}
                            {filtered.map(c => {
                              const bal = debtEntries.filter(e => e.customerId === c.id)
                                .reduce((s, e) => e.type === 'debit' ? s + e.amount : s - e.amount, 0)
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => { setDebtCustomerId(c.id); setDebtCustomerSearch('') }}
                                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-left transition-all ${
                                    debtCustomerId === c.id
                                      ? 'bg-[#FF9500] text-white ring-2 ring-[#FF9500]'
                                      : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                                  }`}
                                >
                                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-bold shrink-0 ${debtCustomerId === c.id ? 'bg-white/25 text-white' : 'bg-[#E5E5EA] dark:bg-[#3A3A3C] text-[#3C3C43] dark:text-white'}`}>
                                    {c.name.split(' ').pop()?.charAt(0)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold truncate">{c.name}</p>
                                    <p className={`text-[11px] ${debtCustomerId === c.id ? 'text-white/70' : 'text-[#8E8E93]'}`}>{c.phone || 'Chưa có SĐT'}</p>
                                  </div>
                                  {bal > 0 && (
                                    <span className={`text-[11px] font-bold tabular-nums shrink-0 ${debtCustomerId === c.id ? 'text-white/90' : 'text-[#FF3B30]'}`}>
                                      +{shortFmt(bal)}
                                    </span>
                                  )}
                                  {bal === 0 && <span className={`text-[11px] shrink-0 ${debtCustomerId === c.id ? 'text-white/70' : 'text-[#34C759]'}`}>✓ Hết nợ</span>}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                )}

                </div>{/* end animation wrapper */}

                {/* Confirm button */}
                <button
                  onClick={confirmPay}
                  disabled={(payMethod === 'cash' && cashNum < total) || (payMethod === 'debt' && !debtCustomerId)}
                  className={`w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm text-white ${
                    payMethod === 'debt' ? 'bg-[#FF9500] hover:bg-[#E68900]' : 'bg-[#34C759] hover:bg-[#2DB34A]'
                  }`}
                >
                  {payMethod === 'cash' && cashNum < total
                    ? `Còn thiếu ${fmt(total - cashNum)}`
                    : payMethod === 'debt' && !debtCustomerId
                    ? 'Chọn khách hàng'
                    : payMethod === 'debt'
                    ? `📒 Ghi nợ cho ${customers.find(c => c.id === debtCustomerId)?.name}`
                    : '✓  Xác nhận thanh toán'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── History Drawer ── */}
        {showHistory && (
          <div className="fixed inset-0 z-40 flex animate-fade-in">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
            <div className="relative ml-auto w-full max-w-sm bg-white dark:bg-[#1C1C1E] h-full flex flex-col shadow-2xl animate-slide-up">

              {/* Drawer Header */}
              <div className="flex items-center justify-between px-5 pt-safe pb-3.5 border-b border-black/[0.07] dark:border-white/[0.07] shrink-0" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
                <div>
                  <h2 className="text-[19px] font-bold">Lịch sử đơn hàng</h2>
                  <p className="text-[12px] text-[#8E8E93] mt-0.5">
                    {filteredHistoryOrders.length} đơn • Doanh thu: <span className="tabular-nums font-semibold text-[#34C759]">{shortFmt(historyRevenue)}</span>
                  </p>
                </div>
                <button onClick={() => setShowHistory(false)} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:bg-[#D1D1D6] transition-colors">
                  <XIcon />
                </button>
              </div>

              {/* Date & Method Filters */}
              <div className="p-3 border-b border-black/[0.05] dark:border-white/[0.05] space-y-2 shrink-0 bg-[#F9F9FB] dark:bg-[#18181A]">
                {/* Date Filter */}
                <div className="flex gap-1 overflow-x-auto scrollbar-hide items-center">
                  {([
                    { id: 'today', label: 'Hôm nay' },
                    { id: 'week',  label: 'Tuần này' },
                    { id: 'month', label: 'Tháng này' },
                    { id: 'year',  label: 'Năm này' },
                    { id: 'all',   label: 'Tất cả' },
                  ] as { id: typeof historyDateFilter; label: string }[]).map(f => (
                    <button
                      key={f.id}
                      onClick={() => { setHistoryDateFilter(f.id); setHistoryCustomDate('') }}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all ${
                        historyDateFilter === f.id && !historyCustomDate
                          ? 'bg-[#007AFF] text-white shadow-xs'
                          : 'bg-white dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-[rgba(235,235,245,0.7)] hover:bg-[#E5E5EA]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                  <div className="flex items-center gap-1 bg-white dark:bg-[#2C2C2E] px-2 py-0.5 rounded-full text-[11px] ring-1 ring-black/[0.06] dark:ring-white/[0.06] shrink-0">
                    <span className="text-[10px] text-[#8E8E93]">📅</span>
                    <input
                      type="date"
                      value={historyCustomDate}
                      onChange={e => {
                        setHistoryCustomDate(e.target.value)
                        if (e.target.value) setHistoryDateFilter('custom')
                      }}
                      className="bg-transparent text-[#1C1C1E] dark:text-white text-[11px] outline-none cursor-pointer"
                      title="Chọn ngày cụ thể"
                    />
                    {historyCustomDate && (
                      <button
                        type="button"
                        onClick={() => { setHistoryCustomDate(''); setHistoryDateFilter('today') }}
                        className="text-[#8E8E93] hover:text-[#FF3B30] text-[10px]"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Method Filter */}
                <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                  {([
                    { id: 'all',      label: 'Tất cả' },
                    { id: 'cash',     label: '💵 Tiền mặt' },
                    { id: 'transfer', label: '📱 CK' },
                    { id: 'debt',     label: '📒 Nợ' },
                  ] as { id: typeof historyMethodFilter; label: string }[]).map(f => (
                    <button
                      key={f.id}
                      onClick={() => setHistoryMethodFilter(f.id)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all ${
                        historyMethodFilter === f.id
                          ? 'bg-[#34C759] text-white'
                          : 'bg-white dark:bg-[#2C2C2E] text-[#3C3C43] dark:text-[rgba(235,235,245,0.7)] hover:bg-[#E5E5EA]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats Row */}
              {filteredHistoryOrders.length > 0 && (
                <div className="grid grid-cols-3 gap-2 px-4 py-2.5 shrink-0 border-b border-black/[0.05] dark:border-white/[0.05]">
                  {([
                    { label: 'Tiền mặt', color: 'text-[#FF9500]', bg: 'bg-[#FFF3E0] dark:bg-[rgba(255,149,0,0.1)]',   count: filteredHistoryOrders.filter(o => o.method === 'cash').length },
                    { label: 'CK',       color: 'text-[#34C759]', bg: 'bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.1)]',   count: filteredHistoryOrders.filter(o => o.method === 'transfer').length },
                    { label: 'Ghi nợ',   color: 'text-[#AF52DE]', bg: 'bg-[#F3E8FF] dark:bg-[rgba(175,82,222,0.1)]',  count: filteredHistoryOrders.filter(o => o.method === 'debt').length },
                  ]).map(s => (
                    <div key={s.label} className={`${s.bg} rounded-xl py-1.5 px-2 text-center`}>
                      <p className={`text-[15px] font-bold ${s.color}`}>{s.count}</p>
                      <p className="text-[10px] text-[#8E8E93] font-medium">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Order List */}
              <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-black/[0.05] dark:divide-white/[0.05]">
                {filteredHistoryOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-[#8E8E93]">
                    <span className="text-4xl mb-2">📋</span>
                    <p className="text-sm font-medium">Không tìm thấy đơn hàng nào</p>
                    <p className="text-xs text-[#8E8E93] mt-0.5">Thử chọn khoảng thời gian khác</p>
                  </div>
                ) : (
                  filteredHistoryOrders.map(order => {
                    const cust = order.customerId ? customers.find(c => c.id === order.customerId) : null
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => setHistorySelectedOrder(order)}
                        className="w-full px-5 py-3.5 text-left hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]/60 transition-colors block active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[14px] font-bold">#{order.id}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              order.method === 'cash'     ? 'bg-[#FFF3E0] dark:bg-[rgba(255,149,0,0.1)] text-[#FF9500]'  :
                              order.method === 'transfer' ? 'bg-[#E8F5E9] dark:bg-[rgba(52,199,89,0.1)] text-[#34C759]'  :
                                                            'bg-[#F3E8FF] dark:bg-[rgba(175,82,222,0.1)] text-[#AF52DE]'
                            }`}>
                              {order.method === 'cash' ? 'TM' : order.method === 'transfer' ? 'CK' : 'Nợ'}
                            </span>
                          </div>
                          <span className="text-[14px] font-bold tabular-nums text-[#007AFF]">{shortFmt(order.total)}</span>
                        </div>
                        <p className="text-[12px] text-[#8E8E93] truncate">
                          {order.lines.map(l => `${l.product.emoji} ${l.product.name}${l.variant ? ` (${l.variant.name})` : ''} ×${l.qty}`).join('  •  ')}
                        </p>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-[#8E8E93]">
                          <span>
                            {new Date(order.time).toLocaleDateString('vi-VN')} {new Date(order.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {cust && (
                            <span className="text-[#007AFF] font-medium truncate max-w-[120px]">
                              👤 {cust.name}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Order Detail Modal from History Drawer ── */}
        {historySelectedOrder && (
          <OrderDetailModal
            order={historySelectedOrder}
            onClose={() => setHistorySelectedOrder(null)}
            customers={customers}
            shopName={shopName}
          />
        )}

        {/* ── Admin Panel ── */}
        {showAdmin && (
          <AdminPanel
            dark={dark}
            setDark={setDark}
            orders={orders}
            setOrders={setOrders}
            products={products}
            setProducts={setProducts}
            customers={customers}
            setCustomers={setCustomers}
            debtEntries={debtEntries}
            setDebtEntries={setDebtEntries}
            suppliers={suppliers}
            setSuppliers={setSuppliers}
            bankAccounts={bankAccounts}
            setBankAccounts={setBankAccounts}
            units={units}
            setUnits={setUnits}
            stockReceipts={stockReceipts}
            setStockReceipts={setStockReceipts}
            shopName={shopName}
            setShopName={setShopName}
            vatRate={vatRate}
            setVatRate={setVatRate}
            onClose={() => setShowAdmin(false)}
            onInstallPwa={pwaPrompt ? installPwa : null}
            currentUser={currentUser}
            onChangePassword={() => { setShowAdmin(false); setShowChangePass(true) }}
            onLogout={() => { setShowAdmin(false); authService.signOut(); setIsLoggedIn(false); setCurrentUser('') }}
            syncProduct={syncProduct}
            syncDeleteProduct={syncDeleteProduct}
            syncSupplier={syncSupplier}
            syncDeleteSupplier={syncDeleteSupplier}
            syncCustomer={syncCustomer}
            syncDeleteCustomer={syncDeleteCustomer}
            syncStockReceipt={syncStockReceipt}
            syncDebtEntry={syncDebtEntry}
            syncBankAccounts={syncBankAccounts}
            syncSetting={syncSetting}
          />
        )}

        {showSettings && (
          <AdminPanel
            dark={dark}
            setDark={setDark}
            orders={orders}
            setOrders={setOrders}
            products={products}
            setProducts={setProducts}
            customers={customers}
            setCustomers={setCustomers}
            debtEntries={debtEntries}
            setDebtEntries={setDebtEntries}
            suppliers={suppliers}
            setSuppliers={setSuppliers}
            bankAccounts={bankAccounts}
            setBankAccounts={setBankAccounts}
            units={units}
            setUnits={setUnits}
            stockReceipts={stockReceipts}
            setStockReceipts={setStockReceipts}
            shopName={shopName}
            setShopName={setShopName}
            vatRate={vatRate}
            setVatRate={setVatRate}
            initialTab="settings"
            currentUser={currentUser}
            onChangePassword={() => { setShowSettings(false); setShowChangePass(true) }}
            onLogout={() => { setShowSettings(false); authService.signOut(); setIsLoggedIn(false); setCurrentUser('') }}
            onClose={() => setShowSettings(false)}
            onInstallPwa={pwaPrompt ? installPwa : null}
            syncProduct={syncProduct}
            syncDeleteProduct={syncDeleteProduct}
            syncSupplier={syncSupplier}
            syncDeleteSupplier={syncDeleteSupplier}
            syncCustomer={syncCustomer}
            syncDeleteCustomer={syncDeleteCustomer}
            syncStockReceipt={syncStockReceipt}
            syncDebtEntry={syncDebtEntry}
            syncBankAccounts={syncBankAccounts}
            syncSetting={syncSetting}
          />
        )}

        {showChangePass && (
          <ChangePasswordModal dark={dark} onClose={() => setShowChangePass(false)} />
        )}

        {/* ── Success Toast ── */}
        {success && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4">
            <div className="bg-white dark:bg-[#1C1C1E] rounded-3xl p-8 shadow-2xl text-center w-full max-w-[280px] animate-pop-in">
              <div className="w-16 h-16 bg-[#34C759] rounded-full flex items-center justify-center mx-auto mb-4 text-white">
                <CheckIcon />
              </div>
              <p className="font-bold text-[18px]">Thanh toán thành công!</p>
              <p className="text-[13px] text-[#8E8E93] mt-1">Đơn hàng #{success.id}</p>
              {success.method === 'cash' && success.change > 0 && (
                <div className="mt-3 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-3.5">
                  <p className="text-[11px] text-[#8E8E93] font-semibold uppercase tracking-wide">Tiền thối khách</p>
                  <p className="text-2xl font-bold tabular-nums text-[#34C759] mt-1">{fmt(success.change)}</p>
                </div>
              )}
              <p className="text-[11px] text-[#C7C7CC] dark:text-[#48484A] mt-4">Tự đóng sau 3 giây...</p>
            </div>
          </div>
        )}

        {/* ── Qty Numpad Modal ── */}
        {qtyNumpadTarget && (() => {
          const targetLine = cart.find(l => l.product.id === qtyNumpadTarget.id && l.variant?.id === qtyNumpadTarget.variantId)
          const linePrice = targetLine ? (targetLine.variant?.price ?? targetLine.product.price) : 0
          const qtyVal = parseFloat(qtyNumpadInput) || 0
          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeQtyNumpad} />
              <div className="relative w-full sm:max-w-[360px] bg-white dark:bg-[#1C1C1E] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1 sm:hidden">
                  <div className="w-10 h-1 rounded-full bg-[#C7C7CC] dark:bg-[#48484A]" />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/[0.07] dark:border-white/[0.07]">
                  <div>
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-widest">Số lượng</p>
                    <p className="text-[13px] font-medium truncate mt-0.5">{targetLine?.product.name}{targetLine?.variant ? ` · ${targetLine.variant.name}` : ''}</p>
                  </div>
                  <button onClick={closeQtyNumpad} className="w-8 h-8 rounded-full bg-[#E5E5EA] dark:bg-[#2C2C2E] flex items-center justify-center text-[#8E8E93]">✕</button>
                </div>
                {/* Display */}
                <div className="px-5 pt-4 pb-2">
                  <div className="bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Nhập số lượng</p>
                      <p className="text-3xl font-bold tabular-nums">
                        {qtyNumpadInput || '0'}
                        {targetLine?.product.unit && <span className="text-[16px] text-[#8E8E93] ml-1">{targetLine.product.unit}</span>}
                      </p>
                    </div>
                    {qtyVal > 0 && (
                      <div className="text-right">
                        <p className="text-[11px] text-[#8E8E93]">Thành tiền</p>
                        <p className="text-[16px] font-bold tabular-nums text-[#007AFF]">{shortFmt(linePrice * qtyVal)}</p>
                      </div>
                    )}
                  </div>
                </div>
                {/* Numpad */}
                <div className="px-5 pb-5 pt-2">
                  <div className="grid grid-cols-3 gap-2">
                    {['7','8','9','4','5','6','1','2','3','⌫','0','.'].map(k => (
                      <button
                        key={k}
                        onClick={() => handleQtyNumpad(k)}
                        className={`py-4 rounded-2xl text-lg font-semibold transition-all active:scale-95 select-none ${
                          k === '⌫'
                            ? 'bg-[#FFE5E5] dark:bg-[rgba(255,59,48,0.12)] text-[#FF3B30] hover:bg-[#FFCCCC]'
                            : k === '.'
                            ? 'bg-[#E5F0FF] dark:bg-[rgba(0,122,255,0.12)] text-[#007AFF] hover:bg-[#CCE2FF] font-bold text-xl'
                            : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1C1C1E] dark:text-white hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={confirmQtyNumpad}
                    className="w-full mt-3 py-4 rounded-2xl bg-[#007AFF] hover:bg-[#0066CC] text-white font-bold text-[15px] active:scale-[0.98] transition-all shadow-sm"
                  >
                    Xác nhận {qtyVal > 0 ? `· ${qtyVal}${targetLine?.product.unit ? ` ${targetLine.product.unit}` : ''}` : '(Xoá khỏi giỏ)'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
