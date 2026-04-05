import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import { getStockName } from '@/types'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const start_date = req.nextUrl.searchParams.get('start_date')
  const end_date = req.nextUrl.searchParams.get('end_date')

  if (!start_date || !end_date) {
    return NextResponse.json({ error: 'Missing date range' }, { status: 400 })
  }

  // Fetch all transactions to ensure FIFO works correctly from beginning of history
  const { data: allTxs, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: true })
    .order('id', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Filter for the specific period for first two sheets
  const filteredTxs = allTxs.filter(t => t.trade_date >= start_date && t.trade_date <= end_date)

  // Sheet 1: 手動交易
  const selfTxs = filteredTxs.filter(t => t.trade_type !== 'DCA').map(t => ({
    '日期': t.trade_date,
    '股票代碼': t.symbol,
    '中文名稱': t.name_zh || getStockName(t.symbol),
    '動作': t.action === 'BUY' ? '買入' : '賣出',
    '整張/零股': t.shares % 1000 === 0 ? '整張' : '零股',
    '股數': t.shares,
    '成交價': t.price,
    '交易金額': t.amount,
    '手續費': t.fee,
    '交易稅': t.tax,
    '淨收支': t.net_amount,
    '備註': t.note || ''
  }))

  // Sheet 2: 定期定額
  const dcaTxs = filteredTxs.filter(t => t.trade_type === 'DCA').map(t => ({
    '日期': t.trade_date,
    '股票代碼': t.symbol,
    '中文名稱': t.name_zh || getStockName(t.symbol),
    '申購金額': Math.abs(t.net_amount),
    '買入股數': t.shares,
    '成交價': t.price,
    '手續費': t.fee,
    '淨收支': t.net_amount
  }))

  // Sheet 3: 庫存匯總 (Based on total history)
  const inventory: Record<string, { shares: number, cost: number }[]> = {}
  const stats: Record<string, { buyCost: number, sellRev: number }> = {}

  for (const t of allTxs) {
    if (!inventory[t.symbol]) inventory[t.symbol] = []
    if (!stats[t.symbol]) stats[t.symbol] = { buyCost: 0, sellRev: 0 }
    
    if (t.action === 'BUY' || t.action === 'DCA') {
      const cost = t.amount + t.fee
      inventory[t.symbol].push({ shares: t.shares, cost })
      stats[t.symbol].buyCost += cost
    } else {
      stats[t.symbol].sellRev += t.net_amount
      let rem = t.shares
      while (rem > 0 && inventory[t.symbol].length > 0) {
        const lot = inventory[t.symbol][0]
        if (lot.shares <= rem) {
          rem -= lot.shares
          inventory[t.symbol].shift()
        } else {
          const u = lot.cost / lot.shares
          lot.shares -= rem
          lot.cost -= rem * u
          rem = 0
        }
      }
    }
  }

  // Fetch current quotes for MV (simplified for export - using last known price)
  const summary = Object.keys(stats).map(sym => {
    const s = stats[sym]
    const currentLots = inventory[sym]
    const heldShares = currentLots.reduce((sum, l) => sum + l.shares, 0)
    const heldCost = currentLots.reduce((sum, l) => sum + l.cost, 0)
    const lastTx = allTxs.filter(t => t.symbol === sym).pop()
    const lastPrice = lastTx?.price || 0
    const mv = Math.round(heldShares * lastPrice)

    return {
      '股票代碼': sym,
      '中文名稱': getStockName(sym),
      '買入總成本': Math.round(s.buyCost),
      '賣出總收入': Math.round(s.sellRev),
      '已實現損益': Math.round(s.sellRev - (s.buyCost - heldCost)),
      '目前持股數': heldShares,
      '目前市值估算': mv,
      '未實現損益估算': Math.round(mv - heldCost)
    }
  })

  // Create Workbook
  const wb = XLSX.utils.book_new()
  
  const ws1 = XLSX.utils.json_to_sheet(selfTxs)
  XLSX.utils.book_append_sheet(wb, ws1, '手動交易')
  
  const ws2 = XLSX.utils.json_to_sheet(dcaTxs)
  XLSX.utils.book_append_sheet(wb, ws2, '定期定額')
  
  const ws3 = XLSX.utils.json_to_sheet(summary)
  XLSX.utils.book_append_sheet(wb, ws3, '庫存匯總')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="export.xlsx"`
    }
  })
}
