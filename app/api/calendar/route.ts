import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Transaction, DEFAULT_SETTINGS, UserSettings, STOCK_NAMES } from '@/types'

async function fetchHistory(symbol: string, startTs: number, endTs: number) {
  try {
    // 往前多抓一點，確保有昨日收盤價
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

  // 獲取該用戶所有交易紀錄，以便計算持股與 FIFO
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

  // 輔助函數：獲取某日期前的最後一個有效收盤價 (昨日收盤價)
  const getPrevPrice = (sym: string, dateStr: string) => {
    const h = histories[sym]
    if (!h) return null
    const dates = Object.keys(h).filter(d => d < dateStr).sort()
    return dates.length > 0 ? h[dates[dates.length - 1]] : null
  }

  // ─── 核心算法：逐日重建部位並計算損益 ───
  const dailyStats: Record<string, any> = {}
  
  // 追蹤每個股票的 FIFO 庫存
  // inventory[symbol] = [{ shares, unitCost }]
  const inventory: Record<string, { shares: number; unitCost: number }[]> = {}
  
  // 計算時間範圍：從第一筆交易到本月最後一天
  const startD = new Date(startDate)
  const endD = new Date(endDate)
  
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().split('T')[0]
    const isCurrentMonth = date.startsWith(`${year}-${String(month).padStart(2, '0')}`)
    
    // 1. 取得今日前的持股狀態 (Yesterday's inventory)
    const prevHoldings: Record<string, number> = {}
    Object.entries(inventory).forEach(([sym, lots]) => {
      const totalShares = lots.reduce((sum, l) => sum + l.shares, 0)
      if (totalShares > 0) prevHoldings[sym] = totalShares
    })

    // 2. 處理今日交易
    const todaysTxs = txs.filter(t => t.trade_date === date)
    let dailyRealizedPnl = 0 // 金色字：已實現損益 (FIFO)
    let txImpactOnDailyPnl = 0 // 交易對「當日損益」的貢獻

    todaysTxs.forEach(tx => {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      const lots = inventory[tx.symbol]
      const todayClose = histories[tx.symbol]?.[date]
      const yesterdayClose = getPrevPrice(tx.symbol, date)

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const unitCost = (tx.amount + tx.fee) / tx.shares
        lots.push({ shares: tx.shares, unitCost })
        
        // 買入貢獻：(今日收盤 - 買入成本) * 買入數量
        if (todayClose !== undefined) {
          txImpactOnDailyPnl += (todayClose - unitCost) * tx.shares
        }
      } else if (tx.action === 'SELL') {
        let sellRem = tx.shares
        const sellUnitNet = tx.net_amount / tx.shares
        
        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)
          
          // 已實現損益 (FIFO)
          dailyRealizedPnl += (sellUnitNet - lot.unitCost) * take
          
          sellRem -= take
          lot.shares -= take
          if (lot.shares <= 0) lots.shift()
        }

        // 賣出對當日損益貢獻：(賣出價 - 昨日收盤) * 賣出數量
        if (yesterdayClose !== null) {
          txImpactOnDailyPnl += (sellUnitNet - yesterdayClose) * tx.shares
        }
      }
    })

    // 3. 計算持倉部分的股價變動 (今日收盤 - 昨日收盤)
    let marketMovementPnl = 0
    Object.entries(prevHoldings).forEach(([sym, shares]) => {
      const todayClose = histories[sym]?.[date]
      const yesterdayClose = getPrevPrice(sym, date)
      if (todayClose !== undefined && yesterdayClose !== null) {
        marketMovementPnl += (todayClose - yesterdayClose) * shares
      }
    })

    // 4. 總結今日數據
    if (isCurrentMonth) {
      const totalDailyPnl = marketMovementPnl + txImpactOnDailyPnl
      
      const details: any[] = []
      // 計算各股貢獻
      // 1. 持倉變動貢獻
      Object.entries(prevHoldings).forEach(([sym, shares]) => {
        const todayClose = histories[sym]?.[date]
        const yesterdayClose = getPrevPrice(sym, date)
        if (todayClose !== undefined && yesterdayClose !== null) {
          const pnl = (todayClose - yesterdayClose) * shares
          if (Math.abs(pnl) > 0.01) {
            details.push({
              symbol: sym,
              name: STOCK_NAMES[sym] || sym,
              price: todayClose,
              pnl: Math.round(pnl),
              shares: shares
            })
          }
        }
      })
      // 2. 今日交易貢獻 (若是今日才買入，則不重複在 prevHoldings 中)
      todaysTxs.forEach(tx => {
        const todayClose = histories[tx.symbol]?.[date]
        const yesterdayClose = getPrevPrice(tx.symbol, date)
        let txPnl = 0
        if (tx.action === 'BUY' || tx.action === 'DCA') {
          if (todayClose !== undefined) {
            const unitCost = (tx.amount + tx.fee) / tx.shares
            txPnl = (todayClose - unitCost) * tx.shares
          }
        } else {
          if (yesterdayClose !== null) {
            const sellUnitNet = tx.net_amount / tx.shares
            txPnl = (sellUnitNet - yesterdayClose) * tx.shares
          }
        }

        if (Math.abs(txPnl) > 0.01) {
          const existing = details.find(d => d.symbol === tx.symbol)
          if (existing) {
            existing.pnl += Math.round(txPnl)
          } else {
            details.push({
              symbol: tx.symbol,
              name: STOCK_NAMES[tx.symbol] || tx.symbol,
              price: todayClose || 0,
              pnl: Math.round(txPnl),
              shares: 0 // 已在上面處理過或不計入持倉
            })
          }
        }
      })

      // 計算當日損益率 = 當日損益 / (昨日市值 + 今日買入成本)
      let capitalIn = 0
      todaysTxs.forEach(tx => {
        if (tx.action === 'BUY' || tx.action === 'DCA') {
          capitalIn += (tx.amount + tx.fee)
        }
      })
      
      let prevMV = 0
      Object.entries(prevHoldings).forEach(([sym, shares]) => {
        const yesterdayClose = getPrevPrice(sym, date)
        if (yesterdayClose !== null) {
          prevMV += shares * yesterdayClose
        }
      })

      const denominator = prevMV + capitalIn
      const pnlPct = denominator > 0 ? (totalDailyPnl / denominator) * 100 : 0
      
      // 只有在有價格變動或有交易時才記錄，避免週末顯示 0
      if (Math.abs(totalDailyPnl) > 0.01 || Math.abs(dailyRealizedPnl) > 0.01 || todaysTxs.length > 0) {
        dailyStats[date] = {
          entry_date: date,
          pnl: Math.round(totalDailyPnl),
          pnl_pct: Math.round(pnlPct * 100) / 100,
          realized_pnl: Math.round(dailyRealizedPnl),
          note: todaysTxs.length > 0 ? `交易: ${todaysTxs.map(t => `${t.action} ${t.symbol}`).join(', ')}` : ''
        }
      }
    }
  }

  return NextResponse.json(Object.values(dailyStats))
}
