'use client'

import { useState } from 'react'
import { Holding, Quote, UserSettings, codeOnly, fmtMoney, Transaction } from '@/types'

interface Props {
  holdings: Holding[]
  quotes: Record<string, Quote>
  settings: UserSettings
  transactions: Transaction[]
  onRefresh: () => void
}

export default function HoldingsTab({ holdings, quotes, settings, transactions, onRefresh }: Props) {
  const totalCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const totalMV   = holdings.reduce((s, h) => s + h.market_value, 0)
  const totalPnl  = holdings.reduce((s, h) => s + h.unrealized_pnl, 0)
  const pnlPct    = totalCost ? totalPnl / totalCost * 100 : 0

  const [expanded, setExpanded] = useState<string | null>(null)

  if (holdings.length === 0) {
    return (
      <Empty
        icon="📭"
        text="尚無持股紀錄"
        sub={<>點右下角 <GoldSpan>+</GoldSpan> 新增第一筆交易</>}
      />
    )
  }

  return (
    <div className="p-4 space-y-3">
      {/* ── Summary card ───────────────────────────────────── */}
      <div className="glass rounded-2xl p-4 relative overflow-hidden"
        style={{ border: '1px solid var(--border-bright)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at top right, rgba(201,165,100,0.07) 0%, transparent 60%)' }} />

        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold" style={{ color: 'var(--t3)' }}>
            持股概覽 · {holdings.length}/{settings.max_holdings} 檔
          </span>
          <button onClick={onRefresh}
            className="text-xs px-2 py-0.5 rounded-lg transition-opacity active:opacity-60"
            style={{ background: 'var(--gold-dim)', color: 'var(--gold)', border: '1px solid var(--border-bright)' }}>
            重整
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatBox label="投入成本" value={shortMoney(totalCost)} />
          <StatBox label="目前市值" value={shortMoney(totalMV)} />
          <StatBox
            label="總盈虧比"
            value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
            upDown={totalPnl}
          />
        </div>
      </div>

      {/* ── Holding rows ───────────────────────────────────── */}
      {holdings
        .sort((a, b) => b.market_value - a.market_value)
        .map(h => (
          <HoldingItem
            key={h.symbol}
            h={h}
            q={quotes[h.symbol]}
            txs={transactions.filter(t => t.symbol === h.symbol)}
            isExpanded={expanded === h.symbol}
            onToggle={() => setExpanded(expanded === h.symbol ? null : h.symbol)}
            onUpdated={onRefresh}
          />
        ))
      }
    </div>
  )
}

