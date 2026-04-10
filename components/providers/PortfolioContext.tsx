'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { Transaction, UserSettings, Holding, Quote, calcFee, calcTax, calcRawFee, calcRawTax } from '@/types'

interface PortfolioStats {
  holdings: Holding[]
  allTimeRealized: number
  totalRealizedCostBasis: number
  yearlyRealized: number
  yearlyRealizedCostBasis: number
  totalBuyCost: number // Currently held shares cost
  historyBuyCost: number // Sum of all historical buy costs (FIFO matched)
  totalNetMV: number
  totalUnrealizedPnl: number
  yearlyUnrealizedPnl: number
  totalPnl: number
  pnlPct: number
  // Raw stats for components to derive filtered views
  inventory: Record<string, any[]>
  fullHistoryStats: Record<string, any>
}


interface PortfolioContextType {
  stats: PortfolioStats
  settings: UserSettings
  quotes: Record<string, Quote>
  loading: boolean
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined)

export function PortfolioProvider({ 
  children, 
  transactions, 
  quotes, 
  settings 
}: { 
  children: React.ReactNode, 
  transactions: Transaction[], 
  quotes: Record<string, Quote>, 
  settings: UserSettings 
}) {
  const [snapshotQuotes, setSnapshotQuotes] = React.useState<Record<string, any>>({})
  
  // Back-calculate 12/31 Snapshot prices
  React.useEffect(() => {
    const lastYearStr = (new Date().getFullYear() - 1).toString()
    const targetDate = `${lastYearStr}-12-31`
    const syms = Array.from(new Set(transactions.map(t => t.symbol)))
    if (syms.length) {
      fetch(`/api/stocks?symbols=${syms.join(',')}&date=${targetDate}`)
        .then(res => res.json())
        .then(data => setSnapshotQuotes(data))
        .catch(console.error)
    }
  }, [transactions])

  const stats = useMemo(() => {
    const inventory: Record<string, any[]> = {}

    const fullHistoryStats: Record<string, any> = {}
    let allTimeRealized = 0
    let totalRealizedCostBasis = 0
    let yearlyRealized = 0
    let yearlyRealizedCostBasis = 0
    let historyBuyTotal = 0 // Used for ROI denominator (matched history)
    
    // Yearly snapshot tracking
    const lastYearStr = (new Date().getFullYear() - 1).toString()
    const yearEndDate = `${lastYearStr}-12-31`
    const currentYear = new Date().getFullYear().toString()
    let yearEndUnrealizedSnapshot = 0

    const sorted = [...transactions].sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
      return a.id - b.id
    })

    // Helper for FIFO cost logic
    const getInventoryAtDate = (date: string) => {
      // Create a deep copy of inventory up to that date
      // This is a bit expensive, but necessary for back-calculation accuracy
      // We'll optimize by doing it only once for yearEnd.
      return JSON.parse(JSON.stringify(inventory))
    }

    const processTx = (tx: Transaction, isSnapshotPass = false) => {
      if (!fullHistoryStats[tx.symbol]) fullHistoryStats[tx.symbol] = { buy: 0, sell: 0, realized: 0, fee: 0, tax: 0, count: 0, history: [] }
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      
      const lots = inventory[tx.symbol]
      const stock = fullHistoryStats[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const rawPrincipal = tx.shares * tx.price
        const rawFee = calcRawFee(tx.shares, tx.price, settings, false, isDca)
        
        // Single-Exit Rounding for initial lot cost
        const total = Math.round(rawPrincipal + rawFee)
        
        lots.push({ 
          shares: tx.shares, 
          price: tx.price, 
          principal: rawPrincipal, 
          rawFee: rawFee, 
          origShares: tx.shares, 
          date: tx.trade_date, 
          id: tx.id, 
          total_cost: total 
        })

        if (!isSnapshotPass) stock.history.push({ ...tx, type: 'BUY', fee: Math.round(rawFee), net: -total })

      } else if (tx.action === 'SELL') {
        const rf_sell = calcRawFee(tx.shares, tx.price, settings, true)
        const rt_sell = calcRawTax(tx.shares, tx.price, tx.symbol, settings)
        
        // Single-Exit Rounding for sell proceeds
        const sellNet = Math.round((tx.shares * tx.price) - rf_sell - rt_sell)
        
        let sellRem = tx.shares
        let matchedBuyCostTotal = 0
        let matchedBuyFeeTotal = 0
        const matches = []

        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)
          const ratio = take / lot.shares
          
          const matchedPrincipal = lot.principal * ratio
          const matchedRawFee = lot.rawFee * ratio
          
          // Single-Exit Rounding for matched buy cost
          const matchedBuyCostInt = Math.round(matchedPrincipal + matchedRawFee)
          
          // Single-Exit Rounding for matched sell part
          const ratioSell = take / tx.shares
          const rawPartGross = (tx.shares * tx.price) * ratioSell
          const rawPartFee = rf_sell * ratioSell
          const rawPartTax = rt_sell * ratioSell
          const matchedSellNetPart = Math.round(rawPartGross - rawPartFee - rawPartTax)

          matchedBuyCostTotal += matchedBuyCostInt
          matchedBuyFeeTotal += Math.round(matchedRawFee)

          matches.push({ 
            date: lot.date, 
            sellDate: tx.trade_date,
            shares: take, 
            buyPrice: lot.price, 
            buyCost: matchedBuyCostInt,
            sellPrice: tx.price,
            sellNet: matchedSellNetPart
          })

          lot.shares -= take
          lot.principal -= matchedPrincipal
          lot.rawFee -= matchedRawFee
          // Maintain total_cost integrity if partial remains
          lot.total_cost = Math.round(lot.principal + lot.rawFee)
          
          sellRem -= take
          if (lot.shares <= 0) lots.shift()
        }

        const profit = sellNet - matchedBuyCostTotal

        if (!isSnapshotPass) {
          historyBuyTotal += matchedBuyCostTotal
          allTimeRealized += profit
          totalRealizedCostBasis += matchedBuyCostTotal

          if (tx.trade_date.startsWith(currentYear)) {
            yearlyRealized += profit
            yearlyRealizedCostBasis += matchedBuyCostTotal
          }

          stock.buy += matchedBuyCostTotal
          stock.sell += sellNet
          stock.fee += (matchedBuyFeeTotal + Math.round(rf_sell))
          stock.tax += Math.round(rt_sell)
          stock.realized += profit
          stock.count++
          stock.history.push({ 
            ...tx, 
            type: 'SELL', 
            matches, 
            profit, 
            net: sellNet, 
            realizedCost: matchedBuyCostTotal, 
            fee: Math.round(rf_sell), 
            tax: Math.round(rt_sell), 
            matchedBuyFee: matchedBuyFeeTotal 
          })
        }
      }
    }

    // Run calculation
    for (const tx of sorted) {
      processTx(tx)
    }

    // Capture Year-End Snapshot correctly (re-run logic to ensure parity)
    const tempInv: Record<string, any[]> = {}
    sorted.forEach(t => {
      if (t.trade_date <= yearEndDate) {
        if (!tempInv[t.symbol]) tempInv[t.symbol] = []
        const lots = tempInv[t.symbol]
        if (t.action === 'BUY' || t.action === 'DCA') {
          const isDca = t.action === 'DCA' || t.trade_type === 'DCA'
          const rawPrincipal = t.shares * t.price
          const rawFee = calcRawFee(t.shares, t.price, settings, false, isDca)
          lots.push({ shares: t.shares, principal: rawPrincipal, rawFee: rawFee })
        } else if (t.action === 'SELL') {
          let rem = t.shares
          while (rem > 0 && lots.length > 0) {
            const take = Math.min(lots[0].shares, rem)
            const ratio = take / lots[0].shares
            lots[0].shares -= take
            lots[0].principal -= (lots[0].principal * ratio)
            lots[0].rawFee -= (lots[0].rawFee * ratio)
            rem -= take
            if (lots[0].shares <= 0) lots.shift()
          }
        }
      }
    })

    // Calculate Snapshot Unrealized PnL strictly via Single-Exit
    Object.entries(tempInv).forEach(([sym, lots]) => {
      const q = snapshotQuotes[sym]
      const cp = q?.price || 0
      if (cp > 0) {
        lots.forEach(l => {
          const rawBuyCost = l.principal + l.rawFee
          const buyCostRounded = Math.round(rawBuyCost)
          
          const rawMv = cp * l.shares
          const rawSfee = calcRawFee(l.shares, cp, settings, true)
          const rawStax = calcRawTax(l.shares, cp, sym, settings)
          const netMvRounded = Math.round(rawMv - rawSfee - rawStax)
          
          yearEndUnrealizedSnapshot += (netMvRounded - buyCostRounded)
        })
      }
    })

    // Process Active Holdings with Discrete Summation
    const hList = Object.entries(inventory)
      .flatMap(([sym, lots]) => {
        const netShares = lots.reduce((s, l) => s + l.shares, 0)
        if (netShares <= 0) return []
        
        const q = quotes[sym]
        const cp = q?.price || 0
        
        // Per-lot detail calculation for visual parity (Discrete Summation)
        const lotDetails = lots.map(l => {
          const rawMv = cp * l.shares
          const rawSfee = calcRawFee(l.shares, cp, settings, true)
          const rawStax = calcRawTax(l.shares, cp, sym, settings)
          
          const roundedNetMV = Math.round(rawMv - rawSfee - rawStax)
          const roundedCost = Math.round(l.principal + l.rawFee)
          
          return {
            ...l,
            market_value: Math.round(rawMv),
            net_market_value: roundedNetMV,
            total_cost: roundedCost,
            unrealized_pnl: roundedNetMV - roundedCost
          }
        })

        const summedNetMV = lotDetails.reduce((s, ld) => s + ld.net_market_value, 0)
        const summedCost = lotDetails.reduce((s, ld) => s + ld.total_cost, 0)
        const upnl = summedNetMV - summedCost

        return [{
          symbol: sym,
          shares: netShares,
          avg_cost: summedCost / netShares,
          total_cost: summedCost,
          current_price: cp,
          market_value: Math.round(cp * netShares),
          net_market_value: summedNetMV,
          sell_fee: lotDetails.reduce((s, ld) => s + Math.round(calcRawFee(ld.shares, cp, settings, true)), 0),
          sell_tax: lotDetails.reduce((s, ld) => s + Math.round(calcRawTax(ld.shares, cp, sym, settings)), 0),
          unrealized_pnl: upnl,
          pnl_pct: summedCost ? (upnl / summedCost) * 100 : 0,
          lots: lotDetails,
        }]
      })


    // Final Aggregation: Total = Sum(Rounded Parts)
    const totalBuyCost = hList.reduce((s, h) => s + h.total_cost, 0)
    const totalNetMV = hList.reduce((s, h) => s + h.net_market_value, 0)
    const totalUnrealizedPnl = hList.reduce((s, h) => s + h.unrealized_pnl, 0)
    const yearlyUnrealizedPnl = totalUnrealizedPnl // Since it's all based on current state

    // 總體損益：總未實現損益 + 總已實現損益
    let filteredAllTimeRealized = 0
    if (settings.total_goal_start_date) {
      Object.values(fullHistoryStats).forEach((s: any) => {
        s.history.forEach((h: any) => {
          if (h.type === 'SELL' && h.trade_date >= settings.total_goal_start_date) {
            filteredAllTimeRealized += (h.profit || 0)
          }
        })
      })
    } else {
      filteredAllTimeRealized = allTimeRealized
    }

    const totalPnl = totalUnrealizedPnl + filteredAllTimeRealized

    return {
      holdings: hList,
      allTimeRealized: filteredAllTimeRealized,
      totalRealizedCostBasis,
      yearlyRealized,
      yearlyRealizedCostBasis,
      totalBuyCost,
      historyBuyCost: historyBuyTotal,
      totalNetMV,
      totalUnrealizedPnl,
      yearlyUnrealizedPnl,
      totalPnl,
      pnlPct: historyBuyTotal ? (totalPnl / historyBuyTotal) * 100 : (totalBuyCost ? (totalPnl / totalBuyCost) * 100 : 0),
      inventory,
      fullHistoryStats
    }
  }, [transactions, quotes, settings, snapshotQuotes])


  return (
    <PortfolioContext.Provider value={{ stats, settings, quotes, loading: false }}>
      {children}
    </PortfolioContext.Provider>
  )
}

export function usePortfolio() {
  const context = useContext(PortfolioContext)
  if (context === undefined) {
    throw new Error('usePortfolio must be used within a PortfolioProvider')
  }
  return context
}
