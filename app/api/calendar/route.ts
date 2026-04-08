import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Transaction, DEFAULT_SETTINGS, UserSettings, STOCK_NAMES, calcFee, calcTax } from '@/types'

async function fetchHistory(symbol: string, startTs: number, endTs: number) {
  try {
    const period1 = startTs - 86400 * 7 
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${endTs}&interval=1d`
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
      if (adjClose[i] !== null && adjClose[i] !== undefined) {
        history[date] = adjClose[i]
      }
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

  const [txsRes, setRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id).order('trade_date', { ascending: true }),
    supabase.from('settings').select('*').eq('user_id', user.id).single()
  ])
  
  const txs = txsRes.data
  const settings: UserSettings = { ...DEFAULT_SETTINGS, ...(setRes.data || {}) }
  
  if (!txs || txs.length === 0) return NextResponse.json([])

  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const startDate = txs[0].trade_date
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86400

  const symbols = Array.from(new Set(txs.map(t => t.symbol)))
  const histories: Record<string, Record<string, number>> = {}
  await Promise.all(symbols.map(async (sym) => {
    const h = await fetchHistory(sym, startTs, endTs)
    if (h) histories[sym] = h
  }))

  const getPrevPrice = (sym: string, dateStr: string) => {
    const h = histories[sym]
    if (!h) return null
    const dates = Object.keys(h).filter(d => d < dateStr).sort()
    return dates.length > 0 ? h[dates[dates.length - 1]] : null
  }

  const dailyStats: Record<string, any> = {}
  const inventory: Record<string, { shares: number; orig_cost: number; allocated_cost: number }[]> = {}
  
  const startD = new Date(startDate)
  const endD = new Date(endDate)
  
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().split('T')[0]
    const isCurrentMonth = date.startsWith(`${year}-${String(month).padStart(2, '0')}`)
    
    const todaysTxs = txs.filter(t => t.trade_date === date)
    let dailyRealizedPnl = 0
    let capitalInToday = 0
    const boughtToday: Record<string, { shares: number, cost: number }> = {}

    todaysTxs.forEach(tx => {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        if (!boughtToday[tx.symbol]) boughtToday[tx.symbol] = { shares: 0, cost: 0 }
        const txTotalCost = Math.floor(Number(tx.amount) || 0) + Math.floor(Number(tx.fee) || 0)
        lots.push({ shares: tx.shares, orig_cost: txTotalCost, allocated_cost: 0 })
        capitalInToday += txTotalCost
      } else if (tx.action === 'SELL') {
        let sellRem = tx.shares
        const sellUnitNet = tx.net_amount / tx.shares
        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)
          
          let lotCostBasis = 0
          if (take === lot.shares) {
            // Final match for this lot: exact remaining cost
            lotCostBasis = lot.orig_cost - lot.allocated_cost
          } else {
            // Proportional match: floor to carry 1-yuan differences to the end
            lotCostBasis = Math.floor((take / lot.shares) * (lot.orig_cost - lot.allocated_cost))
          }
          
          const portionProfit = (sellUnitNet * take) - lotCostBasis
          dailyRealizedPnl += portionProfit
          
          sellRem -= take
          lot.allocated_cost += lotCostBasis
          lot.shares -= take
          
          if (lot.shares <= 0) lots.shift()
        }
      }
    })

    // 計算當日「持倉狀態」
    let totalGrossMV = 0
    let totalNetMV = 0
    let totalActualCost = 0
    const details: any[] = []

    const getNetVal = (p: number, sh: number, s: string) => {
      const gross = Math.floor(p * sh)
      const fee = calcFee(gross, settings, true)
      const tax = calcTax(gross, s, settings)
      return gross - fee - tax
    }

    const endOfDayHoldings: Record<string, number> = {}
    Object.entries(inventory).forEach(([sym, lots]) => {
      const total = lots.reduce((s, l) => s + l.shares, 0)
      if (total > 0) endOfDayHoldings[sym] = total
    })

    Object.entries(endOfDayHoldings).forEach(([sym, endShares]) => {
      const todayPrice = histories[sym]?.[date]
      if (todayPrice !== undefined && endShares > 0) {
        const grossMV = Math.floor(todayPrice * endShares)
        const netMV = getNetVal(todayPrice, endShares, sym)
        const costVal = inventory[sym].reduce((s, l) => s + (l.orig_cost - l.allocated_cost), 0)
        
        totalGrossMV += grossMV
        totalNetMV += netMV
        totalActualCost += costVal
        
        details.push({
          symbol: sym,
          name: STOCK_NAMES[sym] || sym,
          price: todayPrice,
          market_value: netMV,
          total_cost: costVal,
          pnl: netMV - costVal,
          shares: endShares
        })
      }
    })

    if (isCurrentMonth) {
      const unrealizedPnL = totalNetMV - totalActualCost
      const pnlPct = totalActualCost > 0 ? (unrealizedPnL / totalActualCost) * 100 : 0

      if (Math.abs(unrealizedPnL) > 0.01 || Math.abs(dailyRealizedPnl) > 0.01 || todaysTxs.length > 0) {
        dailyStats[date] = {
          entry_date: date,
          pnl: Math.round(unrealizedPnL),
          pnl_pct: Math.round(pnlPct * 100) / 100,
          realized_pnl: Math.round(dailyRealizedPnl),
          net_market_value: Math.round(totalNetMV),
          gross_market_value: totalGrossMV,
          capital_in: totalActualCost,
          details: details as any[],
          note: todaysTxs.length > 0 ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}` : ''
        }
      }
    }
  }

  return NextResponse.json(Object.values(dailyStats))
}
