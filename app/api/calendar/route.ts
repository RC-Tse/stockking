import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Transaction, calcFee, calcTax, DEFAULT_SETTINGS, UserSettings, STOCK_NAMES } from '@/types'

async function fetchHistory(symbol: string, startTs: number, endTs: number) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startTs}&period2=${endTs}&interval=1d`
    const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return null
    const timestamps = result.timestamp || []
    const adjClose = result.indicators.adjclose?.[0]?.adjclose || result.indicators.quote[0].close || []
    const history: Record<string, number> = {}
    timestamps.forEach((ts: number, i: number) => {
      const date = new Date(ts * 1000).toISOString().split('T')[0]
      if (adjClose[i] !== null) history[date] = adjClose[i]
    })
    return history
  } catch (err) {
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

  const { data: txs } = await supabase.from('transactions')
    .select('*').eq('user_id', user.id).order('trade_date', { ascending: true })
  if (!txs || txs.length === 0) return NextResponse.json([])

  const startDate = txs[0].trade_date
  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86400

  const symbols = Array.from(new Set(txs.map(t => t.symbol)))
  const histories: Record<string, Record<string, number>> = {}
  await Promise.all(symbols.map(async (sym) => {
    const h = await fetchHistory(sym, startTs, endTs)
    if (h) histories[sym] = h
  }))

  const { data: sr } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  const settings: UserSettings = sr ?? DEFAULT_SETTINGS
  const dailyStats: Record<string, any> = {}
  const daysInMonth: string[] = []
  for (let d = 1; d <= lastDayOfMonth; d++) {
    daysInMonth.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }

  let currentHoldings: Record<string, { shares: number; cost: number }> = {}
  let prevUnrealizedPnlMap: Record<string, number> = {}
  let prevUnrealizedPnlTotal = 0
  let prevMarketValueTotal = 0

  const startD = new Date(startDate)
  const endD = new Date(endDate)
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().split('T')[0]
    const todaysTxs = txs.filter(t => t.trade_date === date)
    let realizedImpactTotal = 0
    let capitalInTotal = 0
    let realizedImpactMap: Record<string, number> = {}

    todaysTxs.forEach(tx => {
      if (!currentHoldings[tx.symbol]) currentHoldings[tx.symbol] = { shares: 0, cost: 0 }
      const h = currentHoldings[tx.symbol]
      if (tx.action === 'BUY' || tx.action === 'DCA') {
        h.shares += tx.shares
        h.cost += tx.amount + tx.fee
        capitalInTotal += tx.amount + tx.fee
      } else {
        const avgCost = h.shares > 0 ? h.cost / h.shares : 0
        const sellCost = tx.shares * avgCost
        h.shares -= tx.shares
        h.cost -= sellCost
        const pnl = (tx.net_amount + sellCost)
        realizedImpactTotal += pnl
        realizedImpactMap[tx.symbol] = (realizedImpactMap[tx.symbol] || 0) + pnl
      }
    })

    let currentUnrealizedPnlTotal = 0
    let currentMarketValueTotal = 0
    let hasPrice = false
    let details: any[] = []

    Object.entries(currentHoldings).forEach(([sym, h]) => {
      if (h.shares <= 0) return
      const price = histories[sym]?.[date]
      if (price !== undefined) {
        hasPrice = true
        const mv = h.shares * price
        const fee = calcFee(mv, settings, true)
        const tax = calcTax(mv, sym, settings)
        const unrealizedPnl = (mv - fee - tax - h.cost)
        
        currentMarketValueTotal += mv
        currentUnrealizedPnlTotal += unrealizedPnl

        // Calculate daily pnl for this specific stock
        const prevUnrealized = prevUnrealizedPnlMap[sym] || 0
        const realized = realizedImpactMap[sym] || 0
        const stockDailyPnl = (unrealizedPnl - prevUnrealized) + realized
        const stockDailyPnlPct = (h.cost > 0) ? (stockDailyPnl / h.cost) * 100 : 0

        details.push({
          symbol: sym,
          name: STOCK_NAMES[sym] || sym,
          price,
          pnl: Math.round(stockDailyPnl),
          pnl_pct: Math.round(stockDailyPnlPct * 100) / 100,
          shares: h.shares
        })
        
        prevUnrealizedPnlMap[sym] = unrealizedPnl
      }
    })

    if (hasPrice || todaysTxs.length > 0) {
      const dailyPnl = (currentUnrealizedPnlTotal - prevUnrealizedPnlTotal) + realizedImpactTotal
      const denominator = prevMarketValueTotal + capitalInTotal
      const dailyPnlPct = denominator > 0 ? (dailyPnl / denominator) * 100 : 0
      
      if (daysInMonth.includes(date)) {
        dailyStats[date] = { 
          entry_date: date,
          pnl: Math.round(dailyPnl),
          pnl_pct: Math.round(dailyPnlPct * 100) / 100,
          details,
          note: todaysTxs.length > 0 ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}` : ''
        }
      }
      if (hasPrice) {
        prevUnrealizedPnlTotal = currentUnrealizedPnlTotal
        prevMarketValueTotal = currentMarketValueTotal
      }
    }
  }

  return NextResponse.json(Object.values(dailyStats))
}
