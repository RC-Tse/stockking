'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Holding, Quote, UserSettings, codeOnly, fmtMoney, Transaction, CalendarEntry, calcFee, calcTax, getStockName } from '@/types'
import { 
  RefreshCw, 
  Target, 
  Trophy, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight,
  Archive,
  TrendingUp,
  TrendingDown,
  ClipboardList,
  Pencil,
  Trash2
} from 'lucide-react'
import DatePicker from './DatePicker'
import ConfirmModal from './ConfirmModal'

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
  const currentYear = new Date().getFullYear().toString()
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // ── Calculate FIFO Metrics ──
  const { 
    totalRealized,
    realizedCostBasis,
    closedHoldings,
    yearPnl
  } = useMemo(() => {
    let totalRealized = 0
    let realizedCostBasis = 0
    const realizedByBuyYear: Record<string, number> = {}
    const inventory: Record<string, { shares: number, unitCost: number, buyYear: string }[]> = {}
    const stockHistory: Record<string, { buyCost: number, sellRev: number }> = {}

    const sorted = [...transactions].sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
      return a.id - b.id
    })

    for (const tx of sorted) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      if (!stockHistory[tx.symbol]) stockHistory[tx.symbol] = { buyCost: 0, sellRev: 0 }
      const buyYear = tx.trade_date.split('-')[0]

      if (tx.action !== 'SELL') {
        const cost = tx.amount + tx.fee
        inventory[tx.symbol].push({ shares: tx.shares, unitCost: cost / tx.shares, buyYear })
        stockHistory[tx.symbol].buyCost += cost
      } else {
        stockHistory[tx.symbol].sellRev += tx.net_amount
        let sellRemaining = tx.shares
        const sellUnitNet = tx.net_amount / tx.shares
        while (sellRemaining > 0 && inventory[tx.symbol].length > 0) {
          const lot = inventory[tx.symbol][0]
          const sharesFromLot = Math.min(lot.shares, sellRemaining)
          const lotCostBasis = sharesFromLot * lot.unitCost
          const portionProfit = (sellUnitNet - lot.unitCost) * sharesFromLot
          
          realizedCostBasis += lotCostBasis
          realizedByBuyYear[lot.buyYear] = (realizedByBuyYear[lot.buyYear] || 0) + portionProfit
          totalRealized += portionProfit
          sellRemaining -= sharesFromLot
          lot.shares -= sharesFromLot
          if (lot.shares <= 0) inventory[tx.symbol].shift()
        }
      }
    }

    const unrealizedByBuyYear: Record<string, number> = {}
    Object.keys(inventory).forEach(sym => {
      const currentPrice = quotes[sym]?.price || 0
      inventory[sym].forEach(lot => {
        const uPnL = (currentPrice - lot.unitCost) * lot.shares
        unrealizedByBuyYear[lot.buyYear] = (unrealizedByBuyYear[lot.buyYear] || 0) + uPnL
      })
    })

    const closedHoldings = Object.entries(stockHistory)
      .filter(([sym]) => (inventory[sym]?.length || 0) === 0)
      .map(([sym, data]) => ({
        symbol: sym,
        buyCost: data.buyCost,
        sellRev: data.sellRev,
        pnl: data.sellRev - data.buyCost,
        pnlPct: data.buyCost > 0 ? (data.sellRev - data.buyCost) / data.buyCost * 100 : 0
      })).sort((a, b) => b.pnl - a.pnl)

    const yearPnl = (realizedByBuyYear[currentYear] || 0) + (unrealizedByBuyYear[currentYear] || 0)
    return { totalRealized, realizedCostBasis, closedHoldings, yearPnl }
  }, [transactions, currentYear, quotes])

  const currentMV = holdings.reduce((s, h) => s + h.market_value, 0)
  const currentCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const unrealizedPnl = currentMV - currentCost
  const unrealizedPct = currentCost ? (unrealizedPnl / currentCost) * 100 : 0
  const realizedPct = realizedCostBasis ? (totalRealized / realizedCostBasis) * 100 : 0
  
  const yearAchieved = settings.year_goal > 0 ? (yearPnl / settings.year_goal) * 100 : null
  const totalAchieved = settings.total_goal > 0 ? (currentMV / settings.total_goal) * 100 : null

  const [expanded, setExpanded] = useState<string | null>(null)
  const [closedExpanded, setClosedExpanded] = useState(false)

  const confirmDelete = async () => {
    if (!deletingId) return
    await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id: deletingId }) })
    setDeletingId(null); onRefresh()
  }

  return (
    <div className="p-4 space-y-6 tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {/* 1. 持股概覽卡片 */}
      <div className="glass p-5 relative overflow-hidden animate-slide-up border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <span className="text-base font-black text-white/30 uppercase tracking-[0.2em]">持股概覽 · {holdings.length} 檔</span>
          <button onClick={() => window.location.reload()} className="p-2 rounded-full bg-white/5 text-gold border border-white/10 active:scale-95 transition-all">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="space-y-6">
          {/* 第一列 */}
          <div className="flex items-center">
            <StatBox label="持有成本" value={fmtMoney(currentCost)} className="w-1/2 text-center" large />
            <StatBox label="目前市值" value={fmtMoney(currentMV)} className="w-1/2 text-center border-l border-white/5" large upDown={currentMV > currentCost ? 1 : -1} />
          </div>
          {/* 第二列 */}
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="未實現損益" value={`${unrealizedPnl >= 0 ? '+' : ''}${fmtMoney(Math.round(unrealizedPnl))}`} className="w-1/2 text-center" upDown={unrealizedPnl} />
            <StatBox label="未實現損益比" value={`${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%`} className="w-1/2 text-center border-l border-white/5" upDown={unrealizedPnl} />
          </div>
          {/* 第三列 */}
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="已實現損益" value={`${totalRealized >= 0 ? '+' : ''}${fmtMoney(Math.round(totalRealized))}`} className="w-1/2 text-center" upDown={totalRealized} />
            <StatBox label="已實現損益比" value={`${realizedPct >= 0 ? '+' : ''}${realizedPct.toFixed(2)}%`} className="w-1/2 text-center border-l border-white/5" upDown={totalRealized} />
          </div>
          {/* 第四列 & 第五列 */}
          <div className="pt-6 border-t border-white/5 space-y-5">
            <ProgressBar label="年度目標" icon={Target} current={yearPnl} goal={settings.year_goal} achieved={yearAchieved} />
            <ProgressBar label="總目標" icon={Trophy} current={currentMV} goal={settings.total_goal} achieved={totalAchieved} />
          </div>
        </div>
      </div>

      <IntegratedCalendar entries={calEntries} transactions={transactions} onRefresh={onRefreshCal} />

      <div className="space-y-4">
        {holdings.sort((a, b) => b.market_value - a.market_value).map(h => (
          <HoldingItem key={h.symbol} h={h} q={quotes[h.symbol]} settings={settings} txs={transactions.filter(t => t.symbol === h.symbol)} isExpanded={expanded === h.symbol} onToggle={() => setExpanded(expanded === h.symbol ? null : h.symbol)} onUpdated={onRefresh} onDelete={(id:number)=>setDeletingId(id)} />
        ))}

        {closedHoldings.length > 0 && (
          <div className="pt-4">
            <button onClick={() => setClosedExpanded(!closedExpanded)} className="w-full flex items-center justify-between p-4 card-base border-gold/20 active:bg-bg-hover transition-all">
              <div className="flex items-center gap-3">
                <Archive size={18} className="text-gold" />
                <span className="font-black text-sm text-white/60">已結算股票 ({closedHoldings.length}檔)</span>
              </div>
              <ChevronDown size={16} className={`text-white/20 transition-transform duration-300 ${closedExpanded ? 'rotate-180' : ''}`} />
            </button>
            {closedExpanded && (
              <div className="space-y-3 mt-3 animate-slide-up">
                {closedHoldings.map(c => (
                  <ClosedHoldingItem key={c.symbol} c={c} expanded={expanded === `closed-${c.symbol}`} onToggle={() => setExpanded(expanded === `closed-${c.symbol}` ? null : `closed-${c.symbol}`)} transactions={transactions.filter(t => t.symbol === c.symbol)} settings={settings} onRefresh={onRefresh} onDelete={(id:number)=>setDeletingId(id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmModal open={!!deletingId} onCancel={()=>setDeletingId(null)} onConfirm={confirmDelete} />
    </div>
  )
}

function StatBox({ label, value, upDown, large, className }: any) {
  const color = upDown === undefined ? 'text-white' : upDown >= 0 ? 'text-red-400' : 'text-green-400'
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-[11px] font-black text-white/20 uppercase tracking-widest mb-1.5">{label}</span>
      <span className={`font-black font-mono leading-none ${large ? 'text-[22px]' : 'text-[18px]'} ${color}`}>{value}</span>
    </div>
  )
}

function ProgressBar({ label, icon: Icon, goal, achieved }: any) {
  return (
    <div className="space-y-2.5">
      <div className="flex justify-between items-end">
        <span className="text-[13px] font-black text-white/40 flex items-center gap-2">
          <Icon size={14} className="text-gold" /> {label}
        </span>
        {goal > 0 ? (
          <span className="text-[13px] font-black font-mono text-gold">{achieved.toFixed(1)}%</span>
        ) : (
          <button onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' }))} className="text-[11px] font-bold text-gold/50">點此設定目標 →</button>
        )}
      </div>
      {goal > 0 && (
        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
          <div className="h-full bg-gradient-to-r from-[#d4af37] to-[#f0d060] transition-all duration-1000" style={{ width: `${Math.min(100, Math.max(0, achieved))}%` }} />
        </div>
      )}
    </div>
  )
}

function HoldingItem({ h, q, settings, txs, isExpanded, onToggle, onUpdated, onDelete }: any) {
  const isUp = h.unrealized_pnl >= 0
  const color = isUp ? 'text-red-400' : 'text-green-400'
  const dimBg = isUp ? 'bg-red-400/10' : 'bg-green-400/10'
  const arrow = isUp ? '▲' : '▼'

  return (
    <div className={`card-base overflow-hidden transition-all duration-300 border ${isExpanded ? 'border-gold shadow-lg shadow-gold/5' : 'border-white/10 shadow-xl'}`}>
      <div className="p-4 cursor-pointer active:bg-bg-hover flex flex-col gap-3" onClick={onToggle}>
        <div className="flex justify-between items-center">
          <span className="text-[16px] font-black text-white truncate mr-2">{q?.name_zh || h.symbol}</span>
          <span className="text-[18px] font-black text-white font-mono shrink-0">{h.current_price > 0 ? h.current_price.toFixed(2) : '—'}</span>
        </div>
        
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono px-1.5 py-0.5 rounded-md text-[12px] bg-[#d4af3726] border border-[#d4af374d] text-gold">{codeOnly(h.symbol)}</span>
            <span className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-white/5 text-white/40">{h.shares.toLocaleString()} 股</span>
          </div>
          {q?.change !== undefined && (
            <div className={`flex items-center gap-1 text-[12px] font-black font-mono ${q.change >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {q.change >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
              {Math.abs(q.change).toFixed(2)} ({Math.abs(q.change_pct).toFixed(2)}%)
            </div>
          )}
        </div>

        <div className="text-[12px] font-medium text-white/30 whitespace-nowrap overflow-hidden text-ellipsis">平均成本 {h.avg_cost.toFixed(2)} · 持有成本 {fmtMoney(h.total_cost)}</div>

        <div className="flex justify-between items-center">
          <span className={`text-[16px] font-black font-mono ${color}`}>{isUp ? '+' : ''}{fmtMoney(h.unrealized_pnl)}</span>
          <div className={`px-2.5 py-0.5 rounded-full text-[12px] font-black ${isUp ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{isUp ? '+' : ''}{h.pnl_pct.toFixed(2)}%</div>
        </div>
      </div>
      {isExpanded && (
        <div className="bg-black/20 border-t border-white/5 p-3 space-y-2">
          {txs.map((t: any) => <TxRow key={t.id} t={t} settings={settings} onUpdated={onUpdated} onDelete={onDelete} />)}
        </div>
      )}
    </div>
  )
}

function ClosedHoldingItem({ c, expanded, onToggle, transactions, settings, onRefresh, onDelete }: any) {
  const [name, setName] = useState(getStockName(c.symbol))
  useEffect(() => { fetch(`/api/stockname?symbol=${c.symbol}`).then(res => res.json()).then(data => { if (data.name_zh) setName(data.name_zh) }) }, [c.symbol])
  return (
    <div className="card-base overflow-hidden border border-white/5">
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2"><span className="font-black text-white text-base">{name}（{codeOnly(c.symbol)}）</span></div>
          <div className={`font-black font-mono text-base ${c.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>{c.pnl >= 0 ? '+' : ''}{fmtMoney(Math.round(c.pnl))}</div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-white/20">成本 {fmtMoney(Math.round(c.buyCost))} · 收入 {fmtMoney(Math.round(c.sellRev))}</span>
          <div className={`text-[10px] font-bold ${c.pnl >= 0 ? 'text-red-400/50' : 'text-green-400/50'}`}>{c.pnlPct.toFixed(2)}%</div>
        </div>
      </div>
      {expanded && <div className="bg-black/20 border-t border-white/5 p-3 space-y-2">{transactions.map((t: any) => <TxRow key={t.id} t={t} settings={settings} onUpdated={onRefresh} onDelete={onDelete} />)}</div>}
    </div>
  )
}

function IntegratedCalendar({ entries, transactions, onRefresh }: any) {
  const [viewDate, setViewDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [view, setView] = useState<any>('CALENDAR')
  const [dayDetails, setDayDetails] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const year = viewDate.getFullYear(), month = viewDate.getMonth() + 1
  useEffect(() => { onRefresh(year, month) }, [year, month, onRefresh])

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
    const map: Record<number, any> = {}
    entries.forEach((e: any) => {
      // 安全解析日期，避免時區造成誤差
      const day = parseInt(e.entry_date.split(\'-\')[2], 10)
      map[day] = e
    })
    return map
  }, [entries])

  const hasTxMap = useMemo(() => {
    const map: Record<number, boolean> = {}
    transactions.forEach((t: Transaction) => {
      const dParts = t.trade_date.split(\'-\')
      if (parseInt(dParts[0]) === year && parseInt(dParts[1]) === month) {
        map[parseInt(dParts[2])] = true
      }
    })
    return map
  }, [transactions, year, month])

  const toggleDate = async (dateStr: string) => {
    if (selectedDate === dateStr) { setSelectedDate(null); setDayDetails(null); return }
    setSelectedDate(dateStr); setLoading(true)
    try {
      const inventory: any = {}
      const sorted = [...transactions].filter(t => t.trade_date <= dateStr).sort((a,b) => a.trade_date.localeCompare(b.trade_date) || a.id - b.id)
      for (const tx of sorted) {
        if (!inventory[tx.symbol]) inventory[tx.symbol] = []
        if (tx.action !== \'SELL\') inventory[tx.symbol].push({ shares: tx.shares, cost: tx.amount + tx.fee })
        else {
          let rem = tx.shares
          while (rem > 0 && inventory[tx.symbol].length) {
            const lot = inventory[tx.symbol][0]
            if (lot.shares <= rem) { rem -= lot.shares; inventory[tx.symbol].shift() }
            else { lot.shares -= rem; rem = 0 }
          }
        }
      }
      const held = Object.keys(inventory).filter(s => inventory[s].reduce((sum: any, l: any) => sum + l.shares, 0) > 0)
      if (!held.length) { setDayDetails([]); return }
      const res = await fetch(`/api/stocks?symbols=${held.join(\',\')}&date=${dateStr}`)
      const quotes = await res.json()
      const details = held.map(sym => {
        const shares = inventory[sym].reduce((s: any, l: any) => s + l.shares, 0), cost = inventory[sym].reduce((s: any, l: any) => s + l.cost, 0)
        const price = quotes[sym]?.price || 0, mv = Math.round(price * shares), pnl = mv - cost
        return { symbol: sym, name_zh: quotes[sym]?.name_zh || getStockName(sym), shares, price, market_value: mv, pnl, pnl_pct: cost > 0 ? (pnl / cost) * 100 : 0 }
      })
      setDayDetails(details.sort((a,b) => b.market_value - a.market_value))
    } catch (e) { setDayDetails([]) } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="card-base p-5 space-y-6 border-white/10 shadow-2xl">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewDate(new Date(year, month - 2, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-hover text-gold active:scale-90 transition-all border border-white/5 shadow-lg"><ChevronLeft size={20}/></button>
          <div className="flex gap-2 font-black text-white text-[20px]">
            <button onClick={() => setView(view === \'YEAR\' ? \'CALENDAR\' : \'YEAR\')} className={`px-2 rounded transition-colors ${view === \'YEAR\' ? \'text-gold\' : \'active:opacity-60\'}`}>{year} 年</button>
            <button onClick={() => setView(view === \'MONTH\' ? \'CALENDAR\' : \'MONTH\')} className={`px-2 rounded transition-colors ${view === \'MONTH\' ? \'text-gold\' : \'active:opacity-60\'}`}>{month} 月</button>
          </div>
          <button onClick={() => setViewDate(new Date(year, month, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-hover text-gold active:scale-90 transition-all border border-white/5 shadow-lg"><ChevronRight size={20}/></button>
        </div>

        {view === \'CALENDAR\' && (
          <div className="grid grid-cols-7 gap-2">
            {[\'日\',\'一\',\'二\',\'三\',\'四\',\'五\',\'六\'].map((d, i) => <div key={d} className={`text-center text-[11px] font-bold py-1 ${i===0?\'text-red-400\':i===6?\'text-gold\':\'text-white/20\'}`}>{d}</div>)}
            {days.map((d, i) => {
              if (d === null) return <div key={`empty-${i}`} style={{ height: \'52px\' }} />
              const dateStr = `${year}-${String(month).padStart(2,\'0\')}-${String(d).padStart(2,\'0\')}`, entry = entryMap[d], pnlPct = entry?.pnl_pct || 0
              const isToday = new Date().toISOString().split('T')[0] === dateStr, isSel = selectedDate === dateStr
              let bg = '#1e2535'
              if (pnlPct > 0) bg = `rgba(224, 80, 80, ${Math.min(0.85, 0.3 + (pnlPct/5)*0.55)})`
              else if (pnlPct < 0) bg = `rgba(66, 176, 122, ${Math.min(0.85, 0.3 + (Math.abs(pnlPct)/5)*0.55)})`
              return (
                <div key={d} onClick={() => toggleDate(dateStr)} className={`cal-day relative rounded-[10px] border transition-all flex flex-col items-center justify-center ${isSel ? 'border-gold bg-gold z-10 scale-105 shadow-gold/20' : isToday ? 'border-gold shadow-gold/10' : 'border-transparent'}`} style={{ background: isSel ? 'var(--gold)' : bg, height: '52px' }}>
                  <span className={`text-[14px] font-black absolute top-1 left-1.5 leading-none ${isSel ? 'text-bg-base' : (entry ? 'text-white' : 'text-white/30')}`}>{d}</span>
                  {entry && (
                    <div className="flex flex-col items-center justify-center mt-2.5 space-y-0.5">
                      <div className={`text-[11px] font-black leading-none ${isSel ? 'text-bg-base' : 'text-white'}`}>{entry.pnl > 0 ? '+' : ''}{shortMoney(entry.pnl)}</div>
                      <div className={`text-[10px] font-bold leading-none ${isSel ? 'text-bg-base/60' : 'text-white/70'}`}>{entry.pnl > 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div>
                    </div>
                  )}
                  {hasTxMap[d] && <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-gold shadow-sm border border-bg-base" />}
                </div>
              )
            })}
          </div>
        )}
        {view === 'YEAR' && <div className="grid grid-cols-3 gap-2">{Array.from({length:10}, (_,i)=>new Date().getFullYear()-7+i).map(y => <button key={y} onClick={()=>{setViewDate(new Date(y, month-1, 1)); setView('CALENDAR')}} className={`py-4 rounded-xl font-black transition-all ${year===y?'bg-gold text-bg-base shadow-lg':'bg-bg-hover text-white/40 active:bg-bg-card'}`}>{y}</button>)}</div>}
        {view === 'MONTH' && <div className="grid grid-cols-3 gap-2">{Array.from({length:12}, (_,i)=>i+1).map(m => <button key={m} onClick={()=>{setViewDate(new Date(year, m-1, 1)); setView('CALENDAR')}} className={`py-4 rounded-xl font-black transition-all ${month===m?'bg-gold text-bg-base shadow-lg':'bg-bg-hover text-white/40 active:bg-bg-card'}`}>{m}月</button>)}</div>}
      </div>

      {selectedDate && (
        <div className="animate-slide-up card-base p-5 space-y-5 border-white/10 shadow-2xl">
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <div className="flex flex-col"><h3 className="font-black text-base text-white">{selectedDate.split('-')[1]}月{selectedDate.split('-')[2]}日 持股細項</h3>{(() => { const entry = entries.find((e: CalendarEntry) => e.entry_date === selectedDate); if (!entry) return null; return <span className={`text-[10px] font-black font-mono ${entry.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>當天總損益 {entry.pnl >= 0 ? '+' : ''}{fmtMoney(entry.pnl)} ({entry.pnl_pct?.toFixed(2)}%)</span> })()}</div>
            {loading && <RefreshCw size={14} className="animate-spin text-gold" />}
          </div>
          {dayDetails?.map(det => (
            <div key={det.symbol} className="flex justify-between items-center py-1">
              <div className="flex flex-col"><span className="text-sm font-black text-white">{det.name_zh}</span><span className="text-[10px] font-bold text-white/20">{det.shares.toLocaleString()} 股 @ {det.price.toFixed(2)}</span></div>
              <div className="text-right"><div className="text-sm font-black text-white">{fmtMoney(det.market_value)}</div><div className={`text-[11px] font-bold ${det.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>{det.pnl >= 0 ? '+' : ''}{fmtMoney(Math.round(det.pnl))} ({det.pnl_pct.toFixed(2)}%)</div></div>
            </div>
          ))}
          {(() => {
            const dayTxs = transactions.filter((t: Transaction) => t.trade_date === selectedDate)
            if (!dayTxs.length) return null
            return (
              <div className="pt-4 border-t border-white/5 space-y-4">
                <h4 className="text-[11px] font-black text-white/30 uppercase tracking-widest flex items-center gap-2"><ClipboardList size={14}/> 當天交易</h4>
                <div className="space-y-3">
                  {dayTxs.map((tx: Transaction) => (
                    <div key={tx.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2"><span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${tx.action==='BUY'?'bg-red-400/10 text-red-400 border-red-400/20':'bg-green-400/10 text-green-400 border-green-400/20'}`}>{tx.action==='BUY'?'買入':'賣出'}</span><span className="font-black text-white truncate max-w-[100px]">{tx.name_zh}</span></div>
                      <div className="text-right"><div className={`font-mono font-black ${tx.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>{tx.net_amount >= 0 ? '+' : ''}{fmtMoney(tx.net_amount)}</div><div className="text-[9px] text-white/20 font-bold">{tx.shares.toLocaleString()}股 @ {tx.price.toFixed(2)}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function TxRow({ t, settings, onUpdated, onDelete }: any) {
  const [isEditing, setIsEditing] = useState(false), [loading, setLoading] = useState(false)
  const [date, setDate] = useState(t.trade_date), [shares, setShares] = useState<number|''>(t.shares), [price, setPrice] = useState<number|''>(t.price), [note, setNote] = useState(t.note || '')
  const [tradeType, setTradeType] = useState(t.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots] = useState<number | ''>(Math.floor(t.shares / 1000) || 1)
  const isBuy = t.action === 'BUY' || t.action === 'DCA'
  const finalShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = Number(price) || 0
  const amount = finalShares * safePrice
  const fee = calcFee(amount, settings, t.action === 'SELL'), tax = t.action === 'SELL' ? calcTax(amount, t.symbol, settings) : 0
  const net = isBuy ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))
  const isValid = finalShares > 0 && safePrice > 0 && (date !== t.trade_date || finalShares !== t.shares || safePrice !== t.price || note !== (t.note||''))
  
  const handleSave = async () => {
    setLoading(true); await fetch('/api/transactions', { method: 'PUT', body: JSON.stringify({ id: t.id, trade_date: date, shares: finalShares, price: safePrice, note }) })
    setIsEditing(false); setLoading(false); onUpdated()
  }
  
  if (isEditing) return (
    <div className="p-5 rounded-2xl bg-bg-surface border border-gold/30 space-y-5 my-2 shadow-2xl animate-slide-up">
      <div className="text-center pb-2 border-b border-white/5"><h4 className="font-black text-sm text-gold tracking-tight">編輯：{isBuy?'買入':'賣出'} {t.name_zh || t.symbol}</h4></div>
      <div className="flex gap-2 p-1 bg-black/20 rounded-xl">
        <button onClick={() => setTradeType('FULL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FULL'?'bg-gold text-bg-base shadow-md':'text-white/30'}`}>整張 (1000股)</button>
        <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FRACTIONAL'?'bg-gold text-bg-base shadow-md':'text-white/30'}`}>零股</button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label>{tradeType==='FULL'?'張數':'股數'}</Label><input type="number" value={tradeType==='FULL'?lots:shares} onFocus={()=>tradeType==='FULL'?setLots(''):setShares('')} onChange={e=>{const v=e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v as any):setShares(v as any)}} className="input-base text-center font-black py-3" /></div>
        <div className="space-y-1.5"><Label>成交價</Label><input type="number" step="0.01" value={price} onFocus={()=>setPrice('')} onChange={e=>setPrice(e.target.value===''?'':Number(e.target.value))} className="input-base text-center font-black py-3" /></div>
      </div>
      <div className="space-y-1.5"><Label>交易日期</Label><DatePicker value={date} onChange={setDate} /></div>
      <div className="space-y-1.5"><Label>備註</Label><input value={note} onChange={e=>setNote(e.target.value)} className="input-base text-sm py-3" placeholder="選填..." /></div>
      <div className="card-base p-4 space-y-2 bg-black/20 text-[11px] font-bold">
        <div className="flex justify-between opacity-40"><span>手續費 + 稅</span><span>{fmtMoney(Math.floor(fee+tax))}</span></div>
        <div className="flex justify-between items-center pt-2 border-t border-white/5"><span className="text-white/60">預估淨收支</span><span className={`text-base font-black ${net>=0?'text-red-400':'text-green-400'}`}>{net>=0?'+':''}{fmtMoney(net)}</span></div>
      </div>
      <div className="flex gap-3 pt-1"><button onClick={handleSave} disabled={!isValid || loading} className="flex-[3] btn-primary py-3.5">儲存修改</button><button onClick={() => setIsEditing(false)} className="flex-1 btn-secondary py-3.5">取消</button></div>
    </div>
  )
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-white/5 last:border-0">
      <div className="flex flex-col"><div className="flex items-center gap-2 text-[11px] opacity-40 font-mono">{t.trade_date} {t.trade_type === 'DCA' && <span className="text-gold font-black">定期定額</span>}</div><div className="text-sm font-bold text-white/90">{t.shares.toLocaleString()}股 @ {t.price.toFixed(2)}</div></div>
      <div className="text-right">
        <div className={`text-base font-mono font-black ${t.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>{t.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(t.net_amount))}</div>
        <div className="flex gap-3 justify-end mt-1">
          <button onClick={() => setIsEditing(true)} className="text-[11px] font-black text-gold active:opacity-50 transition-opacity">編輯</button>
          <button onClick={() => onDelete(t.id)} className="text-[11px] font-black text-red-400 active:opacity-50 transition-opacity">刪除</button>
        </div>
      </div>
    </div>
  )
}

function shortMoney(v: number): string {
  const abs = Math.abs(v), sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[10px] font-black opacity-30 uppercase tracking-widest ml-1 mb-1 block">{children}</label> }
function Empty({ icon, text, sub }: any) { return <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-30 animate-pulse"><div className="text-6xl">{icon}</div><div className="font-black text-lg">{text}</div><div className="text-sm text-center max-w-[200px] leading-relaxed">{sub}</div></div> }
