'use client'

import { useMemo, useState, useEffect } from 'react'
import { 
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Calendar as CalendarIcon, RefreshCw } from 'lucide-react'
import DatePicker from './DatePicker'
import { Transaction, UserSettings, fmtMoney, calculateTxParts } from '@/types'
import ErrorBoundary from './ErrorBoundary'

interface Props {
  transactions: Transaction[]
  settings: UserSettings
}

type TotalRange = '6M' | '1Y' | '1.5Y' | '2Y' | '3Y' | 'CUSTOM'

function TotalPnLChartContent({ transactions, settings }: Props) {
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  
  // Use setting value for initial range
  const [range, setRange] = useState<TotalRange>(settings.total_chart_default_range || '1Y')
  const [showCustom, setShowCustom] = useState(false)
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0]
  })
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split('T')[0])

  const todayStr = new Date().toISOString().split('T')[0]
  const goalStartDate = settings.total_goal_start_date || todayStr

  const relevantSymbols = useMemo(() => {
    const syms = new Set<string>()
    transactions.forEach(t => {
      if (t?.symbol) syms.add(t.symbol)
    })
    return Array.from(syms)
  }, [transactions])

  useEffect(() => {
    if (relevantSymbols.length === 0) {
      setLoading(false)
      return
    }
    async function fetchAllHistory() {
      setLoading(true)
      const results: Record<string, any[]> = {}
      await Promise.all(relevantSymbols.map(async (sym) => {
        try {
          const res = await fetch(`/api/stocks/info?symbol=${sym}&range=5y`)
          if (res.ok) {
            const data = await res.json()
            results[sym] = Array.isArray(data?.history) ? data.history : []
          }
        } catch (e) { console.error(`Failed to fetch history for ${sym}`, e) }
      }))
      setHistoryData(results)
      setLoading(false)
    }
    fetchAllHistory()
  }, [relevantSymbols])

  const chartData = useMemo(() => {
    if (loading) return []
    
    const sortedTxs = [...transactions]
      .filter(t => t?.trade_date)
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    if (sortedTxs.length === 0) return []

    const firstTxDate = sortedTxs[0].trade_date
    const calcStartStr = firstTxDate < goalStartDate ? firstTxDate : goalStartDate
    const startDate = new Date(calcStartStr)
    const endDate = new Date(todayStr)

    const rawDays: any[] = []
    let inventory: Record<string, any[]> = {}
    let txIdx = 0
    let cumulativeRealized = 0
    const lastPriceMap: Record<string, number> = {}
    const stockHistoryPointers: Record<string, number> = {}

    relevantSymbols.forEach(s => {
      stockHistoryPointers[s] = 0
      lastPriceMap[s] = 0
    })

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dStr = d.toISOString().split('T')[0]
      
      while (txIdx < sortedTxs.length && sortedTxs[txIdx].trade_date === dStr) {
        const t = sortedTxs[txIdx]
        if (!inventory[t.symbol]) inventory[t.symbol] = []
        if (t.action !== 'SELL') {
          const { absNet } = calculateTxParts(t.shares, t.price, t.action, t.symbol, settings)
          inventory[t.symbol].push({ shares: t.shares, cost: absNet })
        } else {
          const { absNet: net_sell } = calculateTxParts(t.shares, t.price, 'SELL', t.symbol, settings)
          let rem = t.shares
          let sellProceedsRemaining = net_sell
          while (rem > 0 && inventory[t.symbol].length > 0) {
            const lot = inventory[t.symbol][0]
            const take = Math.min(lot.shares, rem)
            const mBuyCost = take === lot.shares ? lot.cost : Math.floor(lot.cost * (take / lot.shares))
            const mSellNet = take === rem ? sellProceedsRemaining : Math.floor(net_sell * (take / t.shares))

            cumulativeRealized += (mSellNet - mBuyCost)
            sellProceedsRemaining -= mSellNet
            
            lot.shares -= take
            lot.cost -= mBuyCost
            rem -= take
            if (lot.shares <= 0) inventory[t.symbol].shift()
          }
        }
        txIdx++
      }

      relevantSymbols.forEach(sym => {
        const hist = historyData[sym] || []
        let ptr = stockHistoryPointers[sym]
        while (ptr < hist.length && hist[ptr] && (hist[ptr].date || '') <= dStr) {
          lastPriceMap[sym] = hist[ptr].price || lastPriceMap[sym] || 0
          ptr++
        }
        stockHistoryPointers[sym] = ptr
      })

      let unrealized = 0
      Object.entries(inventory).forEach(([sym, lots]) => {
        const netShares = lots.reduce((s, l) => s + l.shares, 0)
        if (netShares <= 0) return
        const q = lastPriceMap[sym] || 0
        if (q <= 0) {
          lots.forEach(l => { unrealized += (0 - l.cost) })
          return
        }
        const { absNet: totalNetMV } = calculateTxParts(netShares, q, 'SELL', sym, settings)
        const totalCost = lots.reduce((s, l) => s + l.cost, 0)
        unrealized += (totalNetMV - totalCost)
      })

      const actualPnL = cumulativeRealized + unrealized
      rawDays.push({ date: dStr, actual: actualPnL })
    }
    return rawDays
  }, [transactions, historyData, loading, settings, todayStr, relevantSymbols, goalStartDate])

  const { filteredData, dynamicTicks } = useMemo(() => {
    if (!chartData.length) return { filteredData: [], dynamicTicks: [] }

    let startDate: string
    let endDate: string

    const getMonthsFromRange = (r: TotalRange): number => {
      if (r === '6M') return 6
      if (r === '1Y') return 12
      if (r === '1.5Y') return 18
      if (r === '2Y') return 24
      if (r === '3Y') return 36
      return 12
    }

    if (range === 'CUSTOM') {
      startDate = customStart
      endDate = customEnd
    } else {
      const duration = getMonthsFromRange(range)
      const dGoalStart = new Date(goalStartDate)
      const dEndWindow = new Date(dGoalStart)
      dEndWindow.setMonth(dEndWindow.getMonth() + duration)
      
      const dToday = new Date(todayStr)
      
      if (dEndWindow < dToday) {
        // CASE: The window starting from goal_start_date has already passed.
        // Rule: Use today as the end point and look back X months.
        const dS = new Date(dToday)
        dS.setMonth(dS.getMonth() - duration)
        startDate = dS.toISOString().split('T')[0]
        endDate = todayStr
      } else {
        // CASE: The window starting from goal_start_date is either current or in the future.
        // Rule: Start from goal_start_date and look forward X months.
        startDate = goalStartDate
        endDate = dEndWindow.toISOString().split('T')[0]
      }
    }

    // Filter data to the window range.
    const filtered = chartData.filter(d => d.date >= startDate && d.date <= endDate)
    
    // To ensure the chart starts AT the white line, we should ideally have a data point 
    // exactly at startDate. If the first filtered data point is after startDate,
    // we should prepend the first point's value at the startDate to ensure alignment.
    if (filtered.length > 0 && filtered[0].date > startDate) {
       // Optional: Add a virtual start point to anchor at the left.
       // However, for total progress, usually the goal start is the first data day.
    }

    const ticks: string[] = []
    if (filtered.length > 0) {
      ticks.push(filtered[0].date)
      const dS = new Date(startDate)
      const dE = new Date(endDate)
      for (let d = new Date(dS); d <= dE; d.setDate(d.getDate() + 1)) {
        if (d.getDate() === 1) {
          const s = d.toISOString().split('T')[0]
          if (s > startDate && s < endDate) ticks.push(s)
        }
      }
      // Ensure the end of window is shown if it's today or in the past
      const finalEnd = endDate < todayStr ? endDate : todayStr
      if (finalEnd > startDate) ticks.push(finalEnd)
    }

    return { filteredData: filtered, dynamicTicks: Array.from(new Set(ticks)).sort() }
  }, [chartData, range, customStart, customEnd, goalStartDate, todayStr])

  if (loading) return (
    <div className="h-[400px] flex items-center justify-center bg-[var(--bg-card)] rounded-[48px] border border-[var(--border-bright)]">
       <div className="flex flex-col items-center gap-2">
         <RefreshCw className="w-8 h-8 text-accent animate-spin" />
         <span className="text-[10px] font-black text-[var(--t2)] opacity-80 uppercase tracking-widest">載入總進度中...</span>
       </div>
    </div>
  )

  const yDomain = useMemo(() => {
    const vals = filteredData.map(d => d.actual || 0)
    const goal = settings.total_goal || 0
    const maxVal = Math.max(...vals, goal)
    const safeMax = isFinite(maxVal) && maxVal > 0 ? maxVal : 10000

    // Positive: 5 equal segments
    let step = Math.ceil(safeMax / 5 / 100) * 100
    if (step <= 0) step = 2000
    if (step * 5 < safeMax) step = Math.ceil(safeMax / 5)

    // Negative: 1 segment
    const ticks = [-step, 0, step, step * 2, step * 3, step * 4, step * 5]
    return { domain: [-step, step * 5] as [number, number], ticks }
  }, [filteredData, settings.total_goal])

  const currentTotal = Math.round(filteredData[filteredData.length - 1]?.actual || 0)

  return (
    <div className="space-y-4 animate-slide-up w-full">
      <div className="flex items-end justify-between px-4">
        <div className="space-y-1">
          <h3 className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em]">總目標進度</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-[var(--t1)] font-mono">
              {`$${(settings.total_goal||0) >= 1000000 ? ((settings.total_goal||0)/1000000).toFixed(1)+'M' : (settings.total_goal||0) >= 1000 ? Math.round((settings.total_goal||0)/1000)+'K' : (settings.total_goal||0)}`}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em] mb-1">當前累計總損益</div>
          <div className={`text-2xl font-black font-mono ${currentTotal >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {`$${Math.abs(currentTotal) >= 1000000 ? (currentTotal/1000000).toFixed(1)+'M' : Math.abs(currentTotal) >= 1000 ? Math.round(currentTotal/1000)+'K' : currentTotal}`}
          </div>
        </div>
      </div>

      <div className="px-4 flex flex-col gap-4 relative z-20">
        <div className="flex w-full gap-1.5 scrollbar-hide">
          {(['6M', '1Y', '1.5Y', '2Y', '3Y'] as TotalRange[]).map(r => (
            <button 
              key={r} 
              onClick={() => { setRange(r); setShowCustom(false); }}
              className={`flex-1 py-2.5 rounded-xl text-[11px] font-black transition-all border ${range === r && !showCustom ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-[var(--bg-card)] text-[var(--t2)] opacity-60 border-[var(--border-bright)] whitespace-nowrap'}`}
            >
              {r}
            </button>
          ))}
          <button 
            onClick={() => { setRange('CUSTOM'); setShowCustom(!showCustom); }}
            className={`px-4 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-black transition-all border ${range === 'CUSTOM' ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-[var(--bg-card)] text-[var(--t2)] opacity-60 border-[var(--border-bright)]'}`}
          >
            <CalendarIcon size={14} />
          </button>
        </div>

        {showCustom && range === 'CUSTOM' && (
          <div className="flex items-center justify-end gap-3 px-4 py-2 animate-slide-up bg-[var(--bg-card)] rounded-2xl border border-[var(--border-bright)] shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-[var(--t2)] opacity-60">起</span>
              <DatePicker value={customStart} onChange={(v: string) => setCustomStart(v)} />
            </div>
            <div className="flex items-center gap-2 pr-2">
              <span className="text-[10px] font-black text-[var(--t2)] opacity-60">迄</span>
              <DatePicker value={customEnd} onChange={(v: string) => setCustomEnd(v)} />
            </div>
          </div>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[48px] p-0 shadow-2xl relative overflow-hidden group">
        
        {/* Yellow Legend Icon at Center Top */}
        <div className="absolute top-10 left-0 right-0 flex justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-8 h-[2px] bg-accent rounded-full" />
            <span className="text-[10px] font-black text-accent opacity-80 uppercase tracking-widest">實際進度</span>
          </div>
        </div>

        <div className="h-[460px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredData} margin={{ top: 80, right: 0, left: 15, bottom: 20 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.08)" vertical={false} horizontal={true} />
              <XAxis 
                dataKey="date" 
                ticks={dynamicTicks}
                tickFormatter={(v) => {
                  if (!v || typeof v !== 'string') return ''
                  const d = new Date(v)
                  return `${d.getMonth() + 1}/${d.getDate()}`
                }}
                tick={{fontSize: 10, fontWeight: 900, fill: '#888'}}
                axisLine={false}
                tickLine={false}
                padding={{ left: 0, right: 0 }}
                interval="preserveStart"
              />
              <YAxis 
                yAxisId="right"
                width={40}
                orientation="right"
                domain={yDomain.domain}
                ticks={yDomain.ticks}
                tick={{fontSize: 10, fontWeight: 900, fill: '#888'}}
                axisLine={false}
                tickLine={{ stroke: '#888', strokeWidth: 1 }}
                tickFormatter={(v) => {
                  const a = Math.abs(v ?? 0)
                  if (a >= 1000000) return `${((v??0)/1000000).toFixed(1)}M`
                  if (a >= 1000) return `${Math.round((v??0)/1000)}K`
                  return String(v ?? 0)
                }}
              />
              <YAxis yAxisId="leftLine" orientation="left" tick={false} axisLine={{ stroke: '#ffffff', strokeWidth: 3 }} width={2} />

              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload
                    return (
                      <div className="glass p-5 border-white/10 shadow-2xl backdrop-blur-3xl rounded-3xl z-50 overflow-hidden relative">
                        <div className="absolute inset-0 bg-black/60 rounded-3xl" />
                        <div className="relative z-10">
                          <div className="text-[10px] text-[var(--t3)] font-black mb-4 uppercase tracking-widest">{data.date}</div>
                          <div className="flex justify-between gap-12">
                            <span className="text-[12px] text-[var(--t2)] font-black">累計總損益</span>
                            <span className={`text-[14px] font-mono font-black ${(data.actual || 0) >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                              {fmtMoney(data.actual || 0)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />

              <Line 
                yAxisId="right"
                type="linear" 
                dataKey="actual" 
                stroke="var(--accent)" 
                strokeWidth={3} 
                dot={false}
                connectNulls
                isAnimationActive={true}
              />

              <ReferenceLine yAxisId="right" y={0} stroke="#ffffff" strokeWidth={2} strokeOpacity={1} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function TotalPnLChart(props: Props) {
  return (
    <ErrorBoundary>
      <TotalPnLChartContent {...props} />
    </ErrorBoundary>
  )
}
