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
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at top right, rgba(201,165,100,0.07) 0%, transparent 60%)' }} />

        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold opacity-50">
            持股概覽 · {holdings.length} 檔
          </span>
          <button onClick={onRefresh}
            className="text-[10px] px-2 py-0.5 rounded-lg bg-gold-dim text-gold border border-white/10 active:opacity-60">
            重整
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <StatBox label="投入成本" value={shortMoney(totalCost)} />
          <StatBox label="目前市值" value={shortMoney(totalMV)} />
          <StatBox
            label="總損益比"
            value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
            upDown={totalPnl}
          />
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
            <span className="opacity-50">年目標：{settings.year_goal > 0 ? fmtMoney(settings.year_goal) : '尚未設定'}</span>
            <span className="font-mono font-black text-gold">
              {yearAchieved !== null ? (
                <>達成 {yearAchieved.toFixed(1)}% {yearAchieved >= 100 ? '🎉' : ''}</>
              ) : (
                <span className="opacity-30 italic font-normal">前往設定頁面</span>
              )}
            </span>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="opacity-50">總目標：{settings.total_goal > 0 ? fmtMoney(settings.total_goal) : '尚未設定'}</span>
            <span className="font-mono font-black text-gold">
              {totalAchieved !== null ? (
                <>達成 {totalAchieved.toFixed(1)}% {totalAchieved >= 100 ? '🎉' : ''}</>
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

  const selectedEntry = useMemo(() => {
    if (!selectedDate) return null
    return entries.find(e => e.entry_date === selectedDate)
  }, [selectedDate, entries])

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
      <div className="glass rounded-2xl p-4 border border-white/5 space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button onClick={() => moveMonth(-1)} className="p-2 text-white/40 active:text-gold">‹</button>
            <div className="relative">
              <h2 className="font-black text-sm flex items-center gap-1 text-white">
                {year}年 {month}月 ▾
              </h2>
              <input 
                type="month" 
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleMonthChange}
                value={`${year}-${String(month).padStart(2, '0')}`}
              />
            </div>
            <button onClick={() => moveMonth(1)} className="p-2 text-white/40 active:text-gold">›</button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-[10px] font-bold text-white/30 uppercase">本月總損益</div>
              <div className={`text-sm font-black font-mono ${stats.totalPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {stats.totalPnl >= 0 ? '+' : ''}{fmtMoney(stats.totalPnl)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-white/30 uppercase">損益百分比</div>
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
            if (d === null) return <div key={`empty-${i}`} className="aspect-[1.5/1]" />
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
                className={`aspect-[1.2/1] rounded flex flex-col items-center justify-between p-1 cursor-pointer transition-all border ${isSelected ? 'border-white ring-1 ring-white' : 'border-white/5'}`}
                style={{ background: bgColor }}>
                <span className="text-[9px] font-black text-white/60 self-start">{d}</span>
                {entry && entry.pnl !== 0 && (
                  <div className="w-full text-center flex flex-col justify-end flex-1">
                    <div className="text-[8px] font-black text-white leading-none mb-0.5">
                      {shortMoney(entry.pnl)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Daily Details Card */}
      {selectedEntry && (
        <div className="glass rounded-2xl p-4 border border-gold/30 slide-up bg-black/40">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-black text-sm text-gold">
              📅 {selectedEntry.entry_date} 明細
            </h3>
            <span className={`text-xs font-mono font-bold ${selectedEntry.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {selectedEntry.pnl >= 0 ? '+' : ''}{fmtMoney(selectedEntry.pnl)} ({selectedEntry.pnl_pct}%)
            </span>
          </div>
          
          <div className="space-y-2">
            {selectedEntry.details?.map(s => (
              <div key={s.symbol} className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white truncate">{s.name}</span>
                    <span className="text-[10px] font-mono opacity-30">{codeOnly(s.symbol)}</span>
                  </div>
                  <div className="text-[10px] opacity-50 mt-0.5">
                    持股 {s.shares.toLocaleString()} 股
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-black font-mono ${s.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {s.pnl >= 0 ? '+' : ''}{fmtMoney(s.pnl)}
                  </div>
                </div>
              </div>
            ))}
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
    <div className={`glass rounded-xl overflow-hidden transition-all duration-300 border ${isExpanded ? 'border-gold shadow-[0_0_20px_rgba(201,165,100,0.15)]' : 'border-white/5'}`}>
      <div className="p-3 md:p-4 cursor-pointer active:bg-white/5" onClick={onToggle}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-base text-white">{q?.name_zh || q?.name || h.symbol}</span>
              <span className="font-mono px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 text-white/40">
                {codeOnly(h.symbol)}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gold-dim text-gold">
                {h.shares >= 1000 ? `${(h.shares/1000).toFixed(h.shares%1000===0?0:2)}張` : `${h.shares}股`}
              </span>
            </div>
            <div className="text-[11px] mt-1 font-mono text-white/40">
              均成 {h.avg_cost.toFixed(2)} · 持成 {fmtMoney(h.total_cost)}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-black text-lg font-mono text-white">
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
      <div className="p-4 rounded-xl bg-black/60 border-2 border-gold/40 space-y-5 my-2 slide-up shadow-2xl">
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
            <input type="number" value={tradeType === 'FULL' ? lots : shares} onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 0); tradeType === 'FULL' ? setLots(v) : setShares(v) }} className="w-full input-base text-center h-10 font-mono text-sm" />
          </div>
          <div>
            <Label>成交價</Label>
            <input type="number" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-full input-base text-center h-10 font-mono text-sm" />
          </div>
        </div>

        <div>
          <Label>備註</Label>
          <input value={note} onChange={e => setNote(e.target.value)} className="w-full input-base py-2.5 px-3 text-sm" placeholder="點此輸入備註..." />
        </div>

        <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10 shadow-inner">
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
          <button onClick={() => setIsEditing(false)} className="flex-1 py-3 rounded-xl font-bold text-sm bg-white/5 text-white/60 border border-white/10">取消</button>
          <button onClick={handleSave} disabled={loading} className="flex-2 py-3 rounded-xl font-black text-sm bg-gradient-to-br from-gold to-gold-bright text-base shadow-lg active:scale-95 transition-transform">{loading ? '儲存中...' : '儲存修改'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-1 h-8 rounded-full ${isBuy ? 'bg-red-500' : 'bg-green-500'}`} />
        <div>
          <div className="text-[10px] font-mono opacity-30">{t.trade_date}</div>
          <div className="text-xs font-bold text-white/80">
            <span className={isBuy ? 'text-red-400' : 'text-green-400'}>{isBuy ? '買' : '賣'}</span> {t.shares}股 @ {t.price}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`text-xs font-mono font-bold ${t.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
          {t.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(t.net_amount))}
        </div>
        <div className="flex gap-2 justify-end mt-0.5">
          <button onClick={() => setIsEditing(true)} className="text-[10px] text-gold/60 hover:text-gold active:underline">編輯</button>
          <button onClick={handleDelete} className="text-[10px] text-white/20 hover:text-red-400 active:underline">刪除</button>
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

function StatBox({ label, value, upDown }: { label: string; value: string; upDown?: number }) {
  const col = upDown === undefined ? 'text-white' : upDown >= 0 ? 'text-red-400' : 'text-green-400'
  return (
    <div className="flex flex-col">
      <div className="text-[10px] mb-0.5 opacity-40 font-bold uppercase">{label}</div>
      <div className={`font-black font-mono text-sm md:text-base leading-tight ${col}`}>{value}</div>
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
