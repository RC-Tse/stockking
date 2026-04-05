'use client'

import { useState, useMemo, useEffect } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, codeOnly, getStockName } from '@/types'
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, AreaChart, Area, ReferenceLine, Brush 
} from 'recharts'
import { ChevronDown, TrendingUp, Target, Trophy } from 'lucide-react'

interface Props {
  holdings: Holding[]
  transactions: Transaction[]
  settings: UserSettings
  quotes: Record<string, Quote>
}

type StockRange = '1M' | '3M' | '1Y' | 'ALL'
type GoalRange = '1M' | '3M' | '6M' | '9M' | '1Y' | 'ALL'

export default function AnalyticsTab({ holdings, transactions, settings, quotes }: Props) {
  // ── Stock Chart States ──
  const [selSym, setSelSym] = useState(holdings[0]?.symbol || '')
  const [stockRange, setStockRange] = useState<StockRange>('1M')
  const [stockHistory, setStockHistory] = useState<any[]>([])
  const [loadingStock, setLoading] = useState(false)

  // ── Goal Chart States ──
  const [yearRange, setYearRange] = useState<GoalRange>('1Y')
  const [totalRange, setTotalRange] = useState<GoalRange>('ALL')

  // Fetch Stock History
  useEffect(() => {
    if (!selSym) return
    async function fetchHistory() {
      setLoading(true)
      const rangeMap: Record<StockRange, string> = { '1M': '1mo', '3M': '3mo', '1Y': '1y', 'ALL': '5y' }
      try {
        const res = await fetch(`/api/stocks/info?symbol=${selSym}&range=${rangeMap[stockRange]}`)
        if (res.ok) {
          const data = await res.json()
          setStockHistory(data.history || [])
        }
      } catch (e) { console.error(e) } finally { setLoading(false) }
    }
    fetchHistory()
  }, [selSym, stockRange])

  const selectedHolding = useMemo(() => holdings.find(h => h.symbol === selSym), [holdings, selSym])

  // ── Goal Calculation Logic ──
  const calculateGoalData = (isTotal: boolean, range: GoalRange) => {
    const today = new Date()
    const currentYear = today.getFullYear()
    const startDate = isTotal 
      ? new Date(settings.total_goal_start_date || transactions[0]?.trade_date || today)
      : new Date(currentYear, 0, 1)
    const endDate = isTotal ? today : new Date(currentYear, 11, 31)
    const goalValue = isTotal ? settings.total_goal : settings.year_goal

    // Generate dates
    const data = []
    const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (86400 * 1000))
    
    // Sort transactions
    const sortedTxs = [...transactions].sort((a,b) => a.trade_date.localeCompare(b.trade_date))

    for (let i = 0; i <= dayCount; i++) {
      const d = new Date(startDate)
      d.setDate(startDate.getDate() + i)
      if (d > today && isTotal) break
      
      const dateStr = d.toISOString().split('T')[0]
      
      // Ideal line
      const ideal = Math.round((goalValue / dayCount) * i)
      
      // Actual PnL up to this date
      let realized = 0
      const inventory: Record<string, {shares: number, cost: number}[]> = {}
      
      const txsUntil = sortedTxs.filter(t => t.trade_date <= dateStr)
      if (!isTotal) {
        // Year PnL: Only from buys this year
        txsUntil.forEach(tx => {
          const buyYear = tx.trade_date.split('-')[0]
          if (!inventory[tx.symbol]) inventory[tx.symbol] = []
          if (tx.action !== 'SELL') {
            if (buyYear === currentYear.toString()) {
              inventory[tx.symbol].push({ shares: tx.shares, cost: tx.amount + tx.fee })
            }
          } else {
            let rem = tx.shares
            const unitNet = tx.net_amount / tx.shares
            while (rem > 0 && inventory[tx.symbol]?.length) {
              const lot = inventory[tx.symbol][0]
              const take = Math.min(lot.shares, rem)
              realized += (unitNet - (lot.cost/lot.shares)) * take
              rem -= take; lot.shares -= take
              if (lot.shares <= 0) inventory[tx.symbol].shift()
            }
          }
        })
      } else {
        // Total PnL: All buys
        txsUntil.forEach(tx => {
          if (!inventory[tx.symbol]) inventory[tx.symbol] = []
          if (tx.action !== 'SELL') {
            inventory[tx.symbol].push({ shares: tx.shares, cost: tx.amount + tx.fee })
          } else {
            let rem = tx.shares
            const unitNet = tx.net_amount / tx.shares
            while (rem > 0 && inventory[tx.symbol]?.length) {
              const lot = inventory[tx.symbol][0]
              const take = Math.min(lot.shares, rem)
              realized += (unitNet - (lot.cost/lot.shares)) * take
              rem -= take; lot.shares -= take
              if (lot.shares <= 0) inventory[tx.symbol].shift()
            }
          }
        })
      }

      // We don't have historical prices for all dates here easily, 
      // so for the chart actual line we'll show cumulative realized for history
      // and realized + current unrealized for the final point (today)
      let displayActual = realized
      if (dateStr === today.toISOString().split('T')[0]) {
        // Add current unrealized if it's today
        const currentUnrealized = holdings.reduce((s, h) => s + h.unrealized_pnl, 0)
        // If it's year goal, only current unrealized of holdings bought this year
        // This is simplified: just show realized trend for historical points
      }

      data.push({
        date: dateStr.substring(5), // MM-DD
        fullDate: dateStr,
        ideal,
        actual: Math.round(displayActual)
      })
    }

    // Filter by range
    if (range !== 'ALL') {
      const months = parseInt(range.replace('M',''))
      const cutDate = new Date()
      cutDate.setMonth(today.getMonth() - months)
      const cutStr = cutDate.toISOString().split('T')[0]
      return data.filter(d => d.fullDate >= cutStr)
    }

    return data
  }

  const yearGoalData = useMemo(() => calculateGoalData(false, yearRange), [transactions, settings, yearRange, holdings])
  const totalGoalData = useMemo(() => calculateGoalData(true, totalRange), [transactions, settings, totalRange, holdings])

  return (
    <div className="p-4 space-y-8 pb-20 animate-slide-up">
      {/* ── 1. 各股分析 ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="relative inline-block">
            <select 
              value={selSym} 
              onChange={e => setSelSym(e.target.value)}
              className="appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2 pr-10 font-black text-sm text-[var(--t1)] focus:outline-none focus:border-accent transition-all"
            >
              {holdings.map(h => (
                <option key={h.symbol} value={h.symbol} className="bg-[var(--bg-card)]">{getStockName(h.symbol)} ({codeOnly(h.symbol)})</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--t3)] pointer-events-none" />
          </div>
          <div className="flex gap-1.5">
            {(['1M', '3M', '1Y', 'ALL'] as StockRange[]).map(r => (
              <button 
                key={r} onClick={() => setStockRange(r)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border ${stockRange === r ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="card-base p-4 h-80 border-white/10 bg-black/20 relative">
          {loadingStock && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm rounded-2xl"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stockHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis domain={['auto', 'auto']} orientation="right" tick={{fontSize: 10, fill: 'var(--t3)'}} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '12px' }}
                itemStyle={{ fontWeight: 'bold' }}
              />
              <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={false} name="股價" />
              {selectedHolding && (
                <ReferenceLine y={selectedHolding.avg_cost} stroke="var(--t3)" strokeDasharray="5 5" label={{ position: 'left', value: '成本', fill: 'var(--t3)', fontSize: 10, fontWeight: 'bold' }} />
              )}
              <Brush dataKey="date" height={20} stroke="var(--accent)" fill="transparent" travellerWidth={10} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {selectedHolding && (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass p-4 border-white/5">
              <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-1">持有平均成本</div>
              <div className="text-base font-black text-[var(--t1)] font-mono">{selectedHolding.avg_cost.toFixed(2)}</div>
            </div>
            <div className="glass p-4 border-white/5">
              <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-1">股價 vs 成本</div>
              <div className={`text-base font-black font-mono ${selectedHolding.pnl_pct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {selectedHolding.pnl_pct >= 0 ? '+' : ''}{selectedHolding.pnl_pct.toFixed(2)}%
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── 2. 年度目標分析 ── */}
      <section className="space-y-4 pt-4 border-t border-white/5">
        <div className="flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">
            <Target size={16} className="text-accent" /> 年度獲利進度
          </h3>
          <div className="flex gap-1.5">
            {(['1M', '3M', '6M', '1Y'] as GoalRange[]).map(r => (
              <button 
                key={r} onClick={() => setYearRange(r)}
                className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-all border ${yearRange === r ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="card-base p-4 h-64 border-white/10 bg-black/20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={yearGoalData}>
              <defs>
                <linearGradient id="colorIdeal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={{fontSize: 9, fill: 'var(--t3)'}} axisLine={false} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip 
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '11px' }}
              />
              <Area type="monotone" dataKey="ideal" stroke="var(--accent)" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorIdeal)" name="理想進度" />
              <Line type="monotone" dataKey="actual" stroke={yearGoalData[yearGoalData.length-1]?.actual >= 0 ? '#e05050' : '#42b07a'} strokeWidth={3} dot={false} name="實際損益" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── 3. 總損益目標分析 ── */}
      <section className="space-y-4 pt-4 border-t border-white/5">
        <div className="flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">
            <Trophy size={16} className="text-accent" /> 總損益累積進度
          </h3>
          <div className="flex gap-1.5">
            {(['3M', '1Y', 'ALL'] as GoalRange[]).map(r => (
              <button 
                key={r} onClick={() => setTotalRange(r)}
                className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-all border ${totalRange === r ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="card-base p-4 h-64 border-white/10 bg-black/20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={totalGoalData}>
              <defs>
                <linearGradient id="colorIdealTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={{fontSize: 9, fill: 'var(--t3)'}} axisLine={false} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip 
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '11px' }}
              />
              <Area type="monotone" dataKey="ideal" stroke="var(--accent)" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorIdealTotal)" name="理想進度" />
              <Line type="monotone" dataKey="actual" stroke="var(--accent)" strokeWidth={3} dot={false} name="累積損益" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

function RefreshCw({ size, className }: { size: number, className: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" 
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  )
}
