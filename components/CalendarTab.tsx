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

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1

  useEffect(() => { onRefresh(year, month) }, [year, month, onRefresh])

  // ── Calendar grid cells (null = empty padding) ────────────────────────────
  const days = useMemo(() => {
    const firstDow    = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }, [year, month])

  // ── Map day-number → enriched entry ──────────────────────────────────────
  const entryMap = useMemo(() => {
    const map: Record<number, any> = {}
    for (const e of entries) {
      const day = parseInt(e.entry_date.split('-')[2], 10)
      // Use server-calculated daily_pnl / daily_pnl_pct directly
      map[day] = {
        ...e,
        dailyPnL:   e.daily_pnl   ?? 0,
        dailyRate:  e.daily_pnl_pct ?? 0,
        hasRealized: Math.abs(e.realized_pnl ?? 0) > 0.01,
      }
    }
    return map
  }, [entries])

  // ── Monthly summary (sum of per-day daily_pnl) ────────────────────────────
  const stats = useMemo(() => {
    const vals = Object.values(entryMap)
    const active    = vals.filter(e => Math.abs(e.dailyPnL) > 0.01)
    const totalPnl  = active.reduce((s, e) => s + e.dailyPnL, 0)
    const winDays   = active.filter(e => e.dailyPnL > 0).length
    const lossDays  = active.filter(e => e.dailyPnL < 0).length
    const winRate   = active.length ? (winDays / active.length * 100).toFixed(1) : '0.0'
    return { totalPnl, winDays, lossDays, winRate }
  }, [entryMap])

  function moveMonth(delta: number) {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1))
  }

  return (
    <div className="p-4 space-y-4 pb-20">

      {/* ── Header & Summary ─────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => moveMonth(-1)} className="p-2 text-lg opacity-40 hover:opacity-100 transition-opacity">←</button>
          <h2 className="font-black text-lg" style={{ color: 'var(--t1)' }}>{year} 年 {month} 月</h2>
          <button onClick={() => moveMonth(1)}  className="p-2 text-lg opacity-40 hover:opacity-100 transition-opacity">→</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--t3)' }}>當月資產變動</div>
            <div className="text-lg font-black font-mono" style={{ color: stats.totalPnl >= 0 ? 'var(--red)' : 'var(--grn)' }}>
              {stats.totalPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(stats.totalPnl))}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--t3)' }}>勝率 / 活躍天</div>
            <div className="text-lg font-black font-mono" style={{ color: 'var(--accent)' }}>
              {stats.winRate}% <span className="text-xs opacity-50">({stats.winDays + stats.lossDays} 天)</span>
            </div>
          </div>
        </div>

        <div className="flex gap-4 text-center">
          <div className="flex-1">
            <div className="text-[10px] font-bold" style={{ color: 'var(--t3)' }}>獲利天數</div>
            <div className="text-sm font-black" style={{ color: 'var(--red)' }}>{stats.winDays} 天</div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-bold" style={{ color: 'var(--t3)' }}>虧損天數</div>
            <div className="text-sm font-black" style={{ color: 'var(--grn)' }}>{stats.lossDays} 天</div>
          </div>
        </div>
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1">

        {/* Day-of-week headers */}
        {['日','一','二','三','四','五','六'].map(d => (
          <div key={d} className="text-center text-[10px] font-bold py-2" style={{ color: 'var(--t3)' }}>{d}</div>
        ))}

        {/* Date cells */}
        {days.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} className="aspect-square" />

          const e        = entryMap[d]
          const isToday  = year === now.getFullYear() && month === (now.getMonth() + 1) && d === now.getDate()
          const hasNote  = !!(e?.note)
          const rate     = e?.dailyRate ?? 0

          // ── Heatmap background ─────────────────────────────────────────
          // intensity ∈ [0, 1], capped at 10% → opacity 1.0
          const intensity = Math.min(Math.abs(rate) / 10, 1)
          const bgStyle: React.CSSProperties = e
            ? rate > 0
              ? { backgroundColor: `rgba(239, 68, 68, ${intensity})` }   // Red-500  #EF4444
              : rate < 0
                ? { backgroundColor: `rgba(34, 197, 94, ${intensity})` } // Green-500 #22C55E
                : { background: 'var(--bg-surface)' }
            : { background: 'var(--bg-surface)' }

          return (
            <div
              key={d}
              className={`aspect-square rounded-lg flex flex-col p-1 border transition-all
                ${isToday ? 'border-accent shadow-[0_0_10px_var(--accent-dim)]' : 'border-white/5'}`}
              style={bgStyle}
            >
              {/* Date number + yellow indicator dot */}
              <div className="flex justify-between items-start">
                <span className="text-[9px] font-bold leading-none"
                  style={{ color: isToday ? 'var(--accent)' : 'var(--t3)' }}>
                  {d}
                </span>
                {hasNote && (
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_5px_rgba(250,204,21,0.9)]" />
                )}
              </div>

              {/* Data rows – only if there's meaningful data */}
              {e && (Math.abs(e.dailyPnL) > 0.01 || e.hasRealized) && (
                <div className="flex-1 flex flex-col mt-0.5">

                  {/* Row A – Realized (only shown when there is realized P&L) */}
                  {e.hasRealized && (
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <span className="text-[7px] font-bold opacity-50 leading-none tracking-wider uppercase">RLZD</span>
                      <span className="text-[9px] font-black font-mono leading-none mt-px"
                        style={{ color: e.realized_pnl > 0 ? 'var(--red)' : 'var(--grn)' }}>
                        {e.realized_pnl > 0 ? '+' : ''}{shortNum(e.realized_pnl)}
                      </span>
                    </div>
                  )}

                  {/* Row B – Daily PnL */}
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <span className="text-[7px] font-bold opacity-50 leading-none tracking-wider uppercase">DAILY</span>
                    <span className="text-[10px] font-black font-mono leading-none mt-px"
                      style={{ color: e.dailyPnL >= 0 ? 'var(--red)' : 'var(--grn)' }}>
                      {e.dailyPnL > 0 ? '+' : ''}{shortNum(e.dailyPnL)}
                    </span>
                  </div>

                  {/* Row C – Daily % */}
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <span className="text-[9px] font-bold font-mono leading-none"
                      style={{ color: rate >= 0 ? 'var(--red)' : 'var(--grn)', opacity: 0.85 }}>
                      {rate >= 0 ? '+' : ''}{rate.toFixed(2)}%
                    </span>
                  </div>

                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Abbreviation helper ───────────────────────────────────────────────────────
function shortNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (a >= 1_000)     return Math.floor(v / 1_000) + 'K'
  return String(Math.round(v))
}
