'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import DatePicker from './DatePicker'
import { Transaction, UserSettings, calculateTxParts, fmtMoney } from '@/types'
import ErrorBoundary from './ErrorBoundary'
import ProgressChart from './ProgressChart'

interface Props {
  transactions: Transaction[]
  settings: UserSettings
}

type TotalRange = '1M' | '6M' | '1Y' | '3Y' | '5Y' | 'CUSTOM'

function TotalGoalChartContent({ transactions, settings }: Props) {
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  
  const [range, setRange] = useState<TotalRange>('1Y')
  const [showCustom, setShowCustom] = useState(false)
  
  const startDateStr = settings.total_goal_start_date || new Date().toISOString().split('T')[0]
  const todayStr = new Date().toISOString().split('T')[0]

  const [customStart, setCustomStart] = useState(startDateStr)
  const [customEnd, setCustomEnd] = useState(todayStr)

  const relevantSymbols = useMemo(() => {
    const syms = new Set<string>()
    transactions.forEach(t => { if (t?.symbol) syms.add(t.symbol) })
    return Array.from(syms)
  }, [transactions])

  // Fetch full history for all relevant symbols
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
          // Fetch up to 5 years of history
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
    if (loading || !transactions.length) return []
    
    // 1. Determine Window
    let rangeStart: Date
    let rangeEnd: Date
    
    const baseStart = new Date(startDateStr)
    const now = new Date(todayStr)

    if (range === 'CUSTOM') {
      rangeStart = new Date(customStart)
      rangeEnd = new Date(customEnd)
    } else {
      rangeStart = new Date(baseStart)
      // Range End depends on selection
      rangeEnd = new Date(baseStart)
      if (range === '1M') rangeEnd.setMonth(rangeEnd.getMonth() + 1)
      else if (range === '6M') rangeEnd.setMonth(rangeEnd.getMonth() + 6)
      else if (range === '1Y') rangeEnd.setFullYear(rangeEnd.getFullYear() + 1)
      else if (range === '3Y') rangeEnd.setFullYear(rangeEnd.getFullYear() + 3)
      else if (range === '5Y') rangeEnd.setFullYear(rangeEnd.getFullYear() + 5)
    }

    // Optimization: Pre-calculate daily balances using transaction ledger
    const sortedTxs = [...transactions]
      .filter(t => t?.trade_date)
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let inventory: Record<string, any[]> = {}
    let cumulativeRealizedOverall = 0
    let txIdx = 0
    
    // Skip transactions BEFORE rangeStart but update state accordingly
    while (txIdx < sortedTxs.length && sortedTxs[txIdx].trade_date < rangeStart.toISOString().split('T')[0]) {
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
          cumulativeRealizedOverall += (mSellNet - mBuyCost)
          sellProceedsRemaining -= mSellNet
          lot.shares -= take
          lot.cost -= mBuyCost
          rem -= take
          if (lot.shares <= 0) inventory[t.symbol].shift()
        }
      }
      txIdx++
    }

    const rawDays: any[] = []
    const lastPriceMap: Record<string, number> = {}
    const stockHistoryPointers: Record<string, number> = {}
    relevantSymbols.forEach(s => {
      stockHistoryPointers[s] = 0
      const hist = historyData[s] || []
      lastPriceMap[s] = hist.length > 0 ? (hist[0].price || 0) : 0
    })

    const durationDays = (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24) || 1

    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
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
              cumulativeRealizedOverall += (mSellNet - mBuyCost)
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

      let unrealizedOverall = 0
      Object.entries(inventory).forEach(([sym, lots]) => {
        const netShares = lots.reduce((s, l) => s + l.shares, 0)
        if (netShares <= 0) return
        const q = lastPriceMap[sym] || 0
        const { absNet: totalNetMV } = calculateTxParts(netShares, q, 'SELL', sym, settings)
        const totalCost = lots.reduce((s, l) => s + l.cost, 0)
        unrealizedOverall += (totalNetMV - totalCost)
      })

      const dayIdx = rawDays.length
      const idealPnL = (dayIdx / durationDays) * (settings?.total_goal || 0)
      const actualPnL = isFuture ? null : (cumulativeRealizedOverall + unrealizedOverall)
      
      rawDays.push({
        date: dStr,
        actual: actualPnL,
        ideal: idealPnL,
        isFuture,
      })
    }
    return rawDays
  }, [transactions, historyData, loading, settings, range, customStart, customEnd, startDateStr, todayStr, relevantSymbols])

  const currentValue = Math.round(chartData.findLast(d => d.actual !== null)?.actual || 0)

  return (
    <div className="space-y-6">
      <div className="px-4 flex flex-col gap-4 relative z-20">
        <div className="flex w-full gap-1.5 scrollbar-hide">
          {(['1M', '6M', '1Y', '3Y', '5Y'] as TotalRange[]).map(r => (
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
      </div>

      <ProgressChart 
        title="總目標進度"
        subtitle="當前累計總損益"
        data={chartData}
        goal={settings.total_goal}
        currentValue={currentValue}
        loading={loading}
        mode="single"
      />
    </div>
  )
}

export default function TotalGoalChart(props: Props) {
  return (
    <ErrorBoundary>
      <TotalGoalChartContent {...props} />
    </ErrorBoundary>
  )
}
