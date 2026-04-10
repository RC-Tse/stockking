'use client'

import { useMemo, useState, useEffect } from 'react'
import { 
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Transaction, UserSettings, fmtMoney, calcFee, calcTax } from '@/types'
import { TrendingUp, Target, Flame } from 'lucide-react'

interface Props {
  transactions: Transaction[]
  settings: UserSettings
}

export default function YearlyPnLChart({ transactions, settings }: Props) {
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)

  const currentYear = new Date().getFullYear()
  const yearStartStr = `${currentYear}-01-01`
  const lastYearEndStr = `${currentYear - 1}-12-31`
  const todayStr = new Date().toISOString().split('T')[0]

  // 1. Identify all symbols held or traded in the current year
  const relevantSymbols = useMemo(() => {
    const syms = new Set<string>()
    transactions.forEach(t => {
      syms.add(t.symbol)
    })
    return Array.from(syms)
  }, [transactions])

  // 2. Fetch history for all symbols
  useEffect(() => {
    if (relevantSymbols.length === 0) {
      setLoading(false)
      return
    }

    async function fetchAllHistory() {
      setLoading(true)
      const results: Record<string, any[]> = {}
      
      // Fetch in parallel
      await Promise.all(relevantSymbols.map(async (sym) => {
        try {
          const res = await fetch(`/api/stocks/info?symbol=${sym}&range=1y`)
          if (res.ok) {
            const data = await res.json()
            results[sym] = data.history || []
          }
        } catch (e) {
          console.error(`Failed to fetch history for ${sym}`, e)
        }
      }))
      
      setHistoryData(results)
      setLoading(false)
    }

    fetchAllHistory()
  }, [relevantSymbols])

  // 3. Data Pipeline: Incremental Build
  const chartData = useMemo(() => {
    if (loading) return []

    const days: any[] = []
    const start = new Date(`${currentYear}-01-01`)
    const end = new Date(`${currentYear}-12-31`)

    // Initialize state
    let inventory: Record<string, { shares: number, cost: number }[]> = {}
    let cumulativeRealized = 0

    // Sort transactions
    const sortedTxs = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    let txIdx = 0

    // --- PHASE 1: Pre-2026 Catch-up (Up to last year 12/31) ---
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
          const take = Math.min(lot.shares, rem)
          const lotCost = lot.cost
          const lotShares = lot.shares
          lot.cost -= (take / lotShares) * lotCost
          lot.shares -= take
          rem -= take
          if (lot.shares <= 0) inventory[t.symbol].shift()
        }
      }
      txIdx++
    }

    // --- PHASE 2: Calculate Baseline PnL at 12/31 ---
    let initialMV = 0
    let initialCost = 0
    Object.entries(inventory).forEach(([sym, lots]) => {
      const shares = lots.reduce((s, l) => s + l.shares, 0)
      const cost = lots.reduce((s, l) => s + l.cost, 0)
      if (shares > 0) {
        const hist = historyData[sym] || []
        const price = [...hist].reverse().find(p => p.date <= lastYearEndStr)?.price || 0
        initialMV += (shares * price)
        initialCost += cost
      }
    })
    const baselineTotalPnL = initialMV - initialCost + cumulativeRealized

    // --- PHASE 3: Annual Loop (1/1 to 12/31) ---
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
              const take = Math.min(lot.shares, rem)
              const takeCost = (take / lot.shares) * lot.cost
              matchedCost += takeCost
              lot.shares -= take
              lot.cost -= takeCost
              rem -= take
              if (lot.shares <= 0) inventory[t.symbol].shift()
            }
            cumulativeRealized += (sellProceeds - matchedCost)
          }
          txIdx++
        }
      }

      relevantSymbols.forEach(sym => {
        const hist = historyData[sym] || []
        let ptr = stockHistoryPointers[sym]
        while (ptr < hist.length && hist[ptr].date <= dStr) {
          lastPriceMap[sym] = hist[ptr].price
          ptr++
        }
        stockHistoryPointers[sym] = ptr
      })

      let currentMV = 0
      let currentCostBasis = 0
      Object.entries(inventory).forEach(([sym, lots]) => {
        const shares = lots.reduce((s, l) => s + l.shares, 0)
        const cost = lots.reduce((s, l) => s + l.cost, 0)
        if (shares > 0) {
          const price = lastPriceMap[sym] || 0
          currentMV += (shares * price)
          currentCostBasis += cost
        }
      })

      const totalPnL = currentMV - currentCostBasis + cumulativeRealized
      const dayIndex = days.length
      const idealPnL = (dayIndex / 365) * settings.year_goal

      days.push({
        date: dStr,
        actual: isFuture ? null : (totalPnL - baselineTotalPnL),
        ideal: idealPnL,
        isFuture,
        isMonthStart: d.getDate() === 1
      })
    }
    
    return days
  }, [transactions, historyData, loading, settings, currentYear, todayStr, relevantSymbols, yearStartStr, lastYearEndStr])

  const ticks = useMemo(() => chartData.filter(d => d.isMonthStart).map(d => d.date), [chartData])

  if (loading) return (
    <div className="h-[280px] flex items-center justify-center bg-[var(--bg-card)] rounded-[32px] border border-[var(--border-bright)]">
       <div className="flex flex-col items-center gap-2">
         <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
         <span className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest">初始化分析引擎...</span>
       </div>
    </div>
  )

  const CustomLegend = () => (
    <div className="flex justify-center gap-8 mb-2">
      <div className="flex items-center gap-2">
        <div className="w-5 h-0.5 bg-[#FFD700] rounded-full" />
        <span className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest">理想進度</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-0.5 w-5 rounded-full overflow-hidden">
          <div className="bg-[#e05050] flex-1" />
          <div className="bg-[#4ade80] flex-1" />
        </div>
        <span className="text-[10px] font-black text-[var(--t3)] uppercase tracking-widest">實際進度</span>
      </div>
    </div>
  )

  const lastActual = chartData.filter(d => !d.isFuture).pop()
  const currentActual = lastActual?.actual || 0
  const currentIdeal = lastActual?.ideal || 0
  const isAhead = currentActual >= currentIdeal

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center justify-between px-1">
        <h3 className="flex items-center gap-2 text-[13px] font-bold text-[var(--t2)] uppercase tracking-wider">
          <Flame size={16} className="text-orange-500 animate-pulse" /> 年度損益進度圖 (YTD)
        </h3>
        <div className="bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
           <span className="text-[10px] font-black text-[var(--t3)] uppercase mr-2">目標</span>
           <span className="text-[12px] font-mono font-black text-accent">{fmtMoney(settings.year_goal)}</span>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[32px] p-6 shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none group-hover:opacity-[0.08] transition-opacity duration-1000">
           <TrendingUp size={160} />
        </div>

        <CustomLegend />

        <div className="h-[260px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradientPnL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isAhead ? '#e05050' : '#4ade80'} stopOpacity={0.2}/>
                  <stop offset="95%" stopColor={isAhead ? '#e05050' : '#4ade80'} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis 
                dataKey="date" 
                ticks={ticks}
                tickFormatter={(v) => {
                  const d = new Date(v)
                  return `${d.getMonth() + 1}/1`
                }}
                tick={{fontSize: 9, fontWeight: 900, fill: 'var(--t3)'}}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload
                    if (data.isFuture) return null
                    const diff = data.actual - data.ideal
                    return (
                      <div className="glass p-4 border-white/10 shadow-2xl backdrop-blur-2xl">
                        <div className="text-[10px] text-[var(--t3)] font-black mb-3 uppercase tracking-widest">{data.date}</div>
                        <div className="space-y-2">
                          <div className="flex justify-between gap-10">
                            <span className="text-[11px] text-[var(--t2)] font-black">年度損益</span>
                            <span className={`text-[13px] font-mono font-black ${data.actual >= 0 ? 'text-[#e05050]' : 'text-[#4ade80]'}`}>
                              {fmtMoney(Math.round(data.actual))}
                            </span>
                          </div>
                          <div className="flex justify-between gap-10">
                            <span className="text-[11px] text-[var(--t2)] font-black">理想目標</span>
                            <span className="text-[13px] font-mono font-black text-[#FFD700]">
                              {fmtMoney(Math.round(data.ideal))}
                            </span>
                          </div>
                          <div className="pt-2 border-t border-white/5 flex justify-between gap-10">
                            <span className="text-[11px] text-[var(--t2)] font-black">{diff >= 0 ? '超標' : '落後'}</span>
                            <span className={`text-[13px] font-mono font-black ${diff >= 0 ? 'text-[#e05050]' : 'text-[#4ade80]'}`}>
                              {fmtMoney(Math.round(Math.abs(diff)))}
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
                type="monotone" 
                dataKey="ideal" 
                stroke="#FFD700" 
                strokeWidth={1.5} 
                dot={false} 
                strokeDasharray="4 4"
                isAnimationActive={false}
              />

              <Area
                type="monotone"
                dataKey="actual"
                stroke="none"
                fill="url(#gradientPnL)"
                isAnimationActive={true}
              />

              <Line 
                type="monotone" 
                dataKey="actual" 
                stroke={isAhead ? '#e05050' : '#4ade80'} 
                strokeWidth={2.5} 
                dot={false}
                isAnimationActive={true}
              />

              <ReferenceLine x={todayStr} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
