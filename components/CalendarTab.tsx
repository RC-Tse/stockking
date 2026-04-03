'use client'

import { useState, useEffect } from 'react'
import { CalendarEntry, fmtMoney } from '@/types'

interface Props {
  entries: CalendarEntry[]
  onRefresh: (year: number, month: number) => void
}

const DAYS_OF_WEEK = ['日','一','二','三','四','五','六']

// Compute heatmap color from PnL value (Taiwan: red=profit, green=loss)
function heatColor(pnl: number): string {
  if (pnl === 0) return 'transparent'
  const intensity = Math.min(1, Math.abs(pnl) / 30000)  // normalize to 30k
  const alpha = 0.15 + intensity * 0.65
  return pnl > 0
    ? `rgba(224,80,80,${alpha.toFixed(2)})`
    : `rgba(66,176,122,${alpha.toFixed(2)})`
}

function textColor(pnl: number): string {
  if (pnl === 0) return 'var(--t3)'
  return pnl > 0 ? 'var(--red)' : 'var(--grn)'
}

export default function CalendarTab({ entries, onRefresh }: Props) {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selected, setSelected] = useState<string | null>(null)
  const [editPnl,  setEditPnl]  = useState('')
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Build entry map
  const entryMap: Record<string, CalendarEntry> = {}
  for (const e of entries) entryMap[e.entry_date] = e

  // Month stats
  const monthPnl   = entries.reduce((s, e) => s + e.pnl, 0)
  const profitDays = entries.filter(e => e.pnl > 0).length
  const lossDays   = entries.filter(e => e.pnl < 0).length

  // Navigate months
  function prevMonth() {
    const d = new Date(year, month - 2, 1)
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1)
    onRefresh(d.getFullYear(), d.getMonth() + 1)
    setSelected(null)
  }
  function nextMonth() {
    const d = new Date(year, month, 1)
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1)
    onRefresh(d.getFullYear(), d.getMonth() + 1)
    setSelected(null)
  }

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay()  // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // pad to full rows
  while (cells.length % 7 !== 0) cells.push(null)

  function dateStr(day: number) {
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  function openEdit(day: number) {
    const ds = dateStr(day)
    setSelected(ds)
    const e = entryMap[ds]
    setEditPnl(e ? String(e.pnl) : '')
    setEditNote(e ? e.note : '')
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_date: selected, pnl: Number(editPnl) || 0, note: editNote }),
    })
    onRefresh(year, month)
    setSaving(false)
    setSelected(null)
  }

  async function remove() {
    if (!selected) return
    const e = entryMap[selected]
    if (!e) { setSelected(null); return }
    setSaving(true)
    await fetch('/api/calendar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: e.id }),
    })
    onRefresh(year, month)
    setSaving(false)
    setSelected(null)
  }

  return (
    <div className="p-4 space-y-3">

      {/* ── Month header ─────────────────────────────────────── */}
      <div className="glass rounded-2xl p-4" style={{ border: '1px solid var(--border-bright)' }}>
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="btn-ghost px-3 py-1.5 text-sm">‹</button>
          <div className="text-center">
            <div className="font-black text-base" style={{ color: 'var(--t1)' }}>
              {year} 年 {month} 月
            </div>
            <div className="text-xs font-mono" style={{ color: monthPnl >= 0 ? 'var(--red)' : 'var(--grn)' }}>
              本月 {monthPnl >= 0 ? '+' : ''}{fmtMoney(monthPnl)} 元
            </div>
          </div>
          <button onClick={nextMonth} className="btn-ghost px-3 py-1.5 text-sm">›</button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniStat label="獲利日" value={String(profitDays)} color="var(--red)" />
          <MiniStat label="虧損日" value={String(lossDays)}   color="var(--grn)" />
          <MiniStat label="勝率"
            value={profitDays + lossDays > 0 ? `${Math.round(profitDays / (profitDays + lossDays) * 100)}%` : '—'}
            color="var(--gold)" />
        </div>
      </div>

      {/* ── Calendar grid ────────────────────────────────────── */}
      <div className="glass rounded-xl p-3">
        {/* Week header */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_OF_WEEK.map(d => (
            <div key={d} className="text-center text-xs py-1 font-bold"
              style={{ color: d === '日' ? 'var(--red)' : d === '六' ? 'var(--gold)' : 'var(--t3)' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (!day) return <div key={`e-${idx}`} />
            const ds    = dateStr(day)
            const entry = entryMap[ds]
            const isToday = ds === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
            const isSel = selected === ds

            return (
              <button key={ds} onClick={() => openEdit(day)}
                className="cal-day"
                style={{
                  background: entry ? heatColor(entry.pnl) : isSel ? 'var(--gold-dim)' : 'transparent',
                  border: isToday
                    ? '1px solid var(--gold)'
                    : isSel ? '1px solid var(--border-bright)' : '1px solid transparent',
                  color: entry ? textColor(entry.pnl) : 'var(--t2)',
                }}>
                <span className="font-bold" style={{ fontSize: '12px' }}>{day}</span>
                {entry && (
                  <span style={{ fontSize: '9px', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>
                    {entry.pnl >= 0 ? '+' : ''}{entry.pnl >= 1000 ? `${(entry.pnl/1000).toFixed(0)}k` : entry.pnl}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Color legend ─────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 text-xs" style={{ color: 'var(--t3)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: 'rgba(224,80,80,0.6)' }} />
          獲利（紅）
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: 'rgba(66,176,122,0.6)' }} />
          虧損（綠）
        </div>
      </div>

      {/* ── Edit panel ───────────────────────────────────────── */}
      {selected && (
        <div className="glass rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--border-bright)' }}>
          <div className="font-bold text-sm" style={{ color: 'var(--t1)' }}>
            📝 {selected} 戰果
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--t2)' }}>當日損益（元）</label>
            <input
              type="number"
              value={editPnl}
              onChange={e => setEditPnl(e.target.value)}
              placeholder="正值=獲利 / 負值=虧損"
              className="input-base"
            />
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--t2)' }}>備註</label>
            <input
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
              placeholder="今天的操作筆記…"
              className="input-base"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary flex-1 py-2.5 text-sm">
              {saving ? '儲存中…' : '💾 儲存'}
            </button>
            {entryMap[selected] && (
              <button onClick={remove} disabled={saving} className="btn-ghost px-4 text-sm"
                style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}>
                刪除
              </button>
            )}
            <button onClick={() => setSelected(null)} className="btn-ghost px-4 text-sm">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-xs mb-0.5" style={{ color: 'var(--t3)' }}>{label}</div>
      <div className="font-black font-mono text-base" style={{ color }}>{value}</div>
    </div>
  )
}
