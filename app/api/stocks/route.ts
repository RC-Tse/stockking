import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TWSE_API = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_API = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

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

    const price = Math.round((meta.regularMarketPrice || 0) * 100) / 100
    const prev = Math.round((meta.previousClose || meta.chartPreviousClose || price || 0) * 100) / 100
    const open = Math.round(((indicators.open?.[0]) || price || 0) * 100) / 100
    const high = Math.round(((indicators.high?.[0]) || price || 0) * 100) / 100
    const low = Math.round(((indicators.low?.[0]) || price || 0) * 100) / 100
    const volume = (indicators.volume?.[0]) || 0
    const change = Math.round((price - prev) * 100) / 100
    const change_pct = prev ? Math.round(change / prev * 10000) / 100 : 0

    return {
      symbol,
      name_zh: nameZh,
      price,
      prev,
      open,
      high,
      low,
      change,
      change_pct,
      volume,
      trade_date: new Date(meta.regularMarketTime * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    }
  } catch {
    return null
  }
}

async function fetchYahooHistoricalQuote(symbol: string, date: string, nameZh?: string) {
  try {
    const targetDate = new Date(date)
    const end = Math.floor(targetDate.getTime() / 1000) + 86400
    const start = end - 86400 * 7

    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result || !result.indicators?.quote?.[0]?.close) return null

    const closes = result.indicators.quote[0].close
    const timestamps = result.timestamp || []

    let targetIdx = -1
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const dStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0]
      if (dStr <= date && closes[i] !== null) { targetIdx = i; break }
    }
    if (targetIdx === -1) return null

    const price = closes[targetIdx]
    const prevPrice = targetIdx > 0 ? closes[targetIdx - 1] : null
    const change = prevPrice !== null ? Math.round((price - prevPrice) * 100) / 100 : 0
    const change_pct = (prevPrice !== null && prevPrice !== 0) ? Math.round(change / prevPrice * 10000) / 100 : 0

    return {
      symbol,
      name_zh: nameZh,
      trade_date: new Date(timestamps[targetIdx] * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
      price: Math.round(price * 100) / 100,
      prev: prevPrice !== null ? Math.round(prevPrice * 100) / 100 : null,
      change,
      change_pct
    }
  } catch {
    return null
  }
}

// Fetch both official exchange lists once; reuse for name/price/exchange detection
async function fetchExchangeLists() {
  try {
    const [twseRes, tpexRes] = await Promise.all([
      fetch(TWSE_API, { next: { revalidate: 1800 } }),
      fetch(TPEX_API, { next: { revalidate: 1800 } })
    ])
    const twseList: any[] = twseRes.ok ? await twseRes.json() : []
    const tpexList: any[] = tpexRes.ok ? await tpexRes.json() : []
    return { twseList, tpexList }
  } catch {
    return { twseList: [], tpexList: [] }
  }
}

function buildMaps(twseList: any[], tpexList: any[]) {
  const twse = new Map<string, any>()
  const tpex = new Map<string, any>()
  for (const s of twseList) if (s.Code) twse.set(s.Code, s)
  for (const s of tpexList) if (s.SecuritiesCompanyCode) tpex.set(s.SecuritiesCompanyCode, s)
  return { twse, tpex }
}

function parsePrice(val: string | undefined): number {
  if (!val || val === '--') return 0
  const p = parseFloat(val.replace(',', ''))
  return isNaN(p) ? 0 : p
}

// Cache names from official lists to DB
async function cacheNames(supabase: any, syms: string[], twse: Map<string, any>, tpex: Map<string, any>) {
  const { data: cached } = await supabase
    .from('stock_names').select('symbol, name_zh').in('symbol', syms)
  const nameMap: Record<string, string> = Object.fromEntries(cached?.map((n: any) => [n.symbol, n.name_zh]) ?? [])

  const toInsert: { symbol: string; name_zh: string }[] = []
  for (const s of syms) {
    if (nameMap[s]) continue
    const code = s.replace(/\.(TW|TWO)$/, '')
    const name = twse.get(code)?.Name || tpex.get(code)?.CompanyName || ''
    if (name) {
      nameMap[s] = name
      toInsert.push({ symbol: s, name_zh: name })
    }
  }
  if (toInsert.length > 0) {
    await supabase.from('stock_names').upsert(toInsert).catch(() => {})
  }
  return nameMap
}

