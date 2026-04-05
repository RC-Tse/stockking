import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import { calcFee, calcTax, getStockName, codeOnly } from '@/types'

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

  // Sheet 1: ?ªè?äº¤æ?
  const selfTxs = filteredTxs.filter(t => t.trade_type !== 'DCA').map(t => ({
    '?¥æ?': t.trade_date,
    '?¡ç¥¨ä»??': t.symbol,
    'ä¸­æ??ç¨±': t.name_zh || getStockName(t.symbol),
    'è²?è³?: t.action === 'BUY' ? 'è²·å…¥' : 'è³?‡º',
    '?´å¼µ/?¶è‚¡': t.shares % 1000 === 0 ? '?´å¼µ' : '?¶è‚¡',
    '?¡æ•¸': t.shares,
    '?äº¤??: t.price,
    'äº¤æ??‘é?': t.amount,
    '?‹ç?è²?: t.fee,
    'äº¤æ?ç¨?: t.tax,
    'æ·¨æ”¶??: t.net_amount,
    '?™è¨»': t.note || ''
  }))

  // Sheet 2: å®šæ?å®šé?
  const dcaTxs = filteredTxs.filter(t => t.trade_type === 'DCA').map(t => ({
    '?¥æ?': t.trade_date,
    '?¡ç¥¨ä»??': t.symbol,
    'ä¸­æ??ç¨±': t.name_zh || getStockName(t.symbol),
    '?³è³¼?‘é?': Math.abs(t.net_amount),
    'è²·å…¥?¡æ•¸': t.shares,
    '?äº¤??: t.price,
    '?‹ç?è²?: t.fee,
    'æ·¨æ”¶??: t.net_amount
  }))

  // Sheet 3: ?ç??˜è? (Based on total history)
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
      '?¡ç¥¨ä»??': sym,
      'ä¸­æ??ç¨±': getStockName(sym),
      'è²·å…¥ç¸½æ???: Math.round(s.buyCost),
      'è³?‡ºç¸½æ”¶??: Math.round(s.sellRev),
      'å·²å¯¦?¾æ???: Math.round(s.sellRev - (s.buyCost - heldCost)),
      '?®å??è‚¡??: heldShares,
      '?®å?å¸‚å€??ƒè€?': mv,
      '?ªå¯¦?¾æ????ƒè€?': Math.round(mv - heldCost)
    }
  })

  // Create Workbook
  const wb = XLSX.utils.book_new()
  
  const ws1 = XLSX.utils.json_to_sheet(selfTxs)
  XLSX.utils.book_append_sheet(wb, ws1, '?ªè?äº¤æ?')
  
  const ws2 = XLSX.utils.json_to_sheet(dcaTxs)
  XLSX.utils.book_append_sheet(wb, ws2, 'å®šæ?å®šé?')
  
  const ws3 = XLSX.utils.json_to_sheet(summary)
  XLSX.utils.book_append_sheet(wb, ws3, '?ç??˜è?')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="export.xlsx"`
    }
  })
}
