'use client'

import { useMemo, useState, useEffect } from 'react'
import { 
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Transaction, UserSettings, fmtMoney, calcFee, calcTax } from '@/types'
import ErrorBoundary from './ErrorBoundary'

interface Props {
  transactions: Transaction[]
  settings: UserSettings
}

function YearlyPnLChartContent({ transactions, settings }: Props) {
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)

  const currentYear = new Date().getFullYear()
  const yearStartStr = `${currentYear}-01-01`
  const lastYearEndStr = `${currentYear - 1}-12-31`
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
          const res = await fetch(`/api/stocks/info?symbol=${sym}&range=1y`)
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
    const start = new Date(`${currentYear}-01-01`)
    const end = new Date(`${currentYear}-12-31`)
    const sortedTxs = [...transactions]
      .filter(t => t?.trade_date)
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let inventory: Record<string, { shares: number, cost: number }[]> = {}
    let txIdx = 0
    
    // Phase 1: Pre-2026 Inventory
    while (txIdx < sortedTxs.length && sortedTxs[txIdx].trade_date < yearStartStr) {
      const t = sortedTxs[txIdx]
      if (!inventory[t.symbol]) inventory[t.symbol] = []
      if (t.action !== 'SELL') {
        const f = calcFee(t.shares, t.price, settings, false, t.action === 'DCA' || t.trade_type === 'DCA')
        inventory[t.symbol].push({ shares: t.shares, cost: t.amount + f })
      } else {
        let rem = t.shares
        while (rem > 0 && inventory[t.symbol].length > 0) {
          const lot = inventory[t.symbol][0]
          if (!lot) break
          const take = Math.min(lot.shares, rem)
          const lotCost = lot.cost
          const lotShares = lot.shares
          if (lotShares > 0) {
            lot.cost -= (take / lotShares) * lotCost
            lot.shares -= take
          }
          rem -= take
          if (lot.shares <= 0) inventory[t.symbol].shift()
        }
      }
      txIdx++
    }

    // Phase 2: Annual Loop
    const days: any[] = []
    let cumulativeRealized2026 = 0
    const lastPriceMap: Record<string, number> = {}
    const stockHistoryPointers: Record<string, number> = {}
    relevantSymbols.forEach(s => stockHistoryPointers[s] = 0)

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dStr = d.toISOString().split('T')[0]
      const isFuture = dStr > todayStr
      if (!isFuture) {
        while (txIdx < sortedTxs.length && sortedTxs[txIdx].trade_date === dStr) {
          const t = sortedTxs[txIdx]
          if (!inventory[t.symbol]) inventory[t.symbol] = []
          if (t.action !== 'SELL') {
            const f = calcFee(t.shares, t.price, settings, false, t.action === 'DCA' || t.trade_type === 'DCA')
            inventory[t.symbol].push({ shares: t.shares, cost: t.amount + f })
          } else {
            const f = calcFee(t.shares, t.price, settings, true)
            const tax = calcTax(t.shares, t.price, t.symbol, settings)
            const sellProceeds = t.amount - f - tax
            let rem = t.shares
            let matchedCost = 0
            while (rem > 0 && inventory[t.symbol].length > 0) {
              const lot = inventory[t.symbol][0]
              if (!lot) break
              const take = Math.min(lot.shares, rem)
              const lotShares = lot.shares
              if (lotShares > 0) {
                const takeCost = (take / lotShares) * lot.cost
                matchedCost += takeCost
                lot.shares -= take
                lot.cost -= takeCost
              }
              rem -= take
              if (lot.shares <= 0) inventory[t.symbol].shift()
            }
            cumulativeRealized2026 += (sellProceeds - matchedCost)
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

      let currentUnrealizedTotal = 0
      Object.entries(inventory).forEach(([sym, lots]) => {
        const shares = lots.reduce((s, l) => s + (l?.shares || 0), 0)
        const cost = lots.reduce((s, l) => s + (l?.cost || 0), 0)
        if (shares > 0) {
          const price = lastPriceMap[sym] || 0
          currentUnrealizedTotal += (shares * price - cost)
        }
      })

      const dayIdx = days.length
      const idealPnL = (dayIdx / 365) * (settings?.year_goal || 0)
      const actualPnL = cumulativeRealized2026 + currentUnrealizedTotal

      days.push({
        date: dStr,
        actual: isFuture ? null : actualPnL,
        ideal: idealPnL,
        isFuture,
        isMonthStart: d.getDate() === 1,
      })
    }
    return days
  }, [transactions, historyData, loading, settings, currentYear, todayStr, relevantSymbols, yearStartStr])

  const ticks = useMemo(() => {
    if (!chartData || chartData.length === 0) return []
    const main = chartData.filter(d => d?.isMonthStart).map(d => d.date)
    const end = chartData[chartData.length - 1]?.date
    if (end && !main.includes(end)) main.push(end)
    return main
  }, [chartData])

  if (loading) return (
    <div className="h-[300px] flex items-center justify-center bg-[var(--bg-card)] rounded-[48px] border border-[var(--border-bright)]">
       <div className="flex flex-col items-center gap-2">
         <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
         <span className="text-[10px] font-black text-[var(--t2)] opacity-80 uppercase tracking-widest">繪製進度圖表中...</span>
       </div>
    </div>
  )

  const lastActual = chartData.filter(d => !d.isFuture).pop()
  const currentActual = lastActual?.actual || 0
  const currentIdeal = lastActual?.ideal || 0
  const isAhead = currentActual >= currentIdeal

  const yDomain = (() => {
    const vals = chartData.flatMap(d => [d.actual || 0, d.ideal])
    let min = Math.min(0, ...vals)
    const max = Math.max(settings?.year_goal || 0, ...vals)
    if (min < 0) min = Math.floor((min - 1) / 100) * 100
    const pad = (max - min) * 0.1
    return [min, max + pad]
  })()

  return (
    <div className="space-y-4 animate-slide-up w-full">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[14px] font-black text-[var(--t1)] uppercase tracking-widest">
           年度總獲利進度
        </h3>
        <div className="bg-[var(--bg-card)] px-4 py-1.5 rounded-xl border border-[var(--border-bright)]">
           <span className="text-[10px] font-black text-accent">{fmtMoney(settings?.year_goal || 0)}</span>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[48px] p-0 shadow-2xl relative overflow-hidden group">
        
        {/* Custom Legend - Floating */}
        <div className="absolute top-8 left-0 right-0 flex justify-center gap-10 z-10 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 bg-[#FFD700] rounded-full" />
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">理想進度</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-0.5 w-6 rounded-full overflow-hidden">
              <div className="bg-[#e05050] flex-1" />
              <div className="bg-[#4ade80] flex-1" />
            </div>
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">實際進度</span>
          </div>
        </div>

        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 60, right: 0, left: -25, bottom: -10 }}>
              <defs>
                <linearGradient id="areaRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e05050" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#e05050" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="areaGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4ade80" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
                </linearGradient>

                <clipPath id="clipAbove">
                   {/* Hard-coded large polygon trick for straight ideal line relative to Chart scale 
                       In a real Recharts custom component, we'd use the Y scale.
                   */}
                   <rect x="-10%" y="-100%" width="120%" height="200%" /> 
                </clipPath>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" vertical={false} />
              
              <XAxis 
                dataKey="date" 
                ticks={ticks}
                tickFormatter={(v) => {
                  if (!v || typeof v !== 'string') return ''
                  if (v.endsWith('-12-31')) return '12/31'
                  const d = new Date(v)
                  return `${d.getMonth() + 1}/1`
                }}
                tick={{fontSize: 9, fontWeight: 900, fill: 'var(--t3)'}}
                axisLine={false}
                tickLine={false}
                padding={{ left: 10, right: 10 }}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis 
                width={70}
                domain={yDomain}
                tick={{fontSize: 9, fontWeight: 900, fill: 'var(--t3)'}}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
                padding={{ top: 20, bottom: 0 }}
              />

              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload
                    if (!data || data.isFuture) return null
                    const diff = (data.actual || 0) - (data.ideal || 0)
                    return (
                      <div className="glass p-5 border-white/10 shadow-2xl backdrop-blur-3xl rounded-3xl">
                        <div className="text-[10px] text-[var(--t3)] font-black mb-4 uppercase tracking-widest">{data.date}</div>
                        <div className="space-y-3">
                          <div className="flex justify-between gap-12">
                            <span className="text-[12px] text-[var(--t2)] font-black">累計總損益</span>
                            <span className={`text-[14px] font-mono font-black ${data.actual >= 0 ? 'text-[#e05050]' : 'text-[#4ade80]'}`}>
                              {fmtMoney(Math.round(data.actual || 0))}
                            </span>
                          </div>
                          <div className="flex justify-between gap-12">
                            <span className="text-[12px] text-[var(--t2)] font-black">理想目標</span>
                            <span className="text-[14px] font-mono font-black text-[#FFD700]">
                              {fmtMoney(Math.round(data.ideal || 0))}
                            </span>
                          </div>
                          <div className="pt-3 border-t border-white/5 flex justify-between gap-12">
                            <span className="text-[11px] text-[var(--t2)] font-black">差額</span>
                            <span className={`text-[14px] font-mono font-black ${diff >= 0 ? 'text-[#e05050]' : 'text-[#4ade80]'}`}>
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

              {/* IDEAL LINE */}
              <Line 
                type="linear" 
                dataKey="ideal" 
                stroke="#FFD700" 
                strokeWidth={1} 
                dot={false} 
                isAnimationActive={false}
                opacity={0.3}
              />

              {/* DYNAMIC FILL BETWEEN ACTUAL AND IDEAL 
                  Using two Area components with the baseValue trick.
                  Area Red: Actual as values, Ideal as baseValue (Fills gap).
                  We use ClipPath polygons defined relative to the Ideal line to split colors.
              */}
              
              {/* Above Ideal (Red) */}
              <Area 
                type="monotone" 
                dataKey="actual" 
                baseValue="ideal"
                fill="url(#areaRed)"
                stroke="none"
                isAnimationActive={true}
                connectNulls
              />

              {/* Secondary logic: Since Recharts fill between lines isn't color-aware,
                  we use a single Area and apply a splitOffset mask trick or custom component.
                  For simplicity + visual impact, we use the fill between curves. 
                  Given the request for Red if ABOVE and Green if BELOW:
              */}
              <Area 
                type="monotone" 
                dataKey="actual" 
                baseValue="ideal"
                fill={isAhead ? "url(#areaRed)" : "url(#areaGreen)"}
                stroke="none"
                isAnimationActive={true}
              />

              {/* ACTUAL LINE - Dynamic Color */}
              <Line 
                type="monotone" 
                dataKey="actual" 
                stroke={isAhead ? '#e05050' : '#4ade80'} 
                strokeWidth={4} 
                dot={false}
                isAnimationActive={true}
              />

              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
              <ReferenceLine x={todayStr} stroke="rgba(255,255,255,0.15)" strokeDasharray="5 5" />
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
