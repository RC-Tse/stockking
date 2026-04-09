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
import { usePortfolio } from './providers/PortfolioContext'

const PIE_COLORS = [
  '#d4af37', '#e05050', '#42b07a', '#1C5D99', 
  '#717744', '#CBC0D3', '#C8B8DB', '#639FAB'
]

interface Props {
  onRefresh: () => void
}

export default function HoldingsTab({ onRefresh }: Props) {
  const { stats, settings, quotes } = usePortfolio()
  const { holdings, fullHistoryStats, allTimeRealized: totalRealized } = stats
  
  // Flattening transactions from fullHistoryStats for the transactional list view
  const transactions = useMemo(() => {
    const all: any[] = []
    Object.values(fullHistoryStats).forEach((s: any) => {
      s.history.forEach((h: any) => all.push(h))
    })
    return all.sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.id - a.id)
  }, [fullHistoryStats])
  
  const currentYear = new Date().getFullYear().toString()
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [showData, setShowData] = useState(true)
  const [selectedPieSym, setSelectedPieSym] = useState<string | null>(null)
  const [chartMode, setChartMode] = useState<'cost' | 'market'>('cost')

  // Derived Metrics from Context
  const {
    closedHoldings
  } = useMemo(() => {
    const ch = Object.entries(fullHistoryStats)
      .filter(([sym]) => !holdings.find(h => h.symbol === sym))
      .map(([sym, data]: [string, any]) => ({
        symbol: sym,
        buyCost: data.buyCost || data.buy,
        sellRev: data.sellRev || data.sell,
        pnl: data.realized,
        pnlPct: data.buy > 0 ? (data.realized / data.buy) * 100 : 0
      })).sort((a,b) => b.pnl - a.pnl)

    return { 
      closedHoldings: ch
    }
  }, [fullHistoryStats, holdings])

  const currentNetMV = stats.totalNetMV
  const currentCost = stats.totalBuyCost
  const unrealizedPnl = stats.totalUnrealizedPnl
  const unrealizedPct = stats.totalBuyCost ? (stats.totalUnrealizedPnl / stats.totalBuyCost) * 100 : 0
  const realizedPct = stats.historyBuyCost ? (stats.allTimeRealized / stats.historyBuyCost) * 100 : 0
  
  const totalPnl = stats.totalPnl
  
  const yearlyRealizedPct = (stats.yearlyRealizedCostBasis) ? (stats.yearlyRealized / stats.yearlyRealizedCostBasis) * 100 : 0
  const totalYearPnl = stats.yearlyRealized + stats.yearlyUnrealizedPnl

  const yearAchieved = settings.year_goal > 0 ? (totalYearPnl / settings.year_goal) * 100 : 0
  const totalAchieved = settings.total_goal > 0 ? (totalPnl / settings.total_goal) * 100 : 0


  const pieData = useMemo(() => {
    return holdings.map(h => ({
      name: getStockName(h.symbol),
      symbol: h.symbol,
      value: chartMode === 'cost' ? h.total_cost : h.net_market_value
    })).sort((a, b) => b.value - a.value)
  }, [holdings, chartMode])

  const chartTotal = useMemo(() => {
    return chartMode === 'cost' ? currentCost : currentNetMV
  }, [chartMode, currentCost, currentNetMV])

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
      <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-5 relative overflow-hidden animate-slide-up shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <span className="text-base font-black text-[var(--t2)] uppercase tracking-[0.2em]">持股概覽 · {holdings.length} 檔</span>
          <button onClick={() => setShowData(!showData)} className="p-2 rounded-full bg-white/5 text-accent border border-white/10 active:scale-90 active:opacity-70 transition-all">
            {showData ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center">
            <StatBox label="持有成本" value={showData ? fmtMoney(currentCost) : "••••••"} className="w-1/2 text-center" large />
            <div className="w-1/2 flex flex-col items-center border-l border-white/5 px-3">
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">預估淨市值</span>
                <span 
                  onClick={() => alert("預估淨市值 = (庫存股數 * 市價) - 預估賣出手續費 - 預估證交稅\n此數值與各大券商 App 之「損益試算」或「淨市值」顯示一致。")}
                  className="text-[9px] text-[var(--accent)] border border-[var(--accent)]/30 rounded-full w-3.5 h-3.5 flex items-center justify-center font-black cursor-pointer flex-shrink-0 active:scale-90 transition-all"
                >i</span>
              </div>
              <span className={`font-black font-mono leading-none text-[22px] ${!showData ? 'text-white' : (currentNetMV >= currentCost ? 'text-red-400' : 'text-green-400')}`}>{showData ? fmtMoney(currentNetMV) : "••••••"}</span>
            </div>
          </div>
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="未實現損益" value={showData ? `${unrealizedPnl >= 0 ? '+' : ''}${fmtMoney(Math.round(unrealizedPnl))}` : "••••••"} className="w-1/2 text-center" upDown={unrealizedPnl} />
            <StatBox label="未實現損益比" value={showData ? `${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%` : "••••••"} className="w-1/2 text-center border-l border-white/5" upDown={unrealizedPnl} />
          </div>
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="今年已實現損益" value={showData ? `${stats.yearlyRealized >= 0 ? '+' : ''}${fmtMoney(Math.round(stats.yearlyRealized))}` : "••••••"} className="w-1/2 text-center" upDown={stats.yearlyRealized} />
            <StatBox label="今年已實現損益比" value={showData ? `${yearlyRealizedPct >= 0 ? '+' : ''}${yearlyRealizedPct.toFixed(2)}%` : "••••••"} className="w-1/2 text-center border-l border-white/5" upDown={stats.yearlyRealized} />
          </div>
          <div className="flex items-center border-t border-white/5 pt-6">
            <StatBox label="已實現損益 (合計)" value={showData ? `${totalRealized >= 0 ? '+' : ''}${fmtMoney(Math.round(totalRealized))}` : "••••••"} className="w-1/2 text-center" upDown={totalRealized} />
            <StatBox label="已實現損益比" value={showData ? `${realizedPct >= 0 ? '+' : ''}${realizedPct.toFixed(2)}%` : "••••••"} className="w-1/2 text-center border-l border-white/5" upDown={totalRealized} />
          </div>

          <div className="pt-6 border-t border-white/5 space-y-5">
            <ProgressBar label="年度獲利目標" icon={Target} current={totalYearPnl} goal={settings.year_goal} achieved={yearAchieved} showData={showData} />
            <ProgressBar label="總損益目標" icon={Trophy} current={totalPnl} goal={settings.total_goal} achieved={totalAchieved} showData={showData} />
          </div>

        </div>
      </div>

      <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-6 space-y-6 shadow-xl">
        <div className="flex flex-col gap-4 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider flex items-center gap-2">
              <PieChartIcon size={14} className="text-accent" /> 資產分佈 ({chartMode === 'cost' ? '成本' : '市值'})
            </span>
          </div>

          {/* 模式切換器 */}
          <div className="flex p-1 bg-black/40 rounded-xl border border-white/5 relative">
            <div 
              className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-accent rounded-lg transition-all duration-300 ease-out z-0 ${chartMode === 'market' ? 'left-[calc(50%+2px)]' : 'left-1'}`} 
            />
            <button 
              onClick={() => setChartMode('cost')}
              className={`flex-1 py-1.5 text-[11px] font-black rounded-lg transition-colors z-10 ${chartMode === 'cost' ? 'text-bg-base' : 'text-[var(--t3)]'}`}
            >
              投入成本
            </button>
            <button 
              onClick={() => setChartMode('market')}
              className={`flex-1 py-1.5 text-[11px] font-black rounded-lg transition-colors z-10 ${chartMode === 'market' ? 'text-bg-base' : 'text-[var(--t3)]'}`}
            >
              現實市值
            </button>
          </div>
        </div>

        <div className="h-64 w-full relative outline-none" style={{ WebkitTapHighlightColor: 'transparent' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart style={{ outline: 'none' }}>
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
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase">{chartMode === 'cost' ? '總投入' : '合計市值'}</span>
            <span className="text-lg font-black text-[var(--t1)] font-mono">{fmtMoney(Math.round(chartTotal))}</span>
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
                <span className={`text-[11px] font-bold truncate ${selectedPieSym === entry.symbol ? 'text-accent' : 'text-[var(--t2)] opacity-90'}`}>{entry.name}</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--t2)] opacity-50 ml-2">{chartTotal > 0 ? ((entry.value / chartTotal) * 100).toFixed(1) : 0}%</span>
            </button>
          ))}
        </div>

        {selectedHolding && (
          <div className="mt-4 pt-4 border-t border-white/5 animate-slide-up">
            <div className="glass p-4 space-y-4 border-accent/20">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-[var(--t1)] font-black text-sm">{quotes[selectedHolding.symbol]?.name_zh || getStockName(selectedHolding.symbol)}</h4>
                  <p className="text-[10px] font-mono text-[var(--t2)] opacity-40">{codeOnly(selectedHolding.symbol)}</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black text-[var(--t2)] uppercase mb-0.5">{chartMode === 'cost' ? '佔投入比例' : '佔市值比例'}</div>
                  <div className="text-sm font-black text-accent font-mono">{chartTotal > 0 ? (( (chartMode === 'cost' ? selectedHolding.total_cost : selectedHolding.net_market_value) / chartTotal) * 100).toFixed(1) : 0}%</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <DetailBox label="持股數量" value={`${selectedHolding.shares.toLocaleString()} 股`} />
                <DetailBox label="平均成本" value={selectedHolding.avg_cost.toFixed(2)} />
                <DetailBox label="持有成本" value={fmtMoney(selectedHolding.total_cost)} />
                <DetailBox label="預估淨市值" value={fmtMoney(selectedHolding.net_market_value)} />
              </div>

              <div className="pt-2 border-t border-white/5 flex justify-between items-end">
                <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">未實現損益</span>
                <span className={`font-black font-mono text-base ${selectedHolding.unrealized_pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {selectedHolding.unrealized_pnl >= 0 ? '+' : ''}{fmtMoney(selectedHolding.unrealized_pnl)} ({selectedHolding.pnl_pct.toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

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
          <HoldingItem key={h.symbol} h={h} q={quotes[h.symbol]} settings={settings} fullHistoryStats={fullHistoryStats} isExpanded={expanded === h.symbol} onToggle={() => setExpanded(expanded === h.symbol ? null : h.symbol)} onUpdated={onRefresh} onDelete={(id:number)=>setDeletingId(id)} />
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
      <span className="text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest mb-1.5">{label}</span>
      <span className={`font-black font-mono leading-none ${large ? 'text-[22px]' : 'text-[18px]'} ${color}`}>{value}</span>
    </div>
  )
}

function DetailBox({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <div className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-sm font-bold text-[var(--t1)] font-mono">{value}</div>
    </div>
  )
}

function ProgressBar({ label, icon: Icon, goal, current, achieved, showData }: any) {
  const isNegative = current < 0
  const isYearly = label === "年度獲利目標"

  const showInfo = () => {
    alert("年度獲利定義：\n由該年度內已實現損益（已賣出）加上目前手中持股的未實現損益（漲跌幅）組成，反映了您整年的投資總績效。")
  }

  return (
    <div className="space-y-2.5">
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-black text-[var(--t2)] opacity-90 flex items-center gap-2">
            <Icon size={14} className="text-accent" /> {label}
          </span>
          {isYearly && (
            <button 
              onClick={showInfo}
              className="w-3.5 h-3.5 rounded-full border border-accent/30 flex items-center justify-center text-[9px] text-accent font-black hover:bg-accent/10 active:scale-90 transition-all shrink-0 mb-0.5"
            >i</button>
          )}
        </div>
        {goal > 0 ? (
          <div className="flex flex-col items-end">
            <span className={`text-[13px] font-black font-mono ${isNegative ? 'text-red-400' : 'text-accent'}`}>
              {showData ? `${achieved.toFixed(1)}%` : "••••••"}
            </span>
            <span className="text-[10px] font-bold text-[var(--t2)] opacity-50">
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

function HoldingItem({ h, q, settings, fullHistoryStats, isExpanded, onToggle, onUpdated, onDelete }: any) {
  const isUp = h.unrealized_pnl >= 0
  const color = isUp ? 'text-red-400' : 'text-green-400'
  const nameZh = q?.name_zh || h.symbol
  const [clearedExpanded, setClearedExpanded] = useState(false)

  const stockStats = fullHistoryStats[h.symbol] || {}
  
  const activeLots = h.lots || []
  const clearedTxs = useMemo(() => {
    return (stockStats.history || []).filter((t: any) => t.type === 'SELL').sort((a: any, b: any) => b.trade_date.localeCompare(a.trade_date))
  }, [stockStats.history])

  const realizedPnl = stockStats.realized || 0
  const realizedBuyCost = stockStats.buy || 0
  const realizedPct = realizedBuyCost > 0 ? (realizedPnl / realizedBuyCost) * 100 : 0

  return (
    <div className={`transition-all duration-300 border-[0.5px] ${isExpanded ? 'bg-[var(--bg-card)] border-[var(--accent)] ring-1 ring-[var(--accent-bright)]/30' : 'bg-[var(--bg-card)] border-[var(--border-bright)]'} rounded-2xl shadow-xl overflow-hidden`}>
      <div className="py-5 px-6 cursor-pointer active:bg-white/5 space-y-4" onClick={onToggle}>
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <div className="font-black text-[var(--t1)] text-[17px] tracking-tight">{nameZh}</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--t2)] opacity-90">
                {(h.shares ?? 0).toLocaleString()} 股 · 收盤 {(h.current_price ?? 0).toFixed(2)}
              </span>
              {q?.change !== undefined && (() => {
                const isUp = q.change > 0, isDown = q.change < 0
                const changeClass = isUp ? 'bg-red-500/80 text-white' : isDown ? 'bg-green-600/80 text-white' : 'bg-white/10 text-white'
                return (
                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-0.5 ${changeClass}`}>
                    {isUp ? <TrendingUp size={10} strokeWidth={3} /> : isDown ? <TrendingDown size={10} strokeWidth={3} /> : null}
                    {isUp ? '+' : ''}{Math.abs(q.change).toFixed(2)} ({Math.abs(q.change_pct).toFixed(2)}%)
                  </span>
                )
              })()}
            </div>
          </div>
          <div className="text-[12px] font-mono text-[#EAD8B1] opacity-60 mt-1">{codeOnly(h.symbol)}</div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div className="space-y-1">
            <div className="text-[9px] font-black text-[var(--t2)] uppercase tracking-widest opacity-60">持有成本 / 預估淨市值</div>
            <div className="text-[15px] font-black text-[var(--t1)] font-mono flex items-baseline gap-1.5">
              {fmtMoney(Math.round(h.total_cost))} <span className="text-[10px] opacity-20">/</span> <span className="text-accent">{fmtMoney(Math.round(h.net_market_value))}</span>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-[9px] font-black text-[var(--t2)] uppercase tracking-widest opacity-60">未實現損益</div>
            <div className={`text-[15px] font-black font-mono ${color} flex items-baseline justify-end gap-1.5`}>
              {isUp ? '+' : ''}{fmtMoney(Math.round(h.unrealized_pnl))} <span className="text-[10px] opacity-70">({(h.pnl_pct ?? 0).toFixed(2)}%)</span>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="bg-black/30 border-t border-white/5 animate-slide-up pb-4">
          {/* Section A: Active Holdings */}
          <div className="px-6 py-3 text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-[0.2em] border-b border-white/5 mb-2">現時庫存 (Active)</div>
          <div className="px-2 space-y-0.5 mb-6">
            {activeLots.length > 0 ? (
              activeLots.map((lot: any, idx: number) => (
                <ActiveLotRow key={`${lot.id}-${idx}`} lot={lot} onUpdated={onUpdated} onDelete={onDelete} h={h} settings={settings} />
              ))
            ) : (
              <div className="px-6 py-4 text-[11px] text-[var(--t3)] italic opacity-40">查無庫存資料</div>
            )}
          </div>

          {/* Realized Dashboard & Accordion */}
          <div className="mx-4 mb-2 p-4 card-base border-white/5 bg-black/20">
            <div className="flex justify-between items-center mb-4">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-[var(--t2)] opacity-50 uppercase tracking-widest mb-0.5">已沖銷損益</span>
                <span className={`text-sm font-black font-mono ${realizedPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {realizedPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(realizedPnl))}
                </span>
              </div>
              <div className="text-right flex flex-col items-end">
                <span className="text-[9px] font-black text-[var(--t2)] opacity-50 uppercase tracking-widest mb-0.5">已沖銷報酬率</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-black ${realizedPnl >= 0 ? 'bg-red-400/10 text-red-400' : 'bg-green-400/10 text-green-400'}`}>
                  {realizedPnl >= 0 ? '+' : ''}{realizedPct.toFixed(2)}%
                </span>
              </div>
            </div>

            <button 
              onClick={() => setClearedExpanded(!clearedExpanded)}
              className="w-full h-10 flex items-center justify-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/5 transition-all group border border-white/5"
            >
              <span className="text-[10px] font-black text-[var(--t2)] uppercase tracking-widest">
                {clearedExpanded ? '收合已沖銷明細' : `檢視其餘 ${clearedTxs.length} 筆已沖銷交易`}
              </span>
              <ChevronDown size={14} className={`text-accent transition-transform duration-300 ${clearedExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {clearedExpanded && (
            <div className="px-2 space-y-0.5 animate-slide-up">
              {clearedTxs.length > 0 ? (
                clearedTxs.map((t: any) => (
                  <TxRow key={t.id} t={t} settings={settings} onUpdated={onUpdated} onDelete={onDelete} />
                ))
              ) : (
                <div className="px-6 py-4 text-[11px] text-[var(--t3)] italic opacity-40 text-center">查無歷史沖銷紀錄</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function ClosedHoldingItem({ c, expanded, onToggle, transactions, settings, onRefresh, onDelete }: any) {
  const [name, setName] = useState(getStockName(c.symbol))
  useEffect(() => { fetch(`/api/stockname?symbol=${c.symbol}`).then(res => res.json()).then(data => { if (data.name_zh) setName(data.name_zh) }) }, [c.symbol])
  const isUp = c.pnl >= 0
  const color = isUp ? 'text-red-400' : 'text-green-400'

  return (
    <div className={`transition-all duration-300 border-[0.5px] ${expanded ? 'bg-[var(--bg-card)] border-[var(--accent)] ring-1 ring-[var(--accent-bright)]/30 shadow-2xl' : 'bg-[var(--bg-card)] border-[var(--border-bright)]'} rounded-2xl shadow-xl overflow-hidden`}>
      <div className="py-5 px-6 cursor-pointer active:bg-white/5 space-y-4" onClick={onToggle}>
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <div className="font-black text-[var(--t1)] text-[17px] tracking-tight">{name}</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--t2)] opacity-60">
                結算盈虧計入
              </span>
              <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-0.5 ${isUp ? 'bg-red-500/80' : 'bg-green-600/80'} text-white`}>
                {isUp ? <TrendingUp size={10} strokeWidth={3} /> : <TrendingDown size={10} strokeWidth={3} />}
                {(c.pnlPct ?? 0).toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="text-[12px] font-mono text-[var(--t2)] opacity-60 mt-1">{codeOnly(c.symbol)}</div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div className="space-y-1">
            <div className="text-[9px] font-black text-[var(--t2)] uppercase tracking-widest opacity-60">總投入成本 / 總回收營收</div>
            <div className="text-[15px] font-black text-[var(--t1)] font-mono flex items-baseline gap-1.5">
              {fmtMoney(Math.round(c.buyCost))} <span className="text-[10px] opacity-20">/</span> <span className="text-accent">{fmtMoney(Math.round(c.sellRev))}</span>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-[9px] font-black text-[var(--t2)] uppercase tracking-widest opacity-60">已實現損益</div>
            <div className={`text-[15px] font-black font-mono ${color} flex items-baseline justify-end gap-1.5`}>
              {isUp ? '+' : ''}{fmtMoney(Math.round(c.pnl))}
            </div>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="bg-black/30 border-t border-white/5 pb-2 animate-slide-up">
          <div className="px-6 py-2.5 text-[10px] font-black text-[var(--t2)] uppercase tracking-[0.2em] border-b border-white/5 opacity-60 mb-2">完整交易歷程</div>
          <div className="px-2 space-y-0.5">
            {transactions.map((t: any) => <TxRow key={t.id} t={t} settings={settings} onUpdated={onRefresh} onDelete={onDelete} />)}
          </div>
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
  const fee = calcFee(finalShares, safePrice, settings, !isBuy, actionToSave === 'DCA')
  const tax = t.action === 'SELL' ? calcTax(finalShares, safePrice, t.symbol, settings) : 0
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
    <div className="m-4 p-5 rounded-2xl bg-bg-surface border border-accent/20 space-y-5 shadow-2xl animate-scale-in">
      <div className="text-center pb-2 border-b border-white/5"><h4 className="font-black text-xs text-accent tracking-tight">編輯：{isBuy?'買入':'賣出'} {t.name_zh || t.symbol}</h4></div>
      <div className="flex gap-2 p-1 bg-black/20 rounded-xl">
        <button onClick={() => setTradeType('FULL')} className={`flex-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${tradeType==='FULL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)] opacity-40'}`}>整張 (1000股)</button>
        <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${tradeType==='FRACTIONAL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)] opacity-40'}`}>零股</button>
      </div>

      {isBuy && (
        <div className="flex items-center justify-between p-2 rounded-xl bg-black/20 border border-white/5">
          <span className="text-[10px] font-black text-[var(--t2)] tracking-widest uppercase opacity-60">定期定額</span>
          <button 
            onClick={() => setIsDcaOpt(!isDcaOpt)}
            className={`w-10 h-5 rounded-full relative transition-colors ${isDcaOpt ? 'bg-yellow-500' : 'bg-white/10'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-all ${isDcaOpt ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1"><Label>{tradeType==='FULL'?'張數':'股數'}</Label><input type="number" value={tradeType==='FULL'?lots:shares} onFocus={()=>tradeType==='FULL'?setLots(''):setShares('')} onChange={e=>{const v=e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v):setShares(v)}} className="input-base text-center font-black py-2.5 text-sm" /></div>
        <div className="space-y-1"><Label>成交價</Label><input type="number" step="0.01" value={price} onFocus={()=>setPrice('')} onChange={e=>setPrice(e.target.value===''?'':Number(e.target.value))} className="input-base text-center font-black py-2.5 text-sm" /></div>
      </div>
      <div className="space-y-1"><Label>交易日期</Label><DatePicker value={date} onChange={setDate} /></div>
      <div className="space-y-1"><Label>備註</Label><input value={note} onChange={e=>setNote(e.target.value)} className="input-base text-[11px] py-2.5" placeholder="選填..." /></div>
      <div className="bg-black/20 p-3 rounded-xl space-y-1 text-[10px] font-bold">
        <div className="flex justify-between opacity-30"><span>手續費 + 稅</span><span>{fmtMoney(Math.floor(fee+tax))}</span></div>
        <div className="flex justify-between items-center pt-1 border-t border-white/5"><span className="text-[var(--t2)] opacity-60">預估淨收支</span><span className={`text-[13px] font-black ${net>=0?'text-red-400':'text-green-400'}`}>{net>=0?'+':''}{fmtMoney(net)}</span></div>
      </div>
      <div className="flex gap-2 pt-1"><button onClick={handleSave} disabled={!isValid || loading} className="flex-[3] btn-primary py-3 text-xs">確認修改</button><button onClick={() => setIsEditing(false)} className="flex-1 btn-secondary py-3 text-xs">取消</button></div>
    </div>
  )
  return (
    <div className="group relative flex flex-col px-6 py-4 hover:bg-white/5 transition-all">
      <div className="flex justify-between items-center w-full">
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] text-[var(--t2)] font-mono opacity-50 tracking-tight">{t.trade_date}</div>
          <div className="text-[14px] font-bold text-[var(--t2)] opacity-90 flex items-center gap-1.5">
            {(t.shares ?? 0).toLocaleString()} 股 <span className="text-[10px] text-[var(--t2)] opacity-40 font-light">@</span> {(t.price ?? 0).toFixed(2)}
            {(t.action === 'DCA' || t.trade_type === 'DCA') && <span className="text-[8px] text-yellow-500/80 border border-yellow-500/30 px-1.5 py-0.5 rounded font-black tracking-tighter uppercase leading-none ml-1">DCA</span>}
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className={`text-[14px] font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {net >= 0 ? '+' : ''}{fmtMoney(net)}
          </div>
          <div className="flex gap-2">
            <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-2 rounded-lg bg-white/10 text-white hover:text-accent transition-colors shadow-lg"><Pencil size={13} /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(t.id); }} className="p-2 rounded-lg bg-white/10 text-white hover:text-red-400 transition-colors shadow-lg"><Trash2 size={13} /></button>
          </div>
        </div>
      </div>
      
      {/* FIFO Matching Detail for SELL transactions */}
      {t.type === 'SELL' && t.matches && t.matches.length > 0 && (
        <div className="mt-2 pl-4 border-l-2 border-white/5 space-y-1">
          {t.matches.map((m: any, idx: number) => (
            <div key={idx} className="text-[10px] text-[var(--t3)] italic opacity-40 flex justify-between items-center">
              <span>沖銷 {m.date} 買入</span>
              <span>{m.shares.toLocaleString()} 股</span>
            </div>
          ))}
          <div className="pt-1 text-[9px] font-black text-accent/50 uppercase tracking-widest flex justify-between">
            <span>實現獲利</span>
            <span>{fmtMoney(Math.round(t.profit))}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ActiveLotRow({ lot, h, settings, onUpdated, onDelete }: any) {
  const [isEditing, setIsEditing] = useState(false)
  const isBuy = true
  // For ActiveLotRow, we use the original id if available.
  const t = { ...lot, symbol: h.symbol, action: 'BUY', trade_date: lot.date }
  const fee = calcFee(lot.shares, lot.price, settings, false)
  const net = -(Math.floor(lot.shares * lot.price) + Math.floor(fee))

  if (isEditing) return <div className="p-2"><TxRow t={t} settings={settings} onUpdated={onUpdated} onDelete={onDelete} /></div>

  return (
    <div className="group relative flex justify-between items-center px-6 py-4 hover:bg-white/5 transition-all">
      <div className="flex flex-col gap-0.5">
        <div className="text-[10px] text-[var(--t2)] font-mono opacity-50 tracking-tight">{lot.date}</div>
        <div className="text-[14px] font-bold text-[var(--t2)] opacity-90 flex items-center gap-1.5">
          {(lot.shares ?? 0).toLocaleString()} 股 <span className="text-[10px] pb-0.5 text-accent font-black tracking-tighter uppercase leading-none opacity-40">剩餘</span>
          <span className="text-[10px] text-[var(--t2)] opacity-40 font-light ml-1">@</span> {(lot.price ?? 0).toFixed(2)}
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="text-[14px] font-black font-mono text-green-400">
          {fmtMoney(net)}
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setIsEditing(true)} className="p-2 rounded-lg bg-white/10 text-white hover:text-accent transition-colors shadow-lg"><Pencil size={13} /></button>
          <button onClick={() => onDelete(lot.id)} className="p-2 rounded-lg bg-white/10 text-white hover:text-red-400 transition-colors shadow-lg"><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  )
}



function Label({ children }: { children: React.ReactNode }) { return <label className="text-[10px] font-black opacity-30 uppercase tracking-widest ml-1 mb-1 block">{children}</label> }
