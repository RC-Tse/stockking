'use client'

import { useState, useEffect, useMemo } from 'react'
import { CalendarEntry, fmtMoney } from '@/types'

interface Props {
  entries: CalendarEntry[]
  onRefresh: (year: number, month: number) => void
}

export default function CalendarTab({ entries, onRefresh }: Props) {
  const now = new Date()
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1))

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1

  useEffect(() => { onRefresh(year, month) }, [year, month, onRefresh])

  const days = useMemo(() => {
    const firstDow = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }, [year, month])

  const entryMap = useMemo(() => {
    const map: Record<number, CalendarEntry> = {}
    for (const e of entries) {
      const day = parseInt(e.entry_date.split('-')[2], 10)
      map[day] = e
    }
    return map
  }, [entries])

  const stats = useMemo(() => {
    const vals = Object.values(entryMap)
    const active = vals.filter(e => Math.abs(e.daily_pnl || 0) > 0.1)
    const totalPnl = active.reduce((s, e) => s + (e.daily_pnl || 0), 0)
    const winDays = active.filter(e => (e.daily_pnl || 0) > 0).length
    const lossDays = active.filter(e => (e.daily_pnl || 0) < 0).length
    const winRate = active.length ? (winDays / active.length * 100).toFixed(1) : '0.0'
    return { totalPnl, winDays, lossDays, winRate }
  }, [entryMap])

  function moveMonth(delta: number) {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1))
  }

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Summary Header */}
      <div className="glass rounded-2xl p-4 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <button onClick={() => moveMonth(-1)} className="p-2 text-xl opacity-50 hover:opacity-100">←</button>
          <h2 className="font-black text-xl tracking-tight" style={{ color: 'var(--t1)' }}>{year} 年 {month} 月</h2>
          <button onClick={() => moveMonth(1)} className="p-2 text-xl opacity-50 hover:opacity-100">→</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-60">當月資產變動</div>
            <div className={`text-2xl font-black font-mono ${stats.totalPnl >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              {stats.totalPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(stats.totalPnl))}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-60">勝率 (活躍)</div>
            <div className="text-2xl font-black font-mono text-cyan-400">
              {stats.winRate}% <span className="text-xs opacity-40 ml-1">({stats.winDays + stats.lossDays}天)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {['日', '一', '二', '三', '四', '五', '六'].map((d, idx) => (
          <div key={d} className={`text-center text-[11px] font-bold py-2 ${idx === 0 || idx === 6 ? 'text-orange-400' : 'opacity-40'}`}>{d}</div>
        ))}

        {days.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} className="aspect-square" />

          const e = entryMap[d]
          const isToday = year === now.getFullYear() && month === (now.getMonth() + 1) && d === now.getDate()
          const pct = e?.daily_pnl_pct ?? 0
          
          // Heatmap logic
          const intensity = Math.min(Math.abs(pct) / 10, 1)
          const bgStyle: React.CSSProperties = e ? {
            backgroundColor: pct > 0 
              ? `rgba(239, 68, 68, ${intensity})` 
              : pct < 0 
                ? `rgba(34, 197, 94, ${intensity})`
                : 'rgba(255, 255, 255, 0.03)'
          } : { backgroundColor: 'rgba(255, 255, 255, 0.01)' }

          return (
            <div
              key={d}
              className={`aspect-square rounded-xl p-1 flex flex-col border transition-all duration-300
                ${isToday ? 'border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.3)] z-10' : 'border-white/5'}`}
              style={bgStyle}
            >
              <div className="flex justify-between items-start">
                <span className={`text-[10px] font-black ${isToday ? 'text-amber-400' : 'opacity-60'}`}>{d}</span>
                {e?.note && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-sm animate-pulse" />}
              </div>

              {e && (Math.abs(e.daily_pnl ?? 0) > 0.1 || Math.abs(e.realized_pnl ?? 0) > 0.1) && (
                <div className="flex-1 flex flex-col justify-center items-center space-y-0.5">
                  {/* Daily PnL */}
                  <div className="flex-1 flex flex-col justify-center items-center">
                    <span className="text-[10px] font-black font-mono leading-none text-white">
                      {(e.daily_pnl ?? 0) > 0 ? '+' : ''}{shortNum(e.daily_pnl ?? 0)}
                    </span>
                    <span className="text-[8px] font-bold font-mono leading-none text-white/90">
                      {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
                    </span>
                  </div>

                  {/* Realized PnL (if any) */}
                  {Math.abs(e.realized_pnl ?? 0) > 0.1 && (
                    <div className="flex-1 flex flex-col justify-center items-center pt-0.5 border-t border-white/20 w-full">
                      <span className="text-[10px] font-black font-mono text-yellow-300 leading-none">
                        {(e.realized_pnl ?? 0) > 0 ? '+' : ''}{shortNum(e.realized_pnl ?? 0)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function shortNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (a >= 1000) return Math.floor(v / 1000) + 'K'
  return String(Math.round(v))
}
