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
  return Math.max(s.fee_min, shares * price * rate * discount)
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

export function calculateTxParts(shares: number, price: number, action: 'BUY' | 'SELL' | 'DCA' | 'DIVIDEND', symbol: string, settings: UserSettings) {
  // 修正 Yahoo Finance API 浮點誤差（如 2258.0 傳回 2257.9999...）
  const p = Math.round(price * 100) / 100

  if (action === 'DIVIDEND') {
    const gross = Math.floor(shares * p)
    return { gross, fee: 0, tax: 0, net: gross, absNet: gross }
  }

  const isDca = action === 'DCA'
  const isSell = action === 'SELL'

  const gross = Math.floor(shares * p)
  const fee = calcFee(shares, p, settings, isSell, isDca)
  const tax = isSell ? calcTax(shares, p, symbol, settings) : 0

  const net = isSell ? (gross - fee - tax) : (gross + fee)

  return { gross, fee, tax, net: isSell ? net : -net, absNet: net }
}
