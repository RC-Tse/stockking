// utils/calculations.ts
import { UserSettings, ETF_CODES } from '@/types'

export function isEtf(symbol: string): boolean {
  const code = symbol.toUpperCase().replace('.TW','').replace('.TWO','')
  return code.startsWith('00') || code.startsWith('01') || ETF_CODES.has(code)
}

export function codeOnly(symbol: string): string {
  return symbol.replace('.TW','').replace('.TWO','')
}

export function calcRawFee(shares: number, price: number, s: UserSettings, isSell = false, isDca = false): number {
  if (isDca) return s.dca_fee_min
  const rate = isSell ? s.sell_fee_rate : s.buy_fee_rate
  const discount = isSell ? s.sell_discount : s.buy_discount
  return Math.max(1, shares * price * rate * discount)
}

export function calcFee(shares: number, price: number, s: UserSettings, isSell = false, isDca = false): number {
  return Math.floor(calcRawFee(shares, price, s, isSell, isDca))
}

export function calcRawTax(shares: number, price: number, symbol: string, s: UserSettings): number {
  const rate = isEtf(symbol) ? s.tax_etf : s.tax_stock
  return shares * price * rate
}

export function calcTax(shares: number, price: number, symbol: string, s: UserSettings): number {
  return Math.floor(calcRawTax(shares, price, symbol, s))
}

export function calculateTxParts(shares: number, price: number, action: 'BUY' | 'SELL' | 'DCA', symbol: string, settings: UserSettings) {
  const isDca = action === 'DCA'
  const isSell = action === 'SELL'
  
  const gross = Math.floor(shares * price)
  const fee = calcFee(shares, price, settings, isSell, isDca)
  const tax = isSell ? calcTax(shares, price, symbol, settings) : 0
  
  const net = isSell ? (gross - fee - tax) : (gross + fee)
  
  return { gross, fee, tax, net: isSell ? net : -net, absNet: net }
}
