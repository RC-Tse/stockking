// utils/formatters.ts

export function fmtPrice(v: number): string {
  return (v ?? 0).toFixed(2)
}

export function fmtMoney(v: number): string {
  return Math.round(v).toLocaleString('zh-TW')
}
