// utils/stock.ts
import { STOCK_NAMES } from '@/types'
import { codeOnly } from './calculations'

export function getStockName(symbol: string, fallback?: string): string {
  const sym = symbol.toUpperCase()
  const code = codeOnly(sym)
  return STOCK_NAMES[sym] || STOCK_NAMES[code + '.TW'] || STOCK_NAMES[code + '.TWO'] || fallback || code
}
