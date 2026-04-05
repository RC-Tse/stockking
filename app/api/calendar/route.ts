import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Transaction, DEFAULT_SETTINGS, UserSettings, STOCK_NAMES } from '@/types'

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

  const { data: txs } = await supabase.from('transactions')
    .select('*').eq('user_id', user.id).order('trade_date', { ascending: true })
  
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
  const inventory: Record<string, { shares: number; unitCost: number }[]> = {}
  
  const startD = new Date(startDate)
  const endD = new Date(endDate)
  
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().split('T')[0]
    const isCurrentMonth = date.startsWith(`${year}-${String(month).padStart(2, '0')}`)
    
    // 記錄今日開盤持股 (用於計算原本部位的市值變動)
    const startOfDayHoldings: Record<string, number> = {}
    Object.entries(inventory).forEach(([sym, lots]) => {
      const total = lots.reduce((s, l) => s + l.shares, 0)
      if (total > 0) startOfDayHoldings[sym] = total
    })

    const todaysTxs = txs.filter(t => t.trade_date === date)
    let dailyRealizedPnl = 0
    let dailyMarketPnl = 0
    let capitalInToday = 0
    const boughtToday: Record<string, { shares: number, cost: number }> = {}
    const soldToday: Record<string, number> = {}

    todaysTxs.forEach(tx => {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const unitCost = (tx.amount + tx.fee) / tx.shares
        lots.push({ shares: tx.shares, unitCost })
        capitalInToday += (tx.amount + tx.fee)
        if (!boughtToday[tx.symbol]) boughtToday[tx.symbol] = { shares: 0, cost: 0 }
        boughtToday[tx.symbol].shares += tx.shares
        boughtToday[tx.symbol].cost += (tx.amount + tx.fee)
      } else if (tx.action === 'SELL') {
        soldToday[tx.symbol] = (soldToday[tx.symbol] || 0) + tx.shares
        let sellRem = tx.shares
        const sellUnitNet = tx.net_amount / tx.shares
        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)
          dailyRealizedPnl += (sellUnitNet - lot.unitCost) * take
          sellRem -= take
          lot.shares -= take
          if (lot.shares <= 0) lots.shift()
        }
      }
    })

    // 計算當日市值變動 (基於收盤持股)
    const details: any[] = []
    const endOfDayHoldings: Record<string, number> = {}
    Object.entries(inventory).forEach(([sym, lots]) => {
      const total = lots.reduce((s, l) => s + l.shares, 0)
      if (total > 0) endOfDayHoldings[sym] = total
    })

    Object.entries(endOfDayHoldings).forEach(([sym, endShares]) => {
      const todayPrice = histories[sym]?.[date]
      const yesterdayPrice = getPrevPrice(sym, date)
      if (todayPrice === undefined) return

      const bought = boughtToday[sym] || { shares: 0, cost: 0 }
      const originalSharesInEnd = Math.max(0, endShares - bought.shares)
      
      let stockPnl = 0
      // 1. 原本持有部分的損益 (以昨日收盤價計)
      if (yesterdayPrice !== null) {
        stockPnl += originalSharesInEnd * (todayPrice - yesterdayPrice)
      }
      // 2. 今日買入部分的損益 (以買入成本計)
      if (bought.shares > 0) {
        const avgBuyCost = bought.cost / bought.shares
        stockPnl += bought.shares * (todayPrice - avgBuyCost)
      }

      if (Math.abs(stockPnl) > 0.01) {
        dailyMarketPnl += stockPnl
        details.push({
          symbol: sym,
          name: STOCK_NAMES[sym] || sym,
          price: todayPrice,
          pnl: Math.round(stockPnl),
          shares: endShares
        })
      }
    })

    if (isCurrentMonth) {
      // 投報率分母 = 昨日市值 + 今日買入
      let prevMV = 0
      Object.entries(startOfDayHoldings).forEach(([sym, shares]) => {
        const yp = getPrevPrice(sym, date)
        if (yp !== null) prevMV += shares * yp
      })
      const denominator = prevMV + capitalInToday
      const pnlPct = denominator > 0 ? (dailyMarketPnl / denominator) * 100 : 0

      if (Math.abs(dailyMarketPnl) > 0.01 || Math.abs(dailyRealizedPnl) > 0.01 || todaysTxs.length > 0) {
        dailyStats[date] = {
          entry_date: date,
          pnl: Math.round(dailyMarketPnl),
          pnl_pct: Math.round(pnlPct * 100) / 100,
          realized_pnl: Math.round(dailyRealizedPnl),
          details,
          note: todaysTxs.length > 0 ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}` : ''
        }
      }
    }
  }

  return NextResponse.json(Object.values(dailyStats))
}
