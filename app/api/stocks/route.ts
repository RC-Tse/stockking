import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TWSE_API = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_API = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

async function fetchBidPrice(symbol: string): Promise<number> {
  try {
    // Yahoo Finance v6 quote API returns bid/ask prices
    const res = await fetch(
      `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${symbol}&fields=bid,ask,regularMarketPrice`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return 0
    const data = await res.json()
    const quote = data?.quoteResponse?.result?.[0]
    // bid is 0 or missing outside market hours, fall back to 0
    return (quote?.bid && quote.bid > 0) ? Number(quote.bid) : 0
  } catch {
    return 0
  }
}

async function fetchYahooQuote(symbol: string, nameZh?: string) {
  try {
    const [chartRes, bidPrice] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
        { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
      ),
      fetchBidPrice(symbol)
    ])
    if (!chartRes.ok) return null
    const data = await chartRes.json()
    const result = data.chart?.result?.[0]
    if (!result) return null

    const meta = result.meta
    const indicators = result.indicators?.quote?.[0] || {}

    const price = meta.regularMarketPrice || 0
    const prev = meta.previousClose || meta.chartPreviousClose || price || 0
    const open = (indicators.open?.[0]) || price || 0
    const high = (indicators.high?.[0]) || price || 0
    const low = (indicators.low?.[0]) || price || 0
    const volume = (indicators.volume?.[0]) || 0

    const change = Math.round((price - prev) * 100) / 100
    const change_pct = prev ? Math.round(change / prev * 10000) / 100 : 0

    // Use bid_price when available (conservative valuation matching brokerage)
    // bid_price is only > 0 during market hours; outside hours keep as 0 (caller will fall back to price)
    return {
      symbol,
      name_zh: nameZh,
      price,
      bid_price: bidPrice > 0 ? bidPrice : undefined,
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
    const start = end - 86400 * 7 // Fetch 7 days to ensure we get at least two trading days

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
    
    // Find the entry for the target date
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

async function getOrFetchNames(supabase: any, syms: string[]) {
  const { data: cached } = await supabase
    .from('stock_names')
    .select('symbol, name_zh')
    .in('symbol', syms)

  const nameMap = Object.fromEntries(cached?.map((n: any) => [n.symbol, n.name_zh]) ?? [])
  const missing = syms.filter(s => !nameMap[s])

  if (missing.length > 0) {
    try {
      const [twseRes, tpexRes] = await Promise.all([
        fetch(TWSE_API, { next: { revalidate: 86400 } }),
        fetch(TPEX_API, { next: { revalidate: 86400 } })
      ])
      
      const twseList = twseRes.ok ? await twseRes.json() : []
      const tpexList = tpexRes.ok ? await tpexRes.json() : []
      
      const toInsert: { symbol: string; name_zh: string }[] = []
      
      missing.forEach(s => {
        const code = s.split('.')[0]
        let name = ''
        if (s.endsWith('.TW')) {
          name = twseList.find((i: any) => i.Code === code)?.Name
        } else if (s.endsWith('.TWO')) {
          name = tpexList.find((i: any) => i.SecumId === code || i.SecuritiesCompanyCode === code)?.CompanyName || tpexList.find((i: any) => i.SecumId === code || i.SecuritiesCompanyCode === code)?.Name
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
  const nameMap = await getOrFetchNames(supabase, syms)

  const results = await Promise.all(
    syms.map(s => date 
      ? fetchYahooHistoricalQuote(s, date, nameMap[s]) 
      : fetchYahooQuote(s, nameMap[s])
    )
  )
  const data: Record<string, any> = {}

  results.forEach(q => {
    if (q) data[q.symbol] = q
  })

  return NextResponse.json(data, { 
    headers: { 'Cache-Control': 'public, s-maxage=30' } 
  })
}
