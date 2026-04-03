// types/index.ts

export interface Transaction {
  id: number
  user_id: string
  symbol: string
  name_zh?: string
  action: 'BUY' | 'SELL' | 'DCA'
  trade_date: string
  shares: number
  price: number
  amount: number
  fee: number
  tax: number
  net_amount: number
  trade_type: string
  note: string
  created_at: string
}

export interface Holding {
  symbol: string
  shares: number
  avg_cost: number
  total_cost: number
  current_price: number
  market_value: number
  unrealized_pnl: number
  pnl_pct: number
}

export interface Quote {
  symbol: string
  name?: string
  name_zh?: string
  price: number
  prev: number
  open: number
  high: number
  low: number
  change: number
  change_pct: number
  volume: number
}

export interface CalendarEntry {
  entry_date: string
  pnl: number
  pnl_pct?: number
  note: string
  details?: {
    symbol: string
    name: string
    price: number
    pnl: number
    pnl_pct: number
    shares: number
  }[]
}

export interface UserSettings {
  broker_name: string
  buy_fee_rate: number
  buy_discount: number
  sell_fee_rate: number
  sell_discount: number
  fee_min: number
  tax_stock: number
  tax_etf: number
  max_holdings: number
  font_size: 'small' | 'medium' | 'large'
  dca_fee_rate: number
  year_goal: number
  total_goal: number
}

export const DEFAULT_SETTINGS: UserSettings = {
  broker_name: '國泰證券',
  buy_fee_rate: 0.001425,
  buy_discount: 0.285,
  sell_fee_rate: 0.001425,
  sell_discount: 0.285,
  fee_min: 20,
  tax_stock: 0.003,
  tax_etf: 0.001,
  max_holdings: 7,
  font_size: 'medium',
  dca_fee_rate: 0.001425,
  year_goal: 0,
  total_goal: 0,
}

// ETF codes for tax calculation
export const ETF_CODES = new Set([
  '0050','0051','0052','0053','0054','0055','0056','006208',
  '00878','00900','00929','00713','00919','00679B','00687B',
])

export function isEtf(symbol: string): boolean {
  const code = symbol.toUpperCase().replace('.TW','').replace('.TWO','')
  return ETF_CODES.has(code)
}

export function codeOnly(symbol: string): string {
  return symbol.replace('.TW','').replace('.TWO','')
}

export function calcFee(amount: number, s: UserSettings, isSell = false): number {
  const rate = isSell
    ? s.sell_fee_rate * s.sell_discount
    : s.buy_fee_rate * s.buy_discount
  return Math.floor(Math.max(amount * rate, s.fee_min))
}

export function calcTax(amount: number, symbol: string, s: UserSettings): number {
  return amount * (isEtf(symbol) ? s.tax_etf : s.tax_stock)
}

export function fmtPrice(v: number): string {
  return v.toFixed(2)
}

export function fmtMoney(v: number): string {
  return v.toLocaleString('zh-TW')
}

// ── Stock Name Mapping ────────────────────────────────────────────────────────
export const STOCK_NAMES: Record<string, string> = {
  '2330.TW': '台積電', '2454.TW': '聯發科', '2382.TW': '廣達', '2317.TW': '鴻海',
  '2308.TW': '台達電', '2356.TW': '英業達', '3711.TW': '日月光投控', '6669.TW': '緯穎',
  '3034.TW': '聯詠', '2301.TW': '光寶科', '2345.TW': '智邦', '2603.TW': '長榮',
  '2609.TW': '陽明', '2615.TW': '萬海', '2610.TW': '華航', '2882.TW': '國泰金',
  '2881.TW': '富邦金', '2891.TW': '中信金', '2886.TW': '兆豐金', '2884.TW': '玉山金',
  '2892.TW': '第一金', '2880.TW': '華南金', '0050.TW': '元大台灣50', '0056.TW': '元大高股息',
  '006208.TW': '富邦台50', '00878.TW': '國泰永續高股息', '00929.TW': '復華台灣科技優息',
  '00713.TW': '元大台灣高息低波', '1301.TW': '台塑', '1303.TW': '南亞', '2002.TW': '中鋼',
  '3324.TW': '雙鴻', '6230.TW': '超眾', '1626.TW': '建準', '2408.TW': '南亞科',
  '2337.TW': '旺宏', '00918.TW': '凱基台灣TOP50',
}

