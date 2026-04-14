import { NextRequest, NextResponse } from 'next/server'
import { getStockName } from '@/types'

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()
  const range = req.nextUrl.searchParams.get('range')
  const year = req.nextUrl.searchParams.get('year')

  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`
  
  if (year) {
    // Include the end of the previous year to ensure we have a seed price for 1/1 calculations
    const prevYear = Number(year) - 1
    const start = new Date(`${prevYear}-12-20T00:00:00Z`).getTime() / 1000
    const end = new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000
    url += `&period1=${Math.floor(start)}&period2=${Math.floor(end)}`
  } else {
    url += `&range=${range || '4mo'}`
  }

  try {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    ]
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)]

    const res = await fetch(url, 
      { cache: 'no-store', headers: { 'User-Agent': randomUA } }
    )

    if (res.status === 429) {
      return NextResponse.json({ error: 'Yahoo Finance 請求過於頻繁 (429)，請稍後再試' }, { status: 429 })
    }

    if (!res.ok) return NextResponse.json({ error: `Failed to fetch: ${res.status}` }, { status: 500 })
    
    const data = await res.json()
    const result = data.chart?.result?.[0]
    
    if (!result) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
    }

    const quotes = result.indicators?.quote?.[0]
    const closes = quotes?.close || []
    const opens = quotes?.open || []
    const highs = quotes?.high || []
    const lows = quotes?.low || []
    const timestamps = result.timestamp || []
    
    // Map history
    const history = timestamps.map((ts: number, i: number) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      price: closes[i] ? Math.round(closes[i] * 100) / 100 : null,
      open: opens[i] ? Math.round(opens[i] * 100) / 100 : null,
      high: highs[i] ? Math.round(highs[i] * 100) / 100 : null,
      low: lows[i] ? Math.round(lows[i] * 100) / 100 : null,
    })).filter((item: any) => item.price !== null)

    const validCloses = closes.filter((c: any) => c !== null)
    const price = validCloses[validCloses.length - 1] || 0
    
    // MA60 always calculated if possible
    const last60 = validCloses.slice(-60)
    const ma60 = last60.length > 0 
      ? last60.reduce((s: number, c: number) => s + c, 0) / last60.length 
      : price

    const yahooName = result.meta.longName || result.meta.shortName || result.meta.symbol
    const name = getStockName(symbol, yahooName)

    return NextResponse.json({
      symbol: result.meta.symbol,
      price: Math.round(price * 100) / 100,
      ma60: Math.round(ma60 * 100) / 100,
      name: name,
      history: history
    })
  } catch (err) {
    console.error('Error fetching stock info:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
