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
        const p = Math.round(tx.amount)
        const rf = calcRawFee(tx.shares, tx.price, settings, false, isDca)
        const total = Math.round(p + rf)
        lots.push({ 
          shares: tx.shares, 
          price: tx.price, 
          principal: p, 
          rawFee: rf, 
          origShares: tx.shares, 
          date: tx.trade_date, 
          id: tx.id, 
          total_cost: total 
        })

        if (!isSnapshotPass) stock.history.push({ ...tx, type: 'BUY', fee: Math.round(rf), net: -total })

      } else if (tx.action === 'SELL') {
        const f = calcFee(tx.shares, tx.price, settings, true)
        const t = calcTax(tx.shares, tx.price, tx.symbol, settings)
        const sellProceeds = Math.round(tx.amount - f - t)
        
        let sellRem = tx.shares
        let matchedBuyCostTotal = 0
        let matchedBuyFeeTotal = 0
        const matches = []

        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)
          
          let matchedPrincipal = 0
          let matchedRawFee = 0
          
            if (take === lot.shares) {
              matchedPrincipal = lot.principal
              matchedRawFee = (lot.rawFee || lot.fee || 0)
            } else {
              const ratio = take / lot.shares
              matchedPrincipal = lot.principal * ratio // Keep as floating point for now
              matchedRawFee = (lot.rawFee || lot.fee || 0) * ratio
            }

          // Single Exit Rounding for matched buy cost
          const matchedBuyCostInt = Math.round(matchedPrincipal + matchedRawFee)
          
          // Single Exit Rounding for matched sell net
          const ratioSell = take / tx.shares
          const rawSellGross = tx.amount * ratioSell
          const rawSellFee = f * ratioSell
          const rawSellTax = t * ratioSell
          const matchedSellNet = Math.round(rawSellGross - rawSellFee - rawSellTax)

          matchedBuyCostTotal += matchedBuyCostInt
          matchedBuyFeeTotal += Math.round(matchedRawFee)

          matches.push({ 
            date: lot.date, 
            sellDate: tx.trade_date,
            shares: take, 
            buyPrice: lot.price, 
            buyCost: matchedBuyCostInt,
            sellPrice: tx.price,
            sellNet: matchedSellNet
          })

          lot.shares -= take
          lot.principal -= matchedPrincipal
          lot.fee -= matchedFee
          sellRem -= take


          if (lot.shares <= 0) lots.shift()
        }

        const realizedCost = Math.round(matchedBuyCostTotal)
        const profit = sellProceeds - realizedCost

        if (!isSnapshotPass) {
          historyBuyTotal += realizedCost
          allTimeRealized += profit
          totalRealizedCostBasis += realizedCost

          if (tx.trade_date.startsWith(currentYear)) {
            yearlyRealized += profit
            yearlyRealizedCostBasis += realizedCost
          }

          stock.buy += realizedCost
          stock.sell += sellProceeds
          stock.fee += (matchedBuyFeeTotal + f)
          stock.tax += t
          stock.realized += profit
          stock.count++
          stock.history.push({ ...tx, type: 'SELL', matches, profit, net: sellProceeds, realizedCost, fee: f, tax: t, matchedBuyFee: matchedBuyFeeTotal })
        }

      }
    }

    // Run calculation
    for (const tx of sorted) {
      processTx(tx)
      // Check if we just crossed the year-end mark to capture snapshot
      if (tx.trade_date <= yearEndDate) {
        // We could capture here, but we need final state of inventory at yearEnd
      }
    }

    // Capture Year-End Snapshot correctly
    // 1. Re-calculate inventory strictly up to year-end
    const yearEndInventory: Record<string, any[]> = {}
    const tempInv: Record<string, any[]> = {}
    sorted.forEach(t => {
      if (t.trade_date <= yearEndDate) {
        if (!tempInv[t.symbol]) tempInv[t.symbol] = []
        const lots = tempInv[t.symbol]
        if (t.action === 'BUY' || t.action === 'DCA') {
          const f = calcFee(t.shares, t.price, settings, false, t.action === 'DCA' || t.trade_type === 'DCA')
          lots.push({ shares: t.shares, principal: Math.floor(t.amount), fee: f })
        } else if (t.action === 'SELL') {

          let rem = t.shares
          while (rem > 0 && lots.length > 0) {
            const take = Math.min(lots[0].shares, rem)
            lots[0].shares -= take
            rem -= take
            if (lots[0].shares <= 0) lots.shift()
          }
        }
      }
    })

    // Calculate Snapshot Unrealized PnL
    Object.entries(tempInv).forEach(([sym, lots]) => {
      const netShares = lots.reduce((s, l) => s + l.shares, 0)
      if (netShares > 0) {
        const totalCost = lots.reduce((s, l) => s + (l.principal + l.fee), 0)
        const q = snapshotQuotes[sym]
        const cp = q?.price || 0
        const mv = Math.floor(cp * netShares)
        const s_fee = calcFee(netShares, cp, settings, true)
        const s_tax = calcTax(netShares, cp, sym, settings)
        const net_mv = Math.floor(mv - s_fee - s_tax)
        yearEndUnrealizedSnapshot += (net_mv - totalCost)
      }
    })

    // Process Active Holdings
    const hList = Object.entries(inventory)
      .flatMap(([sym, lots]) => {
        const netShares = lots.reduce((s, l) => s + l.shares, 0)
        if (netShares <= 0) return []
        
        const totalCost = lots.reduce((s, l) => s + (l.principal + l.fee), 0)
        const q = quotes[sym]
        const cp = q?.price || 0
        const mv = Math.round(cp * netShares)
        const sell_fee = Math.round(calcFee(netShares, cp, settings, true))
        const sell_tax = Math.round(calcTax(netShares, cp, sym, settings))
        const net_mv = Math.floor(mv - sell_fee - sell_tax)
        
        // Per-lot detail calculation for visual parity
        const lotDetails = lots.map(l => {
          const l_mv = cp * l.shares
          const l_raw_sell_fee = calcRawFee(l.shares, cp, settings, true)
          const l_raw_sell_tax = calcRawTax(l.shares, cp, sym, settings)
          
          const l_net_mv = Math.round(l_mv - l_raw_sell_fee - l_raw_sell_tax)
          const l_cost = Math.round(l.principal + (l.rawFee || l.fee || 0))
          
          return {
            ...l,
            market_value: Math.round(l_mv), // Standardize MV for display
            net_market_value: l_net_mv,
            total_cost: l_cost,
            unrealized_pnl: l_net_mv - l_cost
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
          market_value: Math.round(mv),
          net_market_value: summedNetMV,
          sell_fee,
          sell_tax,
          unrealized_pnl: upnl,
          pnl_pct: summedCost ? (upnl / summedCost) * 100 : 0,
          lots: lotDetails,
        }]
      })



    const totalBuyCost = hList.reduce((s, h) => s + h.total_cost, 0)
    const totalNetMV = hList.reduce((s, h) => s + h.net_market_value, 0)
    const totalUnrealizedPnl = hList.reduce((s, h) => s + h.unrealized_pnl, 0)
    const yearlyUnrealizedPnl = totalUnrealizedPnl


    // 總體損益：總未實現損益 + 總已實現損益 (若設定了總目標起始日，則過濾已實現部分)
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
