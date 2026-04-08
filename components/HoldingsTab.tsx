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
  Trash2,
  Eye, 
  EyeOff,
  PieChart as PieChartIcon
} from 'lucide-react'
import DatePicker from './DatePicker'
import ConfirmModal from './ConfirmModal'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import IntegratedCalendar from './IntegratedCalendar'

const PIE_COLORS = [
  '#d4af37', '#e05050', '#42b07a', '#1C5D99', 
  '#717744', '#CBC0D3', '#C8B8DB', '#639FAB'
]

interface Props {
  holdings: Holding[]
  quotes: Record<string, Quote>
  settings: UserSettings
  transactions: Transaction[]
  calEntries: CalendarEntry[]
  calLoading: boolean
  onRefresh: () => void
  onRefreshCal: (year: number, month: number) => void
}

export default function HoldingsTab({ holdings, quotes, settings, transactions, calEntries, calLoading, onRefresh, onRefreshCal }: Props) {
  const currentYear = new Date().getFullYear().toString()
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [showData, setShowData] = useState(true)
  const [selectedPieSym, setSelectedPieSym] = useState<string | null>(null)

  // FIFO Metrics
  const { 
    totalRealized,
    realizedCostBasis,
    closedHoldings,
    yearPnl
  } = useMemo(() => {
    let totalRealized = 0
    let realizedCostBasis = 0
    const realizedBySellYear: Record<string, number> = {}
    const inventory: Record<string, { shares: number; principal: number; fee: number; origShares: number; buyYear: string }[]> = {}
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
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        inventory[tx.symbol].push({ shares: tx.shares, principal: tx.amount, fee: f, origShares: tx.shares, buyYear })
      } else {
        const f = calcFee(tx.amount, settings, true)
        const t = calcTax(tx.amount, tx.symbol, settings)
        const sellProceeds = Math.floor(tx.amount - f - t)
        stockHistory[tx.symbol].sellRev += sellProceeds
        
        let sellRemaining = tx.shares
        let matchedCostTotal = 0
        const sellYear = tx.trade_date.split('-')[0]
        
        while (sellRemaining > 0 && inventory[tx.symbol].length > 0) {
          const lot = inventory[tx.symbol][0]
          const take = Math.min(lot.shares, sellRemaining)
          const ratio = take / lot.origShares
          
          const matchedPrincipal = (take / lot.shares) * lot.principal
          const matchedFee = ratio * lot.fee
          const matchedCost = (matchedPrincipal + matchedFee)
          
          matchedCostTotal += matchedCost
          
          sellRemaining -= take
          lot.shares -= take
          lot.principal -= matchedPrincipal
          if (lot.shares <= 0) inventory[tx.symbol].shift()
        }
        
        const finalMatchedCost = Math.floor(matchedCostTotal)
        stockHistory[tx.symbol].buyCost += finalMatchedCost
        const profit = sellProceeds - finalMatchedCost
        totalRealized += profit
        realizedBySellYear[sellYear] = (realizedBySellYear[sellYear] || 0) + profit
      }
    }

    const unrealizedByBuyYear: Record<string, number> = {}
    Object.keys(inventory).forEach(sym => {
      const q = quotes[sym]
      const currentPrice = q?.bid_price || q?.price || 0
      const totalShares = inventory[sym].reduce((s, l) => s + l.shares, 0)
      if (totalShares <= 0) return

      const grossMV = Math.floor(currentPrice * totalShares)
      const sellFee = Math.floor(calcFee(grossMV, settings, true))
      const sellTax = Math.floor(calcTax(grossMV, sym, settings))
      const netMV = grossMV - sellFee - sellTax
      const totalActualCost = inventory[sym].reduce((s, l) => s + (l.principal + l.fee * (l.shares/l.origShares)), 0)
      
      const totalNetPnL = netMV - totalActualCost
      inventory[sym].forEach(lot => {
        if (totalActualCost === 0) return
        const currentLotCost = lot.principal + lot.fee * (lot.shares/lot.origShares)
        const lotRatio = currentLotCost / totalActualCost
        const lotNetPnL = totalNetPnL * lotRatio
        unrealizedByBuyYear[lot.buyYear] = (unrealizedByBuyYear[lot.buyYear] || 0) + lotNetPnL
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

    const allUnrealized = Object.values(unrealizedByBuyYear).reduce((s, a) => s + a, 0)
    const yearPnl = (realizedBySellYear[currentYear] || 0) + allUnrealized

    return { totalRealized, realizedCostBasis, closedHoldings, yearPnl }
  }, [transactions, currentYear, quotes, settings])

  const currentNetMV = holdings.reduce((s, h) => s + h.net_market_value, 0)
  const currentCost = holdings.reduce((s, h) => s + h.total_cost, 0)
  const unrealizedPnl = currentNetMV - currentCost
  const unrealizedPct = currentCost ? (unrealizedPnl / currentCost) * 100 : 0
  const realizedPct = realizedCostBasis ? (totalRealized / realizedCostBasis) * 100 : 0
  
  const totalPnl = totalRealized + unrealizedPnl
  const yearAchieved = settings.year_goal > 0 ? (yearPnl / settings.year_goal) * 100 : null
  const totalAchieved = settings.total_goal > 0 ? (totalPnl / settings.total_goal) * 100 : null

  const pieData = useMemo(() => {
    return holdings.map(h => ({
      name: quotes[h.symbol]?.name_zh || getStockName(h.symbol),
      symbol: h.symbol,
      value: h.total_cost
    })).sort((a, b) => b.value - a.value)
  }, [holdings, quotes])

  const selectedHolding = useMemo(() => {
    return holdings.find(h => h.symbol === selectedPieSym)
  }, [holdings, selectedPieSym])

  const [expanded, setExpanded] = useState<string | null>(null)
  const [closedExpanded, setClosedExpanded] = useState(false)

  const [sortField, setSortField] = useState<'COST' | 'SYMBOL' | 'SHARES' | 'PNL'>('COST')
  const [sortDir, setSortDir] = useState<'DESC' | 'ASC'>('DESC')

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'SYMBOL': cmp = a.symbol.localeCompare(b.symbol); break
        case 'SHARES': cmp = a.shares - b.shares; break
        case 'PNL': cmp = a.unrealized_pnl - b.unrealized_pnl; break
        case 'COST': cmp = a.total_cost - b.total_cost; break
      }
      return sortDir === 'DESC' ? -cmp : cmp
    })
  }, [holdings, sortField, sortDir])

  const toggleSort = (field: 'COST' | 'SYMBOL' | 'SHARES' | 'PNL') => {
    if (sortField === field) {
      setSortDir(sortDir === 'DESC' ? 'ASC' : 'DESC')
    } else {
      setSortField(field)
      setSortDir('DESC')
    }
  }

  const confirmDelete = async () => {
    if (!deletingId) return
    try {
      const res = await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id: deletingId }) })
      if (!res.ok) throw new Error('Delete failed')
      setDeletingId(null); onRefresh()
    } catch (e) {
      console.error(e)
      alert('刪除失敗，請稍後再試')
    }
  }

  return (
    <div className="p-4 space-y-6 tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div className="glass p-5 relative overflow-hidden animate-slide-up border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <span className="text-base font-black text-[var(--t3)] uppercase tracking-[0.2em]">持股概覽 · {holdings.length} 檔</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowData(!showData)} className="p-2 rounded-full bg-white/5 text-accent border border-white/10 active:scale-95 transition-all">
              {showData ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button onClick={() => window.location.reload()} className="p-2 rounded-full bg-white/5 text-accent border border-white/10 active:scale-95 transition-all">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center">
            <StatBox label="持有成本" value={showData ? fmtMoney(currentCost) : "••••••"} className="w-1/2 text-center" large />
            <div className="w-1/2 flex flex-col items-center border-l border-white/5 px-3">
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[11px] font-black text-[var(--t3)] uppercase tracking-widest">預估淨市值</span>
                <span 
                  onClick={() => alert("預估淨市值 = (庫存股數 * 市價) - 預估賣出手續費 - 預估證交稅\n此數值與各大券商 App 之「損益試算」或「淨市值」顯示一致。")}
                  className="text-[9px] text-accent/60 border border-accent/30 rounded-full w-3.5 h-3.5 flex items-center justify-center font-black cursor-pointer flex-shrink-0 active:scale-90 transition-all"
                >i</span>
              </div>
              <span className={`font-black font-mono leading-none text-[22px] ${!showData ? 'text-white' : (currentNetMV >= currentCost ? 'text-red-400' : 'text-green-400')}`}>{showData ? fmtMoney(currentNetMV) : "••••••"}</span>
            </div>
          </div>
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="未實現損益" value={showData ? `${unrealizedPnl >= 0 ? '+' : ''}${fmtMoney(Math.round(unrealizedPnl))}` : "••••••"} className="w-1/2 text-center" upDown={unrealizedPnl} />
            <StatBox label="未實現投報" value={showData ? `${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%` : "••••••"} className="w-1/2 text-center border-l border-white/5" upDown={unrealizedPnl} />
          </div>
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="已實現損益" value={showData ? `${totalRealized >= 0 ? '+' : ''}${fmtMoney(Math.round(totalRealized))}` : "••••••"} className="w-1/2 text-center" upDown={totalRealized} />
            <StatBox label="已實現投報" value={showData ? `${realizedPct >= 0 ? '+' : ''}${realizedPct.toFixed(2)}%` : "••••••"} className="w-1/2 text-center border-l border-white/5" upDown={totalRealized} />
          </div>
          <div className="pt-6 border-t border-white/5 space-y-5">
            <ProgressBar label="年度獲利目標" icon={Target} current={yearPnl} goal={settings.year_goal} achieved={yearAchieved} showData={showData} />
            <ProgressBar label="總損益目標" icon={Trophy} current={totalPnl} goal={settings.total_goal} achieved={totalAchieved} showData={showData} />
          </div>
        </div>
      </div>

      <div className="card-base p-6 space-y-6 border-white/10 shadow-xl bg-black/20">
        <div className="flex items-center justify-between px-1">
          <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider flex items-center gap-2">
            <PieChartIcon size={14} className="text-accent" /> 資產分佈 (成本)
          </span>
        </div>

        <div className="h-64 w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                innerRadius={65}
                outerRadius={95}
                paddingAngle={5}
                dataKey="value"
                onClick={(data) => setSelectedPieSym(selectedPieSym === data.payload.symbol ? null : data.payload.symbol)}
              >
                {pieData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={PIE_COLORS[index % PIE_COLORS.length]} 
                    stroke="rgba(0,0,0,0.2)"
                    style={{ outline: 'none', cursor: 'pointer', opacity: selectedPieSym && selectedPieSym !== entry.symbol ? 0.4 : 1 }}
                  />
                ))}
              </Pie>
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const val = typeof payload[0].value === 'number' ? payload[0].value : 0
                    return (
                      <div className="glass p-2 border-white/10 text-[10px] font-bold">
                        {payload[0].name}: {fmtMoney(val)}
                      </div>
                    )
                  }
                  return null
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] font-black text-[var(--t3)] uppercase">持股分布</span>
            <span className="text-lg font-black text-[var(--t1)] font-mono">{fmtMoney(Math.round(currentCost))}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {pieData.map((entry, index) => (
            <button 
              key={entry.symbol}
              onClick={() => setSelectedPieSym(selectedPieSym === entry.symbol ? null : entry.symbol)}
              className="flex items-center justify-between group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                <span className={`text-[11px] font-bold truncate ${selectedPieSym === entry.symbol ? 'text-accent' : 'text-[var(--t2)]'}`}>{entry.name}</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--t3)] ml-2">{currentCost > 0 ? ((entry.value / currentCost) * 100).toFixed(1) : 0}%</span>
            </button>
          ))}
        </div>

        {selectedHolding && (
          <div className="mt-4 pt-4 border-t border-white/5 animate-slide-up">
            <div className="glass p-4 space-y-4 border-accent/20">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-[var(--t1)] font-black text-sm">{quotes[selectedHolding.symbol]?.name_zh || getStockName(selectedHolding.symbol)}</h4>
                  <p className="text-[10px] font-mono text-[var(--t3)]">{codeOnly(selectedHolding.symbol)}</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-0.5">佔總投入比例</div>
                  <div className="text-sm font-black text-accent font-mono">{currentCost > 0 ? ((selectedHolding.total_cost / currentCost) * 100).toFixed(1) : 0}%</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <DetailBox label="持股數量" value={`${selectedHolding.shares.toLocaleString()} 股`} />
                <DetailBox label="平均成本" value={selectedHolding.avg_cost.toFixed(2)} />
                <DetailBox label="持有成本" value={fmtMoney(selectedHolding.total_cost)} />
                <DetailBox label="預估淨市值" value={fmtMoney(selectedHolding.net_market_value)} />
              </div>

              <div className="pt-2 border-t border-white/5 flex justify-between items-end">
                <span className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest">未實現損益</span>
                <span className={`font-black font-mono text-base ${selectedHolding.unrealized_pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {selectedHolding.unrealized_pnl >= 0 ? '+' : ''}{fmtMoney(selectedHolding.unrealized_pnl)} ({selectedHolding.pnl_pct.toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <IntegratedCalendar entries={calEntries} transactions={transactions} onRefresh={onRefreshCal} holdings={holdings} quotes={quotes} settings={settings} loading={calLoading} />

      <div className="space-y-4">
        <div className="flex gap-2 px-1 text-xs justify-end">
          {(
            [
              { id: 'SYMBOL', label: '代號' },
              { id: 'SHARES', label: '股數' },
              { id: 'PNL', label: '損益' },
              { id: 'COST', label: '成本' },
            ] as const
          ).map(opt => (
            <button
              key={opt.id}
              onClick={() => toggleSort(opt.id)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                sortField === opt.id 
                  ? 'bg-accent/20 text-accent border border-accent/30 shadow-md' 
                  : 'bg-black/20 text-[var(--t2)] border border-white/5 active:bg-white/5'
              }`}
            >
              {opt.label}
              {sortField === opt.id && (
                <span className="text-[10px] leading-none mb-0.5">{sortDir === 'DESC' ? '↓' : '↑'}</span>
              )}
            </button>
          ))}
        </div>
        {sortedHoldings.map(h => (
          <HoldingItem key={h.symbol} h={h} q={quotes[h.symbol]} settings={settings} txs={transactions.filter(t => t.symbol === h.symbol)} isExpanded={expanded === h.symbol} onToggle={() => setExpanded(expanded === h.symbol ? null : h.symbol)} onUpdated={onRefresh} onDelete={(id:number)=>setDeletingId(id)} />
        ))}

        {closedHoldings.length > 0 && (
          <div className="pt-4">
            <button onClick={() => setClosedExpanded(!closedExpanded)} className="w-full flex items-center justify-between p-4 card-base border-accent/20 active:bg-bg-hover transition-all">
              <div className="flex items-center gap-3">
                <Archive size={18} className="text-accent" />
                <span className="font-black text-sm text-[var(--t2)]">已結算股票 ({closedHoldings.length} 檔)</span>
              </div>
              <ChevronDown size={16} className={`text-accent transition-transform duration-300 ${closedExpanded ? 'rotate-180' : ''}`} />
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
  const isHidden = value === "••••••"
  const color = (upDown === undefined || isHidden) ? 'text-[var(--t1)]' : upDown >= 0 ? 'text-red-400' : 'text-green-400'
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-[11px] font-black text-[var(--t3)] uppercase tracking-widest mb-1.5">{label}</span>
      <span className={`font-black font-mono leading-none ${large ? 'text-[22px]' : 'text-[18px]'} ${color}`}>{value}</span>
    </div>
  )
}

