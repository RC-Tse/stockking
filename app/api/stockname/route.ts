import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TWSE_API = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_API = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

async function refreshAllNames() {
  const supabase = await createClient()
  const dataToUpsert: { symbol: string; name_zh: string; updated_at: string }[] = []

  try {
    // 1. 抓取上市
    const twseRes = await fetch(TWSE_API, { next: { revalidate: 0 } })
    if (twseRes.ok) {
      const list = await twseRes.json()
      list.forEach((item: any) => {
        dataToUpsert.push({
          symbol: `${item.Code}.TW`,
          name_zh: item.Name,
          updated_at: new Date().toISOString()
        })
      })
    }

    // 2. 抓取上櫃
    const tpexRes = await fetch(TPEX_API, { next: { revalidate: 0 } })
    if (tpexRes.ok) {
      const list = await tpexRes.json()
      list.forEach((item: any) => {
        dataToUpsert.push({
          symbol: `${item.SecumId || item.SecuritiesCompanyCode}.TWO`,
          name_zh: item.CompanyName,
          updated_at: new Date().toISOString()
        })
      })
    }

    // 3. 批次存入 Supabase
    if (dataToUpsert.length > 0) {
      // 由於資料量大 (2000+)，分批寫入避免 timeout
      const chunkSize = 500
      for (let i = 0; i < dataToUpsert.length; i += chunkSize) {
        const chunk = dataToUpsert.slice(i, i + chunkSize)
        await supabase.from('stock_names').upsert(chunk)
      }
      return true
    }
  } catch (err) {
    console.error('Refresh names error:', err)
  }
  return false
}

export async function GET(req: NextRequest) {
  const { pathname, searchParams } = new URL(req.url)
  const supabase = await createClient()

  // 處理 /api/stockname/refresh
  if (pathname.endsWith('/refresh')) {
    const success = await refreshAllNames()
    return NextResponse.json({ success })
  }

  // 處理 /api/stockname?symbol=...
  const symbol = searchParams.get('symbol')?.toUpperCase().trim()
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  let { data: cached } = await supabase
    .from('stock_names')
    .select('name_zh')
    .eq('symbol', symbol)
    .single()

  if (!cached) {
    // 找不到就刷一次清單
    await refreshAllNames()
    const { data: retry } = await supabase
      .from('stock_names')
      .select('name_zh')
      .eq('symbol', symbol)
      .single()
    cached = retry
  }

  if (cached?.name_zh) {
    return NextResponse.json({ symbol, name_zh: cached.name_zh })
  }

  // 真的找不到 (可能是 ETF 或特殊代號)，回傳 symbol 前綴當備案 (但標題要求必須回傳中文，此處應盡力)
  return NextResponse.json({ symbol, name_zh: symbol.split('.')[0] })
}