function HoldingItem({ h, q, txs, isExpanded, onToggle, onUpdated }: {
  h: Holding; q?: Quote; txs: Transaction[]; isExpanded: boolean; onToggle: () => void; onUpdated: () => void
}) {
  const isUp = h.unrealized_pnl >= 0
  const color = isUp ? 'var(--red)' : 'var(--grn)'
  const dimBg = isUp ? 'var(--red-dim)' : 'var(--grn-dim)'
  const arrow = isUp ? '▲' : '▼'

  return (
    <div className="glass rounded-xl overflow-hidden transition-all duration-300"
      style={{ border: isExpanded ? '1px solid var(--gold)' : '1px solid var(--border)' }}>
      <div className="p-3.5 cursor-pointer active:bg-white/5" onClick={onToggle}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-base" style={{ color: 'var(--t1)' }}>{q?.name || h.symbol}</span>
              <span className="font-mono px-1.5 py-0.5 rounded-md text-xs"
                style={{ background: 'var(--bg-hover)', color: 'var(--t2)' }}>
                {codeOnly(h.symbol)}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full"
                style={{ background: 'var(--gold-dim)', color: 'var(--gold)' }}>
                {h.shares >= 1000 ? `${(h.shares/1000).toFixed(h.shares%1000===0?0:2)}張` : `${h.shares}股`}
              </span>
            </div>
            <div className="text-xs mt-1 font-mono" style={{ color: 'var(--t2)' }}>
              均成 {h.avg_cost.toFixed(2)} · 持成 {fmtMoney(h.total_cost)}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-black text-lg font-mono" style={{ color: 'var(--t1)' }}>
              {h.current_price > 0 ? h.current_price.toFixed(2) : '—'}
            </div>
            {q && q.change !== undefined && (
              <div className="text-xs font-mono" style={{ color: q.change >= 0 ? 'var(--red)' : 'var(--grn)' }}>
                {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)} ({q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)
              </div>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-bold font-mono text-sm" style={{ color }}>
            {isUp ? '+' : ''}{fmtMoney(h.unrealized_pnl)} 元
          </span>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
            style={{ background: dimBg, color }}>
            {arrow} {Math.abs(h.pnl_pct).toFixed(2)}%
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t px-3 py-2 space-y-2 bg-white/5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--t3)' }}>交易紀錄</div>
          {txs.map(t => (
            <TxRow key={t.id} t={t} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({ t, onUpdated }: { t: Transaction; onUpdated: () => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)

  // Edit fields
  const [date, setDate] = useState(t.trade_date)
  const [shares, setShares] = useState(t.shares)
  const [price, setPrice] = useState(t.price)
  const [note, setNote] = useState(t.note)

  const isBuy = t.action === 'BUY' || t.action === 'DCA'

  async function handleSave() {
    setLoading(true)
    await fetch('/api/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, trade_date: date, shares, price, note })
    })
    setIsEditing(false)
    setLoading(false)
    onUpdated()
  }

  if (isEditing) {
    return (
      <div className="p-2 rounded-lg bg-black/20 border border-white/10 space-y-2">
        <div className="flex gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="flex-1 input-base text-xs py-1 h-8" />
          <input type="number" value={shares} onChange={e => setShares(Number(e.target.value))} className="w-20 input-base text-xs py-1 h-8" placeholder="股數" />
          <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-20 input-base text-xs py-1 h-8" placeholder="價" />
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} className="w-full input-base text-xs py-1 h-8" placeholder="備註" />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setIsEditing(false)} className="text-[10px] px-3 py-1 rounded bg-white/10">取消</button>
          <button onClick={handleSave} disabled={loading} className="text-[10px] px-3 py-1 rounded bg-gold text-black font-bold">
            {loading ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-1 h-8 rounded-full ${isBuy ? 'bg-red-500' : 'bg-green-500'}`} />
        <div>
          <div className="text-[10px] font-mono opacity-60">{t.trade_date}</div>
          <div className="text-xs font-bold">
            <span style={{ color: isBuy ? 'var(--red)' : 'var(--grn)' }}>{isBuy ? '買' : '賣'}</span> {t.shares}股 @ {t.price}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono font-bold" style={{ color: t.net_amount >= 0 ? 'var(--red)' : 'var(--grn)' }}>
          {t.net_amount >= 0 ? '+' : ''}{fmtMoney(t.net_amount)}
        </div>
        <button onClick={() => setIsEditing(true)} className="text-[10px] text-gold hover:underline">編輯</button>
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

function StatBox({ label, value, sub, upDown }: { label: string; value: string; sub?: string; upDown?: number }) {
  const col = upDown === undefined ? 'var(--t1)' : upDown >= 0 ? 'var(--red)' : 'var(--grn)'
  return (
    <div>
      <div className="text-xs mb-0.5" style={{ color: 'var(--t3)' }}>{label}</div>
      <div className="font-black font-mono text-sm leading-tight" style={{ color: col }}>{value}</div>
      {sub && <div className="text-xs font-mono" style={{ color: col, opacity: 0.7 }}>{sub}</div>}
    </div>
  )
}

function GoldSpan({ children }: { children: React.ReactNode }) { return <span style={{ color: 'var(--gold)', fontWeight: 800 }}>{children}</span> }
function Empty({ icon, text, sub }: { icon: string; text: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-3 px-6">
      <div className="text-5xl">{icon}</div>
      <p className="font-bold" style={{ color: 'var(--t2)' }}>{text}</p>
      {sub && <p className="text-sm text-center" style={{ color: 'var(--t3)' }}>{sub}</p>}
    </div>
  )
}
