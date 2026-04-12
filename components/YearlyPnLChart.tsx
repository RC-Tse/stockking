'use client'

import { useMemo, useState, useEffect } from 'react'
import { 
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Calendar as CalendarIcon } from 'lucide-react'
import DatePicker from './DatePicker'
import { type ChartRange, Transaction, UserSettings, fmtMoney, calculateTxParts } from '@/types'
import ErrorBoundary from './ErrorBoundary'

interface Props {
  transactions: Transaction[]
  settings: UserSettings
  year?: number
}

function YearlyPnLChartContent({ transactions, settings, year }: Props) {
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  
  const [range, setRange] = useState<ChartRange>(settings.chart_default_range || '1M')
  const [showCustom, setShowCustom] = useState(false)
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]
  })
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split('T')[0])

  const chartYear = year || new Date().getFullYear()
  const yearStartStr = `${chartYear}-01-01`
  const todayStr = new Date().toISOString().split('T')[0]

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
          const res = await fetch(`/api/stocks/info?symbol=${sym}&year=${chartYear}`)
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
  }, [relevantSymbols, chartYear])

  const chartData = useMemo(() => {
    if (loading) return []
    const start = new Date(`${chartYear}-01-01`)
    const end = new Date(`${chartYear}-12-31`)
    const sortedTxs = [...transactions]
      .filter(t => t?.trade_date)
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let inventory: Record<string, any[]> = {}
    let txIdx = 0
    
    // Phase 1: Pre-Year Inventory
    while (txIdx < sortedTxs.length && sortedTxs[txIdx].trade_date < yearStartStr) {
      const t = sortedTxs[txIdx]
      if (!inventory[t.symbol]) inventory[t.symbol] = []
      if (t.action !== 'SELL') {
        const { absNet } = calculateTxParts(t.shares, t.price, t.action, t.symbol, settings)
        inventory[t.symbol].push({ shares: t.shares, cost: absNet })
      } else {
        const { absNet: net_sell } = calculateTxParts(t.shares, t.price, 'SELL', t.symbol, settings)
        let rem = t.shares
        while (rem > 0 && inventory[t.symbol].length > 0) {
          const lot = inventory[t.symbol][0]
          const take = Math.min(lot.shares, rem)
          const mBuyCost = take === lot.shares ? lot.cost : Math.floor(lot.cost * (take / lot.shares))
          
          lot.cost -= mBuyCost
          lot.shares -= take
          rem -= take
          if (lot.shares <= 0) inventory[t.symbol].shift()
        }
      }
      txIdx++
    }

    // Phase 2: Annual Loop
    const rawDays: any[] = []
    let cumulativeRealizedThisYear = 0
    const lastPriceMap: Record<string, number> = {}
    const stockHistoryPointers: Record<string, number> = {}
    
    // Seed price map with first available price to fix 1/1 asset loss
    relevantSymbols.forEach(s => {
      stockHistoryPointers[s] = 0
      const hist = historyData[s] || []
      if (hist.length > 0) {
        lastPriceMap[s] = hist[0].price || 0
      } else {
        lastPriceMap[s] = 0
      }
    })

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dStr = d.toISOString().split('T')[0]
      const isFuture = dStr > todayStr
      
      if (!isFuture) {
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

              cumulativeRealizedThisYear += (mSellNet - mBuyCost)
              sellProceedsRemaining -= mSellNet
              
              lot.shares -= take
              lot.cost -= mBuyCost
              rem -= take
              if (lot.shares <= 0) inventory[t.symbol].shift()
            }
          }
          txIdx++
        }
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

      let unrealizedThisYear = 0
      Object.entries(inventory).forEach(([sym, lots]) => {
        const netShares = lots.reduce((s, l) => s + l.shares, 0)
        if (netShares <= 0) return
        
        const q = lastPriceMap[sym] || 0
        if (q <= 0) {
          lots.forEach(l => {
            unrealizedThisYear += (0 - l.cost)
          })
          return
        }
        
        const { absNet: totalNetMV } = calculateTxParts(netShares, q, 'SELL', sym, settings)
        const totalCost = lots.reduce((s, l) => s + l.cost, 0)
        unrealizedThisYear += (totalNetMV - totalCost)
      })

      const dayIdx = rawDays.length
      const idealPnL = (dayIdx / 365) * (settings?.year_goal || 0)
      const actualPnL = isFuture ? null : (cumulativeRealizedThisYear + unrealizedThisYear)
      
      rawDays.push({
        date: dStr,
        actual: actualPnL,
        ideal: idealPnL,
        isFuture,
        isMonthStart: d.getDate() === 1,
      })
    }

    // Phase 3: Intersection Point Injection & Differential Range Calculation
    const finalData: any[] = []
    for (let i = 0; i < rawDays.length; i++) {
        const curr = rawDays[i]
        
        // Compute derived fields for this point
        const augment = (d: any) => {
            const isAbv = d.actual !== null && d.actual >= d.ideal
            return {
                ...d,
                actualAbove: isAbv ? d.actual : null,
                actualBelow: !isAbv ? d.actual : null,
                // Differential Area Fill (strictly between lines)
                rangeAbove: isAbv && d.actual !== null ? [d.ideal, d.actual] : null,
                rangeBelow: !isAbv && d.actual !== null ? [d.actual, d.ideal] : null,
                // PnL Area Fill (relative to Y=0)
                pnlAreaPos: d.actual !== null && d.actual > 0 ? [0, d.actual] : null,
                pnlAreaNeg: d.actual !== null && d.actual < 0 ? [d.actual, 0] : null
            }
        }
        
        finalData.push(augment(curr))

        // Check for crossing between current and next
        const next = rawDays[i+1]
        if (next && curr.actual !== null && next.actual !== null && !curr.isFuture && !next.isFuture) {
            const currAbv = curr.actual >= curr.ideal
            const nextAbv = next.actual >= next.ideal
            
            if (currAbv !== nextAbv) {
                // Crossing detected! Inject shared point.
                // Linear interpolation to find precise crossing day offset 't' (0 to 1)
                const denom = (next.actual - curr.actual) - (next.ideal - curr.ideal)
                if (Math.abs(denom) > 0.0001) {
                    const t = (curr.ideal - curr.actual) / denom
                    const intersectVal = curr.actual + t * (next.actual - curr.actual)
                    
                    // Synthetic point (shared logic)
                    const synthetic = {
                        date: curr.date, // Same day visual overlap
                        actual: intersectVal,
                        ideal: intersectVal,
                        actualAbove: intersectVal,
                        actualBelow: intersectVal,
                        rangeAbove: [intersectVal, intersectVal],
                        rangeBelow: [intersectVal, intersectVal],
                        isIntersection: true
                    }
                    finalData.push(synthetic)
                }
            }
        }
    }
    return finalData
  }, [transactions, historyData, loading, settings, chartYear, todayStr, relevantSymbols, yearStartStr])

  const { filteredData, dynamicTicks } = useMemo(() => {
    if (!chartData.length) return { filteredData: [], dynamicTicks: [] }

    let startDate: string
    let endDate: string
    const baseline = todayStr < `${chartYear}-12-31` ? todayStr : `${chartYear}-12-31`
    const dEnd = new Date(baseline)

    if (range === '1Y') {
      startDate = `${chartYear}-01-01`
      endDate = `${chartYear}-12-31`
    } else if (range === '9M') {
      startDate = `${chartYear}-01-01`
      endDate = `${chartYear}-09-30`
    } else if (range === '6M') {
      startDate = `${chartYear}-01-01`
      endDate = `${chartYear}-06-30`
    } else if (range === 'CUSTOM') {
      startDate = customStart
      endDate = customEnd
    } else {
      // 3M, 1M are dynamic from today
      const numMonths = parseInt(range)
      const dS = new Date(dEnd)
      dS.setMonth(dS.getMonth() - numMonths)
      startDate = dS.toISOString().split('T')[0]
      if (startDate < yearStartStr) startDate = yearStartStr
      endDate = baseline
    }

    const filtered = chartData.filter(d => d.date >= startDate && d.date <= endDate)
    
    // Dynamic Ticks: Start, End, and 1st of each month in between
    const ticks: string[] = []
    if (filtered.length > 0) {
      // 確保將真正的資料範圍起點放入 ticks 中，這樣 Recharts 的 ReferenceLine 才抓得到該點來畫白線
      ticks.push(filtered[0].date)
      
      // Monthly 1st points
      // Generate all 1st days between start and end
      const dS = new Date(startDate)
      const dE = new Date(endDate)
      for (let d = new Date(dS); d <= dE; d.setDate(d.getDate() + 1)) {
        if (d.getDate() === 1) {
          const s = d.toISOString().split('T')[0]
          if (s > startDate && s < endDate) ticks.push(s)
        }
      }
      
      if (endDate !== startDate) ticks.push(endDate)
    }

    // Continuity Fix: Inject intersection points where actual crosses ideal
    const result: any[] = []
    for (let i = 0; i < filtered.length; i++) {
        const curr = filtered[i]
        const next = filtered[i + 1]
        
        result.push(curr)
        
        if (next && curr.actual !== null && next.actual !== null) {
            const currDiff = curr.actual - curr.ideal
            const nextDiff = next.actual - next.ideal
            
            if (currDiff * nextDiff < 0) {
                // Crossing! Calculate t where actual - ideal == 0
                const t = Math.abs(currDiff) / (Math.abs(currDiff) + Math.abs(nextDiff))
                const intersectY = curr.ideal + t * (next.ideal - curr.ideal)
                
                result.push({
                    date: curr.date, // Use curr date for simplicity in X-Axis
                    actual: intersectY,
                    ideal: intersectY,
                    isIntersection: true
                })
            }
        }
    }

    const enhanced = result.map(d => {
      const isAhead = d.actual !== null && d.actual >= d.ideal
      return {
        ...d,
        // For lines: include intersection point in BOTH segments to connect them
        actualLineAbove: isAhead || d.isIntersection ? d.actual : null,
        actualLineBelow: !isAhead || d.isIntersection ? d.actual : null,
        // For Areas
        fillRed: (d.actual !== null && isAhead) ? d.actual : null,
        // Green fill: Need to cover [actual, ideal] and [actual, 0].
        // Since ideal > 0, if actual < ideal, the union is [min(actual, 0), ideal].
        // To avoid overlap (and double opacity), we split into positive and negative parts.
        fillGreenPos: (d.actual !== null && !isAhead) ? d.ideal : null,
        fillGreenNeg: (d.actual !== null && !isAhead) ? Math.min(d.actual, 0) : null
      }
    })

    return { filteredData: enhanced, dynamicTicks: Array.from(new Set(ticks)).sort() }
  }, [chartData, range, customStart, customEnd, chartYear, todayStr, yearStartStr, settings.chart_default_range])

  if (loading) return (
    <div className="h-[400px] flex items-center justify-center bg-[var(--bg-card)] rounded-[48px] border border-[var(--border-bright)]">
       <div className="flex flex-col items-center gap-2">
         <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
         <span className="text-[10px] font-black text-[var(--t2)] opacity-80 uppercase tracking-widest">繪製進度圖表中...</span>
       </div>
    </div>
  )

  const yDomain = (() => {
    const goal = settings?.year_goal || 0
    const vals = filteredData.filter(d => d.actual !== null && !d.isIntersection).flatMap(d => [d.actual, d.ideal])
    if (vals.length === 0) {
      const g = goal * 1.05
      return { domain: [0, g], ticks: [0, g] }
    }

    const dataMin = Math.min(0, ...vals)
    const dataMax = Math.max(...vals)
    
    // Y-Axis Positive: Max of Actual or Last Day's Ideal, rounded up to 8 nice segments
    const lastDayIdeal = filteredData[filteredData.length - 1]?.ideal || 0
    const targetMax = Math.max(lastDayIdeal, dataMax)

    let step = Math.ceil(targetMax / 80) * 10
    if (step <= 0) step = 100
    const finalMax = step * 8
    
    const positiveTicks = []
    for (let i = 0; i <= 8; i++) {
      positiveTicks.push(i * step)
    }

    // Y-Axis Negative: Maintain existing 500 snap logic
    const bufferMin = dataMin < 0 ? dataMin * 1.05 : 0
    const snapUnit = 500
    const finalMin = dataMin < 0 ? Math.floor(bufferMin / snapUnit) * snapUnit : 0
    
    const negativeTicks = []
    if (finalMin < 0) {
      for (let v = finalMin; v < 0; v += snapUnit) {
        negativeTicks.push(v)
      }
    }

    const rawTicks = [...negativeTicks, ...positiveTicks]
    if (finalMin <= 0 && finalMax >= 0 && !rawTicks.includes(0)) rawTicks.push(0)

    const ticks = Array.from(new Set(rawTicks)).sort((a,b) => a-b)
    return { domain: [finalMin, finalMax], ticks }
  })()

  const latestValid = [...filteredData].reverse().find(d => d.actual !== null)
  const currentActual = Math.round(latestValid?.actual || 0)

  return (
    <div className="space-y-4 animate-slide-up w-full">
      {/* Premium Header: Goal & Progress */}
      <div className="flex items-end justify-between px-4">
        <div className="space-y-1">
          <h3 className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em]">年度目標進度</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-[var(--t1)] font-mono">{fmtMoney(settings.year_goal)}</span>
            <span className="text-[11px] font-bold text-accent opacity-60 uppercase tracking-widest">Target Goal</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em] mb-1">當前累計總損益</div>
          <div className={`text-2xl font-black font-mono ${currentActual >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {fmtMoney(currentActual)}
          </div>
        </div>
      </div>

      {/* Range Selector Integration - Moved outside the card */}
      <div className="px-4 flex flex-col gap-4 relative z-20">
        <div className="flex w-full gap-1.5 scrollbar-hide">
          {(['1M', '3M', '6M', '9M', '1Y'] as ChartRange[]).map(r => (
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
              <DatePicker value={customStart} onChange={(v: string) => setCustomStart(v)} fixedYear={chartYear} />
            </div>
            <div className="flex items-center gap-2 pr-2">
              <span className="text-[10px] font-black text-[var(--t2)] opacity-60">迄</span>
              <DatePicker value={customEnd} onChange={(v: string) => setCustomEnd(v)} fixedYear={chartYear} />
            </div>
          </div>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[48px] p-0 shadow-2xl relative overflow-hidden group">
        
        {/* Custom Legend - Floating */}
        <div className="absolute top-10 left-0 right-0 flex justify-center gap-10 z-10 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0 border-t-2 border-[#fbbf24] border-dashed" />
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">理想進度</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-[3px] w-6 rounded-full overflow-hidden items-center">
              <div className="bg-[#ef4444] h-full flex-1" />
              <div className="bg-[#22c55e] h-full flex-1" />
            </div>
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">實際進度</span>
          </div>
        </div>

        <div className="h-[460px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredData} margin={{ top: 80, right: 0, left: 15, bottom: 20 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.05)" vertical={true} horizontal={true} />
              
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
                padding={{ left: 0, right: 20 }}
                interval={0}
              />
              <YAxis 
                yAxisId="right"
                width={40}
                orientation="right"
                ticks={yDomain.ticks}
                domain={yDomain.domain}
                tick={{fontSize: 10, fontWeight: 900, fill: '#888'}}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => Math.abs(v ?? 0) >= 1000 ? `${((v ?? 0)/1000).toFixed(0)}K` : fmtMoney(v ?? 0)}
              />
              {/* 這個 YAxis 專門用來在畫面最左側(即資料的起始日)畫出一道又直又粗的正版白線 */}
              <YAxis 
                yAxisId="leftLine"
                orientation="left"
                tick={false}
                axisLine={{ stroke: '#ffffff', strokeWidth: 3 }}
                width={2} 
              />

              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload
                    if (!data || data.isFuture || data.isIntersection) return null
                    const diff = (data.actual || 0) - (data.ideal || 0)
                    return (
                      <div className="glass p-5 border-white/10 shadow-2xl backdrop-blur-3xl rounded-3xl z-50 overflow-hidden relative">
                        <div className="absolute inset-0 bg-black/60 rounded-3xl" />
                        <div className="relative z-10">
                          <div className="text-[10px] text-[var(--t3)] font-black mb-4 uppercase tracking-widest">{data.date}</div>
                          <div className="space-y-3">
                            <div className="flex justify-between gap-12">
                              <span className="text-[12px] text-[var(--t2)] font-black">累計總損益</span>
                              <span className={`text-[14px] font-mono font-black ${(data.actual || 0) >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                                {fmtMoney(data.actual || 0)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-12">
                              <span className="text-[12px] text-[var(--t2)] font-black">理想目標</span>
                              <span className="text-[14px] font-mono font-black text-[#fbbf24]">
                                {fmtMoney(data.ideal || 0)}
                              </span>
                            </div>
                            <div className="pt-3 border-t border-white/5 flex justify-between gap-12">
                              <span className="text-[11px] text-[var(--t2)] font-black">跟隨差距</span>
                              <span className={`text-[14px] font-mono font-black ${diff >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                                {fmtMoney(diff)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />

              {/* IDEAL LINE (YELLOW DASHED) */}
              <Line 
                yAxisId="right"
                type="linear" 
                dataKey="ideal" 
                stroke="#fbbf24" 
                strokeWidth={2} 
                strokeDasharray="5 5"
                dot={false} 
                isAnimationActive={true}
              />
              
              {/* PnL AREAS (Relative to Y=0) */}
              <Area 
                yAxisId="right"
                type="linear" 
                dataKey="pnlAreaPos" 
                fill="#ef4444" 
                fillOpacity={0.15} 
                stroke="none" 
                isAnimationActive={true}
              />
              <Area 
                yAxisId="right"
                type="linear" 
                dataKey="pnlAreaNeg" 
                fill="#22c55e" 
                fillOpacity={0.15} 
                stroke="none" 
                isAnimationActive={true}
              />

              {/* DIFFERENTIAL AREAS (Between lines) - Kept but with reduced opacity */}
              <Area 
                yAxisId="right"
                type="linear" 
                dataKey="rangeAbove" 
                fill="#ef4444" 
                fillOpacity={0.15} 
                stroke="none" 
                isAnimationActive={true}
              />
              <Area 
                yAxisId="right"
                type="linear" 
                dataKey="rangeBelow" 
                fill="#22c55e" 
                fillOpacity={0.15} 
                stroke="none" 
                isAnimationActive={true}
              />

              {/* ACTUAL LINE (RED/GREEN DYNAMIC) */}
              <Line 
                yAxisId="right"
                type="linear" 
                dataKey="actualLineAbove" 
                stroke="#ef4444" 
                strokeWidth={2.5} 
                dot={false}
                connectNulls
                isAnimationActive={true}
                strokeLinecap="round"
              />
              <Line 
                yAxisId="right"
                type="linear" 
                dataKey="actualLineBelow" 
                stroke="#22c55e" 
                strokeWidth={2.5} 
                dot={false}
                connectNulls
                isAnimationActive={true}
                strokeLinecap="round"
              />

              <ReferenceLine yAxisId="right" y={0} stroke="#ffffff" strokeWidth={2} strokeOpacity={1} />

              {chartYear === new Date().getFullYear() && filteredData.some(d => d.date === todayStr) && (
                <ReferenceLine yAxisId="right" x={todayStr} stroke="rgba(255,255,255,0.15)" strokeDasharray="5 5" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function YearlyPnLChart(props: Props) {
  return (
    <ErrorBoundary>
      <YearlyPnLChartContent {...props} />
    </ErrorBoundary>
  )
}