// Fetch quote for a Taiwan stock: try primary exchange, then alt, then fallback to official close
async function fetchTwStockQuote(
  code: string,
  nameZh: string,
  twse: Map<string, any>,
  tpex: Map<string, any>
): Promise<any | null> {
  // Determine exchange from official lists first; heuristic as fallback
  let primary: string
  let alt: string
  if (twse.has(code)) {
    primary = code + '.TW'; alt = code + '.TWO'
  } else if (tpex.has(code)) {
    primary = code + '.TWO'; alt = code + '.TW'
  } else {
    // Heuristic: 7xxx-9xxx tend to be TPEX
    const num = parseInt(code)
    if (!isNaN(num) && num >= 7000) {
      primary = code + '.TWO'; alt = code + '.TW'
    } else {
      primary = code + '.TW'; alt = code + '.TWO'
    }
  }

  // Try primary Yahoo symbol
  let q = await fetchYahooQuote(primary, nameZh)

  // Try alternative exchange if primary failed
  if (!q) q = await fetchYahooQuote(alt, nameZh)

  // Final fallback: use official API close price directly (no live price, but always works)
  if (!q) {
    const twseData = twse.get(code)
    const tpexData = tpex.has(code) ? tpex.get(code) : null
    const close = parsePrice(twseData?.ClosingPrice) || parsePrice(tpexData?.Close)
    const name = nameZh || twseData?.Name || tpexData?.CompanyName || code
    if (close > 0) {
      q = {
        symbol: code,
        name_zh: name,
        price: close,
        prev: close,
        open: parsePrice(twseData?.OpeningPrice || tpexData?.Open),
        high: parsePrice(twseData?.HighestPrice || tpexData?.High),
        low: parsePrice(twseData?.LowestPrice || tpexData?.Low),
        change: 0,
        change_pct: 0,
        volume: 0,
        trade_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
      }
    }
  }

  // Override prev with official TWSE close price for accuracy
  if (q && twse.has(code)) {
    const officialClose = parsePrice(twse.get(code)?.ClosingPrice)
    if (officialClose > 0) {
      q.prev = officialClose
      q.change = Math.round((q.price - officialClose) * 100) / 100
      q.change_pct = officialClose ? Math.round(q.change / officialClose * 10000) / 100 : 0
    }
  }

  return q
}

export async function GET(req: NextRequest) {
  const syms = (req.nextUrl.searchParams.get('symbols') ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const date = req.nextUrl.searchParams.get('date')
  if (!syms.length) return NextResponse.json({}, { status: 400 })

  const supabase = await createClient()
  const { twseList, tpexList } = await fetchExchangeLists()
  const { twse, tpex } = buildMaps(twseList, tpexList)
  const nameMap = await cacheNames(supabase, syms, twse, tpex)

  const results = await Promise.all(
    syms.map(s => {
      const code = s.replace(/\.(TW|TWO)$/, '')
      const name = nameMap[s] || ''

      if (date) {
        // Historical: use Yahoo only, determine suffix from maps
        const suffix = twse.has(code) ? '.TW' : tpex.has(code) ? '.TWO' : (parseInt(code) >= 7000 ? '.TWO' : '.TW')
        return fetchYahooHistoricalQuote(code + suffix, date, name)
      }

      // Non-Taiwan symbol (e.g. AAPL, BTC-USD): pass through as-is
      if (s.includes('.') || !/^\d[A-Z0-9]{3,5}$/.test(s)) {
        return fetchYahooQuote(s, name)
      }

      return fetchTwStockQuote(code, name, twse, tpex)
    })
  )

  const data: Record<string, any> = {}
  results.forEach((q, i) => { if (q) data[syms[i]] = q })

  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=30' } })
}
