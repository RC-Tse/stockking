import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SETTINGS, UserSettings, STOCK_NAMES } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function fetchHistory(symbol: string, startTs: number, endTs: number): Promise<Record<string, number> | null> {
  try {
    const period1 = startTs - 86400 * 14
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${endTs}&interval=1d`
    const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return null
    const timestamps: number[] = result.timestamp || []
    const closes: number[] = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || []
    const history: Record<string, number> = {}
    timestamps.forEach((ts, i) => {
      if (closes[i] != null) {
        history[new Date(ts * 1000).toISOString().split('T')[0]] = closes[i]
      }
    })
    return history
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const year = parseInt(url.searchParams.get('year') || '')
  const month = parseInt(url.searchParams.get('month') || '')
  if (!year || !month) return NextResponse.json({ error: 'Missing date' }, { status: 400 })

  const [txsRes, setRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).order('trade_date', { ascending: true }),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  const txs = txsRes.data || []
  if (txs.length === 0) return NextResponse.json([])

  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const historyStartDate = txs[0].trade_date
  const replayEndDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`

  const startTs = Math.floor(new Date(historyStartDate).getTime() / 1000)
  const endTs = Math.floor(new Date(replayEndDate).getTime() / 1000) + 86400
  const symbols = Array.from(new Set(txs.map(t => t.symbol)))
  const histories: Record<string, Record<string, number>> = {}
  await Promise.all(symbols.map(async sym => {
    const h = await fetchHistory(sym, startTs, endTs)
    if (h) histories[sym] = h
  }))

  // FIFO Lot Tracking
  type Lot = { shares: number; costBasis: number }
  const inventory: Record<string, Lot[]> = {}
  const lastPrice: Record<string, number> = {}

  let prevTotalMV = 0
  let prevTotalCost = 0
  const output: Record<string, any> = {}

  const startD = new Date(historyStartDate)
  const endD = new Date(replayEndDate)

  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().split('T')[0]
    const todaysTxs = txs.filter(t => t.trade_date === date)
    let realizedToday = 0

    // 1. Process Transactions
    for (const tx of todaysTxs) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        // Cost = Amount + Fee ( Principal + Buying Fee )
        const buyCost = Number(tx.amount || 0) + Number(tx.fee || 0)
        lots.push({ shares: tx.shares, costBasis: buyCost })
      } else if (tx.action === 'SELL') {
        let sharesToSell = tx.shares
        // Net Realized Calculation: Net Amount - FIFO Cost
        // Net Amount usually already has fees/tax deducted from brokerage output
        const netProceeds = Number(tx.net_amount || 0)
        let totalLotCost = 0

        while (sharesToSell > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sharesToSell)
          const lotCostTaken = (take === lot.shares) ? lot.costBasis : (lot.costBasis * (take / lot.shares))
          
          totalLotCost += lotCostTaken
          lot.shares -= take
          lot.costBasis -= lotCostTaken
          sharesToSell -= take
          if (lot.shares <= 0) lots.shift()
        }
        realizedToday += (netProceeds - totalLotCost)
      }
    }

    // 2. Update Prices
    for (const sym of symbols) {
      const p = histories[sym]?.[date]
      if (p != null) lastPrice[sym] = p
    }

    // 3. Snapshot
    let curTotalMV = 0
    let curTotalCost = 0
    const details = []

    for (const [sym, lots] of Object.entries(inventory)) {
      const shares = lots.reduce((acc, l) => acc + l.shares, 0)
      if (shares <= 0) continue

      const price = lastPrice[sym]
      if (price == null) continue

      const cost = lots.reduce((acc, l) => acc + l.costBasis, 0)
      const mv = Math.floor(price * shares)
      
      curTotalMV += mv
      curTotalCost += cost

      details.push({
        symbol: sym,
        name: STOCK_NAMES[sym] || sym,
        price,
        shares,
        total_cost: cost,
        market_value: mv,
        pnl: mv - cost,
        pnl_pct: cost > 0 ? ((mv - cost) / cost * 100) : 0
      })
    }

    // 4. Accounting Formulas
    let daily_pnl = 0
    let daily_pnl_pct = 0

    const hasPrevHistory = prevTotalCost > 0 || Object.values(output).length > 0
    
    // First Day Handling (Strict)
    if (!hasPrevHistory && curTotalCost > 0) {
      daily_pnl = curTotalMV - curTotalCost
      daily_pnl_pct = curTotalCost > 0 ? (daily_pnl / curTotalCost * 100) : 0
    } else if (hasPrevHistory) {
      // daily_pnl = (今日市值 - 昨日市值) - (今日成本變動) + 今日已實現
      const costChange = curTotalCost - prevTotalCost
      daily_pnl = (curTotalMV - prevTotalMV) - costChange + realizedToday
      daily_pnl_pct = prevTotalMV > 0 ? (daily_pnl / prevTotalMV * 100) : 0
    }

    // 5. Store result for target month
    if (date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
      const hasMeaningfulData = Math.abs(daily_pnl) > 0.1 || Math.abs(realizedToday) > 0.1 || todaysTxs.length > 0
      if (hasMeaningfulData) {
        output[date] = {
          entry_date: date,
          daily_pnl: Math.round(daily_pnl),
          daily_pnl_pct: Number(daily_pnl_pct.toFixed(2)),
          realized_pnl: Math.round(realizedToday),
          pnl: Math.round(curTotalMV - curTotalCost), // Unrecognized PnL for detail reference
          gross_market_value: curTotalMV,
          capital_in: curTotalCost,
          note: todaysTxs.length > 0 ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}` : '',
          details
        }
      }
    }

    prevTotalMV = curTotalMV
    prevTotalCost = curTotalCost
  }

  return NextResponse.json(Object.values(output))
}
