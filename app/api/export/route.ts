import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import { getStockName, calcFee, calcTax } from '@/types'


export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const start_date = req.nextUrl.searchParams.get('start_date')
  const end_date = req.nextUrl.searchParams.get('end_date')
  const customFilename = req.nextUrl.searchParams.get('filename')

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

  // Fetch all stock names for accurate display
  const { data: cachedNames } = await supabase.from('stock_names').select('symbol, name_zh')
  const nameMap = Object.fromEntries(cachedNames?.map((n: any) => [n.symbol, n.name_zh]) || [])

  const getQuote = async (symbol: string) => {
    // Attempt to get quote from Yahoo in API
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }})
      if (!res.ok) return 0
      const data = await res.json()
      return data.chart?.result?.[0]?.meta?.regularMarketPrice || 0
    } catch { return 0 }
  }

  // Pre-fetch all current prices for active symbols
  const activeSymbols = Array.from(new Set(allTxs.map(t => t.symbol)))
  const quotes: Record<string, number> = {}
  await Promise.all(activeSymbols.map(async s => { quotes[s] = await getQuote(s) }))

  const buildExportTx = (t: any) => {
    const isDca = t.trade_type === 'DCA' || t.action === 'DCA'
    const f = calcFee(t.shares, t.price, settings, t.action === 'SELL', isDca)
    const tax = t.action === 'SELL' ? calcTax(t.shares, t.price, t.symbol, settings) : 0
    const net = t.action === 'SELL' ? Math.floor(t.amount - f - tax) : -Math.floor(t.amount + f)
    return { f, tax, net }
  }


  // 1. Prepare Transaction Pair Details (FIFO) for Sheet 2
  const txPairs: any[] = []
  const inventory: Record<string, { date: string, shares: number, price: number, fee: number }[]> = {}

  for (const t of allTxs) {
    if (!inventory[t.symbol]) inventory[t.symbol] = []
    const isBuy = t.action === 'BUY' || t.action === 'DCA'
    const { f, tax, net } = buildExportTx(t)

    if (isBuy) {
      inventory[t.symbol].push({ date: t.trade_date, shares: t.shares, price: t.price, fee: f })
    } else {
      let rem = t.shares
      while (rem > 0 && inventory[t.symbol].length > 0) {
        const lot = inventory[t.symbol][0]
        const take = Math.min(lot.shares, rem)
        
        const ratio = take / lot.shares
        const matchedPrincipal = Math.floor(lot.price * lot.shares * ratio)
        const matchedBuyFee = Math.floor(lot.fee * ratio)
        const matchedCost = matchedPrincipal + matchedBuyFee

        
        // Single match sell revenue
        const sellRatio = take / t.shares
        const matchedSellRev = Math.floor(t.price * t.shares * sellRatio)
        const matchedSellFee = Math.floor(f * sellRatio)
        const matchedSellTax = Math.floor(tax * sellRatio)
        const matchedIncome = matchedSellRev - matchedSellFee - matchedSellTax
        
        const profit = matchedIncome - matchedCost

        if (t.trade_date >= start_date && t.trade_date <= end_date) {
            txPairs.push({
              '買進日': lot.date,
              '賣出日': t.trade_date,
              '名稱': nameMap[t.symbol] || t.name_zh || getStockName(t.symbol),
              '代碼': t.symbol.replace('.TW','').replace('.TWO',''),
              '股數': take,
              '買單價': lot.price,
              '賣單價': t.price,
              '付出成本': matchedCost,
              '帳面收入': matchedIncome,
              '已實現損益': profit,
              '報酬率': `${(profit / matchedCost * 100).toFixed(2)}%`,
              '交易稅': matchedSellTax,
              '手續費': matchedBuyFee + matchedSellFee,
              '定期定額': t.action === 'DCA' ? '是' : ''
            })
        }

        lot.shares -= take
        lot.fee -= matchedBuyFee
        rem -= take
        if (lot.shares <= 0) inventory[t.symbol].shift()
      }
    }
  }

  // 2. Prepare Inventory Summary for Sheet 1
  const activeHoldings: any[] = []
  const inactiveHoldings: any[] = []

  const allSymbolsSet = Array.from(new Set(allTxs.map(t => t.symbol)))
  allSymbolsSet.forEach(sym => {
    const lots = inventory[sym] || []
    const heldShares = lots.reduce((s, l) => s + l.shares, 0)
    const heldCost = lots.reduce((s, l) => s + (l.price * l.shares + l.fee), 0)
    const cp = quotes[sym] || 0
    const mv = Math.floor(heldShares * cp)
    
    // Estimated sell fees/tax
    const s_fee = Math.max(1, Math.floor(heldShares * cp * settings.sell_fee_rate * settings.sell_discount))
    const taxRate = sym.replace('.TW','').replace('.TWO','').startsWith('00') ? settings.tax_etf : settings.tax_stock
    const s_tax = Math.floor(heldShares * cp * taxRate)
    const net_mv = mv - s_fee - s_tax
    const unrealized = net_mv - heldCost

    const row = {
      '名稱': nameMap[sym] || getStockName(sym),
      '代碼': sym.replace('.TW','').replace('.TWO',''),
      '股數': heldShares,
      '持有成本': Math.floor(heldCost),
      '成交均價': heldShares > 0 ? (heldCost / heldShares).toFixed(2) : '0',
      '現價': cp.toFixed(2),
      '股票現值': mv,
      '預估賣出手續費': s_fee,
      '預估賣出交易稅': s_tax,
      '未實現損益': Math.floor(unrealized),
      '預估報酬率': heldCost > 0 ? `${(unrealized / heldCost * 100).toFixed(2)}%` : '0%',
      '幣別': '台幣'
    }

    if (heldShares > 0) activeHoldings.push(row)
    else {
        // Find total realized for closed
        let realized = 0
        allTxs.filter(t => t.symbol === sym && t.action === 'SELL').forEach(t => {
            // Simplified realized for summary sheet
        })
        // Inactive list usually excludes currently held ones but shows the history if needed.
        // The user says Sheet 1: --- 手上持有 --- and --- 已結清 ---
        // For inactive, we only show those with 0 shares.
        inactiveHoldings.push({
             ...row,
             '股數': 0,
             '持有成本': 0,
             '股票現值': 0,
             '未實現損益': 0,
             '預估報酬率': '-'
        })
    }
  })

  const summaryRows = [
    { '名稱': '--- 手上持有 ---' },
    ...activeHoldings,
    { '名稱': '' },
    { '名稱': '--- 已結清 ---' },
    ...inactiveHoldings
  ]

  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.json_to_sheet(summaryRows)
  XLSX.utils.book_append_sheet(wb, ws1, '庫存彙總')
  
  const ws2 = XLSX.utils.json_to_sheet(txPairs)
  XLSX.utils.book_append_sheet(wb, ws2, '交易明細')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
    }
  })

}
