import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Transaction, calcFee, calcTax, DEFAULT_SETTINGS, UserSettings } from '@/types'

// 獲取歷史價格 (Yahoo Finance)
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
    console.error(`History fetch error for ${symbol}:`, err)
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

  // 1. 撈出所有交易紀錄
  const { data: txs, error: txError } = await supabase.from('transactions')
    .select('*').eq('user_id', user.id).order('trade_date', { ascending: true })

  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 })
  if (!txs || txs.length === 0) return NextResponse.json([])

  // 2. 確定時間範圍 (從第一筆交易到本月月底)
  const startDate = txs[0].trade_date
  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`
  
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86400

  // 3. 抓取所有持股的歷史股價
  const symbols = Array.from(new Set(txs.map(t => t.symbol)))
  const histories: Record<string, Record<string, number>> = {}
  
  await Promise.all(symbols.map(async (sym) => {
    const h = await fetchHistory(sym, startTs, endTs)
    if (h) histories[sym] = h
  }))

  // 4. 每日持股與盈虧計算
  const { data: sr } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  const settings: UserSettings = sr ?? DEFAULT_SETTINGS

  const dailyStats: Record<string, { pnl: number; note: string }> = {}
  
  // 取得該月份的所有日期
  const daysInMonth: string[] = []
  for (let d = 1; d <= lastDayOfMonth; d++) {
    daysInMonth.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }

  // 為了計算 "當日損益"，我們需要追蹤 "前一日的未實現損益"
  // 我們從第一筆交易日開始跑直到 endDate
  let currentHoldings: Record<string, { shares: number; cost: number }> = {}
  let prevUnrealizedPnl = 0
  
  const allDates: string[] = []
  const startD = new Date(startDate)
  const endD = new Date(endDate)
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split('T')[0])
  }

  allDates.forEach(date => {
    // 處理當日交易
    const todaysTxs = txs.filter(t => t.trade_date === date)
    let realizedImpact = 0
    
    todaysTxs.forEach(tx => {
      if (!currentHoldings[tx.symbol]) currentHoldings[tx.symbol] = { shares: 0, cost: 0 }
      const h = currentHoldings[tx.symbol]
      
      if (tx.action === 'BUY' || tx.action === 'DCA') {
        h.shares += tx.shares
        h.cost += tx.amount + tx.fee
      } else {
        const avgCost = h.shares > 0 ? h.cost / h.shares : 0
        const sellCost = tx.shares * avgCost
        h.shares -= tx.shares
        h.cost -= sellCost
        // 賣出的實現損益 (包含稅費)
        realizedImpact += (tx.net_amount + sellCost)
      }
    })

    // 計算今日未實現損益
    let currentUnrealizedPnl = 0
    let hasPrice = false
    
    Object.entries(currentHoldings).forEach(([sym, h]) => {
      if (h.shares <= 0) return
      const price = histories[sym]?.[date]
      if (price !== undefined) {
        hasPrice = true
        const mv = h.shares * price
        const fee = calcFee(mv, settings, true)
        const tax = calcTax(mv, sym, settings)
        currentUnrealizedPnl += (mv - fee - tax - h.cost)
      } else {
        // 如果當天沒開盤，沿用最近一個有價格日期的未實現損益計算（簡化處理：這裡先不加到 currentUnrealizedPnl，讓 dailyPnl 變成 realizedImpact）
        // 實際上應該找 lastKnownPrice，但為了精確計算當日波動，我們只在有收盤價的日子計算未實現變化
      }
    })

    // 當日損益 = (今日未實現 - 昨日未實現) + 今日實現衝擊
    // 如果今天沒開盤 (hasPrice 為 false) 且沒有交易，則損益為 0
    if (hasPrice || todaysTxs.length > 0) {
      const dailyPnl = (currentUnrealizedPnl - prevUnrealizedPnl) + realizedImpact
      
      // 只記錄在本月的資料
      if (daysInMonth.includes(date)) {
        dailyStats[date] = { 
          pnl: Math.round(dailyPnl),
          note: todaysTxs.length > 0 ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}` : ''
        }
      }
      
      if (hasPrice) prevUnrealizedPnl = currentUnrealizedPnl
    }
  })

  // 5. 格式化回傳
  const result = Object.entries(dailyStats).map(([date, data]) => ({
    entry_date: date,
    pnl: data.pnl,
    note: data.note
  }))

  return NextResponse.json(result)
}
