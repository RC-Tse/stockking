'use client'

import { useState, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, TrendingUp, TrendingDown, ClipboardList } from 'lucide-react'
import { CalendarEntry, Transaction, Quote, getStockName, codeOnly, fmtMoney } from '@/types'

interface Props {
  entries: CalendarEntry[]
  transactions: Transaction[]
  onRefresh: (year: number, month: number) => void
  holdings: any[]
  quotes: Record<string, Quote>
  settings: any
  loading?: boolean
}

export default function IntegratedCalendar({ entries, transactions, onRefresh, holdings, quotes, settings, loading: externalLoading }: Props) {
  const [viewDate, setViewDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  
  const year = viewDate.getFullYear(), month = viewDate.getMonth() + 1

  useEffect(() => {
    onRefresh(year, month)
  }, [year, month, onRefresh])

  const days = useMemo(() => {
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const cells = []
    for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }, [year, month])

  const entryMap = useMemo(() => {
    const map: Record<number, CalendarEntry> = {}
    entries?.forEach((e: CalendarEntry) => {
      const day = parseInt(e.entry_date.split('-')[2], 10)
      map[day] = e
    })
    return map
  }, [entries])

  const selectedEntry = useMemo(() => {
    if (!selectedDate) return null
    const d = parseInt(selectedDate.split('-')[2], 10)
    return entryMap[d]
  }, [selectedDate, entryMap])

  // Skeleton loading grid
  const isInitialLoading = !entries || (entries.length === 0 && externalLoading)

  return (
    <div className="space-y-6">
      <div className="card-base p-5 space-y-6 border-white/10 shadow-2xl bg-black/20">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewDate(new Date(year, month - 2, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-accent active:scale-95 border border-white/10 transition-all shadow-lg hover:bg-white/10"><ChevronLeft size={20}/></button>
          <div className="flex items-center gap-3 font-black text-[var(--t1)] text-xl">
            <span className="tracking-tight">{year}年 {month}月</span>
            {externalLoading && <RefreshCw size={14} className="animate-spin text-accent" />}
          </div>
          <button onClick={() => setViewDate(new Date(year, month, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-accent active:scale-95 border border-white/10 transition-all shadow-lg hover:bg-white/10"><ChevronRight size={20}/></button>
        </div>

        {isInitialLoading ? (
          <div className="grid grid-cols-7 gap-1.5 animate-pulse">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="min-h-[68px] rounded-xl bg-white/5 border border-white/5" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {['日','一','二','三','四','五','六'].map((d, i) => <div key={d} className={`text-center text-[10px] font-black py-1 uppercase tracking-widest ${i===0?'text-red-400':i===6?'text-accent':'text-[var(--t3)]'}`}>{d}</div>)}
            {days.map((d, i) => {
              if (d === null) return <div key={`empty-${i}`} className="min-h-[60px]" />
              const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
              const entry = entryMap[d]
              const isToday = new Date().toISOString().split('T')[0] === dateStr
              const isSelected = selectedDate === dateStr
              return (
                <CalendarCell 
                  key={d} 
                  day={d} 
                  entry={entry} 
                  isToday={isToday} 
                  isSelected={isSelected}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                />
              )
            })}
          </div>
        )}
      </div>

      {selectedEntry && (
        <div className="animate-slide-up space-y-4">
          <div className="flex items-end justify-between px-2">
            <div>
              <h3 className="text-sm font-black text-[var(--t1)] flex items-center gap-2">
                <ClipboardList size={14} className="text-accent" /> 
                {selectedEntry.entry_date} 持股明細
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-black font-mono ${(selectedEntry.daily_pnl ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(selectedEntry.daily_pnl ?? 0) >= 0 ? '+' : ''}{fmtMoney(Math.round(selectedEntry.daily_pnl ?? 0))}
                </span>
                <span className={`text-[10px] font-black bg-white/5 px-1.5 py-0.5 rounded ${(selectedEntry.daily_pnl_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(selectedEntry.daily_pnl_pct ?? 0) >= 0 ? '+' : ''}{(selectedEntry.daily_pnl_pct ?? 0).toFixed(2)}%
                </span>
                {selectedEntry.is_market_closed && (
                  <span className="text-[10px] pb-1 font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/20" /> 當天休市
                  </span>
                )}
              </div>
            </div>
            {selectedEntry.note && (
              <div className="text-right max-w-[50%]">
                <div className="text-[9px] font-black text-[var(--t3)] uppercase tracking-widest mb-0.5">當日備註</div>
                <div className="text-[11px] font-bold text-yellow-400 italic truncate">{selectedEntry.note}</div>
              </div>
            )}
          </div>

          {selectedEntry.is_market_closed ? (
            <div className="card-base p-16 border-dashed border-white/10 bg-white/5 flex flex-col items-center justify-center space-y-3 opacity-60">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                <RefreshCw size={24} className="text-white/20 rotate-45" />
              </div>
              <div className="text-sm font-black text-white/40 tracking-widest uppercase">當天未開盤</div>
            </div>
          ) : (
            <div className="space-y-4 tabular-nums">
              {selectedEntry.details?.map(det => {
                const isUp = det.change >= 0
                const isPnlUp = det.stock_daily_pnl >= 0
                const pillColor = isUp ? 'bg-red-400/20 text-red-400' : 'bg-green-400/20 text-green-400'
                const pnlColor = isPnlUp ? 'text-red-400' : 'text-green-400'
                
                return (
                  <div key={det.symbol} className="card-base p-5 border-white/10 bg-black/40 shadow-xl space-y-4 animate-slide-up">
                    {/* First Row: Name and Symbol */}
                    <div className="flex justify-between items-baseline">
                      <span className="text-xl font-black text-[var(--t1)]">{det.name}</span>
                      <span className="text-xs font-bold text-[var(--t3)] tracking-wider">{codeOnly(det.symbol)}</span>
                    </div>

                    {/* Second Row: Market Context & Change Pill */}
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-bold text-[var(--t2)] opacity-80">
                        {det.shares.toLocaleString()} 股 · 收盤 {det.price.toFixed(2)}
                      </div>
                      <div className={`px-2.5 py-1 rounded-lg font-black text-[11px] flex items-center gap-1.5 shadow-sm ${pillColor}`}>
                        {isUp ? '▲' : '▼'} {Math.abs(det.change).toFixed(2)} ({Math.abs(det.change_pct).toFixed(2)}%)
                      </div>
                    </div>

                    <div className="h-px bg-white/5" />

                    {/* Third Row: Labels */}
                    <div className="flex justify-between">
                      <span className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest">持有成本 / 預估淨市值</span>
                      <span className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest">當日損益</span>
                    </div>

                    {/* Fourth Row: Values */}
                    <div className="flex justify-between items-end">
                      <div className="text-[18px] font-black font-mono text-[var(--t1)]">
                        {fmtMoney(Math.round(det.cost))} <span className="mx-1 opacity-20">/</span> {fmtMoney(Math.round(det.mv))}
                      </div>
                      <div className={`text-[18px] font-black font-mono ${pnlColor}`}>
                        {isPnlUp ? '+' : ''}{fmtMoney(Math.round(det.stock_daily_pnl))} <span className="text-[13px] ml-0.5">({det.stock_daily_pnl_pct.toFixed(2)}%)</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CalendarCell({ day, entry, isToday, isSelected, onClick }: any) {
  const pct = entry?.daily_pnl_pct || 0
  const intensity = Math.min(Math.abs(pct) / 10, 1)
  const hasRealized = Math.abs(entry?.realized_pnl || 0) > 0.1
  
  let bg = 'rgba(255,255,255,0.02)'
  if (pct > 0.01) bg = `rgba(239, 68, 68, ${intensity * 0.8 + 0.1})`
  else if (pct < -0.01) bg = `rgba(34, 197, 94, ${intensity * 0.8 + 0.1})`

  return (
    <div 
      onClick={onClick}
      className={`relative min-h-[68px] rounded-xl border transition-all cursor-pointer flex flex-col p-1.5 overflow-hidden ${
        isSelected ? 'border-accent ring-2 ring-accent/20 z-10 scale-[1.03] shadow-lg shadow-black/40' : 
        isToday ? 'border-amber-400/50 shadow-amber-400/10' : 'border-white/5 active:bg-white/5'
      }`}
      style={{ background: bg }}
    >
      <div className="flex justify-between items-start w-full mb-1">
        <span className={`text-[10px] font-black leading-none ${isToday ? 'text-amber-400' : isSelected ? 'text-white' : 'text-white/40'}`}>{day}</span>
        {entry?.hasTransactions && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />}
      </div>

      {entry && (
        <div className="flex-1 flex flex-col gap-0.5">
          <div className="flex-1 flex flex-col justify-center items-center">
            <span className="text-[10px] font-black font-mono leading-none tracking-tighter text-white drop-shadow-md">
              {(entry.daily_pnl ?? 0) > 0 ? '+' : ''}{shortNum(entry.daily_pnl ?? 0)}
            </span>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center">
            <span className="text-[8px] font-black font-mono leading-none text-white/90 drop-shadow-sm">
              {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
            </span>
          </div>
          {hasRealized && (
            <div className="flex-1 flex flex-col justify-center items-center pt-0.5 border-t border-white/20">
              <span className="text-[8px] font-black font-mono text-yellow-300 leading-none drop-shadow-md">
                {(entry.realized_pnl ?? 0) > 0 ? '+' : ''}{shortNum(entry.realized_pnl ?? 0)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function shortNum(v: number): string {
  const abs = Math.abs(v), sign = v < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}${(abs/1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}${(abs/1000).toFixed(1)}K`
  return `${sign}${Math.round(abs)}`
}