function DetailBox({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <div className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest mb-1">{label}</div>
      <div className="text-sm font-bold text-[var(--t1)] font-mono">{value}</div>
    </div>
  )
}

function ProgressBar({ label, icon: Icon, goal, current, achieved, showData }: any) {
  const isNegative = current < 0
  return (
    <div className="space-y-2.5">
      <div className="flex justify-between items-end">
        <span className="text-[13px] font-black text-[var(--t2)] flex items-center gap-2">
          <Icon size={14} className="text-accent" /> {label}
        </span>
        {goal > 0 ? (
          <div className="flex flex-col items-end">
            <span className={`text-[13px] font-black font-mono ${isNegative ? 'text-red-400' : 'text-accent'}`}>
              {showData ? `${achieved.toFixed(1)}%` : "••••••"}
            </span>
            <span className="text-[10px] font-bold text-[var(--t3)]">
              {showData ? `${fmtMoney(Math.round(current))} / ${fmtMoney(goal)}` : "••••••"}
            </span>
          </div>
        ) : (
          <button onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' }))} className="text-[11px] font-bold text-accent/50">點此設定目標 ➔</button>
        )}
      </div>
      {goal > 0 && (
        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
          <div 
            className={`h-full transition-all duration-1000 ${isNegative ? 'bg-red-500/50' : 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-bright)]'}`} 
            style={{ width: `${Math.min(100, Math.max(0, achieved))}%` }} 
          />
        </div>
      )}
    </div>
  )
}

