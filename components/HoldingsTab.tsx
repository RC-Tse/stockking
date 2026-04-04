'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Holding, Quote, UserSettings, codeOnly, fmtMoney, Transaction, CalendarEntry, calcFee, calcTax, getStockName } from '@/types'
import DatePicker from './DatePicker'

interface Props {
  holdings: Holding[]
  quotes: Record<string, Quote>
  settings: UserSettings
  transactions: Transaction[]
  calEntries: CalendarEntry[]
  onRefresh: () => void
  onRefreshCal: (year: number, month: number) => void
}

export default function HoldingsTab({ holdings, quotes, settings, transactions, calEntries, onRefresh, onRefreshCal }: Props) {
  const currentYear = new Date().getFullYear().toString()

  // ── Calculate Unified PnL Metrics ──
  const { 
    totalRealized, ytdRealized, eoyHeldCost, 
    allTimeBuyTotal, allTimeSellTotal,
    yearBuyTotal, yearSellTotal,
    closedHoldings
  } = useMemo(() => {
    let totalRealized = 0
    let ytdRealized = 0
    
    let allTimeBuyTotal = 0
    let allTimeSellTotal = 0
    let yearBuyTotal = 0
    let yearSellTotal = 0

    // FIFO tracking
    const inventory: Record<string, { shares: number, cost: number }[]> = {}
    const stockHistory: Record<string, { buyCost: number, sellRev: number }> = {}

    const sortedTxs = [...transactions].sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
      return a.id - b.id
    })

    for (const tx of sortedTxs) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      if (!stockHistory[tx.symbol]) stockHistory[tx.symbol] = { buyCost: 0, sellRev: 0 }
      
      const lots = inventory[tx.symbol]
      const isThisYear = tx.trade_date >= `${currentYear}-01-01`

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const cost = tx.amount + tx.fee
        lots.push({ shares: tx.shares, cost })
        allTimeBuyTotal += cost
        stockHistory[tx.symbol].buyCost += cost
        if (isThisYear) yearBuyTotal += cost
      } else if (tx.action === 'SELL') {
        allTimeSellTotal += tx.net_amount
        stockHistory[tx.symbol].sellRev += tx.net_amount
        if (isThisYear) yearSellTotal += tx.net_amount

        let sellRemaining = tx.shares
        let totalSellCostBasis = 0
        while (sellRemaining > 0 && lots.length > 0) {
          if (lots[0].shares <= sellRemaining) {
            totalSellCostBasis += lots[0].cost
            sellRemaining -= lots[0].shares
            lots.shift()
          } else {
            const unit = lots[0].cost / lots[0].shares
            const partial = sellRemaining * unit
            totalSellCostBasis += partial
            lots[0].shares -= sellRemaining
            lots[0].cost -= partial
            sellRemaining = 0
          }
        }
        const profit = tx.net_amount - totalSellCostBasis
        totalRealized += profit
        if (isThisYear) ytdRealized += profit
      }
    }

    // Calculate cost basis of holdings as of Jan 1st
    let eoyHeldCost = 0
    const tempInv: Record<string, { shares: number, cost: number }[]> = {}
    sortedTxs.filter(t => t.trade_date < `${currentYear}-01-01`).forEach(tx => {
      if (!tempInv[tx.symbol]) tempInv[tx.symbol] = []
      const lots = tempInv[tx.symbol]
      if (tx.action === 'BUY' || tx.action === 'DCA') {
        lots.push({ shares: tx.shares, cost: tx.amount + tx.fee })
      } else if (tx.action === 'SELL') {
        let rem = tx.shares
        while (rem > 0 && lots.length > 0) {
          if (lots[0].shares <= rem) { rem -= lots[0].shares; lots.shift() }
          else { 
            const u = lots[0].cost / lots[0].shares
            lots[0].shares -= rem; lots[0].cost -= rem * u; rem = 0 
          }
        }
      }
    })
    // Now we have inventory at end of last year.
    // BUT we only care about those still held TODAY.
    Object.keys(tempInv).forEach(sym => {
      const currentNetShares = inventory[sym]?.reduce((s, l) => s + l.shares, 0) || 0
      if (currentNetShares > 0) {
        // How many of the start-of-year shares are still here?
        const startShares = tempInv[sym].reduce((s, l) => s + l.shares, 0)
        const stillHeld = Math.min(startShares, currentNetShares)
        if (stillHeld > 0) {
          const avgAtStart = tempInv[sym].reduce((s, l) => s + l.cost, 0) / startShares
          eoyHeldCost += stillHeld * avgAtStart
        }
      }
    })

    // Identify closed positions
    const closedHoldings = Object.entries(stockHistory)
      .filter(([sym]) => (inventory[sym]?.reduce((s, l) => s + l.shares, 0) || 0) === 0)
      .map(([sym, data]) => ({
        symbol: sym,
        buyCost: data.buyCost,
        sellRev: data.sellRev,
        pnl: data.sellRev - data.buyCost,
        pnlPct: data.buyCost > 0 ? (data.sellRev - data.buyCost) / data.buyCost * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl)

    return { totalRealized, ytdRealized, eoyHeldCost, allTimeBuyTotal, allTimeSellTotal, yearBuyTotal, yearSellTotal, closedHoldings }
  }, [transactions, currentYear])

  const currentMV = holdings.reduce((s, h) => s + h.market_value, 0)
  
  // 總損益 = 賣出總收入 + 目前持股市值 - 買入總成本
  const totalPnl = allTimeSellTotal + currentMV - allTimeBuyTotal
  const totalCost = allTimeBuyTotal
  const pnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0

  // 年損益 = 今年賣出收入 - 今年買入成本 + (目前持股市值 - 年初持股成本)
  const yearPnl = yearSellTotal - yearBuyTotal + (currentMV - eoyHeldCost)
  const yearPnlPct = eoyHeldCost > 0 ? (yearPnl / eoyHeldCost) * 100 : 0

  const [expanded, setExpanded] = useState<string | null>(null)
  const [closedExpanded, setClosedExpanded] = useState(false)

  const yearAchieved = settings.year_goal > 0 ? (yearPnl / settings.year_goal) * 100 : null
  const totalAchieved = settings.total_goal > 0 ? (currentMV / settings.total_goal) * 100 : null

  return (
    <div className="p-3 md:p-4 space-y-4">
      {/* 1. 持股概覽卡片 */}
      <div className="glass rounded-2xl p-4 md:p-5 relative overflow-hidden border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-black opacity-30 uppercase tracking-widest">
            持股概覽 · {holdings.length} 檔
          </span>
          <button onClick={() => window.location.reload()}
            className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-white/40 border border-white/10 active:bg-white/10 font-bold transition-colors">
            重整
          </button>
        </div>

        <div className="space-y-5 mb-6">
          {/* 第一列：投入成本、目前市值 */}
          <div className="flex items-center">
            <StatBox label="投入成本" value={fmtMoney(totalCost)} className="w-1/2 text-center px-1" />
            <StatBox 
              label="目前市值" 
              value={fmtMoney(currentMV)} 
              className="w-1/2 text-center px-1" 
              upDown={currentMV > totalCost ? 1 : currentMV < totalCost ? -1 : 0}
            />
          </div>
          {/* 第二列：總損益金額、總損益比 */}
          <div className="flex items-center border-t border-white/5 pt-5">
            <StatBox 
              label="總損益金額" 
              value={`${totalPnl >= 0 ? '+' : ''}${fmtMoney(Math.round(totalPnl))}`} 
              className="w-1/2 text-center px-1"
              upDown={totalPnl}
            />
            <StatBox
              label="總損益比"
              value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
              className="w-1/2 text-center px-1"
              upDown={totalPnl}
            />
          </div>
          {/* 第三列：已實現損益、今年損益 */}
          <div className="flex items-center border-t border-white/5 pt-5">
            <StatBox 
              label="已實現損益" 
              value={`${totalRealized >= 0 ? '+' : ''}${fmtMoney(Math.round(totalRealized))}`} 
              className="w-1/2 text-center px-1 border-r border-white/5"
              upDown={totalRealized}
            />
            <StatBox
              label="今年損益"
              value={`${yearPnl >= 0 ? '+' : ''}${fmtMoney(Math.round(yearPnl))}`}
              className="w-1/2 text-center px-1"
              upDown={yearPnl}
            />
          </div>
        </div>

        {/* 📋 目標追蹤區塊 */}
        <div className="pt-5 border-t border-white/10 space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-black text-white/40 flex items-center gap-1.5">📈 年度目標</span>
              {settings.year_goal > 0 ? (
                <span className={`text-[11px] font-black font-mono ${yearPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {fmtMoney(Math.round(yearPnl))} / {yearAchieved?.toFixed(1)}%
                </span>
              ) : (
                <button onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' }))} className="text-[10px] font-bold text-gold active:opacity-50">點此設定目標 →</button>
              )}
            </div>
            {settings.year_goal > 0 && (
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full transition-all duration-1000 ${yearPnl >= 0 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, Math.max(0, yearAchieved || 0))}%` }} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-black text-white/40 flex items-center gap-1.5">🏆 總目標</span>
              {settings.total_goal > 0 ? (
                <span className="text-[11px] font-black font-mono text-gold">
                  {fmtMoney(currentMV)} / {totalAchieved?.toFixed(1)}%
                </span>
              ) : (
                <button onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' }))} className="text-[10px] font-bold text-gold active:opacity-50">點此設定目標 →</button>
              )}
            </div>
            {settings.total_goal > 0 && (
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full transition-all duration-1000 ${(totalAchieved || 0) >= 50 ? 'bg-gold' : 'bg-white/20'}`} style={{ width: `${Math.min(100, Math.max(0, totalAchieved || 0))}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-0.5">
        <IntegratedCalendar entries={calEntries} transactions={transactions} onRefresh={onRefreshCal} />
      </div>

      <div className="space-y-3">
        {holdings.length === 0 ? (
          <Empty icon="📭" text="尚無持股紀錄" sub={<>點右下角 <GoldSpan>+</GoldSpan> 新增第一筆交易</>} />
        ) : (
          holdings
            .sort((a, b) => b.market_value - a.market_value)
            .map(h => (
              <HoldingItem
                key={h.symbol}
                h={h}
                q={quotes[h.symbol]}
                settings={settings}
                txs={transactions.filter(t => t.symbol === h.symbol)}
                isExpanded={expanded === h.symbol}
                onToggle={() => setExpanded(expanded === h.symbol ? null : h.symbol)}
                onUpdated={onRefresh}
              />
            ))
        )}

        {/* 📁 已結算股票 */}
        {closedHoldings.length > 0 && (
          <div className="pt-4 mt-4 border-t border-white/5">
            <button 
              onClick={() => setClosedExpanded(!closedExpanded)}
              className="w-full flex items-center justify-between p-4 glass rounded-2xl border border-white/5 active:bg-white/5 transition-all"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">📁</span>
                <span className="font-black text-sm text-white/60">已結算股票 ({closedHoldings.length}檔)</span>
              </div>
              <span className={`text-xs transition-transform duration-300 ${closedExpanded ? 'rotate-180' : ''}`}>▼</span>
            </button>
            
            {closedExpanded && (
              <div className="space-y-3 mt-3 animate-in fade-in slide-in-from-top-2">
                {closedHoldings.map(c => (
                  <div key={c.symbol} className="glass rounded-xl overflow-hidden border border-white/5">
                    <div className="p-4" onClick={() => setExpanded(expanded === `closed-${c.symbol}` ? null : `closed-${c.symbol}`)}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-white">{getStockName(c.symbol)}</span>
                            <span className="text-[10px] font-mono text-white/30">{codeOnly(c.symbol)}</span>
                          </div>
                          <div className="text-[10px] font-bold text-white/20 mt-0.5">
                            成本 {fmtMoney(Math.round(c.buyCost))} · 收入 {fmtMoney(Math.round(c.sellRev))}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-black font-mono text-sm ${c.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {c.pnl >= 0 ? '+' : ''}{fmtMoney(Math.round(c.pnl))}
                          </div>
                          <div className={`text-[10px] font-bold ${c.pnl >= 0 ? 'text-red-400/50' : 'text-green-400/50'}`}>
                            {c.pnlPct >= 0 ? '+' : ''}{c.pnlPct.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </div>
                    {expanded === `closed-${c.symbol}` && (
                      <div className="bg-white/[0.02] border-t border-white/5 p-3 space-y-2">
                        {transactions.filter(t => t.symbol === c.symbol).map(t => (
                          <TxRow key={t.id} t={t} settings={settings} onUpdated={onRefresh} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type CalendarView = 'CALENDAR' | 'YEAR' | 'MONTH'

function IntegratedCalendar({ entries, transactions, onRefresh }: { 
  entries: CalendarEntry[], 
  transactions: Transaction[],
  onRefresh: (y: number, m: number) => void 
}) {
  const now = new Date()
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [view, setView] = useState<CalendarView>('CALENDAR')
  const [dayDetails, setDayDetails] = useState<any[] | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1

  useEffect(() => {
    onRefresh(year, month)
  }, [year, month, onRefresh])

  const days = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1).getDay()
    const lastDate = new Date(year, month, 0).getDate()
    const arr = []
    for (let i = 0; i < firstDay; i++) arr.push(null)
    for (let i = 1; i <= lastDate; i++) arr.push(i)
    return arr
  }, [year, month])

  const entryMap = useMemo(() => {
    const map: Record<number, CalendarEntry> = {}
    entries.forEach(e => {
      const d = new Date(e.entry_date).getDate()
      map[d] = e
    })
    return map
  }, [entries])

  const stats = useMemo(() => {
    const totalPnl = entries.reduce((s, e) => s + e.pnl, 0)
    const totalPnlPct = entries.reduce((s, e) => s + (e.pnl_pct || 0), 0)
    return { totalPnl, totalPnlPct }
  }, [entries])

  function moveMonth(delta: number) {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1))
    setSelectedDate(null)
    setDayDetails(null)
  }

  const fetchDayDetails = useCallback(async (dateStr: string) => {
    setLoadingDetails(true)
    try {
      const inventory: Record<string, { shares: number, cost: number }[]> = {}
      const sortedTxs = [...transactions]
        .filter(t => t.trade_date <= dateStr)
        .sort((a, b) => {
          if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
          return a.id - b.id
        })

      for (const tx of sortedTxs) {
        if (!inventory[tx.symbol]) inventory[tx.symbol] = []
        const lots = inventory[tx.symbol]
        if (tx.action === 'BUY' || tx.action === 'DCA') {
          lots.push({ shares: tx.shares, cost: tx.amount + tx.fee })
        } else if (tx.action === 'SELL') {
          let sellRem = tx.shares
          while (sellRem > 0 && lots.length > 0) {
            if (lots[0].shares <= sellRem) {
              sellRem -= lots[0].shares
              lots.shift()
            } else {
              const unit = lots[0].cost / lots[0].shares
              lots[0].shares -= sellRem
              lots[0].cost = lots[0].shares * unit
              sellRem = 0
            }
          }
        }
      }

      const heldSymbols = Object.keys(inventory).filter(s => inventory[s].reduce((sum, l) => sum + l.shares, 0) > 0)

      if (heldSymbols.length === 0) {
        setDayDetails([])
        return
      }

      const res = await fetch(`/api/stocks?symbols=${heldSymbols.join(',')}&date=${dateStr}`)
      if (!res.ok) throw new Error('Failed to fetch historical quotes')
      const quotes: Record<string, Quote> = await res.json()

      const details = heldSymbols.map(sym => {
        const lots = inventory[sym]
        const shares = lots.reduce((s, l) => s + l.shares, 0)
        const cost = lots.reduce((s, l) => s + l.cost, 0)
        const q = quotes[sym]
        const price = q?.price || 0
        const mv = Math.round(price * shares)
        const pnl = mv - cost
        const pnl_pct = cost > 0 ? (pnl / cost) * 100 : 0
        return {
          symbol: sym,
          name_zh: q?.name_zh || getStockName(sym),
          shares,
          price,
          market_value: mv,
          pnl,
          pnl_pct
        }
      })

      setDayDetails(details.sort((a,b) => b.market_value - a.market_value))
    } catch (err) {
      console.error(err)
      setDayDetails([])
    } finally {
      setLoadingDetails(false)
    }
  }, [transactions])

  function toggleDate(dateStr: string) {
    if (selectedDate === dateStr) {
      setSelectedDate(null)
      setDayDetails(null)
    } else {
      setSelectedDate(dateStr)
      fetchDayDetails(dateStr)
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 border border-white/5 space-y-4 bg-black/20">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button 
              onClick={() => moveMonth(-1)} 
              className="p-2 text-gold disabled:opacity-20 transition-colors"
              disabled={view !== 'CALENDAR'}
            >◀</button>
            <div className="flex gap-2 font-black text-white">
              <button 
                onClick={() => setView(view === 'YEAR' ? 'CALENDAR' : 'YEAR')}
                className={`px-2 py-1 rounded transition-colors ${view === 'YEAR' ? 'bg-[#c9a564] text-[#0d1018]' : 'hover:bg-white/5'}`}
              >
                {year}年
              </button>
              <button 
                onClick={() => setView(view === 'MONTH' ? 'CALENDAR' : 'MONTH')}
                className={`px-2 py-1 rounded transition-colors ${view === 'MONTH' ? 'bg-[#c9a564] text-[#0d1018]' : 'hover:bg-white/5'}`}
              >
                {month}月
              </button>
            </div>
            <button 
              onClick={() => moveMonth(1)} 
              className="p-2 text-gold disabled:opacity-20 transition-colors"
              disabled={view !== 'CALENDAR'}
            >▶</button>
          </div>

          {view === 'CALENDAR' && (
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-[10px] font-bold text-white/30 uppercase tracking-tighter">本月總損益</div>
                <div className={`text-sm font-black font-mono ${stats.totalPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {stats.totalPnl >= 0 ? '+' : ''}{fmtMoney(stats.totalPnl)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-white/30 uppercase tracking-tighter">損益百分比</div>
                <div className={`text-sm font-black font-mono ${stats.totalPnlPct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {stats.totalPnlPct >= 0 ? '+' : ''}{stats.totalPnlPct.toFixed(2)}%
                </div>
              </div>
            </div>
          )}
        </div>

        {view === 'CALENDAR' && (
          <div className="grid grid-cols-7 gap-1">
            {['日','一','二','三','四','五','六'].map(d => (
              <div key={d} className="text-center text-[10px] font-bold py-1 opacity-20">{d}</div>
            ))}
            {days.map((d, i) => {
              if (d === null) return <div key={`empty-${i}`} className="aspect-[1/1]" />
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const entry = entryMap[d]
              const pnlPct = entry?.pnl_pct || 0
              const isSelected = selectedDate === dateStr
              let bgColor = 'transparent'
              if (pnlPct > 0) {
                const intensity = Math.min(100, (pnlPct / 10) * 100)
                bgColor = `rgba(248, 113, 113, ${0.1 + (intensity / 100) * 0.6})`
              } else if (pnlPct < 0) {
                const intensity = Math.min(100, (Math.abs(pnlPct) / 10) * 100)
                bgColor = `rgba(74, 222, 128, ${0.1 + (intensity / 100) * 0.6})`
              } else if (entry) { bgColor = 'rgba(255, 255, 255, 0.05)' }

              return (
                <div key={d} 
                  onClick={() => toggleDate(dateStr)}
                  className={`aspect-[1/1] rounded flex flex-col items-center justify-between p-1 cursor-pointer transition-all border ${isSelected ? 'border-white ring-1 ring-white' : 'border-white/5'}`}
                  style={{ background: bgColor }}>
                  <span className="text-[11px] font-black text-white/80 self-start leading-none">{d}</span>
                  {entry && (
                    <div className="w-full text-center flex flex-col justify-end flex-1 space-y-0.5 pb-0.5">
                      <div className="text-[8px] font-black text-white leading-none scale-90">
                        {entry.pnl > 0 ? '+' : ''}{shortMoney(entry.pnl)}
                      </div>
                      <div className="text-[8px] font-bold text-white/60 leading-none scale-90">
                        {entry.pnl > 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {view === 'YEAR' && (
          <div className="grid grid-cols-3 gap-2 py-2">
            {(() => {
              const currentYear = new Date().getFullYear()
              const years = []
              for (let y = currentYear - 7; y <= currentYear + 2; y++) years.push(y)
              return years.map(y => (
                <button
                  key={y}
                  onClick={() => { setViewDate(new Date(y, viewDate.getMonth(), 1)); setView('CALENDAR') }}
                  className={`py-3 rounded-xl text-sm font-black transition-all ${year === y ? 'bg-[#c9a564] text-[#0d1018]' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                >{y}</button>
              ))
            })()}
          </div>
        )}

        {view === 'MONTH' && (
          <div className="grid grid-cols-3 gap-2 py-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <button
                key={m}
                onClick={() => { setViewDate(new Date(year, m - 1, 1)); setView('CALENDAR') }}
                className={`py-3 rounded-xl text-sm font-black transition-all ${month === m ? 'bg-[#c9a564] text-[#0d1018]' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
              >{m}月</button>
            ))}
          </div>
        )}
      </div>

      {selectedDate && (
        <div className="animate-in fade-in slide-in-from-top-2">
          <div className="glass rounded-2xl p-4 border border-white/10 space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="flex flex-col">
                <h3 className="font-black text-sm text-white">{selectedDate.split('-')[1]}月{selectedDate.split('-')[2]}日 持股細項</h3>
                {(() => {
                  const entry = entries.find(e => e.entry_date === selectedDate)
                  if (!entry) return null
                  return (
                    <span className={`text-[10px] font-black font-mono ${entry.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      當天總損益 {entry.pnl >= 0 ? '+' : ''}{fmtMoney(entry.pnl)} ({entry.pnl_pct && entry.pnl_pct >= 0 ? '+' : ''}{entry.pnl_pct?.toFixed(2)}%)
                    </span>
                  )
                })()}
              </div>
              {loadingDetails && <div className="text-[10px] text-gold animate-pulse font-bold">載入中...</div>}
            </div>

            {dayDetails ? (
              dayDetails.length === 0 ? (
                <div className="text-center py-4 text-xs text-white/20 italic border-b border-white/5 pb-4">當天無持股數據</div>
              ) : (
                <div className="space-y-3">
                  {dayDetails.map(det => (
                    <div key={det.symbol} className="flex items-center justify-between gap-4 py-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-xs text-white truncate">{det.name_zh}</span>
                          <span className="text-[9px] font-mono text-white/30">{codeOnly(det.symbol)}</span>
                        </div>
                        <div className="text-[10px] font-bold text-white/40">{det.shares.toLocaleString()} 股 @ {det.price.toFixed(2)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-black text-white">{fmtMoney(det.market_value)}</div>
                        <div className={`text-[10px] font-mono font-bold ${det.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {det.pnl >= 0 ? '+' : ''}{fmtMoney(det.pnl)} ({det.pnl >= 0 ? '+' : ''}{det.pnl_pct.toFixed(2)}%)
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {(() => {
              const dayTxs = transactions.filter(t => t.trade_date === selectedDate)
              if (dayTxs.length === 0) return null
              return (
                <div className="border-t border-white/5 pt-4">
                  <h4 className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                    <span>📋 當天交易</span>
                    <span className="h-[1px] flex-1 bg-white/5" />
                  </h4>
                  <div className="space-y-3">
                    {dayTxs.map(tx => {
                      const isBuy = tx.action === 'BUY' || tx.action === 'DCA'
                      const label = tx.trade_type === 'DCA' ? '定期定額' : (tx.action === 'BUY' ? '買入' : '賣出')
                      const labelCol = tx.trade_type === 'DCA' ? 'text-gold bg-gold/10 border-gold/20' : (isBuy ? 'text-red-400 bg-red-400/10 border-red-400/20' : 'text-green-400 bg-green-400/10 border-green-400/20')
                      return (
                        <div key={tx.id} className="flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border leading-none ${labelCol}`}>{label}</span>
                              <span className="text-xs font-black text-white truncate">{tx.name_zh || getStockName(tx.symbol)}</span>
                              <span className="text-[9px] font-mono text-white/20">{codeOnly(tx.symbol)}</span>
                            </div>
                            <div className="text-[10px] font-bold text-white/40">{tx.shares.toLocaleString()} 股 @ {Number(tx.price).toFixed(2)} <span className="mx-1.5 opacity-30">·</span> 費+稅 {fmtMoney(tx.fee + tx.tax)}</div>
                          </div>
                          <div className={`text-xs font-black font-mono ${tx.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>{tx.net_amount >= 0 ? '+' : ''}{fmtMoney(tx.net_amount)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

function HoldingItem({ h, q, settings, txs, isExpanded, onToggle, onUpdated }: {
  h: Holding; q?: Quote; settings: UserSettings; txs: Transaction[]; isExpanded: boolean; onToggle: () => void; onUpdated: () => void
}) {
  const isUp = h.unrealized_pnl >= 0
  const color = isUp ? 'text-red-400' : 'text-green-400'
  const dimBg = isUp ? 'bg-red-400/10' : 'bg-green-400/10'
  const arrow = isUp ? '▲' : '▼'

  return (
    <div className={`glass rounded-xl overflow-hidden transition-all duration-300 border ${isExpanded ? 'border-gold' : 'border-white/5'}`}>
      <div className="p-3 md:p-4 cursor-pointer active:bg-white/5" onClick={onToggle}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-base text-white leading-tight">{q?.name_zh || h.symbol}</span>
              <span className="font-mono px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 text-white/40">{codeOnly(h.symbol)}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gold-dim text-gold">{h.shares >= 1000 ? `${(h.shares/1000).toFixed(h.shares%1000===0?0:2)}張` : `${h.shares}股`}</span>
            </div>
            <div className="text-[11px] mt-1 font-mono text-white/40">平均成本 {h.avg_cost.toFixed(2)} · 持有成本 {fmtMoney(h.total_cost)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-black text-lg font-mono text-white leading-tight">{h.current_price > 0 ? h.current_price.toFixed(2) : '—'}</div>
            {q && q.change !== undefined && (
              <div className={`text-[11px] font-mono ${q.change >= 0 ? 'text-red-400' : 'text-green-400'}`}>{q.change >= 0 ? '+' : ''}{q.change.toFixed(2)} ({q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)</div>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className={`font-bold font-mono text-sm ${color}`}>{isUp ? '+' : ''}{fmtMoney(h.unrealized_pnl)} 元</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${dimBg} ${color}`}>{arrow} {Math.abs(h.pnl_pct).toFixed(2)}%</span>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2 bg-white/5">
          <div className="text-[10px] font-bold opacity-30 uppercase tracking-widest mb-1 pl-1">交易紀錄</div>
          {txs.map(t => <TxRow key={t.id} t={t} settings={settings} onUpdated={onUpdated} />)}
        </div>
      )}
    </div>
  )
}

function TxRow({ t, settings, onUpdated }: { t: Transaction; settings: UserSettings; onUpdated: () => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  
  const [date, setDate] = useState(t.trade_date)
  const [shares, setShares] = useState<number | ''>(t.shares)
  const [price, setPrice] = useState<number | ''>(t.price)
  const [monthNote, setMonthNote] = useState(t.note || '')
  const [tradeType, setTradeType] = useState(t.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots]     = useState<number | ''>(Math.floor(t.shares / 1000) || 1)
  
  const isBuy = t.action === 'BUY' || t.action === 'DCA'
  const actualShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = Number(price) || 0
  const amount = actualShares * safePrice
  const fee    = calcFee(amount, settings, t.action === 'SELL')
  const tax    = t.action === 'SELL' ? calcTax(amount, t.symbol, settings) : 0
  const net    = isBuy ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))

  const hasChanged = date !== t.trade_date || actualShares !== t.shares || safePrice !== t.price || monthNote !== (t.note || '')
  const isValid = actualShares > 0 && safePrice > 0 && hasChanged

  async function handleSave() {
    if (!isValid) return
    setLoading(true)
    await fetch('/api/transactions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, trade_date: date, shares: actualShares, price: safePrice, note: monthNote })
    })
    setIsEditing(false)
    setLoading(false)
    onUpdated()
  }

  async function handleDelete() {
    if (!confirm('確定刪除這筆交易紀錄？')) return
    setLoading(true)
    await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id }),
    })
    setLoading(false)
    onUpdated()
  }

  if (isEditing) {
    return (
      <div className="p-4 rounded-xl bg-black/60 border-2 border-gold/40 space-y-5 my-2 slide-up">
        <div className="flex flex-col items-center"><Label>交易日期</Label><DatePicker value={date} onChange={setDate} /></div>
        <div className="space-y-2">
          <Label>交易方式</Label>
          <div className="flex gap-2">
            <button onClick={() => setTradeType('FULL')} className={`flex-1 h-10 rounded-lg text-[10px] font-black transition-all border ${tradeType === 'FULL' ? 'bg-[#c9a56433] text-gold border-gold' : 'bg-transparent text-white/30 border-white/10'}`}>整張 (1000股)</button>
            <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 h-10 rounded-lg text-[10px] font-black transition-all border ${tradeType === 'FRACTIONAL' ? 'bg-[#c9a56433] text-gold border-gold' : 'bg-transparent text-white/30 border-white/10'}`}>零股</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
            <input type="number" inputMode="numeric" value={tradeType === 'FULL' ? lots : shares} onFocus={() => { if (tradeType === 'FULL') setLots(''); else setShares('') }} onChange={e => { const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0); if (tradeType === 'FULL') setLots(v); else setShares(v) }} className="w-full input-base text-center h-12 font-black font-mono text-lg bg-white/5 border-white/10" />
            {tradeType === 'FULL' && lots !== '' && <div className="text-[10px] text-center mt-1 text-white/30 font-bold">= {(Number(lots)*1000).toLocaleString()} 股</div>}
          </div>
          <div>
            <Label>成交價</Label>
            <input type="number" inputMode="decimal" step="0.01" value={price} onFocus={() => setPrice('')} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className="w-full input-base text-center h-12 font-black font-mono text-lg bg-white/5 border-white/10" />
          </div>
        </div>
        <div><Label>備註</Label><input value={monthNote} onChange={e => setMonthNote(e.target.value)} className="w-full input-base py-3 px-4 text-sm bg-white/5 border-white/10" placeholder="點此輸入備註..." /></div>
        <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10 text-xs font-bold">
          <div className="flex justify-between"><span className="opacity-40">手續費</span><span className="font-mono text-white">{fmtMoney(fee)}</span></div>
          <div className="flex justify-between items-center pt-2 border-t border-white/5"><span className="opacity-60 uppercase text-[10px]">預估淨收支</span><span className={`text-lg font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>{net >= 0 ? '+' : ''}{fmtMoney(net)}</span></div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={!isValid || loading} className="w-3/4 py-4 rounded-xl font-black text-sm transition-all active:scale-95" style={isValid ? { background: 'linear-gradient(135deg, #c9a564, #e8c880)', color: '#0d1018', fontWeight: 800 } : { background: '#444', color: '#888', cursor: 'not-allowed', opacity: 0.5 }}>{loading ? '儲存中...' : '儲存修改'}</button>
          <button onClick={() => setIsEditing(false)} className="w-1/4 py-4 rounded-xl font-bold text-sm bg-white/10 text-white/60 active:scale-95 transition-all">取消</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-1 h-10 rounded-full ${isBuy ? 'bg-red-500' : 'bg-green-500'}`} />
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="text-[11px] font-mono opacity-40">{t.trade_date}</div>
            {t.trade_type === 'DCA' ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-gold-dim text-gold border border-gold/20 leading-none">定期定額</span> : isBuy ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20 leading-none">買入</span> : <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-400/10 text-green-400 border border-green-400/20 leading-none">賣出</span>}
          </div>
          <div className="text-sm font-bold text-white/90">{t.shares}股 @ {t.price}</div>
        </div>
      </div>
      <div className="text-right">
        <div className={`text-base font-mono font-black ${t.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>{t.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(t.net_amount))}</div>
        <div className="flex gap-3 justify-end mt-1">
          <button onClick={() => setIsEditing(true)} className="text-sm font-bold text-gold hover:underline active:opacity-60">編輯</button>
          <button onClick={handleDelete} className="text-sm font-bold text-[#ff6b6b] hover:underline active:opacity-60">刪除</button>
        </div>
      </div>
    </div>
  )
}

function shortMoney(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

function StatBox({ label, value, upDown, className = '', baseColor = false }: { 
  label: string; value: string; upDown?: number; className?: string; baseColor?: boolean 
}) {
  const col = upDown === undefined ? 'text-white' : upDown > 0 ? 'text-red-400' : upDown < 0 ? 'text-green-400' : 'text-white'
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="text-[10px] mb-1 opacity-40 font-bold uppercase tracking-tighter">{label}</div>
      <div className={`font-black font-mono text-xs md:text-sm leading-tight ${col}`}>{value}</div>
    </div>
  )
}

function GoldSpan({ children }: { children: React.ReactNode }) { return <span className="text-gold font-black">{children}</span> }
function Empty({ icon, text, sub }: { icon: string; text: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 px-6">
      <div className="text-4xl opacity-20">{icon}</div>
      <p className="font-bold text-sm text-white/40">{text}</p>
      {sub && <p className="text-xs text-center text-white/20">{sub}</p>}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[9px] mb-0.5 block font-bold opacity-30 uppercase tracking-tighter">{children}</label>
}
