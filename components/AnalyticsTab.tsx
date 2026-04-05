'use client'

import { useState, useMemo, useEffect } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, codeOnly, getStockName } from '@/types'
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, AreaChart, Area, Legend
} from 'recharts'
import { ChevronDown, TrendingUp, Target, Trophy, RefreshCw, Calendar as CalendarIcon } from 'lucide-react'
import DatePicker from './DatePicker'

interface Props {
  holdings: Holding[]
  transactions: Transaction[]
  settings: UserSettings
  quotes: Record<string, Quote>
}

type StockRange = '1M' | '3M' | '1Y' | 'ALL'
type GoalRange = '1M' | '3M' | '6M' | '9M' | '1Y' | 'ALL' | 'CUSTOM'

export default function AnalyticsTab({ holdings, transactions, settings, quotes }: Props) {
  // ── Stock Chart States ──
  const [selSym, setSelSym] = useState(holdings[0]?.symbol || '')
  const [stockRange, setStockRange] = useState<StockRange>('1M')
  const [stockHistory, setStockHistory] = useState<any[]>([])
  const [loadingStock, setLoading] = useState(false)

  // ── Goal Chart States ──
  const [yearRange, setYearRange] = useState<GoalRange>('1Y')
  const [totalRange, setTotalRange] = useState<GoalRange>('ALL')
  const [showCustomTotal, setShowCustomTotal] = useState(false)
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split('T')[0])

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

  const enrichedStockHistory = useMemo(() => {
    if (!stockHistory.length) return []
    const txs = [...transactions].filter(t => t.symbol === selSym).sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let txIdx = 0
    let inventory: { shares: number, cost: number }[] = []
    let currentAvgCost: number | null = null
    const firstDate = stockHistory[0].date

    while (txIdx < txs.length && txs[txIdx].trade_date < firstDate) {
      const tx = txs[txIdx]
      if (tx.action !== 'SELL') {
        inventory.push({ shares: tx.shares, cost: tx.amount + tx.fee })
      } else {
        let rem = tx.shares
        while (rem > 0 && inventory.length > 0) {
          if (inventory[0].shares <= rem) { rem -= inventory[0].shares; inventory.shift() }
          else { inventory[0].shares -= rem; rem = 0 }
        }
      }
      txIdx++
    }

    return stockHistory.map((h, i) => {
      let isBuy = false
      let txPrice = 0
      let txShares = 0
      
      const prevDateStr = i > 0 ? stockHistory[i-1].date : firstDate

      while (txIdx < txs.length && txs[txIdx].trade_date <= h.date) {
        const tx = txs[txIdx]
        // Allow treating trades on weekends to map to the next available history date (h.date)
        if (tx.action !== 'SELL') {
          inventory.push({ shares: tx.shares, cost: tx.amount + tx.fee })
          isBuy = true
          txPrice = tx.price
          txShares += tx.shares
        } else {
          let rem = tx.shares
          while (rem > 0 && inventory.length > 0) {
            if (inventory[0].shares <= rem) { rem -= inventory[0].shares; inventory.shift() }
            else { inventory[0].shares -= rem; rem = 0 }
          }
        }
        txIdx++
      }
      
      const totalShares = inventory.reduce((s, lot) => s + lot.shares, 0)
      const totalCost = inventory.reduce((s, lot) => s + lot.cost, 0)
      currentAvgCost = totalShares > 0 ? totalCost / totalShares : null
      
      return {
        ...h,
        isBuy,
        txPrice,
        txShares,
        avgCost: currentAvgCost,
        pnlDiff: currentAvgCost !== null ? (h.price - currentAvgCost) * totalShares : 0,
        pnlPct: currentAvgCost !== null && currentAvgCost !== 0 ? ((h.price - currentAvgCost) / currentAvgCost) * 100 : 0
      }
    })
  }, [stockHistory, transactions, selSym])

  // ── Goal Calculation Logic ──
  const calculateGoalData = (isTotal: boolean, range: GoalRange, customS?: string, customE?: string) => {
    const today = new Date()
    const currentYear = today.getFullYear()
    
    // Sort tx to find first date safely
    const sortedTxs = [...transactions].sort((a,b) => a.trade_date.localeCompare(b.trade_date))
    const firstTxDate = sortedTxs.length > 0 ? new Date(sortedTxs[0].trade_date) : today

    const startDate = isTotal 
      ? new Date(settings.total_goal_start_date || firstTxDate)
      : new Date(currentYear, 0, 1)
    
    const endDate = isTotal ? today : new Date(currentYear, 11, 31)
    const goalValue = isTotal ? settings.total_goal : settings.year_goal
    const todayStr = today.toISOString().split('T')[0]

    const fullData = []
    const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (86400 * 1000))

    let realized = 0
    const inventory: Record<string, {shares: number, cost: number, buyDate: Date}[]> = {}
    let lastTxIdx = 0

    for (let i = 0; i <= Math.max(0, dayCount); i++) {
      const d = new Date(startDate)
      d.setDate(startDate.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      const ideal = dayCount > 0 ? Math.round((goalValue / dayCount) * i) : 0
      
      if (isTotal && dateStr > todayStr) break
      
      while (lastTxIdx < sortedTxs.length && sortedTxs[lastTxIdx].trade_date <= dateStr) {
        const tx = sortedTxs[lastTxIdx]
        const buyYear = tx.trade_date.split('-')[0]
        if (!inventory[tx.symbol]) inventory[tx.symbol] = []
        
        if (tx.action !== 'SELL') {
          if (isTotal || buyYear === currentYear.toString()) {
            inventory[tx.symbol].push({ shares: tx.shares, cost: tx.amount + tx.fee, buyDate: new Date(tx.trade_date) })
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
        lastTxIdx++
      }

      if (dateStr > todayStr) {
        fullData.push({ date: dateStr.substring(5), fullDate: dateStr, ideal, actual: null })
        continue
      }

      let estimatedUnrealized = 0
      Object.keys(inventory).forEach(sym => {
         const currentPrice = quotes[sym]?.price || 0
         inventory[sym].forEach(lot => {
            const daysSinceBuy = Math.max(1, (d.getTime() - lot.buyDate.getTime()) / 86400000)
            const daysTotal = Math.max(1, (today.getTime() - lot.buyDate.getTime()) / 86400000)
            const fraction = Math.min(1, Math.max(0, daysSinceBuy / daysTotal))
            const uPnl = (currentPrice - (lot.cost/lot.shares)) * lot.shares
            estimatedUnrealized += uPnl * fraction
         })
      })

      fullData.push({
        date: dateStr.substring(5),
        fullDate: dateStr,
        ideal,
        actual: Math.round(realized + estimatedUnrealized)
      })
    }

    if (range === 'ALL') return fullData
    if (range === 'CUSTOM' && customS && customE) {
      return fullData.filter(d => d.fullDate >= customS && d.fullDate <= customE)
    }

    let viewportDays = 0
    if (range === '1M') viewportDays = 15
    else if (range === '3M') viewportDays = 45
    else if (range === '6M') viewportDays = 90
    else if (range === '9M') viewportDays = 135
    else if (range === '1Y') viewportDays = isTotal ? 182 : 364

    let todayIdx = fullData.findIndex(d => d.fullDate === todayStr)
    if (todayIdx === -1) todayIdx = fullData.length - 1

    let left = todayIdx - viewportDays
    let right = todayIdx + viewportDays

    if (!isTotal) {
      if (left < 0) { right += Math.abs(left); left = 0 }
      if (right >= fullData.length) { left -= (right - fullData.length + 1); right = fullData.length - 1 }
      left = Math.max(0, left)
      right = Math.min(fullData.length - 1, right)
    } else {
      left = Math.max(0, left)
      right = Math.min(fullData.length - 1, right)
    }

    return fullData.slice(left, right + 1)
  }

  const yearGoalData = useMemo(() => calculateGoalData(false, yearRange), [transactions, settings, yearRange, holdings, quotes])
  const totalGoalData = useMemo(() => calculateGoalData(true, totalRange, customStart, customEnd), [transactions, settings, totalRange, customStart, customEnd, holdings, quotes])

  const renderBuyDot = (props: any) => {
    const { cx, cy, payload } = props
    if (payload.isBuy) {
      return (
        <circle 
          key={`dot-${payload.date}`} 
          cx={cx} cy={cy} r={5} 
          fill="#e05050" stroke="#fff" strokeWidth={2} 
          style={{filter: 'drop-shadow(0 0 4px #e05050)'}} 
        />
      )
    }
    return null
  }

  const StockTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="glass p-3 border-white/10 text-sm font-bold shadow-2xl z-50">
          <div className="text-[11px] text-[var(--t3)] mb-2 uppercase tracking-widest">{data.date}</div>
          <div className="flex justify-between gap-4 mb-1">
            <span className="text-[12px] text-[var(--t2)] flex-1">收盤價</span>
            <span className="font-mono text-[var(--t1)]">{data.price.toFixed(2)}</span>
          </div>
          {data.avgCost !== null && (
            <>
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-[12px] text-[var(--t2)] flex-1">對應均價</span>
                <span className="font-mono text-accent">{data.avgCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-[12px] text-[var(--t2)] flex-1">差距金額</span>
                <span className={`font-mono ${data.pnlDiff >= 0 ? 'text-red-400' : 'text-green-400'}`}>{data.pnlDiff >= 0 ? '+' : ''}{fmtMoney(Math.round(data.pnlDiff))}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[12px] text-[var(--t2)] flex-1">損益%</span>
                <span className={`font-mono ${data.pnlPct >= 0 ? 'text-red-400' : 'text-green-400'}`}>{data.pnlPct >= 0 ? '+' : ''}{data.pnlPct.toFixed(2)}%</span>
              </div>
            </>
          )}
          {data.isBuy && (
            <div className="mt-2 pt-2 border-t border-accent/20">
              <div className="text-[11px] font-black text-red-400 mb-0.5">🟢 買入紀錄</div>
              <div className="flex justify-between gap-4">
                <span className="text-[11px] text-[var(--t2)]">價格:</span>
                <span className="text-[11px] text-[var(--t1)]">{data.txPrice.toFixed(2)} 元</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[11px] text-[var(--t2)]">數量:</span>
                <span className="text-[11px] text-[var(--t1)]">{data.txShares.toLocaleString()} 股</span>
              </div>
              <div className="flex justify-between gap-4 mt-1 border-t border-white/5 pt-1">
                <span className="text-[11px] text-[var(--t2)]">買入後新均價:</span>
                <span className="text-[11px] font-black text-accent">{data.avgCost.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )
    }
    return null
  }

  const finalYearPnl = yearGoalData.filter(d => d.actual !== null).pop()?.actual || 0
  const finalTotalPnl = totalGoalData.filter(d => d.actual !== null).pop()?.actual || 0

  return (
    <div className="p-4 space-y-8 pb-20 animate-slide-up w-full overflow-x-hidden">
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
                <option key={h.symbol} value={h.symbol} className="bg-[var(--bg-card)]">{quotes[h.symbol]?.name_zh || getStockName(h.symbol)} ({codeOnly(h.symbol)})</option>
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
            <LineChart data={enrichedStockHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis domain={['auto', 'auto']} orientation="right" unit="元" tick={{fontSize: 10, fill: 'var(--t3)'}} axisLine={false} tickLine={false} />
              <Tooltip content={<StockTooltip />} />
              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
              <Line type="stepAfter" dataKey="avgCost" stroke="var(--t3)" strokeDasharray="5 5" strokeWidth={2} dot={false} name="買入均價" />
              <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={renderBuyDot} name="股價線 / 買入點" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {selectedHolding && (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass p-4 border-white/5">
              <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-1">現時平均成本</div>
              <div className="text-base font-black text-[var(--t1)] font-mono">{selectedHolding.avg_cost.toFixed(2)}</div>
            </div>
            <div className="glass p-4 border-white/5">
              <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-1">現時股價 vs 成本</div>
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
          <div className="flex gap-1.5 flex-wrap justify-end">
            {(['1M', '3M', '6M', '9M', '1Y'] as GoalRange[]).map(r => (
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
              <Line type="monotone" dataKey="actual" stroke={finalYearPnl >= 0 ? '#e05050' : '#42b07a'} strokeWidth={3} dot={false} name="累積損益" connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── 3. 總損益目標分析 ── */}
      <section className="space-y-4 pt-4 border-t border-white/5">
        <div className="flex flex-col space-y-3 px-1">
          {/* 第一行：🏆 圖示 + 時間快捷鍵（1M 3M 6M） */}
          <div className="flex items-center justify-between">
            <Trophy size={16} className="text-accent" />
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {(['1M', '3M', '6M'] as GoalRange[]).map(r => (
                <button 
                  key={r} onClick={() => { setTotalRange(r); setShowCustomTotal(false); }}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-all border ${totalRange === r && !showCustomTotal ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          
          {/* 第二行：「總損益累積進度」標題（置中或靠左） */}
          <h3 className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider whitespace-nowrap text-left">
            總損益累積進度
          </h3>

          {/* 第三行：剩餘時間快捷鍵（1Y 全部）+ 自訂按鈕 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['1Y', 'ALL'] as GoalRange[]).map(r => (
              <button 
                key={r} onClick={() => { setTotalRange(r); setShowCustomTotal(false); }}
                className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-all border ${totalRange === r && !showCustomTotal ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
              >
                {r === 'ALL' ? '全部' : r}
              </button>
            ))}
            <button 
              onClick={() => { setTotalRange('CUSTOM'); setShowCustomTotal(!showCustomTotal); }}
              className={`px-2.5 py-1 flex items-center gap-1 rounded-lg text-[9px] font-black transition-all border ${totalRange === 'CUSTOM' ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
            >
              <CalendarIcon size={10} /> 自訂
            </button>
          </div>
        </div>

        {showCustomTotal && (
          <div className="flex items-center justify-end gap-3 mt-2 animate-slide-up">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-[var(--t3)]">開始</span>
              <DatePicker value={customStart} onChange={(v: string) => setCustomStart(v)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-[var(--t3)]">結束</span>
              <DatePicker value={customEnd} onChange={(v: string) => setCustomEnd(v)} />
            </div>
          </div>
        )}

        <div className="card-base p-4 h-64 border-white/10 bg-black/20 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={totalGoalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={{fontSize: 9, fill: 'var(--t3)'}} axisLine={false} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip 
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '11px' }}
              />
              <Line type="monotone" dataKey="actual" stroke={finalTotalPnl >= 0 ? '#e05050' : '#42b07a'} strokeWidth={3} dot={false} name="累積損益" connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
