'use client'

import { useMemo, useState, useEffect } from 'react'
import { 
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Transaction, UserSettings, fmtMoney, calcFee, calcTax, calcRawFee, calcRawTax } from '@/types'
import ErrorBoundary from './ErrorBoundary'

interface Props {
  transactions: Transaction[]
  settings: UserSettings
  year?: number
}

function YearlyPnLChartContent({ transactions, settings, year }: Props) {
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)

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
        const p = Math.round(t.amount)
        const rf = calcRawFee(t.shares, t.price, settings, false, t.action === 'DCA' || t.trade_type === 'DCA')
        const total = Math.round(p + rf)
        inventory[t.symbol].push({ shares: t.shares, price: t.price, principal: p, rawFee: rf, cost: total })
      } else {
        let rem = t.shares
        while (rem > 0 && inventory[t.symbol].length > 0) {
          const lot = inventory[t.symbol][0]
          if (!lot) break
          const take = Math.min(lot.shares, rem)
          const lotCost = lot.cost
          const lotShares = lot.shares
          if (lotShares > 0) {
            const ratio = take / lotShares
            const matchedPrincipal = (lot.principal || lot.cost) * ratio
            const matchedRawFee = (lot.rawFee || 0) * ratio
            
            lot.principal = (lot.principal || lot.cost) - matchedPrincipal
            lot.rawFee = (lot.rawFee || 0) - matchedRawFee
            lot.cost = Math.round(lot.principal + lot.rawFee)
            lot.shares -= take
          }
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
            const p = Math.round(t.amount)
            const rf = calcRawFee(t.shares, t.price, settings, false, t.action === 'DCA' || t.trade_type === 'DCA')
            const total = Math.round(p + rf)
            inventory[t.symbol].push({ shares: t.shares, price: t.price, principal: p, rawFee: rf, cost: total })
          } else {
            const rf_sell = calcRawFee(t.shares, t.price, settings, true)
            const rt_sell = calcRawTax(t.shares, t.price, t.symbol, settings)
            let rem = t.shares
            while (rem > 0 && inventory[t.symbol].length > 0) {
              const lot = inventory[t.symbol][0]
              if (!lot) break
              const take = Math.min(lot.shares, rem)
              
              const ratio = take / lot.shares
              const matchedPrincipal = lot.principal * ratio
              const matchedRawFee = (lot.rawFee || 0) * ratio
              const matchedBuyCostInt = Math.round(matchedPrincipal + matchedRawFee)
              
              const ratioSell = take / t.shares
              const sellProceedsPart = Math.round((t.amount * ratioSell) - (rf_sell * ratioSell) - (rt_sell * ratioSell))

              cumulativeRealizedThisYear += (sellProceedsPart - matchedBuyCostInt)
              
              lot.shares -= take
              lot.principal -= matchedPrincipal
              lot.rawFee -= matchedRawFee
              lot.cost = Math.round(lot.principal + lot.rawFee) // Update integer cost for next loop if partial
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
        const q = lastPriceMap[sym] || 0
        if (q <= 0) {
          lots.forEach(l => {
            unrealizedThisYear += (0 - l.cost)
          })
          return
        }
        
        lots.forEach(l => {
          const mv = q * l.shares
          const rf_s = calcRawFee(l.shares, q, settings, true)
          const rt_s = calcRawTax(l.shares, q, sym, settings)
          const netMv = Math.round(mv - rf_s - rt_s)
          unrealizedThisYear += (netMv - l.cost)
        })
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
                rangeBelow: !isAbv && d.actual !== null ? [d.actual, d.ideal] : null
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

  const ticks = useMemo(() => {
    const t: string[] = []
    for (let m = 0; m < 12; m++) {
      t.push(`${chartYear}-${String(m + 1).padStart(2, '0')}-01`)
    }
    t.push(`${chartYear}-12-31`)
    return t
  }, [chartYear])

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
    const vals = chartData.filter(d => d.actual !== null && !d.isIntersection).flatMap(d => [d.actual, d.ideal])
    if (vals.length === 0) return [0, goal * 1.05]

    const dataMin = Math.min(0, ...vals)
    const dataMax = Math.max(goal, ...vals)
    
    // 5% Visual Buffer
    const bufferMax = dataMax * 1.05
    const bufferMin = dataMin < 0 ? dataMin * 1.05 : 0
    
    const range = bufferMax - bufferMin
    const snapUnit = range > 10000 ? 1000 : 500
    
    const finalMax = Math.ceil(bufferMax / snapUnit) * snapUnit
    const finalMin = dataMin < 0 ? Math.floor(bufferMin / snapUnit) * snapUnit : 0
    
    return [finalMin, finalMax]
  })()

  return (
    <div className="space-y-4 animate-slide-up w-full">
      {/* Header with Goal Info */}
      <div className="flex items-end justify-between px-2">
        <div className="space-y-1">
          <h3 className="text-[10px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em]">年度獲利目標進度</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--t1)] font-mono">{fmtMoney(settings.year_goal)}</span>
            <span className="text-[10px] font-bold text-accent opacity-60 uppercase tracking-widest">Target Goal</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em] mb-1">當前累計損益</div>
          <div className={`text-xl font-black font-mono ${(chartData.findLast(d => d.actual !== null)?.actual || 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {fmtMoney(Math.round(chartData.findLast(d => d.actual !== null)?.actual || 0))}
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[48px] p-0 shadow-2xl relative overflow-hidden group">
        
        {/* Custom Legend - Floating */}
        <div className="absolute top-8 left-0 right-0 flex justify-center gap-10 z-10 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 bg-[#fbbf24] rounded-full border-t border-dashed" />
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">理想進度</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-0.5 w-6 rounded-full overflow-hidden">
              <div className="bg-[#ef4444] flex-1" />
              <div className="bg-[#22c55e] flex-1" />
            </div>
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">實際進度</span>
          </div>
        </div>

        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 70, right: 10, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="areaRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="areaGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" vertical={false} />
              
              <XAxis 
                dataKey="date" 
                ticks={ticks}
                tickFormatter={(v) => {
                  if (!v || typeof v !== 'string') return ''
                  const d = new Date(v)
                  if (v.endsWith('-12-31')) return '12/31'
                  return `${d.getMonth() + 1}/1`
                }}
                tick={{fontSize: 10, fontWeight: 900, fill: '#888'}}
                axisLine={false}
                tickLine={false}
                padding={{ left: 20, right: 20 }}
                interval={0}
              />
              <YAxis 
                width={50}
                orientation="right"
                domain={yDomain}
                tick={{fontSize: 10, fontWeight: 900, fill: '#888'}}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
              />

              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload
                    if (!data || data.isFuture || data.isIntersection) return null
                    const diff = (data.actual || 0) - (data.ideal || 0)
                    return (
                      <div className="glass p-5 border-white/10 shadow-2xl backdrop-blur-3xl rounded-3xl">
                        <div className="text-[10px] text-[var(--t3)] font-black mb-4 uppercase tracking-widest">{data.date}</div>
                        <div className="space-y-3">
                          <div className="flex justify-between gap-12">
                            <span className="text-[12px] text-[var(--t2)] font-black">累計總損益</span>
                            <span className={`text-[14px] font-mono font-black ${(data.actual || 0) >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                              {fmtMoney(Math.round(data.actual || 0))}
                            </span>
                          </div>
                          <div className="flex justify-between gap-12">
                            <span className="text-[12px] text-[var(--t2)] font-black">理想目標</span>
                            <span className="text-[14px] font-mono font-black text-[#fbbf24]">
                              {fmtMoney(Math.round(data.ideal || 0))}
                            </span>
                          </div>
                          <div className="pt-3 border-t border-white/5 flex justify-between gap-12">
                            <span className="text-[11px] text-[var(--t2)] font-black">差額</span>
                            <span className={`text-[14px] font-mono font-black ${diff >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                              {fmtMoney(Math.round(diff))}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />

              {/* DYNAMIC GAP FILLING */}
              <Area 
                type="monotone" 
                dataKey="rangeAbove" 
                fill="url(#areaRed)"
                stroke="none"
                isAnimationActive={true}
                connectNulls
              />
              <Area 
                type="monotone" 
                dataKey="rangeBelow" 
                fill="url(#areaGreen)"
                stroke="none"
                isAnimationActive={true}
                connectNulls
              />

              {/* IDEAL LINE (YELLOW DASHED) */}
              <Line 
                type="linear" 
                dataKey="ideal" 
                stroke="#fbbf24" 
                strokeWidth={2} 
                strokeDasharray="5 5"
                dot={false} 
                isAnimationActive={false}
                opacity={0.4}
              />

              {/* ACTUAL LINE - Segmented for Color */}
              <Line 
                type="monotone" 
                dataKey="actualAbove" 
                stroke="#ef4444" 
                strokeWidth={2.5} 
                dot={false}
                connectNulls
                isAnimationActive={true}
              />
              <Line 
                type="monotone" 
                dataKey="actualBelow" 
                stroke="#22c55e" 
                strokeWidth={2.5} 
                dot={false}
                connectNulls
                isAnimationActive={true}
              />

              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
              {chartYear === new Date().getFullYear() && (
                <ReferenceLine x={todayStr} stroke="rgba(255,255,255,0.15)" strokeDasharray="5 5" />
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
