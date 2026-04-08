import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  Transaction, Quote, UserSettings, DEFAULT_SETTINGS, 
  calcFee, calcTax, CalendarEntry 
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

  // Optimization: Pre-process transactions into a Map for O(1) daily lookup
  const txMap = new Map<string, Transaction[]>()
  for (const t of txs) {
    if (!txMap.has(t.trade_date)) txMap.set(t.trade_date, [])
    txMap.get(t.trade_date)!.push(t)
  }

  // 2. Determine date range for replay
  const startDate = new Date(txs[0].trade_date)
  const endDate = new Date(year, month, 0)
  
  // 3. FIFO Engine with Remainder Fix
  const inventory: Record<string, { 
    shares: number; 
    origPrincipal: number; 
    origFee: number; 
    matchedCost: number; 
  }[]> = {}

  const results: Record<string, CalendarEntry> = {}
  
  let prevMV = 0
  let prevTotalCost = 0
  let hasPrevHistory = false

  const cur = new Date(startDate)
  const origin = new URL(request.url).origin

  while (cur <= endDate) {
    const dateStr = cur.toISOString().split('T')[0]
    const txsToday = txMap.get(dateStr) || []
    
    let realizedToday = 0
    let costChangeToday = 0

    for (const tx of txsToday) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        lots.push({ shares: tx.shares, origPrincipal: tx.amount, origFee: f, matchedCost: 0 })
        costChangeToday += (tx.amount + f)
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
        realizedToday += (Math.floor(tx.amount - sellFee - sellTax) - matchedCostTotal)
        costChangeToday -= matchedCostTotal
      }
    }

    // Daily Market Valuation
    let curTotalMV = 0
    let curTotalCost = 0
    
    const heldSymbols = []
    for (const s in inventory) {
        const sSum = inventory[s].reduce((acc, l) => acc + l.shares, 0)
        if (sSum > 0) heldSymbols.push(s)
    }
    
    if (heldSymbols.length > 0) {
      // NOTE: We only fetch if it's potentially a trading day or if we are in the target month
      // This is a trade-off between absolute precision for every historical day vs speed.
      // For this app, we need history for PnL calculation.
      const isTargetMonth = cur.getFullYear() === year && (cur.getMonth() + 1) === month
      
      const qRes = await fetch(`${origin}/api/stocks?symbols=${heldSymbols.join(',')}&date=${dateStr}`)
      if (qRes.ok) {
        const quotes: Record<string, Quote> = await qRes.json()
        for (const sym of heldSymbols) {
          const q = quotes[sym]
          const price = q?.bid_price || q?.price || 0
          const shares = inventory[sym].reduce((sum, l) => sum + l.shares, 0)
          const mv = Math.floor(price * shares)
          curTotalMV += (mv - calcFee(mv, settings, true) - calcTax(mv, sym, settings))
          curTotalCost += inventory[sym].reduce((sum, l) => sum + (l.origPrincipal + l.origFee - l.matchedCost), 0)
        }
      } else {
          // If fetch fails (holiday etc), MV stays same as yesterday
          curTotalMV = prevMV
          curTotalCost = prevTotalCost
      }
    }

    let daily_pnl = 0
    if (!hasPrevHistory) {
      if (curTotalCost > 0 || txsToday.length > 0) {
         daily_pnl = curTotalMV - curTotalCost
         hasPrevHistory = true
      }
    } else {
      daily_pnl = (curTotalMV - prevMV) - costChangeToday + realizedToday
    }

    if (cur.getFullYear() === year && (cur.getMonth() + 1) === month) {
      results[dateStr] = {
        entry_date: dateStr,
        pnl: curTotalMV - curTotalCost,
        pnl_pct: curTotalCost ? (curTotalMV - curTotalCost) / curTotalCost * 100 : 0,
        realized_pnl: realizedToday,
        daily_pnl: daily_pnl,
        daily_pnl_pct: prevMV || curTotalCost ? daily_pnl / (prevMV || curTotalCost) * 100 : 0,
        net_market_value: curTotalMV,
        note: txsToday.find(t => t.note)?.note || ''
      } as CalendarEntry
    }

    prevMV = curTotalMV
    prevTotalCost = curTotalCost
    cur.setDate(cur.getDate() + 1)
  }

  return NextResponse.json(Object.values(results))
}
