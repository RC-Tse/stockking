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
  onRefresh: () => void
  onRefreshCal: (year: number, month: number) => void
}

export default function HoldingsTab({ holdings, quotes, settings, transactions, calEntries, onRefresh, onRefreshCal }: Props) {
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
    const realizedByBuyYear: Record<string, number> = {}
    const realizedBySellYear: Record<string, number> = {}
    const inventory: Record<string, { shares: number, cost: number, buyYear: string }[]> = {}
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
        const cost = Math.floor(tx.amount) + Math.floor(tx.fee)
        inventory[tx.symbol].push({ shares: tx.shares, cost, buyYear })
        stockHistory[tx.symbol].buyCost += cost
      } else {
        stockHistory[tx.symbol].sellRev += tx.net_amount
        let sellRemaining = tx.shares
        const sellUnitNet = tx.net_amount / tx.shares
        const sellYear = tx.trade_date.split('-')[0]
        while (sellRemaining > 0 && inventory[tx.symbol].length > 0) {
          const lot = inventory[tx.symbol][0]
          const sharesFromLot = Math.min(lot.shares, sellRemaining)
          const lotCostBasis = (sharesFromLot / lot.shares) * lot.cost
          const portionProfit = (sellUnitNet * sharesFromLot) - lotCostBasis
          
          realizedCostBasis += lotCostBasis
          realizedByBuyYear[lot.buyYear] = (realizedByBuyYear[lot.buyYear] || 0) + portionProfit
          realizedBySellYear[sellYear] = (realizedBySellYear[sellYear] || 0) + portionProfit
          totalRealized += portionProfit
          
          sellRemaining -= sharesFromLot
          lot.cost -= lotCostBasis
          lot.shares -= sharesFromLot
          if (lot.shares <= 0) inventory[tx.symbol].shift()
        }
      }
    }

    const unrealizedByBuyYear: Record<string, number> = {}
    Object.keys(inventory).forEach(sym => {
      const q = quotes[sym]
      const currentPrice = q?.bid_price || q?.price || 0
      const totalShares = inventory[sym].reduce((s, l) => s + l.shares, 0)
      if (totalShares <= 0) return

      const grossMV = Math.floor(currentPrice * totalShares)
      const sellFee = calcFee(grossMV, settings, true)
      const sellTax = calcTax(grossMV, sym, settings)
      const netMV = grossMV - sellFee - sellTax
      const totalActualCost = inventory[sym].reduce((s, l) => s + l.cost, 0)
      
      const totalNetPnL = netMV - totalActualCost
      inventory[sym].forEach(lot => {
        if (totalActualCost === 0) return
        const lotRatio = lot.cost / totalActualCost
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

      <IntegratedCalendar entries={calEntries} transactions={transactions} onRefresh={onRefreshCal} holdings={holdings} quotes={quotes} settings={settings} />

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

function IntegratedCalendar({ entries, transactions, onRefresh, holdings, quotes, settings }: any) {
  const [viewDate, setViewDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [view, setView] = useState<any>('CALENDAR')
  const [dayDetails, setDayDetails] = useState<any[] | null>(null)
  const [isHoliday, setIsHoliday] = useState(false)
  const [loading, setLoading] = useState(false)
  const year = viewDate.getFullYear(), month = viewDate.getMonth() + 1
  useEffect(() => { onRefresh(year, month) }, [year, month, onRefresh])

  const days = useMemo(() => {
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const cells = []
    for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }, [year, month])

  const entryMap = useMemo(() => {
    const map: Record<number, any> = {}
    entries?.forEach((e: any) => {
      const day = parseInt(e.entry_date.split('-')[2], 10)
      map[day] = e
    })
    return map
  }, [entries])

  const hasTxMap = useMemo(() => {
    const map: Record<number, boolean> = {}
    transactions?.forEach((t: Transaction) => {
      const dParts = t.trade_date.split('-')
      if (parseInt(dParts[0]) === year && parseInt(dParts[1]) === month) {
        map[parseInt(dParts[2])] = true
      }
    })
    return map
  }, [transactions, year, month])

  const toggleDate = async (dateStr: string) => {
    try {
      if (selectedDate === dateStr) { setSelectedDate(null); setDayDetails(null); setIsHoliday(false); return }
      setSelectedDate(dateStr)
      setLoading(true)
      setIsHoliday(false)

      const d = new Date(dateStr)
      const isWeekend = d.getDay() === 0 || d.getDay() === 6
      const twseClosedDates = ['2023-01-01', '2023-01-02', '2023-01-20', '2023-01-23', '2023-01-24', '2023-01-25', '2023-01-26', '2023-01-27', '2023-02-27', '2023-02-28', '2023-04-03', '2023-04-04', '2023-04-05', '2023-05-01', '2023-06-22', '2023-06-23', '2023-09-29', '2023-10-09', '2023-10-10', '2024-01-01', '2024-02-08', '2024-02-09', '2024-02-12', '2024-02-13', '2024-02-14', '2024-02-28', '2024-04-04', '2024-04-05', '2024-05-01', '2024-06-10', '2024-09-17', '2024-10-10', '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-28', '2025-04-04', '2025-05-01', '2025-05-30', '2025-10-06']
      
      if (isWeekend || twseClosedDates.includes(dateStr)) {
        setIsHoliday(true)
        setDayDetails([])
        setLoading(false)
        return
      }

      const inventory: Record<string, { shares: number; cost: number }[]> = {}
      const sortedTxs = [...(transactions || [])]
        .filter(t => t.trade_date <= dateStr)
        .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.id - b.id)

      for (const tx of sortedTxs) {
        if (!tx.symbol) continue
        if (!inventory[tx.symbol]) inventory[tx.symbol] = []
        if (tx.action !== 'SELL') {
          const cost = Math.floor(Number(tx.amount) || 0) + Math.floor(Number(tx.fee) || 0)
          inventory[tx.symbol].push({ shares: Number(tx.shares) || 0, cost })
        } else {
          let rem = Number(tx.shares) || 0
          while (rem > 0 && inventory[tx.symbol].length) {
            const lot = inventory[tx.symbol][0]
            if (lot.shares <= rem) {
              rem -= lot.shares
              inventory[tx.symbol].shift()
            } else {
              const lotCostBasis = (rem / lot.shares) * lot.cost
              lot.shares -= rem
              lot.cost -= lotCostBasis
              rem = 0
            }
          }
        }
      }

      const held = Object.keys(inventory).filter(s => inventory[s].reduce((sum, l) => sum + l.shares, 0) > 0)
      if (!held.length) {
        setDayDetails([])
        setLoading(false)
        return
      }

      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
      const isToday = dateStr === todayStr
      let results: Record<string, any> = {}

      if (isToday && quotes) {
        // Use live quotes for Today to ensure parity with main page
        results = quotes
      } else {
        const res = await fetch(`/api/stocks?symbols=${held.join(',')}&date=${dateStr}`)
        if (!res.ok) throw new Error('API fetch error')
        results = await res.json() || {}
      }

      if (Object.keys(results).length === 0 || (!isToday && Object.values(results).some((q: any) => q.trade_date && q.trade_date !== dateStr))) {
        setIsHoliday(true)
        setDayDetails([])
        return
      }

      const details = held.map(sym => {
        const lots = inventory[sym] || []
        const totalShares = lots.reduce((s, l) => s + l.shares, 0)
        const actualCost = lots.reduce((sum, lot) => sum + lot.cost, 0)
        const q = results[sym] || {}
        // Prefer bid_price for conservative valuation (matches brokerage standard)
        const price = Number(q.bid_price || q.price) || 0
        const grossMV = Math.floor(price * totalShares)
        const sellFee = calcFee(grossMV, settings, true)
        const sellTax = calcTax(grossMV, sym, settings)
        const netMV = grossMV - sellFee - sellTax
        const pnl = netMV - actualCost
        return {
          symbol: sym,
          name_zh: q.name_zh || getStockName(sym),
          shares: totalShares,
          price,
          prev: q.prev,
          change: q.change,
          change_pct: q.change_pct,
          market_value: netMV,
          total_cost: actualCost,
          pnl,
          pnl_pct: actualCost > 0 ? (pnl / actualCost) * 100 : 0
        }
      })
      setDayDetails(details.sort((a, b) => b.market_value - a.market_value))
    } catch (e) {
      console.error('toggleDate error:', e)
      setDayDetails([])
      alert('載入失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card-base p-5 space-y-6 border-white/10 shadow-2xl">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewDate(new Date(year, month - 2, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-hover text-accent active:scale-90 transition-all border border-white/5 shadow-lg"><ChevronLeft size={20}/></button>
          <div className="flex gap-2 font-black text-[var(--t1)] text-[20px]">
            <button onClick={() => setView(view === 'YEAR' ? 'CALENDAR' : 'YEAR')} className={`px-2 rounded transition-colors ${view === 'YEAR' ? 'text-accent' : 'active:opacity-60'}`}>{year} 年</button>
            <button onClick={() => setView(view === 'MONTH' ? 'CALENDAR' : 'MONTH')} className={`px-2 rounded transition-colors ${view === 'MONTH' ? 'text-accent' : 'active:opacity-60'}`}>{month} 月</button>
          </div>
          <button onClick={() => setViewDate(new Date(year, month, 1))} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-hover text-accent active:scale-90 transition-all border border-white/5 shadow-lg"><ChevronRight size={20}/></button>
        </div>

        {view === 'CALENDAR' && (
          <div className="grid grid-cols-7 gap-2">
            {['日','一','二','三','四','五','六'].map((d, i) => <div key={d} className={`text-center text-[11px] font-bold py-1 ${i===0?'text-red-400':i===6?'text-accent':'text-[var(--t3)]'}`}>{d}</div>)}
            {days.map((d, i) => {
              if (d === null) return <div key={`empty-${i}`} style={{ minHeight: '58px' }} />
              const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, entry = entryMap[d]
              const dObj = new Date(dateStr)
              const isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6
              const pnlPct = entry?.pnl_pct || 0
              const isToday = new Date().toISOString().split('T')[0] === dateStr, isSel = selectedDate === dateStr
              let bg = 'transparent'
              const hasPnl = entry && (entry.pnl !== 0 || (entry.realized_pnl !== 0 && entry.realized_pnl !== undefined))
              
              if (!isWeekend) {
                if (pnlPct > 0) bg = `rgba(224, 80, 80, ${Math.min(0.85, 0.3 + (pnlPct/5)*0.55)})`
                else if (pnlPct < 0) bg = `rgba(66, 176, 122, ${Math.min(0.85, 0.3 + (Math.abs(pnlPct)/5)*0.55)})`
                else bg = 'var(--bg-surface)'
              }
              
              return (
                <div key={d} onClick={() => toggleDate(dateStr)} 
                  className={`cal-day relative rounded-[10px] border transition-all flex flex-col items-center justify-center ${isSel ? 'border-accent bg-accent z-10 scale-105 shadow-accent/20' : isToday ? 'border-accent shadow-accent/10' : 'border-transparent'}`} 
                  style={{ background: isSel ? 'var(--accent)' : bg, minHeight: '58px' }}>
                  
                  <span className={`absolute top-1 left-1.5 leading-none ${
                    isToday ? 'text-[14px] font-[800] text-accent' : 
                    isSel ? 'text-bg-base' : 
                    !isWeekend && hasPnl ? 'text-[var(--t1)]' : 'text-[var(--t3)]'
                  } ${!isWeekend && hasPnl ? 'text-[14px] font-[800]' : 'text-[13px] font-[600]'}`}>{d}</span>

                  {!isWeekend && entry && (
                    <div className="flex flex-col items-center justify-center mt-4 space-y-1">
                      {/* Line 1: Unrealized PnL Status */}
                      <div className={`text-[12px] font-[700] leading-none ${isSel ? 'text-bg-base' : 'text-[var(--t1)]'}`}>
                        {entry.pnl > 0 ? '+' : ''}{shortMoney(entry.pnl)}
                      </div>
                      {/* Line 2: Unrealized PnL % */}
                      <div className={`text-[11px] font-[600] leading-none ${isSel ? 'text-bg-base/60' : 'text-white/85'}`}>
                        {entry.pnl > 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                      </div>
                      {/* Line 3: Daily Realized PnL */}
                      {entry.realized_pnl !== 0 && entry.realized_pnl !== undefined ? (
                        <div className={`text-[9px] font-black leading-none mt-0.5 ${isSel ? 'text-bg-base' : 'text-accent'}`}>
                          {entry.realized_pnl > 0 ? '+' : ''}{shortMoney(entry.realized_pnl)}
                        </div>
                      ) : (
                        <div className="h-[9px]" /> // Maintain height for grid consistency
                      )}
                    </div>
                  )}
                  {hasTxMap[d] && <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent shadow-sm border border-bg-base" />}
                </div>
              )
            })}
          </div>
        )}
        {view === 'YEAR' && <div className="grid grid-cols-3 gap-2">{Array.from({length:10}, (_,i)=>new Date().getFullYear()-7+i).map(y => <button key={y} onClick={()=>{setViewDate(new Date(y, month-1, 1)); setView('CALENDAR')}} className={`py-4 rounded-xl font-black transition-all ${year===y?'bg-accent text-bg-base shadow-lg':'bg-bg-hover text-[var(--t2)] active:bg-bg-card'}`}>{y}</button>)}</div>}
        {view === 'MONTH' && <div className="grid grid-cols-3 gap-2">{Array.from({length:12}, (_,i)=>i+1).map(m => <button key={m} onClick={()=>{setViewDate(new Date(year, m-1, 1)); setView('CALENDAR')}} className={`py-4 rounded-xl font-black transition-all ${month===m?'bg-accent text-bg-base shadow-lg':'bg-bg-hover text-[var(--t2)] active:bg-bg-card'}`}>{m} 月</button>)}</div>}
      </div>

      {selectedDate && (
        <div className="animate-slide-up card-base p-5 space-y-5 border-white/10 shadow-2xl">
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <div className="flex flex-col">
              <h3 className="font-black text-base text-[var(--t1)]">{selectedDate.split('-')[1]} 月 {selectedDate.split('-')[2]} 日 持股明細</h3>
              {!isHoliday && (() => { 
                const entry = entries?.find((e: CalendarEntry) => e.entry_date === selectedDate); 
                if (!entry) return null; 
                return (
                  <div className="flex flex-col gap-0.5 mt-1">
                    <span className={`text-[10px] font-black font-mono ${entry.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      未實現損益狀態 {entry.pnl >= 0 ? '+' : ''}{fmtMoney(entry.pnl)} ({(entry.pnl_pct ?? 0).toFixed(2)}%)
                    </span>
                    {entry.realized_pnl !== 0 && entry.realized_pnl !== undefined && (
                      <span className="text-[10px] font-black font-mono text-accent">
                        當日已實現損益 {entry.realized_pnl > 0 ? '+' : ''}{fmtMoney(entry.realized_pnl)}
                      </span>
                    )}
                  </div>
                )
              })()}
            </div>
            {loading && <RefreshCw size={14} className="animate-spin text-accent" />}
          </div>
          
          {isHoliday ? (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-2">
              <div className="text-[16px] font-black text-[var(--t2)]">休市日</div>
              <div className="text-[12px] font-bold text-[var(--t3)]">當日無交易或市值變動</div>
            </div>
          ) : (
            <div className="space-y-4">
              {dayDetails?.map(det => (
                <div key={det.symbol} className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-black text-[var(--t1)] text-base">{det.name_zh} <span className="text-xs text-[var(--t3)] font-mono">{codeOnly(det.symbol)}</span></div>
                      <div className="text-[11px] font-bold text-[var(--t2)] mt-1">
                        {(det.shares ?? 0).toLocaleString()} 股 · 收盤 {det.price.toFixed(2)}
                        {det.change !== undefined && (() => {
                          const isUp = det.change > 0, isDown = det.change < 0
                          const changeClass = isUp ? (det.change_pct >= 9.8 ? 'text-red-900 bg-red-500 font-black px-1.5 py-0.5 rounded-md' : 'text-red-400 bg-red-400/20 px-1.5 py-0.5 rounded-md') : isDown ? (det.change_pct <= -9.8 ? 'text-green-900 bg-green-500 font-black px-1.5 py-0.5 rounded-md' : 'text-green-400 bg-green-400/20 px-1.5 py-0.5 rounded-md') : 'text-white'
                          return (
                            <span className={`ml-2 ${changeClass}`}>
                              {isUp ? '▲' : isDown ? '▼' : ''} {Math.abs(det.change).toFixed(2)} ({Math.abs(det.change_pct).toFixed(2)}%)
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                    <div>
                      <div className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest mb-1">持有成本 / 市值</div>
                      <div className="text-sm font-bold text-[var(--t1)] font-mono">
                        {fmtMoney(Math.round(det.total_cost))} / <span className="text-[var(--t1)]">{fmtMoney(det.market_value)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest mb-1">當日損益</div>
                      <div className={`text-sm font-black font-mono ${det.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {det.pnl >= 0 ? '+' : ''}{fmtMoney(Math.round(det.pnl))} ({det.pnl_pct.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(() => {
            const dayTxs = transactions?.filter((t: Transaction) => t.trade_date === selectedDate)
            if (!dayTxs?.length) return null
            return (
              <div className="pt-4 border-t border-white/5 space-y-4">
                <h4 className="text-[11px] font-black text-[var(--t3)] uppercase tracking-widest flex items-center gap-2"><ClipboardList size={14}/> 當天交易</h4>
                <div className="space-y-3">
                  {dayTxs.map((tx: Transaction) => (
                    <div key={tx.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                          (tx.action==='BUY' || tx.action==='DCA') ? 'bg-red-400/10 text-red-400 border-red-400/20' : 'bg-green-400/10 text-green-400 border-green-400/20'
                        }`}>
                          {tx.action==='BUY' ? '買入' : tx.action==='DCA' ? '定期' : '賣出'}
                        </span>
                        <span className="font-black text-[var(--t1)] truncate max-w-[100px]">{tx.name_zh || tx.symbol}</span>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-black ${tx.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>{tx.net_amount >= 0 ? '+' : ''}{fmtMoney(tx.net_amount)}</div>
                        <div className="text-[9px] text-[var(--t3)] font-bold">{(tx.shares ?? 0).toLocaleString()} 股 @ {(tx.price ?? 0).toFixed(2)}</div>
                      </div>
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
