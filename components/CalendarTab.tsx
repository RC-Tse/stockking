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

  useEffect(() => {
    onRefresh(year, month)
  }, [year, month, onRefresh])

  const days = useMemo(() => {
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const cells = []
    
    // 前面補空格
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(null)
    }
    
    // 加入當月所有日期
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(d)
    }
    return cells
  }, [year, month])

  const entryMap = useMemo(() => {
    const map: Record<number, CalendarEntry> = {}
    entries.forEach(e => {
      // 安全解析日期，避免時區造成誤差
      const day = parseInt(e.entry_date.split(\'-\')[2], 10)
      map[day] = e
    })
    return map
  }, [entries])

  // Stats
  const stats = useMemo(() => {
    const active = entries.filter(e => e.pnl !== 0)
    const totalPnl = active.reduce((s, e) => s + e.pnl, 0)
    const winDays = active.filter(e => e.pnl > 0).length
    const lossDays = active.filter(e => e.pnl < 0).length
    const winRate = active.length ? (winDays / active.length * 100).toFixed(1) : '0.0'
    return { totalPnl, winDays, lossDays, winRate }
  }, [entries])

  function moveMonth(delta: number) {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1))
  }

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* ── Header & Stats ─────────────────────────────────── */}
      <div className="glass rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => moveMonth(-1)} className="btn-ghost p-2 text-lg">‹</button>
          <h2 className="font-black text-lg" style={{ color: 'var(--t1)' }}>{year}年 {month}月</h2>
          <button onClick={() => moveMonth(1)} className="btn-ghost p-2 text-lg">›</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--t3)' }}>本月總損益</div>
            <div className="text-lg font-black font-mono" style={{ color: stats.totalPnl >= 0 ? 'var(--red)' : 'var(--grn)' }}>
              {stats.totalPnl >= 0 ? '+' : ''}{fmtMoney(stats.totalPnl)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--t3)' }}>勝率 / 交易天數</div>
            <div className="text-lg font-black font-mono" style={{ color: 'var(--gold)' }}>
              {stats.winRate}% <span className="text-xs opacity-50">({entries.filter(e => e.pnl !== 0).length}天)</span>
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

      {/* ── Calendar Grid ──────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1">
        {['日','一','二','三','四','五','六'].map(d => (
          <div key={d} className="text-center text-[10px] font-bold py-2" style={{ color: 'var(--t3)' }}>{d}</div>
        ))}
        {days.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} className="aspect-square" />
          const entry = entryMap[d]
          const isToday = year === now.getFullYear() && month === (now.getMonth()+1) && d === now.getDate()
          
          return (
            <div key={d} 
              className={`aspect-square rounded-lg flex flex-col items-center justify-between p-1 border transition-all ${isToday ? 'border-gold shadow-[0_0_10px_rgba(201,165,100,0.3)]' : 'border-white/5'}`}
              style={{ background: 'var(--bg-surface)' }}>
              <span className="text-[10px] font-bold self-start" style={{ color: isToday ? 'var(--gold)' : 'var(--t2)' }}>{d}</span>
              {entry && entry.pnl !== 0 && (
                <div className="w-full text-center">
                  <div className="text-[9px] font-black font-mono leading-none mb-0.5" 
                    style={{ color: entry.pnl >= 0 ? 'var(--red)' : 'var(--grn)' }}>
                    {entry.pnl > 0 ? '+' : ''}{shortMoney(entry.pnl)}
                  </div>
                  {entry.note && <div className="w-1 h-1 rounded-full bg-gold mx-auto" />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function shortMoney(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (abs >= 1000) return (v / 1000).toFixed(1) + 'K'
  return v.toString()
}
