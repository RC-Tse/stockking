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

  // 1. Try Cache First (daily_snapshots)
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
  
  const { data: cached } = await supabase
    .from('daily_snapshots')
    .select('*')
    .eq('user_id', user.id)
    .gte('snapshot_date', firstDay)
    .lte('snapshot_date', lastDay)
    .order('snapshot_date', { ascending: true })

  if (cached && cached.length >= new Date(year, month, 0).getDate()) {
    return NextResponse.json(cached.map(row => ({
      entry_date: row.snapshot_date,
      daily_pnl: Number(row.daily_pnl),
      daily_pnl_pct: Number(row.daily_pnl_pct),
      realized_pnl: Number(row.realized_pnl),
      pnl: Number(row.gross_mv - row.total_cost),
      pnl_pct: Number(row.total_cost) ? (Number(row.gross_mv - row.total_cost) / Number(row.total_cost) * 100) : 0,
      net_market_value: Number(row.gross_mv),
      details: row.daily_stock_list_json,
      hasTransactions: (row.daily_stock_list_json as any[]).some(d => d.has_tx_today) // Inferred
    })))
  }

  // 2. Fetch Transactions & Settings for calculation
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

  // 3. FIFO Master Loop
  const startDate = new Date(txs[0].trade_date)
  const endDate = new Date(year, month, 0)
  const inventory: Record<string, { shares: number; origPrincipal: number; origFee: number; matchedCost: number }[]> = {}
  const stockState: Record<string, { prevNetMV: number; prevCost: number }> = {}

  let prevTotalMV = 0
  let prevTotalCost = 0
  let hasPrevHistory = false
  const results: CalendarEntry[] = []
  const snapshotsToUpsert: any[] = []

  const cur = new Date(startDate)
  const origin = new URL(request.url).origin

  while (cur <= endDate) {
    const dateStr = cur.toISOString().split('T')[0]
    const txsToday = txMap.get(dateStr) || []
    
    let realizedToday = 0
    let costChangeToday = 0
    const stockContribution: Record<string, { costChange: number; realized: number }> = {}

    for (const tx of txsToday) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]
      if (!stockContribution[tx.symbol]) stockContribution[tx.symbol] = { costChange: 0, realized: 0 }

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        lots.push({ shares: tx.shares, origPrincipal: tx.amount, origFee: f, matchedCost: 0 })
        costChangeToday += (tx.amount + f)
        stockContribution[tx.symbol].costChange += (tx.amount + f)
      } else if (tx.action === 'SELL') {
        let rem = tx.shares
        let matchedCostTotal = 0
        while (rem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, rem)
          if (take === lot.shares) {
            matchedCostTotal += (lot.origPrincipal + lot.origFee - lot.matchedCost)
            lots.shift()
          } else {
            const lotMatched = Math.floor((lot.origPrincipal + lot.origFee - lot.matchedCost) * (take / lot.shares))
            lot.matchedCost += lotMatched
            lot.shares -= take
            matchedCostTotal += lotMatched
          }
          rem -= take
        }
        const sellFee = calcFee(tx.amount, settings, true), sellTax = calcTax(tx.amount, tx.symbol, settings)
        const pnl = Math.floor(tx.amount - sellFee - sellTax) - matchedCostTotal
        realizedToday += pnl
        stockContribution[tx.symbol].realized += pnl
        costChangeToday -= matchedCostTotal
        stockContribution[tx.symbol].costChange -= matchedCostTotal
      }
    }

    let curTotalMV = 0, curTotalCost = 0
    const details: any[] = []
    const heldSymbols = Object.keys(inventory).filter(s => inventory[s].reduce((a, l) => a + l.shares, 0) > 0)
    
    if (heldSymbols.length > 0) {
      const qRes = await fetch(`${origin}/api/stocks?symbols=${heldSymbols.join(',')}&date=${dateStr}`)
      const quotes = qRes.ok ? await qRes.json() : {}
      for (const sym of heldSymbols) {
        const q = quotes[sym], shares = inventory[sym].reduce((s, l) => s + l.shares, 0), price = q?.bid_price || q?.price || 0
        const mv = Math.floor(price * shares), fee = calcFee(mv, settings, true), tax = calcTax(mv, sym, settings)
        const netMV = mv - fee - tax, cost = inventory[sym].reduce((s, l) => s + (l.origPrincipal + l.origFee - l.matchedCost), 0)
        
        const prev = stockState[sym] || { prevNetMV: 0, prevCost: 0 }
        const contr = stockContribution[sym] || { costChange: 0, realized: 0 }
        const sPnl = !hasPrevHistory ? (netMV - cost) : ((netMV - prev.prevNetMV) - contr.costChange + contr.realized)
        
        curTotalMV += netMV; curTotalCost += cost
        details.push({
          symbol: sym, name: q?.name_zh || getStockName(sym), shares, price,
          change: q?.change || 0, change_pct: q?.change_pct || 0,
          cost, mv: netMV, stock_daily_pnl: sPnl,
          stock_daily_pnl_pct: (prev.prevNetMV || cost) ? (sPnl / (prev.prevNetMV || cost) * 100) : 0,
          has_tx_today: txsToday.some(t => t.symbol === sym)
        })
        stockState[sym] = { prevNetMV: netMV, prevCost: cost }
      }
    }

    let daily_pnl = !hasPrevHistory ? (curTotalMV - curTotalCost) : ((curTotalMV - prevTotalMV) - costChangeToday + realizedToday)
    if (!hasPrevHistory && (curTotalCost > 0 || txsToday.length > 0)) hasPrevHistory = true

    const isCurrentMonth = cur.getFullYear() === year && (cur.getMonth() + 1) === month
    if (isCurrentMonth) {
      const sortedDetails = details.sort((a, b) => b.cost - a.cost)
      results.push({
        entry_date: dateStr, daily_pnl, daily_pnl_pct: (prevTotalMV || curTotalCost) ? (daily_pnl / (prevTotalMV || curTotalCost) * 100) : 0,
        realized_pnl: realizedToday, pnl: curTotalMV - curTotalCost, pnl_pct: curTotalCost ? (curTotalMV - curTotalCost) / curTotalCost * 100 : 0,
        net_market_value: curTotalMV, note: txsToday.find(t => t.note)?.note || '', hasTransactions: txsToday.length > 0,
        details: sortedDetails
      })
      snapshotsToUpsert.push({
        user_id: user.id, snapshot_date: dateStr, gross_mv: curTotalMV, total_cost: curTotalCost,
        daily_pnl, daily_pnl_pct: (prevTotalMV || curTotalCost) ? (daily_pnl / (prevTotalMV || curTotalCost) * 100) : 0,
        realized_pnl: realizedToday, daily_stock_list_json: sortedDetails
      })
    }

    prevTotalMV = curTotalMV; prevTotalCost = curTotalCost
    cur.setDate(cur.getDate() + 1)
  }

  // Final Background Cache Save
  if (snapshotsToUpsert.length > 0) {
    supabase.from('daily_snapshots').upsert(snapshotsToUpsert).then(({error}) => { if(error) console.error('Snapshot error:', error) })
  }

  return NextResponse.json(results)
}
