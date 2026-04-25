// types/index.ts

export * from '../constants/stocks'

export interface Transaction {
  id: number
  user_id: string
  symbol: string
  name_zh?: string
  action: 'BUY' | 'SELL' | 'DCA' | 'DIVIDEND'
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

export interface DCAPlan {
  id: number
  user_id: string
  symbol: string
  amount: number
  days_of_month: number[]
  dividend_reinvest: boolean
  smart_buy_enabled: boolean
  smart_buy_threshold: string
  smart_buy_amount: number
  smart_sell_enabled: boolean
  smart_sell_threshold: string
  smart_sell_amount: number
  is_active: boolean
  created_at: string
  name_zh?: string
}

export interface Holding {
  symbol: string
  shares: number
  avg_cost: number
  total_cost: number
  current_price: number
  market_value: number        // gross: price × shares (floor)
  net_market_value: number    // market_value minus estimated sell fee + tax (= brokerage '預估淨市值')
  sell_fee: number            // estimated sell brokerage fee
  sell_tax: number            // estimated sell securities transaction tax
  unrealized_pnl: number
  pnl_pct: number
  lots?: any[]
}


export interface Quote {
  symbol: string
  name?: string
  name_zh?: string
  price: number       // last traded price (regularMarketPrice)
  bid_price?: number  // bid (买進第一檔), used for conservative valuation
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
  realized_pnl?: number
  daily_pnl?: number
  daily_pnl_pct?: number
  net_market_value?: number
  gross_market_value?: number
  is_market_closed?: boolean
  capital_in?: number
  note: string
  hasTransactions?: boolean
  details?: {
    symbol: string
    name: string
    shares: number
    price: number
    change: number
    change_pct: number
    cost: number
    mv: number
    stock_daily_pnl: number
    stock_daily_pnl_pct: number
  }[]
}

export type ChartRange = '1M' | '3M' | '6M' | '9M' | '1Y' | 'CUSTOM'
export type TotalChartRange = '6M' | '1Y' | '1.5Y' | '2Y' | '3Y' | 'CUSTOM'

export interface UserSettings {
  broker_name: string
  buy_fee_rate: number
  buy_discount: number
  sell_fee_rate: number
  sell_discount: number
  fee_min: number
  dca_fee_rate: number
  dca_fee_min: number
  tax_stock: number
  tax_etf: number
  max_holdings: number
  font_size: 'small' | 'medium' | 'large'
  year_goal: number
  year_goals: Record<string, number> 
  total_goal: number
  total_goal_start_date: string
  theme: 'dark' | 'light' | 'blue' | 'green' | 'rose' | 'purple'
  chart_default_range: ChartRange
  total_chart_default_range: TotalChartRange
  stock_chart_default_range: ChartRange
  stock_chart_style: 'simple' | 'detailed'
}

export const DEFAULT_SETTINGS: UserSettings = {
  broker_name: '國泰證券',
  buy_fee_rate: 0.001425,
  buy_discount: 0.285,
  sell_fee_rate: 0.001425,
  sell_discount: 0.285,
  fee_min: 20,
  dca_fee_rate: 0.0001, 
  dca_fee_min: 1,      
  tax_stock: 0.003,
  tax_etf: 0.001,
  max_holdings: 7,
  font_size: 'medium',
  year_goal: 10000,
  year_goals: { "2026": 10000 },
  total_goal: 0,
  total_goal_start_date: new Date().toISOString().split('T')[0],
  theme: 'dark',
  chart_default_range: '1M',
  total_chart_default_range: '1Y',
  stock_chart_default_range: '1M',
  stock_chart_style: 'simple'
}
