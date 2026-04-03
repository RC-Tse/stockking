import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    
    const data = await res.json()
    const result = data.quoteResponse?.result?.[0]
    
    if (!result) return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })

    return NextResponse.json({
      symbol: result.symbol,
      name: result.longName || result.shortName || result.symbol,
    })
  } catch (err) {
    console.error('Error fetching stock info:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
