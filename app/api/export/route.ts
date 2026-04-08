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

  // Fetch settings for fee/tax calculation
  const { data: sr } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  const settings: any = sr || { buy_fee_rate: 0.001425, buy_discount: 0.285, sell_fee_rate: 0.001425, sell_discount: 0.285, dca_fee_min: 1, tax_stock: 0.003, tax_etf: 0.001 }

  const buildExportTx = (t: any) => {
    const isDca = t.trade_type === 'DCA' || t.action === 'DCA'
    const f = Math.max(isDca ? settings.dca_fee_min : 1, Math.floor(t.amount * (t.action === 'SELL' ? settings.sell_fee_rate * settings.sell_discount : settings.buy_fee_rate * settings.buy_discount)))
    const taxRate = t.symbol.replace('.TW','').replace('.TWO','').startsWith('00') ? settings.tax_etf : settings.tax_stock
    const tax = t.action === 'SELL' ? Math.floor(t.amount * taxRate) : 0
    const net = t.action === 'SELL' ? Math.floor(t.amount - f - tax) : -Math.floor(t.amount + f)
    return { f, tax, net }
  }

  // Sheet 1: 手動交易
  const selfTxs = filteredTxs.filter(t => t.trade_type !== 'DCA').map(t => {
    const { f, tax, net } = buildExportTx(t)
    return {
      '日期': t.trade_date,
      '股票代碼': t.symbol,
      '中文名稱': t.name_zh || getStockName(t.symbol),
      '動作': t.action === 'BUY' ? '買入' : '賣出',
      '整張/零股': t.shares % 1000 === 0 ? '整張' : '零股',
      '股數': t.shares,
      '成交價': t.price,
      '交易金額': Math.floor(t.amount),
      '手續費': f,
      '交易稅': tax,
      '淨收支': net,
      '備註': t.note || ''
    }
  })

  // Sheet 2: 定期定額
  const dcaTxs = filteredTxs.filter(t => t.trade_type === 'DCA').map(t => {
    const { f, net } = buildExportTx(t)
    return {
      '日期': t.trade_date,
      '股票代碼': t.symbol,
      '中文名稱': t.name_zh || getStockName(t.symbol),
      '申購金額': Math.abs(net),
      '買入股數': t.shares,
      '成交價': t.price,
      '手續費': f,
      '淨收支': net
    }
  })

  // Sheet 3: 庫存匯總 (Based on total history)
  const inventory: Record<string, { shares: number, cost: number }[]> = {}
  const stats: Record<string, { buyCost: number, sellRev: number }> = {}

  for (const t of allTxs) {
    if (!inventory[t.symbol]) inventory[t.symbol] = []
    if (!stats[t.symbol]) stats[t.symbol] = { buyCost: 0, sellRev: 0 }
    
    if (t.action === 'BUY' || t.action === 'DCA') {
      const isDca = t.trade_type === 'DCA' || t.action === 'DCA'
      const f = Math.max(isDca ? settings.dca_fee_min : 1, Math.floor(t.amount * (settings.buy_fee_rate * settings.buy_discount)))
      const cost = Math.floor(t.amount + f)
      inventory[t.symbol].push({ shares: t.shares, cost })
      stats[t.symbol].buyCost += cost
    } else {
      const f = Math.max(1, Math.floor(t.amount * (settings.sell_fee_rate * settings.sell_discount)))
      const taxRate = t.symbol.replace('.TW','').replace('.TWO','').startsWith('00') ? settings.tax_etf : settings.tax_stock
      const tax = Math.floor(t.amount * taxRate)
      const net = Math.floor(t.amount - f - tax)
      stats[t.symbol].sellRev += net
      
      let rem = t.shares
      while (rem > 0 && inventory[t.symbol].length > 0) {
        const lot = inventory[t.symbol][0]
        const take = Math.min(lot.shares, rem)
        const unit = lot.cost / lot.shares
        const pCost = Math.floor(take * unit)
        
        lot.shares -= take
        lot.cost -= pCost
        rem -= take
        if (lot.shares <= 0) inventory[t.symbol].shift()
      }
    }
  }

  // Fetch current quotes for MV (simplified for export - using last known price)
  const summary = Object.keys(stats).map(sym => {
    const s = stats[sym]
    const currentLots = inventory[sym]
    const heldShares = currentLots.reduce((sum, l) => sum + l.shares, 0)
    const heldCost = Math.floor(currentLots.reduce((sum, l) => sum + l.cost, 0))
    const lastTx = allTxs.filter(t => t.symbol === sym).pop()
    const lastPrice = lastTx?.price || 0
    const mv = Math.floor(heldShares * lastPrice)

    return {
      '股票代碼': sym,
      '中文名稱': getStockName(sym),
      '買入總成本': Math.floor(s.buyCost),
      '賣出總收入': Math.floor(s.sellRev),
      '已實現損益': Math.floor(s.sellRev - (s.buyCost - heldCost)),
      '目前持股數': heldShares,
      '目前市值估算': mv,
      '未實現損益估算': Math.floor(mv - heldCost)
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
