import { NextRequest, NextResponse } from 'next/server'
import { STOCK_NAMES } from '@/types'
import { createClient } from '@/lib/supabase/server'

async function fetchYahooQuote(symbol: string, nameZh?: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return null

    const meta = result.meta
    const indicators = result.indicators?.quote?.[0] || {}

    const price = meta.regularMarketPrice || 0
    const prev = meta.previousClose || price || 0
    const open = (indicators.open?.[0]) || price || 0
    const high = (indicators.high?.[0]) || price || 0
    const low = (indicators.low?.[0]) || price || 0
    const volume = (indicators.volume?.[0]) || 0

    const change = Math.round((price - prev) * 100) / 100
    const change_pct = prev ? Math.round(change / prev * 10000) / 100 : 0

    return {
      symbol,
      name: nameZh || STOCK_NAMES[symbol] || meta.shortName || meta.longName || symbol.split('.')[0],
      name_zh: nameZh,
      price,
      prev,
      open,
      high,
      low,
      change,
      change_pct,
      volume
    }
  } catch (err) {
    console.error(`Error fetching ${symbol}:`, err)
    return null
  }
}

export async function GET(req: NextRequest) {
  const syms = (req.nextUrl.searchParams.get('symbols') ?? '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)

  if (!syms.length) return NextResponse.json({}, { status: 400 })

  const supabase = await createClient()
  const { data: names } = await supabase
    .from('stock_names')
    .select('symbol, name_zh')
    .in('symbol', syms)

  const nameMap = Object.fromEntries(names?.map(n => [n.symbol, n.name_zh]) ?? [])

  const results = await Promise.all(syms.map(s => fetchYahooQuote(s, nameMap[s])))
  const data: Record<string, any> = {}

  results.forEach(q => {
    if (q) data[q.symbol] = q
  })

  return NextResponse.json(data, { 
    headers: { 'Cache-Control': 'public, s-maxage=30' } 
  })
}
