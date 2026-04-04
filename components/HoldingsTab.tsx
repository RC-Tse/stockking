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

  // ── Calculate Realized PnL & Year PnL ──
  const { totalRealized, ytdRealized, eoyCost } = useMemo(() => {
    let totalRealized = 0
    let ytdRealized = 0
    let eoyCost = 0
    
    // Tracking current inventory cost basis for realized PnL calculation
    const map: Record<string, { shares: number, cost: number }> = {}
    const sortedTxs = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))

    sortedTxs.forEach(tx => {
      if (!map[tx.symbol]) map[tx.symbol] = { shares: 0, cost: 0 }
      const h = map[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        h.shares += tx.shares
        h.cost += tx.amount + tx.fee
      } else if (tx.action === 'SELL') {
        const avgCostBefore = h.shares > 0 ? h.cost / h.shares : 0
        const sellCostBasis = tx.shares * avgCostBefore
        
        const realized = tx.net_amount + sellCostBasis
        totalRealized += realized
        
        if (tx.trade_date >= `${currentYear}-01-01`) {
          ytdRealized += realized
        }

        h.shares -= tx.shares
        h.cost -= sellCostBasis
      }

      // Track cost basis at the end of last year
      if (tx.trade_date < `${currentYear}-01-01`) {
        // This is handled by the loop as it progresses
      }
    });

    // To get EOY cost, we'd need another pass or check date inside
    const eoyMap: Record<string, { shares: number, cost: number }> = {}
    sortedTxs.filter(t => t.trade_date < `${currentYear}-01-01`).forEach(tx => {
      if (!eoyMap[tx.symbol]) eoyMap[tx.symbol] = { shares: 0, cost: 0 }
      const h = eoyMap[tx.symbol]
      if (tx.action === 'BUY' || tx.action === 'DCA') {
        h.shares += tx.shares
        h.cost += tx.amount + tx.fee
      } else if (tx.action === 'SELL') {
        const avg = h.shares > 0 ? h.cost / h.shares : 0
        h.shares -= tx.shares
        h.cost -= tx.shares * avg
      }
    })
    Object.values(eoyMap).forEach(v => { if (v.shares > 0) eoyCost += v.cost })

    return { totalRealized, ytdRealized, eoyCost }
  }, [transactions, currentYear])

  const totalCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const totalMV   = holdings.reduce((s, h) => s + h.market_value, 0)
  const totalUnrealized = holdings.reduce((s, h) => s + h.unrealized_pnl, 0)
  
  const totalPnl = totalRealized + totalUnrealized
  const pnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0

  const yearPnl = (ytdRealized || 0) + totalUnrealized // YTD Realized + Current Unrealized
  const yearPnlPct = eoyCost > 0 ? (yearPnl / eoyCost) * 100 : 0

  const [expanded, setExpanded] = useState<string | null>(null)

  const yearAchieved = settings.year_goal > 0 ? (yearPnl / settings.year_goal) * 100 : null
  const totalAchieved = settings.total_goal > 0 ? (totalMV / settings.total_goal) * 100 : null

  return (
    <div className="p-3 md:p-4 space-y-4">
      {/* 1. 持股概覽卡片 */}
      <div className="glass rounded-2xl p-4 md:p-5 relative overflow-hidden border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-black opacity-30 uppercase tracking-widest">
            Portfolio Overview · {holdings.length} Positions
          </span>
          <button onClick={onRefresh}
            className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-white/40 border border-white/10 active:bg-white/10 font-bold transition-colors">
            REFRESH
          </button>
        </div>

        <div className="space-y-5 mb-6">
          {/* 第一列：投入成本、目前市值 */}
          <div className="flex items-center">
            <StatBox label="投入成本" value={fmtMoney(totalCost)} className="w-1/2 text-center px-1" />
            <StatBox 
              label="目前市值" 
              value={fmtMoney(totalMV)} 
              className="w-1/2 text-center px-1" 
              upDown={totalMV > totalCost ? 1 : totalMV < totalCost ? -1 : 0}
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
          {/* 年度目標 */}
          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-black text-white/40 flex items-center gap-1.5">
                📈 年度目標
              </span>
              {settings.year_goal > 0 ? (
                <span className={`text-[11px] font-black font-mono ${yearPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {fmtMoney(Math.round(yearPnl))} / {yearAchieved?.toFixed(1)}%
                </span>
              ) : (
                <a href="#settings" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' })); }} className="text-[10px] font-bold text-gold active:opacity-50">點此設定目標 →</a>
              )}
            </div>
            {settings.year_goal > 0 && (
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-1000 ${yearPnl >= 0 ? 'bg-red-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(100, Math.max(0, yearAchieved || 0))}%` }}
                />
              </div>
            )}
          </div>

          {/* 總目標 */}
          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-black text-white/40 flex items-center gap-1.5">
                🏆 總目標
              </span>
              {settings.total_goal > 0 ? (
                <span className="text-[11px] font-black font-mono text-gold">
                  {fmtMoney(totalMV)} / {totalAchieved?.toFixed(1)}%
                </span>
              ) : (
                <a href="#settings" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' })); }} className="text-[10px] font-bold text-gold active:opacity-50">點此設定目標 →</a>
              )}
            </div>
            {settings.total_goal > 0 && (
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-1000 ${(totalAchieved || 0) >= 50 ? 'bg-gold' : 'bg-white/20'}`}
                  style={{ width: `${Math.min(100, Math.max(0, totalAchieved || 0))}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. 損益月曆區塊 */}
      <div className="px-0.5">
        <IntegratedCalendar entries={calEntries} transactions={transactions} onRefresh={onRefreshCal} />
      </div>

      {/* 3. 各持股明細列表 */}
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
      // 1. Calculate holdings up to this date
      const map: Record<string, { shares: number, cost: number }> = {}
      transactions.filter(t => t.trade_date <= dateStr).forEach(tx => {
        if (!map[tx.symbol]) map[tx.symbol] = { shares: 0, cost: 0 }
        const h = map[tx.symbol]
        if (tx.action === 'BUY' || tx.action === 'DCA') {
          h.shares += tx.shares
          h.cost += tx.amount + tx.fee
        } else if (tx.action === 'SELL') {
          const avgCost = h.shares > 0 ? h.cost / h.shares : 0
          h.shares -= tx.shares
          h.cost -= tx.shares * avgCost
        }
      })

      const heldSymbols = Object.entries(map)
        .filter(([, v]) => v.shares > 0)
        .map(([s]) => s)

      if (heldSymbols.length === 0) {
        setDayDetails([])
        return
      }

      // 2. Fetch historical quotes for these symbols on that date
      const res = await fetch(`/api/stocks?symbols=${heldSymbols.join(',')}&date=${dateStr}`)
      if (!res.ok) throw new Error('Failed to fetch historical quotes')
      const quotes: Record<string, Quote> = await res.json()

      // 3. Compute final details
      const details = heldSymbols.map(sym => {
        const h = map[sym]
        const q = quotes[sym]
        const price = q?.price || 0
        const mv = Math.round(price * h.shares)
        const pnl = mv - h.cost
        const pnl_pct = h.cost > 0 ? (pnl / h.cost) * 100 : 0
        return {
          symbol: sym,
          name_zh: q?.name_zh || getStockName(sym),
          shares: h.shares,
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
          {/* Header styled like DatePicker */}
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

        {/* View: CALENDAR */}
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
              } else if (entry) {
                bgColor = 'rgba(255, 255, 255, 0.05)'
              }

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

        {/* View: YEAR Grid */}
        {view === 'YEAR' && (
          <div className="grid grid-cols-3 gap-2 py-2">
            {(() => {
              const thisYear = new Date().getFullYear()
              const years = []
              for (let y = thisYear - 7; y <= thisYear + 2; y++) {
                years.push(y)
              }
              return years.map(y => (
                <button
                  key={y}
                  onClick={() => {
                    setViewDate(new Date(y, viewDate.getMonth(), 1))
                    setView('CALENDAR')
                  }}
                  className={`py-3 rounded-xl text-sm font-black transition-all ${
                    year === y ? 'bg-[#c9a564] text-[#0d1018]' : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {y}
                </button>
              ))
            })()}
          </div>
        )}

        {/* View: MONTH Grid */}
        {view === 'MONTH' && (
          <div className="grid grid-cols-3 gap-2 py-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <button
                key={m}
                onClick={() => {
                  setViewDate(new Date(year, m - 1, 1))
                  setView('CALENDAR')
                }}
                className={`py-3 rounded-xl text-sm font-black transition-all ${
                  month === m ? 'bg-[#c9a564] text-[#0d1018]' : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {m}月
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Date Detail View Card */}
      {selectedDate && (
        <div className="animate-in fade-in slide-in-from-top-2">
          <div className="glass rounded-2xl p-4 border border-white/10 space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <h3 className="font-black text-sm text-white">
                {selectedDate.split('-')[1]}月{selectedDate.split('-')[2]}日 持股細項
              </h3>
              {loadingDetails && <div className="text-[10px] text-gold animate-pulse font-bold">載入中...</div>}
            </div>

            {dayDetails ? (
              dayDetails.length === 0 ? (
                <div className="text-center py-4 text-xs text-white/20 italic">當天無持股</div>
              ) : (
                <div className="space-y-3">
                  {dayDetails.map(det => (
                    <div key={det.symbol} className="flex items-center justify-between gap-4 py-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-xs text-white truncate">{det.name_zh}</span>
                          <span className="text-[9px] font-mono text-white/30">{codeOnly(det.symbol)}</span>
                        </div>
                        <div className="text-[10px] font-bold text-white/40">
                          {det.shares.toLocaleString()} 股 @ {det.price.toFixed(2)}
                        </div>
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
              <span className="font-mono px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 text-white/40">
                {codeOnly(h.symbol)}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gold-dim text-gold">
                {h.shares >= 1000 ? `${(h.shares/1000).toFixed(h.shares%1000===0?0:2)}張` : `${h.shares}股`}
              </span>
            </div>
            <div className="text-[11px] mt-1 font-mono text-white/40">
              平均成本 {h.avg_cost.toFixed(2)} · 持有成本 {fmtMoney(h.total_cost)}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-black text-lg font-mono text-white leading-tight">
              {h.current_price > 0 ? h.current_price.toFixed(2) : '—'}
            </div>
            {q && q.change !== undefined && (
              <div className={`text-[11px] font-mono ${q.change >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)} ({q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)
              </div>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className={`font-bold font-mono text-sm ${color}`}>
            {isUp ? '+' : ''}{fmtMoney(h.unrealized_pnl)} 元
          </span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${dimBg} ${color}`}>
            {arrow} {Math.abs(h.pnl_pct).toFixed(2)}%
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2 bg-white/5">
          <div className="text-[10px] font-bold opacity-30 uppercase tracking-widest mb-1 pl-1">交易紀錄</div>
          {txs.map(t => (
            <TxRow key={t.id} t={t} settings={settings} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({ t, settings, onUpdated }: { t: Transaction; settings: UserSettings; onUpdated: () => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  
  // Form states
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

  // Validation
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
        <div className="flex flex-col items-center">
          <Label>交易日期</Label>
          <DatePicker value={date} onChange={setDate} />
        </div>

        <div className="space-y-2">
          <Label>交易方式</Label>
          <div className="flex gap-2">
            <button 
              onClick={() => setTradeType('FULL')} 
              className={`flex-1 h-10 rounded-lg text-[10px] font-black transition-all border ${
                tradeType === 'FULL' 
                  ? 'bg-[#c9a56433] text-gold border-gold' 
                  : 'bg-transparent text-white/30 border-white/10'
              }`}
            >
              整張 (1000股)
            </button>
            <button 
              onClick={() => setTradeType('FRACTIONAL')} 
              className={`flex-1 h-10 rounded-lg text-[10px] font-black transition-all border ${
                tradeType === 'FRACTIONAL' 
                  ? 'bg-[#c9a56433] text-gold border-gold' 
                  : 'bg-transparent text-white/30 border-white/10'
              }`}
            >
              零股
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
            <input 
              type="number" inputMode="numeric" 
              value={tradeType === 'FULL' ? lots : shares} 
              onFocus={(e) => {
                if (tradeType === 'FULL') setLots('')
                else setShares('')
              }}
              onChange={e => { 
                const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
                if (tradeType === 'FULL') setLots(v)
                else setShares(v)
              }} 
              className="w-full input-base text-center h-12 font-black font-mono text-lg bg-white/5 border-white/10" 
            />
            {tradeType === 'FULL' && lots !== '' && (
              <div className="text-[10px] text-center mt-1 text-white/30 font-bold">= {(Number(lots)*1000).toLocaleString()} 股</div>
            )}
          </div>
          <div>
            <Label>成交價</Label>
            <input 
              type="number" inputMode="decimal" step="0.01" 
              value={price} 
              onFocus={() => setPrice('')}
              onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} 
              className="w-full input-base text-center h-12 font-black font-mono text-lg bg-white/5 border-white/10" 
            />
          </div>
        </div>

        <div>
          <Label>備註</Label>
          <input value={monthNote} onChange={e => setMonthNote(e.target.value)} className="w-full input-base py-3 px-4 text-sm bg-white/5 border-white/10" placeholder="點此輸入備註..." />
        </div>

        <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10 text-xs font-bold">
          <div className="flex justify-between">
            <span className="opacity-40">手續費</span>
            <span className="font-mono text-white">{fmtMoney(fee)}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-white/5">
            <span className="opacity-60 uppercase text-[10px]">預估淨收支</span>
            <span className={`text-lg font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {net >= 0 ? '+' : ''}{fmtMoney(net)}
            </span>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button 
            onClick={handleSave} 
            disabled={!isValid || loading} 
            className="w-3/4 py-4 rounded-xl font-black text-sm transition-all active:scale-95"
            style={isValid ? { 
              background: 'linear-gradient(135deg, #c9a564, #e8c880)', 
              color: '#0d1018',
              fontWeight: 800 
            } : {
              background: '#444',
              color: '#888',
              cursor: 'not-allowed',
              opacity: 0.5
            }}
          >
            {loading ? '儲存中...' : '儲存修改'}
          </button>
          <button 
            onClick={() => setIsEditing(false)} 
            className="w-1/4 py-4 rounded-xl font-bold text-sm bg-white/10 text-white/60 active:scale-95 transition-all"
          >
            取消
          </button>
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
            {t.trade_type === 'DCA' ? (
              <span className="text-[9px] font-black px-1 py-0.5 rounded bg-gold-dim text-gold border border-gold/20 leading-none">定期定額</span>
            ) : isBuy ? (
              <span className="text-[9px] font-black px-1 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20 leading-none">買入</span>
            ) : (
              <span className="text-[9px] font-black px-1 py-0.5 rounded bg-green-400/10 text-green-400 border border-green-400/20 leading-none">賣出</span>
            )}
          </div>
          <div className="text-sm font-bold text-white/90">
            {t.shares}股 @ {t.price}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`text-base font-mono font-black ${t.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
          {t.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(t.net_amount))}
        </div>
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
