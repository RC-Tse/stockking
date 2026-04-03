import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 台灣證交所與櫃買中心 API 網址
const TWSE_API = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_API = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')?.toUpperCase().trim()
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  const supabase = await createClient()

  // 1. 先查 Supabase 快取
  const { data: cached } = await supabase
    .from('stock_names')
    .select('name_zh')
    .eq('symbol', symbol)
    .single()

  if (cached?.name_zh) {
    return NextResponse.json({ symbol, name_zh: cached.name_zh })
  }

  // 2. 快取沒有，呼叫官方 API
  const code = symbol.replace('.TW', '').replace('.TWO', '')
  let name_zh = ''

  try {
    if (symbol.endsWith('.TW') || !symbol.includes('.')) {
      // 嘗試從上市 API 抓取
      const res = await fetch(TWSE_API, { next: { revalidate: 86400 } })
      if (res.ok) {
        const list = await res.json()
        const item = list.find((i: any) => i.Code === code)
        if (item) name_zh = item.Name
      }
    }

    if (!name_zh && (symbol.endsWith('.TWO') || !symbol.includes('.'))) {
      // 嘗試從上櫃 API 抓取
      const res = await fetch(TPEX_API, { next: { revalidate: 86400 } })
      if (res.ok) {
        const list = await res.json()
        const item = list.find((i: any) => i.SecumId === code)
        if (item) name_zh = item.CompanyName
      }
    }

    if (name_zh) {
      // 3. 存入快取
      await supabase.from('stock_names').upsert({
        symbol,
        name_zh,
        updated_at: new Date().toISOString()
      })
      return NextResponse.json({ symbol, name_zh })
    }
  } catch (err) {
    console.error('Fetch stock name error:', err)
  }

  return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
}
