import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { refreshAllNames } from '@/lib/stockname-sync'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()

  // 處理 /api/stockname?symbol=...
  const symbol = searchParams.get('symbol')?.toUpperCase().trim()
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  let { data: cached } = await supabase
    .from('stock_names')
    .select('name_zh')
    .eq('symbol', symbol)
    .single()

  if (!cached) {
    // 沒快取就刷新一次全量
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

  // 真的找不到，依據要求不回傳符號作為備用的中文名稱，嚴格回傳 404
  return NextResponse.json({ error: 'Stock name not found' }, { status: 404 })
}
