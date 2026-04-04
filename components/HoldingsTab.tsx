'use client'

import { useState, useMemo, useEffect } from 'react'
import { Holding, Quote, UserSettings, codeOnly, fmtMoney, Transaction, CalendarEntry, calcFee, calcTax } from '@/types'

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
  const totalCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const totalMV   = holdings.reduce((s, h) => s + h.market_value, 0)
  const totalPnl  = holdings.reduce((s, h) => s + h.unrealized_pnl, 0)
  const pnlPct    = totalCost ? totalPnl / totalCost * 100 : 0

  // ── Year PnL Calculation ──
  const currentYear = new Date().getFullYear().toString()
  let ytdRealized = 0
  let eoyCost = 0

  const sortedTxs = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const map: Record<string, { shares: number, cost: number }> = {}

  sortedTxs.forEach(tx => {
    if (tx.trade_date < `${currentYear}-01-01`) {
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
    }
  })

  Object.values(map).forEach(h => {
    if (h.shares > 0) eoyCost += h.cost
  })

  const mapYtd: Record<string, { shares: number, cost: number }> = {}
  sortedTxs.forEach(tx => {
    if (!mapYtd[tx.symbol]) mapYtd[tx.symbol] = { shares: 0, cost: 0 }
    const h = mapYtd[tx.symbol]
    if (tx.action === 'BUY' || tx.action === 'DCA') {
      h.shares += tx.shares
      h.cost += tx.amount + tx.fee
    } else if (tx.action === 'SELL') {
      const avgCost = h.shares > 0 ? h.cost / h.shares : 0
      const costBasis = tx.shares * avgCost
      h.shares -= tx.shares
      h.cost -= costBasis
      if (tx.trade_date >= `${currentYear}-01-01`) {
        ytdRealized += (tx.net_amount + costBasis)
      }
    }
  })

  const yearPnl = ytdRealized + totalPnl
  const yearPnlPct = eoyCost > 0 ? (yearPnl / eoyCost) * 100 : 0

  const [expanded, setExpanded] = useState<string | null>(null)

  const yearAchieved = settings.year_goal > 0 ? (yearPnl / settings.year_goal) * 100 : null
  const totalAchieved = settings.total_goal > 0 ? (totalMV / settings.total_goal) * 100 : null

  return (
    <div className="p-3 md:p-4 space-y-4">
      {/* 1. 持股概覽卡片 */}
      <div className="glass rounded-2xl p-3 md:p-4 relative overflow-hidden border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold opacity-50">
            持股概覽 · {holdings.length} 檔
          </span>
          <button onClick={onRefresh}
            className="text-[10px] px-2 py-0.5 rounded-lg bg-gold-dim text-gold border border-white/10 active:opacity-60 font-bold">
            重整
          </button>
        </div>

        <div className="space-y-4 mb-4">
          {/* 第一列 */}
          <div className="flex items-center">
            <StatBox label="投入成本" value={fmtMoney(totalCost)} className="w-1/2 text-center px-1" />
            <StatBox 
              label="目前市值" 
              value={fmtMoney(totalMV)} 
              className="w-1/2 text-center px-1" 
              upDown={totalMV > totalCost ? 1 : totalMV < totalCost ? -1 : 0}
            />
          </div>
          {/* 第二列 */}
          <div className="flex items-center border-t border-white/5 pt-4">
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
        </div>

        {/* 年損益與目標 */}
        <div className="pt-3 border-t border-white/5 space-y-2.5">
          <div className="flex justify-between items-center text-xs">
            <span className="opacity-50 font-bold">今年損益</span>
            <span className={`font-mono font-bold ${yearPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {yearPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(yearPnl))} 
              <span className="ml-1 text-[10px] opacity-60">({yearPnlPct >= 0 ? '+' : ''}{yearPnlPct.toFixed(2)}%)</span>
            </span>
          </div>
          
          <div className="flex justify-between items-center text-xs">
            <span className="opacity-50 font-bold">年目標達成</span>
            <span className="font-mono font-black text-gold">
              {yearAchieved !== null ? (
                <>{fmtMoney(settings.year_goal)} · {yearAchieved.toFixed(1)}% {yearAchieved >= 100 ? '🎉' : ''}</>
              ) : (
                <span className="opacity-30 italic font-normal">前往設定頁面</span>
              )}
            </span>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="opacity-50 font-bold">總目標達成</span>
            <span className="font-mono font-black text-gold">
              {totalAchieved !== null ? (
                <>{fmtMoney(settings.total_goal)} · {totalAchieved.toFixed(1)}% {totalAchieved >= 100 ? '🎉' : ''}</>
              ) : (
                <span className="opacity-30 italic font-normal">未設定</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* 2. 損益月曆區塊 */}
      <div className="px-0.5">
        <IntegratedCalendar entries={calEntries} onRefresh={onRefreshCal} />
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

function IntegratedCalendar({ entries, onRefresh }: { entries: CalendarEntry[], onRefresh: (y: number, m: number) => void }) {
  const now = new Date()
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  
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
  }

  function handleMonthChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.value) return
    const [y, m] = e.target.value.split('-').map(Number)
    setViewDate(new Date(y, m - 1, 1))
    setSelectedDate(null)
  }

  function toggleDate(dateStr: string) {
    setSelectedDate(prev => prev === dateStr ? null : dateStr)
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 border border-white/5 space-y-4 bg-black/20">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button onClick={() => moveMonth(-1)} className="p-2 text-white/40 active:text-gold transition-colors">‹</button>
            <div className="relative">
              <h2 className="font-black text-base flex items-center gap-1 text-white">
                {year}年 {month}月 ▾
              </h2>
              <input 
                type="month" 
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleMonthChange}
                value={`${year}-${String(month).padStart(2, '0')}`}
              />
            </div>
            <button onClick={() => moveMonth(1)} className="p-2 text-white/40 active:text-gold transition-colors">›</button>
          </div>

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
        </div>

        <div className="grid grid-cols-7 gap-1">
          {['日','一','二','三','四','五','六'].map(d => (
            <div key={d} className="text-center text-[10px] font-bold py-1 opacity-20">{d}</div>
          ))}
          {days.map((d, i) => {
            if (d === null) return <div key={`empty-${i}`} className="aspect-[1.2/1]" />
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
      </div>
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
  const [date, setDate] = useState(t.trade_date)
  const [shares, setShares] = useState(t.shares)
  const [price, setPrice] = useState(t.price)
  const [note, setNote] = useState(t.note || '')
  const [tradeType, setTradeType] = useState(t.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots] = useState(Math.floor(t.shares / 1000) || 1)
  
  const isBuy = t.action === 'BUY' || t.action === 'DCA'
  const actualShares = tradeType === 'FULL' ? lots * 1000 : shares
  const amount = actualShares * price
  const fee    = calcFee(amount, settings, t.action === 'SELL')
  const tax    = t.action === 'SELL' ? calcTax(amount, t.symbol, settings) : 0
  const net    = isBuy ? -(amount + fee) : (amount - fee - tax)

  async function handleSave() {
    if (actualShares <= 0 || price <= 0) return
    setLoading(true)
    await fetch('/api/transactions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, trade_date: date, shares: actualShares, price, note })
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
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base text-center w-full py-2 text-sm" style={{ colorScheme: 'dark' }} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>方式</Label>
            <button onClick={() => setTradeType(prev => prev === 'FULL' ? 'FRACTIONAL' : 'FULL')} className={`w-full h-10 rounded-lg text-[10px] font-black transition-colors border ${tradeType === 'FULL' ? 'bg-gold-dim text-gold border-gold' : 'bg-white/5 text-white/40 border-white/10'}`}>{tradeType === 'FULL' ? '整張' : '零股'}</button>
          </div>
          <div>
            <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
            <input type="number" inputMode="numeric" pattern="[0-9]*" value={tradeType === 'FULL' ? lots : shares} onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 0); tradeType === 'FULL' ? setLots(v) : setShares(v) }} className="w-full input-base text-center h-10 font-mono text-sm" />
          </div>
          <div>
            <Label>成交價</Label>
            <input type="number" inputMode="decimal" pattern="[0-9.]*" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-full input-base text-center h-10 font-mono text-sm" />
          </div>
        </div>

        <div>
          <Label>備註</Label>
          <input value={note} onChange={e => setNote(e.target.value)} className="w-full input-base py-2.5 px-3 text-sm" placeholder="點此輸入備註..." />
        </div>

        <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10">
          <div className="flex justify-between text-xs">
            <span className="opacity-40">手續費</span>
            <span className="font-mono font-bold text-white">{fmtMoney(Math.round(fee))}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between text-xs">
              <span className="opacity-40">交易稅</span>
              <span className="font-mono font-bold text-white">{fmtMoney(Math.round(tax))}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-white/5">
            <span className="text-xs font-black opacity-60">預估淨收支</span>
            <span className={`text-lg font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
            </span>
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={() => setIsEditing(false)} className="flex-1 py-3 rounded-xl font-bold text-sm bg-white/5 text-white/60 border border-white/10 active:scale-95 transition-transform">取消</button>
          <button onClick={handleSave} disabled={loading} className="flex-2 py-3 rounded-xl font-black text-sm bg-gold text-[#0d1018] active:scale-95 transition-transform">{loading ? '儲存中...' : '儲存修改'}</button>
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
