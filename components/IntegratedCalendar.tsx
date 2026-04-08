'use client'

import { useState, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { CalendarEntry, Transaction, Quote, getStockName, codeOnly } from '@/types'

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
  const [dayDetails, setDayDetails] = useState<any[] | null>(null)
  const [isHoliday, setIsHoliday] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const year = viewDate.getFullYear(), month = viewDate.getMonth() + 1

  // Effect to trigger data refresh when month changes
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

  const hasTxMap = useMemo(() => {
    const map: Record<number, boolean> = {}
    transactions?.forEach((t: Transaction) => {
      const dParts = t.trade_date.split('-')
      if (parseInt(dParts[0]) === year && parseInt(dParts[1]) === month) {
        map[parseInt(dParts[2])] = true
      }
    })
    return map
  }, [transactions, year, month])

  const toggleDate = async (dateStr: string) => {
    if (selectedDate === dateStr) { setSelectedDate(null); setDayDetails(null); setIsHoliday(false); return }
    setSelectedDate(dateStr)
    setDetailLoading(true)
    setIsHoliday(false)
    const d = new Date(dateStr)
    const isWeekend = d.getDay() === 0 || d.getDay() === 6
    if (isWeekend) { setIsHoliday(true); setDayDetails([]); setDetailLoading(false); return }

    try {
      const held = holdings.map((h: any) => h.symbol)
      if (held.length === 0) { setDayDetails([]); setDetailLoading(false); return }
      const res = await fetch(`/api/stocks?symbols=${held.join(',')}&date=${dateStr}`)
      if (res.ok) {
        const results = await res.json()
        const details = holdings.map((h: any) => {
          const q = results[h.symbol] || {}
          return {
            symbol: h.symbol,
            name_zh: q.name_zh || getStockName(h.symbol),
            price: q.price,
            change_pct: q.change_pct
          }
        })
        setDayDetails(details)
      }
    } catch (e) {
      console.error(e)
    }
    setDetailLoading(false)
  }

  // Skeleton loading grid
  const isInitialLoading = !entries || (entries.length === 0 && externalLoading)

  return (
    <div className="card-base p-5 space-y-6 border-white/10 shadow-2xl bg-black/20">
      <div className="flex items-center justify-between">
        <button onClick={() => setViewDate(new Date(year, month - 2, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-accent active:scale-95 border border-white/10 transition-all shadow-lg hover:bg-white/10"><ChevronLeft size={20}/></button>
        <div className="flex items-center gap-3 font-black text-[var(--t1)] text-xl">
          <span className="tracking-tight">{year}年 {month}月</span>
          {(externalLoading || detailLoading) && <RefreshCw size={14} className="animate-spin text-accent" />}
        </div>
        <button onClick={() => setViewDate(new Date(year, month, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-accent active:scale-95 border border-white/10 transition-all shadow-lg hover:bg-white/10"><ChevronRight size={20}/></button>
      </div>

      {isInitialLoading ? (
        <div className="grid grid-cols-7 gap-2 animate-pulse">
           {Array.from({ length: 35 }).map((_, i) => (
             <div key={i} className="min-h-[62px] rounded-xl bg-white/5 border border-white/5" />
           ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
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
                dateStr={dateStr}
                entry={entry} 
                isToday={isToday} 
                isSelected={isSelected}
                hasTx={hasTxMap[d]}
                onClick={() => toggleDate(dateStr)}
              />
            )
          })}
        </div>
      )}

      {selectedDate && (
        <div className="pt-4 border-t border-white/10 animate-slide-up space-y-4">
          <div className="flex justify-between items-center px-1">
             <span className="text-[13px] font-black text-[var(--t2)]">{selectedDate} 持股數據</span>
             <button onClick={() => setSelectedDate(null)} className="text-[11px] font-bold text-accent px-2 py-1 rounded-lg bg-accent/10 active:bg-accent/20">收合</button>
          </div>
          {dayDetails?.length ? (
            <div className="grid grid-cols-2 gap-3 pb-2">
              {dayDetails.map(det => (
                <div key={det.symbol} className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-[11px] font-black text-[var(--t1)] truncate">{det.name_zh}</div>
                  <div className="flex justify-between items-end mt-1">
                    <span className="text-[10px] font-bold text-[var(--t3)]">{codeOnly(det.symbol)}</span>
                    <span className={`text-[11px] font-black font-mono ${det.change_pct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {det.change_pct >= 0 ? '+' : ''}{det.change_pct?.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : !isHoliday ? (
            <div className="text-center py-4 opacity-50 text-[11px] font-bold">載入中...</div>
          ) : (
             <div className="text-center py-4 opacity-50 text-[11px] font-bold">休市日</div>
          )}
        </div>
      )}
    </div>
  )
}

function CalendarCell({ day, entry, isToday, isSelected, hasTx, onClick }: any) {
  const pct = entry?.daily_pnl_pct || 0
  const intensity = Math.min(Math.abs(pct) / 10, 1)
  
  let bg = 'rgba(255,255,255,0.02)'
  if (pct > 0.01) bg = `rgba(239, 68, 68, ${intensity})`
  else if (pct < -0.01) bg = `rgba(34, 197, 94, ${intensity})`

  return (
    <div 
      onClick={onClick}
      className={`relative min-h-[62px] rounded-xl border transition-all cursor-pointer flex flex-col p-1.5 overflow-hidden ${
        isSelected ? 'border-accent ring-2 ring-accent/20 z-10 scale-105 shadow-lg' : 
        isToday ? 'border-amber-400/50 shadow-amber-400/10' : 'border-white/5 active:bg-white/5'
      }`}
      style={{ background: bg }}
    >
      <div className="flex justify-between items-start w-full">
        <span className={`text-[10px] font-black leading-none ${isToday ? 'text-amber-400' : isSelected ? 'text-white' : 'text-white/40'}`}>{day}</span>
        {entry?.note && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />}
      </div>

      {entry && (
        <div className="flex-1 flex flex-col justify-center items-center mt-1">
          <div className="flex-1 flex flex-col justify-center items-center w-full">
            <span className="text-[10px] font-black font-mono leading-none tracking-tighter text-white drop-shadow-md">
              {(entry.daily_pnl ?? 0) > 0 ? '+' : ''}{shortNum(entry.daily_pnl ?? 0)}
            </span>
            <span className="text-[8px] font-black font-mono leading-none text-white/90 drop-shadow-sm mt-0.5">
              {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
            </span>
          </div>

          {(Math.abs(entry.realized_pnl ?? 0) > 0.1) && (
            <div className="flex-1 flex flex-col justify-center items-center pt-0.5 border-t border-white/10 w-full">
              <span className="text-[9px] font-black font-mono text-yellow-300 leading-none drop-shadow-md">
                {(entry.realized_pnl ?? 0) > 0 ? '+' : ''}{shortNum(entry.realized_pnl ?? 0)}
              </span>
            </div>
          )}
        </div>
      )}
      {hasTx && !entry && <div className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-white/20" />}
    </div>
  )
}

function shortNum(v: number): string {
  const abs = Math.abs(v), sign = v < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}${(abs/1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}${(abs/1000).toFixed(1)}K`
  return `${sign}${Math.round(abs)}`
}
