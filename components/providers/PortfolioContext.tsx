'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { Transaction, UserSettings, Holding, Quote, calcFee, calcTax } from '@/types'

interface PortfolioStats {
  holdings: Holding[]
  allTimeRealized: number
  totalBuyCost: number
  totalNetMV: number
  totalUnrealizedPnl: number
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
  
  const stats = useMemo(() => {
    const inventory: Record<string, { shares: number; principal: number; fee: number; origShares: number; date: string; id: number }[]> = {}
    const fullHistoryStats: Record<string, any> = {}
    let allTimeRealized = 0
    let totalBuyTotal = 0 // Used for ROI denominator

    const sorted = [...transactions].sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
      return a.id - b.id
    })

    for (const tx of sorted) {
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      if (!fullHistoryStats[tx.symbol]) fullHistoryStats[tx.symbol] = { buy: 0, sell: 0, realized: 0, fee: 0, tax: 0, count: 0, history: [] }
      
      const lots = inventory[tx.symbol]
      const stock = fullHistoryStats[tx.symbol]

      if (tx.action === 'BUY' || tx.action === 'DCA') {
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        lots.push({ shares: tx.shares, principal: tx.amount, fee: f, origShares: tx.shares, date: tx.trade_date, id: tx.id })
        totalBuyTotal += (tx.amount + f)
        stock.history.push({ ...tx, type: 'BUY', net: -Math.floor(tx.amount + f) })
      } else if (tx.action === 'SELL') {
        const f = calcFee(tx.amount, settings, true)
        const t = calcTax(tx.amount, tx.symbol, settings)
        const sellProceeds = Math.floor(tx.amount - f - t)
        
        let sellRem = tx.shares
        let matchedBuyCostTotal = 0
        let matchedBuyFeeTotal = 0
        const matches = []

        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)
          
          let matchedPrincipal = 0
          let matchedFee = 0
          
          if (take === lot.shares) {
            matchedPrincipal = lot.principal
            matchedFee = lot.fee
          } else {
            const ratio = take / lot.shares
            matchedPrincipal = Math.floor(lot.principal * ratio)
            matchedFee = Math.floor(lot.fee * ratio)
          }

          matchedBuyCostTotal += (matchedPrincipal + matchedFee)
          matchedBuyFeeTotal += matchedFee
          matches.push({ date: lot.date, shares: take })

          lot.shares -= take
          lot.principal -= matchedPrincipal
          lot.fee -= matchedFee
          sellRem -= take

          if (lot.shares <= 0) lots.shift()
        }

        const realizedCost = Math.round(matchedBuyCostTotal)
        const profit = sellProceeds - realizedCost
        allTimeRealized += profit

        stock.buy += realizedCost
        stock.sell += sellProceeds
        stock.fee += (matchedBuyFeeTotal + f)
        stock.tax += t
        stock.realized += profit
        stock.count++
        stock.history.push({ ...tx, type: 'SELL', matches, profit, net: sellProceeds, realizedCost })
      }
    }

    // Process Active Holdings
    const hList: Holding[] = Object.entries(inventory)
      .map(([sym, lots]) => {
        const netShares = lots.reduce((s, l) => s + l.shares, 0)
        if (netShares <= 0) return null
        
        // Holding cost must be proportional
        const totalCost = lots.reduce((s, l) => s + (l.principal + l.fee), 0)
        const q = quotes[sym]
        const cp = q?.bid_price || q?.price || 0
        const mv = Math.floor(cp * netShares)
        const sell_fee = calcFee(mv, settings, true)
        const sell_tax = calcTax(mv, sym, settings)
        const net_mv = Math.floor(mv - sell_fee - sell_tax)
        const upnl = net_mv - totalCost

        return {
          symbol: sym,
          shares: netShares,
          avg_cost: totalCost / netShares,
          total_cost: Math.round(totalCost),
          current_price: cp,
          market_value: mv,
          net_market_value: net_mv,
          sell_fee,
          sell_tax,
          unrealized_pnl: Math.round(upnl),
          pnl_pct: totalCost ? (upnl / totalCost) * 100 : 0,
        }
      })
      .filter((h): h is Holding => h !== null)

    const totalBuyCost = hList.reduce((s, h) => s + h.total_cost, 0)
    const totalNetMV = hList.reduce((s, h) => s + h.net_market_value, 0)
    const totalUnrealizedPnl = hList.reduce((s, h) => s + h.unrealized_pnl, 0)
    const totalPnl = totalUnrealizedPnl + allTimeRealized

    return {
      holdings: hList,
      allTimeRealized,
      totalBuyCost,
      totalNetMV,
      totalUnrealizedPnl,
      totalPnl,
      pnlPct: totalBuyTotal ? (totalPnl / totalBuyTotal) * 100 : 0,
      inventory,
      fullHistoryStats
    }
  }, [transactions, quotes, settings])

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
