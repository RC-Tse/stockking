import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  Transaction, Quote, UserSettings, DEFAULT_SETTINGS, 
  calcFee, calcTax, CalendarEntry, getStockName 
} from '@/types'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') || '0', 10)
  const month = parseInt(searchParams.get('month') || '0', 10)

  if (!year || !month) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Fetch Transactions & Settings
  const [txRes, setRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).order('trade_date', { ascending: true }).order('id', { ascending: true }),
    supabase.from('settings').select('*').eq('user_id', user.id).single()
  ])

  const txs: Transaction[] = txRes.data || []
  const settings: UserSettings = setRes.data || DEFAULT_SETTINGS
  if (txs.length === 0) return NextResponse.json([])

  const txMap = new Map<string, Transaction[]>()
  for (const t of txs) {
    if (!txMap.has(t.trade_date)) txMap.set(t.trade_date, [])
    txMap.get(t.trade_date)!.push(t)
  }

  // 2. Loop Setup
  const startDate = new Date(txs[0].trade_date)
  const endDate = new Date(year, month, 0)
  
  const inventory: Record<string, { shares: number; origPrincipal: number; origFee: number; matchedCost: number }[]> = {}
  const results: Record<string, CalendarEntry> = {}
  const origin = new URL(request.url).origin

  let prevTotalMV = 0
  let prevTotalCost = 0
  let hasPrevHistory = false
  
  // Track per-stock state to calculate daily deltas
  const stockState: Record<string, { prevNetMV: number; prevCost: number }> = {}

  const cur = new Date(startDate)
  while (cur <= endDate) {
    const dateStr = cur.toISOString().split('T')[0]
    const txsToday = txMap.get(dateStr) || []
    
    let realizedToday = 0
    let costChangeToday = 0
    const stockContributionToday: Record<string, { costChange: number; realized: number }> = {}

    // Process Transactions
    for (const tx of txsToday) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]
      if (!stockContributionToday[tx.symbol]) stockContributionToday[tx.symbol] = { costChange: 0, realized: 0 }

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        lots.push({ shares: tx.shares, origPrincipal: tx.amount, origFee: f, matchedCost: 0 })
        const inc = tx.amount + f
        costChangeToday += inc
        stockContributionToday[tx.symbol].costChange += inc
      } else if (tx.action === 'SELL') {
        let rem = tx.shares
        let matchedCostTotal = 0
        while (rem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, rem)
          let lotMatchedCost = 0
          const originalTotalLotCost = lot.origPrincipal + lot.origFee
          if (take === lot.shares) {
            lotMatchedCost = originalTotalLotCost - lot.matchedCost
            lots.shift()
          } else {
            const ratio = take / lot.shares
            lotMatchedCost = Math.floor((originalTotalLotCost - lot.matchedCost) * ratio)
            lot.shares -= take
            lot.matchedCost += lotMatchedCost
          }
          matchedCostTotal += lotMatchedCost
          rem -= take
        }
        const sellFee = calcFee(tx.amount, settings, true)
        const sellTax = calcTax(tx.amount, tx.symbol, settings)
        const pnl = Math.floor(tx.amount - sellFee - sellTax) - matchedCostTotal
        realizedToday += pnl
        stockContributionToday[tx.symbol].realized += pnl
        costChangeToday -= matchedCostTotal
        stockContributionToday[tx.symbol].costChange -= matchedCostTotal
      }
    }

    // Daily Market Valuation
    let curTotalMV = 0
    let curTotalCost = 0
    const details: any[] = []
    
    // We fetch quotes for all symbols ever held up to today to ensure delta calculation is correct
    const heldSymbols = Object.keys(inventory).filter(s => inventory[s].reduce((acc, l) => acc + l.shares, 0) > 0)
    
    if (heldSymbols.length > 0) {
      const qRes = await fetch(`${origin}/api/stocks?symbols=${heldSymbols.join(',')}&date=${dateStr}`)
      const quotes: Record<string, Quote> = qRes.ok ? await qRes.json() : {}

      for (const sym of heldSymbols) {
        const q = quotes[sym]
        const price = q?.bid_price || q?.price || 0
        const shares = inventory[sym].reduce((sum, l) => sum + l.shares, 0)
        const mv = Math.floor(price * shares)
        const sellFee = calcFee(mv, settings, true)
        const sellTax = calcTax(mv, sym, settings)
        const netMV = mv - sellFee - sellTax
        const cost = inventory[sym].reduce((sum, l) => sum + (l.origPrincipal + l.origFee - l.matchedCost), 0)
        
        const prev = stockState[sym] || { prevNetMV: 0, prevCost: 0 }
        const contr = stockContributionToday[sym] || { costChange: 0, realized: 0 }
        
        let stockDailyPnL = 0
        if (!hasPrevHistory) {
            stockDailyPnL = netMV - cost
        } else {
            stockDailyPnL = (netMV - prev.prevNetMV) - contr.costChange + contr.realized
        }
        
        curTotalMV += netMV
        curTotalCost += cost
        
        details.push({
          symbol: sym,
          name: q?.name_zh || getStockName(sym),
          shares: shares,
          price: price,
          change: q?.change || 0,
          change_pct: q?.change_pct || 0,
          cost: cost,
          mv: netMV,
          stock_daily_pnl: stockDailyPnL,
          stock_daily_pnl_pct: (prev.prevNetMV || cost) ? (stockDailyPnL / (prev.prevNetMV || cost) * 100) : 0
        })
        
        stockState[sym] = { prevNetMV: netMV, prevCost: cost }
      }
    }

    // Daily Aggregates
    let daily_pnl = 0
    if (!hasPrevHistory) {
      if (curTotalCost > 0 || txsToday.length > 0) {
         daily_pnl = curTotalMV - curTotalCost
         hasPrevHistory = true
      }
    } else {
      daily_pnl = (curTotalMV - prevTotalMV) - costChangeToday + realizedToday
    }

    // Record if in target month
    if (cur.getFullYear() === year && (cur.getMonth() + 1) === month) {
      results[dateStr] = {
        entry_date: dateStr,
        daily_pnl: daily_pnl,
        daily_pnl_pct: (prevTotalMV || curTotalCost) ? (daily_pnl / (prevTotalMV || curTotalCost) * 100) : 0,
        realized_pnl: realizedToday,
        pnl: curTotalMV - curTotalCost,
        pnl_pct: curTotalCost ? (curTotalMV - curTotalCost) / curTotalCost * 100 : 0,
        net_market_value: curTotalMV,
        note: txsToday.find(t => t.note)?.note || '',
        hasTransactions: txsToday.length > 0,
        details: details.sort((a,b) => b.cost - a.cost)
      } as CalendarEntry
    }

    prevTotalMV = curTotalMV
    prevTotalCost = curTotalCost
    cur.setDate(cur.getDate() + 1)
  }

  return NextResponse.json(Object.values(results))
}
