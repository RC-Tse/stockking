import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SETTINGS, UserSettings, STOCK_NAMES, calcFee, calcTax } from '@/types'

// ─── Fetch price history from Yahoo Finance ───────────────────────────────────
async function fetchHistory(symbol: string, startTs: number, endTs: number): Promise<Record<string, number> | null> {
  try {
    const period1 = startTs - 86400 * 14 // fetch 2 weeks before to get prev-day prices
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

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const year  = parseInt(url.searchParams.get('year')  || '')
  const month = parseInt(url.searchParams.get('month') || '')
  if (!year || !month) return NextResponse.json({ error: 'Missing date' }, { status: 400 })

  const [txsRes, setRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).order('trade_date', { ascending: true }),
    supabase.from('settings').select('*').eq('user_id', user.id).single(),
  ])

  const txs = txsRes.data
  const settings: UserSettings = { ...DEFAULT_SETTINGS, ...(setRes.data || {}) }
  if (!txs || txs.length === 0) return NextResponse.json([])

  // Replay from the very first transaction to today
  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const historyStartDate = txs[0].trade_date
  const replayEndDate   = `${year}-${String(month).padStart(2,'0')}-${String(lastDayOfMonth).padStart(2,'0')}`

  // Fetch price data for all symbols
  const startTs = Math.floor(new Date(historyStartDate).getTime() / 1000)
  const endTs   = Math.floor(new Date(replayEndDate).getTime()    / 1000) + 86400
  const symbols = Array.from(new Set(txs.map(t => t.symbol)))
  const histories: Record<string, Record<string, number>> = {}
  await Promise.all(symbols.map(async sym => {
    const h = await fetchHistory(sym, startTs, endTs)
    if (h) histories[sym] = h
  }))

  // ─── FIFO Inventory ───────────────────────────────────────────────────────
  // Each lot: { shares, origCost, allocatedCost }
  type Lot = { shares: number; origCost: number; allocatedCost: number }
  const inventory: Record<string, Lot[]> = {}

  // Price persistence: last known close price per symbol (handles weekends / holidays)
  const lastPrice: Record<string, number> = {}

  // Running totals carried across iterations
  let prevGrossMV   = 0  // yesterday's gross market value
  let prevCostBasis = 0  // yesterday's total cost basis

  const output: Record<string, any> = {}

  const startD = new Date(historyStartDate)
  const endD   = new Date(replayEndDate)

  for (let cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
    const date = cur.toISOString().split('T')[0]
    const isTargetMonth = date.startsWith(`${year}-${String(month).padStart(2,'0')}`)

    // ── 1. Process today's transactions ───────────────────────────────────
    const todaysTxs = txs.filter(t => t.trade_date === date)
    let realizedToday = 0

    for (const tx of todaysTxs) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const cost = Math.floor(Number(tx.amount)) + Math.floor(Number(tx.fee))
        lots.push({ shares: tx.shares, origCost: cost, allocatedCost: 0 })

      } else if (tx.action === 'SELL') {
        let rem = tx.shares
        const netPerShare = tx.net_amount / tx.shares

        while (rem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, rem)
          const remaining = lot.origCost - lot.allocatedCost

          // Final match: use exact remaining cost to eliminate rounding drift
          const costBasis = (take === lot.shares)
            ? remaining
            : Math.floor((take / lot.shares) * remaining)

          realizedToday += (netPerShare * take) - costBasis

          lot.shares        -= take
          lot.allocatedCost += costBasis
          rem               -= take
          if (lot.shares <= 0) lots.shift()
        }
      }
    }

    // ── 2. Update price cache ──────────────────────────────────────────────
    for (const sym of symbols) {
      const p = histories[sym]?.[date]
      if (p != null) lastPrice[sym] = p
    }

    // ── 3. Calculate end-of-day snapshot ─────────────────────────────────
    let curGrossMV   = 0
    let curNetMV     = 0
    let curCostBasis = 0
    const details: any[] = []

    for (const [sym, lots] of Object.entries(inventory)) {
      const shares = lots.reduce((s, l) => s + l.shares, 0)
      if (shares <= 0) continue

      const price = lastPrice[sym]
      if (price == null) continue  // no price data at all yet → skip

      const gross    = Math.floor(price * shares)
      const fee      = calcFee(gross, settings, true)
      const tax      = calcTax(gross, sym, settings)
      const net      = gross - fee - tax
      const costBasis = lots.reduce((s, l) => s + (l.origCost - l.allocatedCost), 0)

      curGrossMV   += gross
      curNetMV     += net
      curCostBasis += costBasis

      details.push({
        symbol: sym,
        name: STOCK_NAMES[sym] || sym,
        price,
        market_value: net,
        total_cost:   costBasis,
        pnl:          net - costBasis,
        shares,
      })
    }

    // ── 4. Daily PnL formula ───────────────────────────────────────────────
    // Organic daily PnL = market movement only (capital injection excluded)
    //
    //   Day 1  : gross_mv - cost_basis          (no yesterday to compare)
    //   Day N  : (gross_mv_today - gross_mv_yday) - (cost_today - cost_yday) + realized
    //
    let daily_pnl     = 0
    let daily_pnl_pct = 0

    if (prevCostBasis === 0 && curCostBasis > 0) {
      // ── FIRST DAY of history ──────────────────────────────────────────────
      // daily_pnl = actual market value - money invested
      // This equals: 6397 - 6417 = -20  ✓
      daily_pnl     = curGrossMV - curCostBasis
      daily_pnl_pct = curCostBasis > 0 ? (daily_pnl / curCostBasis * 100) : 0

    } else if (prevCostBasis > 0 && curCostBasis > 0) {
      // ── SUBSEQUENT DAYS ───────────────────────────────────────────────────
      const capitalInToday = curCostBasis - prevCostBasis
      daily_pnl     = (curGrossMV - prevGrossMV) - capitalInToday + realizedToday
      daily_pnl_pct = prevGrossMV > 0 ? (daily_pnl / prevGrossMV * 100) : 0
    }

    // ── 5. Record entry (target month only) ───────────────────────────────
    if (isTargetMonth) {
      const unrealized = curNetMV - curCostBasis
      const hasData    = Math.abs(daily_pnl) > 0.01 || Math.abs(realizedToday) > 0.01 || todaysTxs.length > 0

      if (hasData) {
        output[date] = {
          entry_date:      date,
          pnl:             Math.round(unrealized),
          realized_pnl:    Math.round(realizedToday),
          daily_pnl:       Math.round(daily_pnl),
          daily_pnl_pct:   Math.round(daily_pnl_pct * 100) / 100,
          net_market_value: Math.round(curNetMV),
          gross_market_value: curGrossMV,
          capital_in:      curCostBasis,
          details,
          note: todaysTxs.length > 0
            ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}`
            : '',
        }
      }
    }

    // ── 6. Carry forward for next iteration ──────────────────────────────
    prevGrossMV   = curGrossMV
    prevCostBasis = curCostBasis
  }

  return NextResponse.json(Object.values(output))
}