export function getStockName(symbol: string, fallback?: string): string {
  const sym = symbol.toUpperCase()
  return STOCK_NAMES[sym] || fallback || codeOnly(sym)
}

// ── Concept groups ────────────────────────────────────────────────────────────
export const CONCEPT_GROUPS: Record<string, { desc: string; stocks: [string, string][] }> = {
  '🤖 AI & 高效能運算': {
    desc: '受惠輝達 AI 伺服器需求爆發，涵蓋設計、代工、組裝供應商',
    stocks: [
      ['2330.TW','台積電'],['2454.TW','聯發科'],['2382.TW','廣達'],
      ['2356.TW','英業達'],['3711.TW','日月光投控'],['2308.TW','台達電'],
      ['6669.TW','緯穎'],['3034.TW','聯詠'],['2301.TW','光寶科'],['2317.TW','鴻海'],
    ],
  },
  '🔦 光通訊': {
    desc: 'AI 資料中心高速傳輸所需光纖模組、收發器、雷射元件',
    stocks: [
      ['4979.TW','華星光'],['3081.TW','聯亞'],['3049.TW','和鑫'],
      ['6513.TW','前鼎'],['6442.TW','光聖'],['5371.TW','中光電'],['3163.TW','波若威'],
    ],
  },
  '🌡️ 散熱模組': {
    desc: 'AI 伺服器高功耗散熱需求：均溫板、水冷、熱管',
    stocks: [
      ['3324.TW','雙鴻'],['3019.TW','亞泰'],['6230.TW','超眾'],
      ['6278.TW','台表科'],['1626.TW','建準'],['2308.TW','台達電'],['3540.TW','曜越'],
    ],
  },
  '📦 CoWoS & 先進封裝': {
    desc: 'CoWoS、Chiplet、SiP 等先進封裝技術供應鏈',
    stocks: [
      ['3711.TW','日月光投控'],['2449.TW','京元電子'],['6286.TW','立錡'],
      ['3443.TW','創意'],['3006.TW','晶豪科'],['6515.TW','穎崴'],
    ],
  },
  '🖥️ 伺服器 & 雲端': {
    desc: '雲端伺服器、機架、電源、ODM 設計製造',
    stocks: [
      ['2382.TW','廣達'],['2356.TW','英業達'],['2353.TW','宏碁'],
      ['3231.TW','緯創'],['6669.TW','緯穎'],['2301.TW','光寶科'],
    ],
  },
  '🚗 電動車 & 儲能': {
    desc: 'EV 零組件、充電樁、電池芯、儲能系統',
    stocks: [
      ['2308.TW','台達電'],['1513.TW','中興電'],['1519.TW','華城'],
      ['2207.TW','和泰車'],['6244.TW','茂迪'],['6671.TW','三聯科技'],
    ],
  },
  '🏦 金融股': {
    desc: '銀行、保險、金控，適合存股領股息',
    stocks: [
      ['2891.TW','中信金'],['2882.TW','國泰金'],['2881.TW','富邦金'],
      ['2886.TW','兆豐金'],['2884.TW','玉山金'],['2892.TW','第一金'],['2880.TW','華南金'],
    ],
  },
  '📈 ETF 指數型': {
    desc: '台灣主流 ETF，適合定期定額長期投資',
    stocks: [
      ['0050.TW','元大台灣50'],['0056.TW','元大高股息'],
      ['006208.TW','富邦台50'],['00878.TW','國泰永續高股息'],
      ['00929.TW','復華台灣科技優息'],['00713.TW','元大台灣高息低波'],
    ],
  },
  '💊 生技醫療': {
    desc: '新藥開發、醫療器材、健康照護',
    stocks: [
      ['4746.TW','台耀'],['1762.TW','中化生'],['4126.TW','太醫'],
      ['6548.TW','長聖'],['4174.TW','浩鼎'],
    ],
  },
  '🚢 航運': {
    desc: '貨櫃航運、散裝船、空運貨運',
    stocks: [
      ['2603.TW','長榮'],['2609.TW','陽明'],['2615.TW','萬海'],
      ['2610.TW','華航'],['2618.TW','長榮航'],
    ],
  },
}
