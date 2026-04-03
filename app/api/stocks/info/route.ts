import { NextRequest, NextResponse } from 'next/server'
import { STOCK_NAMES } from '@/types'

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  // 優先從對照表找
  if (STOCK_NAMES[symbol]) {
    return NextResponse.json({
      symbol,
      name: STOCK_NAMES[symbol],
    })
  }

  try {
    if (!symbol.endsWith('.TW') && !symbol.endsWith('.TWO')) {
      return NextResponse.json({ error: 'Only Taiwan stocks supported' }, { status: 400 })
    }

    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`,
      { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    
    const data = await res.json()
    const result = data.quoteResponse?.result?.[0]
    
    // 確保抓到的是台股 (Yahoo 有時會回傳不同後綴的結果)
    if (!result || !result.symbol.includes('.TW')) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
    }

    return NextResponse.json({
      symbol: result.symbol,
      name: result.shortName || result.longName || result.symbol,
    })
  } catch (err) {
    console.error('Error fetching stock info:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
