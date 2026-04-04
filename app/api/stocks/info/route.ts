import { NextRequest, NextResponse } from 'next/server'
import { getStockName } from '@/types'

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  try {
    // Fetch 3 months of data to calculate 60-day MA
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=4mo`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    
    const data = await res.json()
    const result = data.chart?.result?.[0]
    
    if (!result) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
    }

    const quotes = result.indicators?.quote?.[0]
    const closes = quotes?.close || []
    const validCloses = closes.filter((c: any) => c !== null)
    
    const price = validCloses[validCloses.length - 1] || 0
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
    })
  } catch (err) {
    console.error('Error fetching stock info:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