function HoldingItem({ h, q, settings, txs, isExpanded, onToggle, onUpdated, onDelete }: any) {
  const isUp = h.unrealized_pnl >= 0
  const color = isUp ? 'text-red-400' : 'text-green-400'
  const nameZh = q?.name_zh || h.symbol

  return (
    <div className={`card-base overflow-hidden transition-all duration-300 border ${isExpanded ? 'border-accent shadow-lg shadow-accent/5' : 'border-white/10 shadow-xl'}`}>
      <div className="p-4 cursor-pointer active:bg-bg-hover space-y-3" onClick={onToggle}>
        <div className="flex justify-between items-center">
          <div className="font-black text-[var(--t1)] text-base">
            {nameZh} <span className="text-xs text-[var(--t3)] font-mono ml-1">{codeOnly(h.symbol)}</span>
          </div>
        </div>
        
        <div className="text-[11px] font-bold text-[var(--t2)]">
          {(h.shares ?? 0).toLocaleString()} 股 · 收盤 {(h.current_price ?? 0).toFixed(2)}
          {q?.change !== undefined && (() => {
            const isUp = q.change > 0, isDown = q.change < 0
            const changeClass = isUp ? (q.change_pct >= 9.8 ? 'text-red-900 bg-red-500 font-black px-1.5 py-0.5 rounded-md' : 'text-red-400 bg-red-400/20 px-1.5 py-0.5 rounded-md') : isDown ? (q.change_pct <= -9.8 ? 'text-green-900 bg-green-500 font-black px-1.5 py-0.5 rounded-md' : 'text-green-400 bg-green-400/20 px-1.5 py-0.5 rounded-md') : 'text-white'
            return (
              <span className={`ml-2 ${changeClass}`}>
                {isUp ? '▲' : isDown ? '▼' : ''} {Math.abs(q.change).toFixed(2)} ({Math.abs(q.change_pct).toFixed(2)}%)
              </span>
            )
          })()}
        </div>

        <div className="h-px bg-white/5" />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest mb-1">持有成本 / 預估淨市值</div>
            <div className="text-sm font-bold text-[var(--t1)] font-mono">
              {fmtMoney(Math.round(h.total_cost))} / <span className="text-[var(--t1)]">{fmtMoney(Math.round(h.net_market_value))}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest mb-1">未實現損益</div>
            <div className={`text-sm font-black font-mono ${color}`}>
              {isUp ? '+' : ''}{fmtMoney(Math.round(h.unrealized_pnl))} ({(h.pnl_pct ?? 0).toFixed(2)}%)
            </div>
          </div>
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
          <div className="flex items-center gap-2"><span className="font-black text-[var(--t1)] text-base">{name} ({codeOnly(c.symbol)})</span></div>
          <div className={`font-black font-mono text-base ${c.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>{c.pnl >= 0 ? '+' : ''}{fmtMoney(Math.round(c.pnl))}</div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-[var(--t3)]">總成本 {fmtMoney(Math.round(c.buyCost))} · 總營收 {fmtMoney(Math.round(c.sellRev))}</span>
          <div className={`text-[10px] font-bold ${c.pnl >= 0 ? 'text-red-400/50' : 'text-green-400/50'}`}>{(c.pnlPct ?? 0).toFixed(2)}%</div>
        </div>
      </div>
      {expanded && <div className="bg-black/20 border-t border-white/5 p-3 space-y-2">{transactions.map((t: any) => <TxRow key={t.id} t={t} settings={settings} onUpdated={onRefresh} onDelete={onDelete} />)}</div>}
    </div>
  )
}


function TxRow({ t, settings, onUpdated, onDelete }: any) {
  const [isEditing, setIsEditing] = useState(false), [loading, setLoading] = useState(false)
  const [date, setDate] = useState(t.trade_date), [shares, setShares] = useState<number|''>(t.shares), [price, setPrice] = useState<number|''>(t.price), [note, setNote] = useState(t.note || '')
  const [tradeType, setTradeType] = useState(t.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots] = useState<number | ''>(Math.floor(t.shares / 1000) || 1)
  const [isDcaOpt, setIsDcaOpt] = useState(t.action === 'DCA')
  const isBuy = t.action === 'BUY' || t.action === 'DCA'
  const finalShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = Number(price) || 0
  const amount = finalShares * safePrice
  const actionToSave = isBuy ? (isDcaOpt ? 'DCA' : 'BUY') : 'SELL'
  const fee = calcFee(amount, settings, !isBuy, actionToSave === 'DCA')
  const tax = t.action === 'SELL' ? calcTax(amount, t.symbol, settings) : 0
  const net = isBuy ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))
  const isValid = finalShares > 0 && safePrice > 0 && (
    date !== t.trade_date || 
    finalShares !== t.shares || 
    safePrice !== t.price || 
    note !== (t.note||'') ||
    isDcaOpt !== (t.action === 'DCA')
  )
  
  const handleSave = async () => {
    setLoading(true); await fetch('/api/transactions', { method: 'PUT', body: JSON.stringify({ id: t.id, trade_date: date, shares: finalShares, price: safePrice, note, action: actionToSave }) })
    setIsEditing(false); setLoading(false); onUpdated()
  }
  
  if (isEditing) return (
    <div className="p-5 rounded-2xl bg-bg-surface border border-accent/30 space-y-5 my-2 shadow-2xl animate-slide-up">
      <div className="text-center pb-2 border-b border-white/5"><h4 className="font-black text-sm text-accent tracking-tight">編輯：{isBuy?'買入':'賣出'} {t.name_zh || t.symbol}</h4></div>
      <div className="flex gap-2 p-1 bg-black/20 rounded-xl">
        <button onClick={() => setTradeType('FULL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FULL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)]'}`}>整張 (1000股)</button>
        <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FRACTIONAL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)]'}`}>零股</button>
      </div>

      {isBuy && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
          <span className="text-[11px] font-black text-[var(--t2)] tracking-widest uppercase">定期定額</span>
          <button 
            onClick={() => setIsDcaOpt(!isDcaOpt)}
            className={`w-12 h-6 rounded-full relative transition-colors ${isDcaOpt ? 'bg-yellow-500' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${isDcaOpt ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label>{tradeType==='FULL'?'張數':'股數'}</Label><input type="number" value={tradeType==='FULL'?lots:shares} onFocus={()=>tradeType==='FULL'?setLots(''):setShares('')} onChange={e=>{const v=e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v):setShares(v)}} className="input-base text-center font-black py-3" /></div>
        <div className="space-y-1.5"><Label>成交價</Label><input type="number" step="0.01" value={price} onFocus={()=>setPrice('')} onChange={e=>setPrice(e.target.value===''?'':Number(e.target.value))} className="input-base text-center font-black py-3" /></div>
      </div>
      <div className="space-y-1.5"><Label>交易日期</Label><DatePicker value={date} onChange={setDate} /></div>
      <div className="space-y-1.5"><Label>備註</Label><input value={note} onChange={e=>setNote(e.target.value)} className="input-base text-sm py-3" placeholder="選填..." /></div>
      <div className="card-base p-4 space-y-2 bg-black/20 text-[11px] font-bold">
        <div className="flex justify-between opacity-40"><span>手續費 + 稅</span><span>{fmtMoney(Math.floor(fee+tax))}</span></div>
        <div className="flex justify-between items-center pt-2 border-t border-white/5"><span className="text-[var(--t2)]">預估淨收支</span><span className={`text-base font-black ${net>=0?'text-red-400':'text-green-400'}`}>{net>=0?'+':''}{fmtMoney(net)}</span></div>
      </div>
      <div className="flex gap-3 pt-1"><button onClick={handleSave} disabled={!isValid || loading} className="flex-[3] btn-primary py-3.5">確認修改</button><button onClick={() => setIsEditing(false)} className="flex-1 btn-secondary py-3.5">取消</button></div>
    </div>
  )
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-white/5 last:border-0">
      <div className="flex flex-col"><div className="flex items-center gap-2 text-[11px] opacity-40 font-mono">{t.trade_date} {(t.action === 'DCA' || t.trade_type === 'DCA') && <span className="text-yellow-500 bg-yellow-400/10 border border-yellow-500/20 px-1.5 py-0.5 rounded font-black tracking-widest leading-none mt-0.5">定期定額</span>}</div><div className="text-sm font-bold text-[var(--t1)]">{(t.shares ?? 0).toLocaleString()} 股 @ {(t.price ?? 0).toFixed(2)}</div></div>
      <div className="text-right">
        <div className={`text-base font-mono font-black ${t.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>{t.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(t.net_amount))}</div>
        <div className="flex gap-3 justify-end mt-1">
          <button onClick={() => setIsEditing(true)} className="text-[11px] font-black text-accent active:opacity-50 transition-opacity">編輯</button>
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
