'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { Transaction, UserSettings, Holding, Quote } from '@/types'
import { calculateTxParts } from '@/utils/calculations'

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
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined)

interface PortfolioProviderProps {
  children: React.ReactNode
  transactions: Transaction[]
  quotes: Record<string, Quote>
  settings: UserSettings
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>
}

export function PortfolioProvider({ 
  children, 
  transactions, 
  quotes, 
  settings,
  updateSettings
}: PortfolioProviderProps) {
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
        // 使用資料庫已計算好的 net_amount（已取整），避免 DCA 小數點金額累積誤差
        const gross = tx.amount
        const fee = tx.fee
        const absNet = Math.round(-tx.net_amount)

        lots.push({
          shares: tx.shares,
          price: tx.price,
          principal: gross,
          rawFee: fee,
          origShares: tx.shares,
          date: tx.trade_date,
          id: tx.id,
          total_cost: absNet
        })

        if (!isSnapshotPass) {
          stock.fee += fee
          stock.history.push({ ...tx, type: 'BUY', fee, net: -absNet })
        }

      } else if (tx.action === 'SELL') {
        // 使用資料庫實際記錄的手續費與稅，確保損益與紀錄頁面完全對齊
        const fee_sell = tx.fee
        const tax_sell = tx.tax
        const net_sell = tx.net_amount
        
        const totalSharesBefore = lots.reduce((s, l) => s + l.shares, 0)
        const totalCostBefore = lots.reduce((s, l) => s + l.total_cost, 0)
        const avgCostBefore = totalSharesBefore > 0 ? totalCostBefore / totalSharesBefore : 0
        const isSellingAll = tx.shares === totalSharesBefore

        let sellRem = tx.shares
        let sellProceedsRemaining = net_sell
        let matchedBuyCostTotal = 0
        let matchedBuyFeeTotal = 0
        let matchedSellNetTotal = 0
        const matches = []

        while (sellRem > 0 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, sellRem)

          // When selling all shares, last portion uses exact remainder to avoid floor rounding
          const mBuyCost = (isSellingAll && take === sellRem)
            ? totalCostBefore - matchedBuyCostTotal
            : Math.floor(take * avgCostBefore)
            
          const mBuyFee = take === lot.shares
            ? lot.rawFee
            : Math.floor(lot.rawFee * (take / lot.shares))
          
          const mSellNet = take === sellRem
            ? sellProceedsRemaining
            : Math.floor(net_sell * (take / tx.shares))

          matchedBuyCostTotal += mBuyCost
          matchedBuyFeeTotal += mBuyFee
          matchedSellNetTotal += mSellNet
          sellProceedsRemaining -= mSellNet

          matches.push({ 
            date: lot.date, 
            sellDate: tx.trade_date,
            shares: take, 
            buyPrice: lot.price, 
            buyCost: mBuyCost,
            sellPrice: tx.price,
            sellNet: mSellNet
          })

          lot.shares -= take
          lot.total_cost -= mBuyCost
          
          sellRem -= take
          if (lot.shares <= 0) lots.shift()
        }

        const profit = matchedSellNetTotal - matchedBuyCostTotal

        if (!isSnapshotPass) {
          historyBuyTotal += matchedBuyCostTotal
          allTimeRealized += profit
          totalRealizedCostBasis += matchedBuyCostTotal

          if (tx.trade_date.startsWith(currentYear)) {
            yearlyRealized += profit
            yearlyRealizedCostBasis += matchedBuyCostTotal
          }

          stock.buy += matchedBuyCostTotal
          stock.sell += matchedSellNetTotal
          stock.fee += fee_sell
          stock.tax += tax_sell
          stock.realized += profit
          stock.count++
          stock.history.push({
            ...tx,
            type: 'SELL',
            matches,
            profit,
            net: matchedSellNetTotal,
            realizedCost: matchedBuyCostTotal,
            fee: fee_sell,
            tax: tax_sell,
            matchedBuyFee: matchedBuyFeeTotal
          })
        }

      } else if (tx.action === 'DIVIDEND') {
        // 國泰除息成本調降：新平均成本 = (舊平均成本 × 持股 − 配息金額) ÷ 持股
        const dividendTotal = Math.floor(tx.shares * tx.price)
        const totalShares = lots.reduce((s, l) => s + l.shares, 0)
        if (totalShares > 0 && dividendTotal > 0) {
          let remaining = dividendTotal
          lots.forEach((l, i) => {
            if (i === lots.length - 1) {
              l.total_cost = Math.max(0, l.total_cost - remaining)
            } else {
              const reduction = Math.floor(dividendTotal * (l.shares / totalShares))
              l.total_cost = Math.max(0, l.total_cost - reduction)
              remaining -= reduction
            }
          })
        }
        if (!isSnapshotPass) {
          stock.history.push({ ...tx, type: 'DIVIDEND', dividendTotal })
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
          lots.push({ shares: t.shares, total_cost: Math.round(-t.net_amount) })
        } else if (t.action === 'SELL') {
          const totalSharesBefore = lots.reduce((s, l) => s + l.shares, 0)
          const totalCostBefore = lots.reduce((s, l) => s + l.total_cost, 0)
          const avgCostBefore = totalSharesBefore > 0 ? totalCostBefore / totalSharesBefore : 0
          const isSellingAll = t.shares === totalSharesBefore
          let buyCostAllocated = 0

          let rem = t.shares
          while (rem > 0 && lots.length > 0) {
            const take = Math.min(lots[0].shares, rem)
            const mBuyCost = (isSellingAll && take === rem)
              ? totalCostBefore - buyCostAllocated
              : Math.floor(take * avgCostBefore)
            buyCostAllocated += mBuyCost
            lots[0].shares -= take
            lots[0].total_cost -= mBuyCost
            rem -= take
            if (lots[0].shares <= 0) lots.shift()
          }
        } else if (t.action === 'DIVIDEND') {
          const dividendTotal = Math.floor(t.shares * t.price)
          const totalSharesBefore = lots.reduce((s, l) => s + l.shares, 0)
          if (totalSharesBefore > 0 && dividendTotal > 0) {
            let remaining = dividendTotal
            lots.forEach((l, i) => {
              if (i === lots.length - 1) {
                l.total_cost = Math.max(0, l.total_cost - remaining)
              } else {
                const reduction = Math.floor(dividendTotal * (l.shares / totalSharesBefore))
                l.total_cost = Math.max(0, l.total_cost - reduction)
                remaining -= reduction
              }
            })
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
          const lotCostRounded = l.total_cost
              const { absNet: netMvRounded } = calculateTxParts(l.shares, cp, 'SELL', sym, settings)
          yearEndUnrealizedSnapshot += (netMvRounded - lotCostRounded)
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
        
        // Aggregate Position Estimation (Source of Truth for Brokerage Parity)
        const { gross: totalGross, absNet: totalNetMV, fee: totalSellFee, tax: totalSellTax } = calculateTxParts(netShares, cp, 'SELL', sym, settings)
        
        // Per-lot detail calculation
        // 持有成本依原始買入紀錄比例計算：shares/origShares × (買入金額+手續費)
        // 等同「直接把手持紀錄加起來」，避免 WAC 跨批次分攤造成的高估
        const lotDetails = lots.map(l => {
          const { gross, absNet, fee, tax } = calculateTxParts(l.shares, cp, 'SELL', sym, settings)
          const roundedCost = l.total_cost

          return {
            ...l,
            market_value: gross,
            net_market_value: gross,
            total_cost: roundedCost,
            unrealized_pnl: gross - roundedCost,
            sell_fee: fee,
            sell_tax: tax
          }
        })

        const summedCost = lotDetails.reduce((s, ld) => s + ld.total_cost, 0)
        const upnl = totalGross - summedCost

        return [{
          symbol: sym,
          shares: netShares,
          avg_cost: summedCost / netShares,
          total_cost: summedCost,
          current_price: cp,
          market_value: totalGross,
          net_market_value: totalGross,
          sell_fee: totalSellFee,
          sell_tax: totalSellTax,
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
      allTimeRealized: allTimeRealized,
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
    <PortfolioContext.Provider value={{ stats, settings, quotes, loading: false, updateSettings }}>
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
