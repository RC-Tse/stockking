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

  // 2. Determine date range for replay
  const firstTxDate = txs[0].trade_date
  const startDate = new Date(firstTxDate)
  const lastDayOfMonth = new Date(year, month, 0)
  
  // To calculate day-over-day, we need to loop from the very first transaction up to the target month's end
  const endDate = lastDayOfMonth
  
  // 3. FIFO Engine with Remainder Fix (Cost Accumulator)
  const inventory: Record<string, { 
    shares: number; 
    origPrincipal: number; 
    origFee: number; 
    matchedCost: number; // Tracker for total matched cost to avoid rounding errors on final sell
  }[]> = {}

  const results: Record<string, CalendarEntry> = {}
  
  let prevMV = 0
  let prevTotalCost = 0
  let hasPrevHistory = false

  // We loop day by day from startDate to endDate
  const cur = new Date(startDate)
  while (cur <= endDate) {
    const dateStr = cur.toISOString().split('T')[0]
    const txsToday = txs.filter(t => t.trade_date === dateStr)
    
    let realizedToday = 0
    let costChangeToday = 0

    for (const tx of txsToday) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        lots.push({ 
          shares: tx.shares, 
          origPrincipal: tx.amount, 
          origFee: f, 
          matchedCost: 0 
        })
        costChangeToday += (tx.amount + f)
      } else if (tx.action === 'SELL') {
        const sellShares = tx.shares
        let rem = sellShares
        let matchedCostTotal = 0

        while (rem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, rem)
          
          let lotMatchedCost = 0
          const originalTotalLotCost = lot.origPrincipal + lot.origFee

          if (take === lot.shares) {
            // Remainder Fix: If fully selling this lot, matched cost is exactly the remainder of original cost
            lotMatchedCost = originalTotalLotCost - lot.matchedCost
            lots.shift()
          } else {
            // Proportional cost for partial sell
            const ratio = take / lot.shares
            lotMatchedCost = Math.floor((lot.origPrincipal + lot.origFee - lot.matchedCost) * ratio)
            
            lot.shares -= take
            lot.matchedCost += lotMatchedCost
          }
          
          matchedCostTotal += lotMatchedCost
          rem -= take
        }

        const sellFee = calcFee(tx.amount, settings, true)
        const sellTax = calcTax(tx.amount, tx.symbol, settings)
        const netProceeds = Math.floor(tx.amount - sellFee - sellTax)
        
        realizedToday += (netProceeds - matchedCostTotal)
        costChangeToday -= matchedCostTotal
      }
    }

    // Daily Market Valuation
    let curTotalMV = 0
    let curTotalCost = 0
    
    // For valuation, we need quotes. For historical replay, we'd need historical quotes.
    // However, the user request targets specific dates with known prices.
    // We'll fetch quotes for all held symbols on this date.
    const heldSymbols = Object.keys(inventory).filter(s => inventory[s].reduce((sum, l) => sum + l.shares, 0) > 0)
    
    if (heldSymbols.length > 0) {
      // Mock historical prices for the target dates based on user requirements 
      // In a real app, this would be a lookup table or DB query
      // 12/10: 2330=500, 12/11: 2330=501, etc.
      // For this specific task, we will fetch from our stock API which supports historical dates
      const qRes = await fetch(`${new URL(request.url).origin}/api/stocks?symbols=${heldSymbols.join(',')}&date=${dateStr}`)
      if (qRes.ok) {
        const quotes: Record<string, Quote> = await qRes.json()
        for (const sym of heldSymbols) {
          const q = quotes[sym]
          const price = q?.bid_price || q?.price || 0
          const shares = inventory[sym].reduce((sum, l) => sum + l.shares, 0)
          const mv = Math.floor(price * shares)
          const sellFee = calcFee(mv, settings, true)
          const sellTax = calcTax(mv, sym, settings)
          const netMV = mv - sellFee - sellTax
          
          curTotalMV += netMV
          curTotalCost += inventory[sym].reduce((sum, l) => sum + (l.origPrincipal + l.origFee - l.matchedCost), 0)
        }
      }
    }

    // Calculation of Daily PnL
    let daily_pnl = 0
    if (!hasPrevHistory) {
      // Day 1: Daily_PnL = 今日總市值 - 今日總投入成本
      if (curTotalCost > 0 || txsToday.length > 0) {
         daily_pnl = curTotalMV - curTotalCost
         hasPrevHistory = true
      }
    } else {
      // Subsequent Days: Daily_PnL = (今日市值 - 昨日市值) - (今日成本變動) + 今日已實現
      daily_pnl = (curTotalMV - prevMV) - costChangeToday + realizedToday
    }

    // Only record if it's within the requested month
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
