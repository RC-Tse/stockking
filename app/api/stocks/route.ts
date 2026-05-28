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
  } catch (err) {
    console.error(`Error fetching ${symbol}:`, err)
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
      const d = new Date(timestamps[i] * 1000)
      const dStr = d.toISOString().split('T')[0]
      if (dStr <= date && closes[i] !== null) {
        targetIdx = i
        break
      }
    }

    if (targetIdx === -1) return null

    const price = closes[targetIdx]
    const prevPrice = targetIdx > 0 ? closes[targetIdx - 1] : null
    const change = prevPrice !== null ? Math.round((price - prevPrice) * 100) / 100 : 0
    const change_pct = (prevPrice !== null && prevPrice !== 0) ? Math.round(change / prevPrice * 10000) / 100 : 0
    const trade_date = new Date(timestamps[targetIdx] * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

    return {
      symbol,
      name_zh: nameZh,
      trade_date,
      price: Math.round(price * 100) / 100,
      prev: prevPrice !== null ? Math.round(prevPrice * 100) / 100 : null,
      change,
      change_pct
    }
  } catch (err) {
    console.error(`Error fetching historical ${symbol} for ${date}:`, err)
    return null
  }
}

// Fetch TWSE and TPEX lists once, reuse for name lookup + exchange detection + close prices
async function fetchExchangeLists() {
  try {
    const [twseRes, tpexRes] = await Promise.all([
      fetch(TWSE_API, { next: { revalidate: 1800 } }),
      fetch(TPEX_API, { next: { revalidate: 1800 } })
    ])
    return {
      twseList: twseRes.ok ? await twseRes.json() as any[] : [],
      tpexList: tpexRes.ok ? await tpexRes.json() as any[] : []
    }
  } catch {
    return { twseList: [], tpexList: [] }
  }
}

// Determine correct Yahoo Finance symbol (.TW for TWSE, .TWO for TPEX)
function resolveYahooSym(code: string, twseCodes: Set<string>, tpexCodes: Set<string>): string {
  if (code.includes('.')) return code
  if (!/^\d[A-Z0-9]{3,5}$/.test(code)) return code
  if (twseCodes.has(code)) return code + '.TW'
  if (tpexCodes.has(code)) return code + '.TWO'
  return code + '.TW' // fallback
}

async function getOrFetchNames(
  supabase: any,
  syms: string[],
  twseList: any[],
  tpexList: any[]
) {
  const { data: cached } = await supabase
    .from('stock_names')
    .select('symbol, name_zh')
    .in('symbol', syms)

  const nameMap = Object.fromEntries(cached?.map((n: any) => [n.symbol, n.name_zh]) ?? [])
  const missing = syms.filter(s => !nameMap[s])

  if (missing.length > 0) {
    try {
      const toInsert: { symbol: string; name_zh: string }[] = []

      missing.forEach(s => {
        const code = s.replace(/\.(TW|TWO)$/, '')
        let name = ''

        // Check TWSE first, then TPEX
        name = twseList.find((i: any) => i.Code === code)?.Name || ''
        if (!name) {
          const tpexMatch = tpexList.find((i: any) => i.SecumId === code || i.SecuritiesCompanyCode === code)
          name = tpexMatch?.CompanyName || tpexMatch?.Name || ''
        }

        if (name) {
          nameMap[s] = name
          toInsert.push({ symbol: s, name_zh: name })
        }
      })

      if (toInsert.length > 0) {
        await supabase.from('stock_names').upsert(toInsert)
      }
    } catch (e) {
      console.error('Fetch names error:', e)
    }
  }

  return nameMap
}

export async function GET(req: NextRequest) {
  const syms = (req.nextUrl.searchParams.get('symbols') ?? '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)

  const date = req.nextUrl.searchParams.get('date')

  if (!syms.length) return NextResponse.json({}, { status: 400 })

  const supabase = await createClient()

  // Single fetch for both exchange detection and name lookup
  const { twseList, tpexList } = await fetchExchangeLists()
  const twseCodes = new Set(twseList.map((s: any) => s.Code).filter(Boolean))
  const tpexCodes = new Set(tpexList.map((s: any) => s.SecumId || s.SecuritiesCompanyCode).filter(Boolean))

  // Extract TWSE official close prices
  const twseClose: Record<string, number> = {}
  if (!date) {
    for (const s of twseList) {
      if (s.Code && s.ClosingPrice && s.ClosingPrice !== '--') {
        const p = parseFloat(s.ClosingPrice.replace(',', ''))
        if (!isNaN(p) && p > 0) twseClose[s.Code] = p
      }
    }
  }

  const nameMap = await getOrFetchNames(supabase, syms, twseList, tpexList)

  const results = await Promise.all(
    syms.map(s => {
      const fetchSym = resolveYahooSym(s, twseCodes, tpexCodes)
      return date
        ? fetchYahooHistoricalQuote(fetchSym, date, nameMap[s])
        : fetchYahooQuote(fetchSym, nameMap[s])
    })
  )

  const data: Record<string, any> = {}

  results.forEach((q, i) => {
    if (!q) return
    const sym = syms[i]
    const code = sym.replace(/\.(TW|TWO)$/, '')
    // Override prev with TWSE official close for listed stocks
    if (!date && twseCodes.has(code) && twseClose[code]) {
      q.prev = twseClose[code]
      q.change = Math.round((q.price - q.prev) * 100) / 100
      q.change_pct = q.prev ? Math.round(q.change / q.prev * 10000) / 100 : 0
    }
    data[sym] = q
  })

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=30' }
  })
}
