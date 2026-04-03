'use client'

import { Holding, Quote, UserSettings, codeOnly, fmtMoney } from '@/types'

interface Props {
  holdings: Holding[]
  quotes: Record<string, Quote>
  settings: UserSettings
  onRefresh: () => void
}

export default function HoldingsTab({ holdings, quotes, settings, onRefresh }: Props) {
  const totalCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const totalMV   = holdings.reduce((s, h) => s + h.market_value, 0)
  const totalPnl  = holdings.reduce((s, h) => s + h.unrealized_pnl, 0)
  const pnlPct    = totalCost ? totalPnl / totalCost * 100 : 0

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
            label="未實現損益"
            value={`${totalPnl >= 0 ? '+' : ''}${shortMoney(totalPnl)}`}
            sub={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`}
            upDown={totalPnl}
          />
        </div>

        {/* aggregate bar */}
        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, Math.abs(pnlPct) * 8)}%`,
              background: totalPnl >= 0
                ? 'linear-gradient(90deg, var(--red-dim), var(--red))'
                : 'linear-gradient(90deg, var(--grn-dim), var(--grn))',
            }} />
        </div>
      </div>

      {/* ── Holding rows ───────────────────────────────────── */}
      {holdings
        .sort((a, b) => b.market_value - a.market_value)
        .map(h => <HoldingRow key={h.symbol} h={h} q={quotes[h.symbol]} />)
      }
    </div>
  )
}

// ─── HoldingRow ──────────────────────────────────────────────────────────────
function HoldingRow({ h, q }: { h: Holding; q?: Quote }) {
  const isUp = h.unrealized_pnl >= 0
  const color = isUp ? 'var(--red)' : 'var(--grn)'
  const dimBg = isUp ? 'var(--red-dim)' : 'var(--grn-dim)'
  const arrow = isUp ? '▲' : '▼'

  return (
    <div className="glass glass-hover rounded-xl p-3.5 transition-colors"
      style={{ cursor: 'default' }}>

      <div className="flex items-start justify-between gap-2">
        {/* Left */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-base" style={{ color: 'var(--t1)' }}>
              {codeOnly(h.symbol)}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full shrink-0"
              style={{ background: 'var(--gold-dim)', color: 'var(--gold)' }}>
              {h.shares >= 1000
                ? `${(h.shares / 1000).toFixed(h.shares % 1000 === 0 ? 0 : 2)}張`
                : `${h.shares}股`}
            </span>
          </div>
          <div className="text-xs mt-1 font-mono" style={{ color: 'var(--t2)' }}>
            均成本 {h.avg_cost.toFixed(2)} · 持成 {fmtMoney(h.total_cost)}
          </div>
        </div>

        {/* Right: price */}
        <div className="text-right shrink-0">
          <div className="font-black text-lg font-mono" style={{ color: 'var(--t1)' }}>
            {h.current_price > 0 ? h.current_price.toFixed(2) : '—'}
          </div>
          {q && (
            <div className="text-xs font-mono" style={{ color: q.change >= 0 ? 'var(--red)' : 'var(--grn)' }}>
              {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)}
              <span className="opacity-70 ml-1">({q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)</span>
            </div>
          )}
        </div>
      </div>

      {/* PnL row */}
      <div className="mt-2.5 flex items-center justify-between">
        <span className="font-bold font-mono text-sm" style={{ color }}>
          {isUp ? '+' : ''}{fmtMoney(h.unrealized_pnl)} 元
        </span>
        <span className="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
          style={{ background: dimBg, color }}>
          {arrow} {Math.abs(h.pnl_pct).toFixed(2)}%
        </span>
      </div>

      {/* PnL bar */}
      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div className="h-full rounded-full"
          style={{
            width: `${Math.min(100, Math.abs(h.pnl_pct) * 6)}%`,
            background: isUp ? 'var(--red)' : 'var(--grn)',
            opacity: 0.7,
          }} />
      </div>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function shortMoney(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

function StatBox({ label, value, sub, upDown }: {
  label: string; value: string; sub?: string; upDown?: number
}) {
  const col = upDown === undefined ? 'var(--t1)'
    : upDown >= 0 ? 'var(--red)' : 'var(--grn)'
  return (
    <div>
      <div className="text-xs mb-0.5" style={{ color: 'var(--t3)' }}>{label}</div>
      <div className="font-black font-mono text-sm leading-tight" style={{ color: col }}>{value}</div>
      {sub && <div className="text-xs font-mono" style={{ color: col, opacity: 0.7 }}>{sub}</div>}
    </div>
  )
}

function GoldSpan({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--gold)', fontWeight: 800 }}>{children}</span>
}

function Empty({ icon, text, sub }: { icon: string; text: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-3 px-6">
      <div className="text-5xl">{icon}</div>
      <p className="font-bold" style={{ color: 'var(--t2)' }}>{text}</p>
      {sub && <p className="text-sm text-center" style={{ color: 'var(--t3)' }}>{sub}</p>}
    </div>
  )
}
