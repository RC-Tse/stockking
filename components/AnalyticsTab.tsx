'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, getStockName } from '@/types'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { TrendingUp, RefreshCw, Calendar as CalendarIcon } from 'lucide-react'
import DatePicker from './DatePicker'

interface Props {
  holdings: Holding[]
  transactions: Transaction[]
  settings: UserSettings
  quotes: Record<string, Quote>
}

type StockRange = '1M' | '3M' | '1Y' | 'ALL' | 'CUSTOM'

export default function AnalyticsTab({ holdings, transactions, quotes }: Props) {
  // ── Stock Chart States ──
  const [selSym, setSelSym] = useState(holdings[0]?.symbol || '')
  const [stockRange, setStockRange] = useState<StockRange>('1M')
  const [showCustomStock, setShowCustomStock] = useState(false)
  const [customStockStart, setCustomStockStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]
  })
  const [customStockEnd, setCustomStockEnd] = useState(() => new Date().toISOString().split('T')[0])
  const [stockHistory, setStockHistory] = useState<any[]>([])
  const [loadingStock, setLoading] = useState(false)

  // Fetch Stock History
  useEffect(() => {
    if (!selSym) return
    async function fetchHistory() {
      setLoading(true)
      const rangeMap: Record<StockRange, string> = { '1M': '1mo', '3M': '3mo', '1Y': '1y', 'ALL': '5y', 'CUSTOM': '5y' }
      try {
        const res = await fetch(`/api/stocks/info?symbol=${selSym}&range=${rangeMap[stockRange]}`)
        if (res.ok) {
          const data = await res.json()
          setStockHistory(data.history || [])
        }
      } catch (e) { console.error(e) } finally { setLoading(false) }
    }
    fetchHistory()
  }, [selSym, stockRange])

  const selectedHolding = useMemo(() => holdings.find(h => h.symbol === selSym), [holdings, selSym])

  const enrichedStockHistory = useMemo(() => {
    if (!stockHistory.length) return []
    const txs = [...transactions].filter(t => t.symbol === selSym).sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let txIdx = 0
    let inventory: { shares: number, cost: number }[] = []
    let currentAvgCost: number | null = null
    const firstDate = stockHistory[0].date

    while (txIdx < txs.length && txs[txIdx].trade_date < firstDate) {
      const tx = txs[txIdx]
      if (tx.action !== 'SELL') {
        inventory.push({ shares: tx.shares, cost: tx.amount + tx.fee })
      } else {
        let rem = tx.shares
        while (rem > 0 && inventory.length > 0) {
          if (inventory[0].shares <= rem) { rem -= inventory[0].shares; inventory.shift() }
          else { inventory[0].shares -= rem; rem = 0 }
        }
      }
      txIdx++
    }

    const processed = stockHistory.map((h, i) => {
      let isBuy = false
      let txPrice = 0
      let txShares = 0

      while (txIdx < txs.length && txs[txIdx].trade_date <= h.date) {
        const tx = txs[txIdx]
        if (tx.action !== 'SELL') {
          inventory.push({ shares: tx.shares, cost: tx.amount + tx.fee })
          isBuy = true
          txPrice = tx.price
          txShares += tx.shares
        } else {
          let rem = tx.shares
          while (rem > 0 && inventory.length > 0) {
            if (inventory[0].shares <= rem) { rem -= inventory[0].shares; inventory.shift() }
            else { inventory[0].shares -= rem; rem = 0 }
          }
        }
        txIdx++
      }
      
      const totalShares = inventory.reduce((s, lot) => s + lot.shares, 0)
      const totalCost = inventory.reduce((s, lot) => s + lot.cost, 0)
      currentAvgCost = totalShares > 0 ? totalCost / totalShares : null
      
      return {
        ...h,
        isBuy,
        txPrice,
        txShares,
        totalShares, // Added this
        avgCost: currentAvgCost,
        pnlDiff: currentAvgCost !== null ? (h.price - currentAvgCost) * totalShares : 0,
        pnlPct: currentAvgCost !== null && currentAvgCost !== 0 ? ((h.price - currentAvgCost) / currentAvgCost) * 100 : 0
      }
    })

    let finalData = processed
    if (stockRange === 'CUSTOM') {
      finalData = processed.filter(d => d.date >= customStockStart && d.date <= customStockEnd)
    }
    return finalData.map(d => ({...d, timestamp: new Date(d.date).getTime()}))
  }, [stockHistory, transactions, selSym, stockRange, customStockStart, customStockEnd])

  const chartRef = useRef<any>(null)
  const longPressTimer = useRef<any>(null)

  const getOption = () => {
    if (!enrichedStockHistory.length) return {}

    // Prepare MarkLine data for safety lines
    const buyEvents = enrichedStockHistory.filter(d => d.isBuy)
    const lastIdx = enrichedStockHistory.length - 1
    
    // Safety lines: from buy date to the end of the chart
    const markLineData = buyEvents.map(event => {
      const startIdx = enrichedStockHistory.findIndex(d => d.date === event.date)
      return [
        { coord: [startIdx, event.avgCost], lineStyle: { type: 'dashed', color: 'rgba(255,255,255,0.4)', width: 1 } },
        { coord: [lastIdx, event.avgCost] }
      ]
    })

    // Latest safety line: stronger visibility
    const latest = enrichedStockHistory[lastIdx]
    if (latest && latest.avgCost !== null) {
      const latestBuyIdx = [...enrichedStockHistory].reverse().findIndex(d => d.isBuy)
      const startIdx = latestBuyIdx !== -1 ? (enrichedStockHistory.length - 1 - latestBuyIdx) : 0
      markLineData.push([
        { coord: [startIdx, latest.avgCost], lineStyle: { type: 'dashed', color: 'rgba(255,255,255,0.8)', width: 1.5 } },
        { coord: [lastIdx, latest.avgCost] }
      ])
    }

    return {
      backgroundColor: 'transparent',
      grid: { top: 40, bottom: 30, left: 10, right: 50, containLabel: false },
      tooltip: {
        trigger: 'axis',
        triggerOn: 'none', // Managed by long-press
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        textStyle: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
        formatter: (params: any) => {
          const data = params[0].payload
          return `
            <div style="padding: 4px">
              <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px;">${data.date}</div>
              <div style="display: flex; justify-content: space-between; gap: 20px;">
                <span style="color: #cbd5e1">收盤價</span>
                <span style="color: #d4af37">${data.price.toFixed(2)}</span>
              </div>
              ${data.avgCost !== null ? `
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-top: 2px;">
                <span style="color: #cbd5e1">對應均價</span>
                <span style="color: rgba(255,255,255,0.8)">${data.avgCost.toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-top: 2px;">
                <span style="color: #cbd5e1">目前持股</span>
                <span style="color: #fff">${data.totalShares.toLocaleString()} 股</span>
              </div>
              ` : ''}
            </div>
          `
        },
        axisPointer: {
          type: 'cross',
          label: { show: false },
          lineStyle: { color: 'rgba(255,255,255,0.3)', type: 'dashed' },
          crossStyle: { color: 'rgba(255,255,255,0.3)', type: 'dashed' }
        }
      },
      xAxis: {
        type: 'category',
        data: enrichedStockHistory.map(d => d.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 9,
          color: '#94a3b8',
          formatter: (value: string) => {
            const parts = value.split('-')
            return `${parts[1]}-${parts[2]}`
          }
        },
        boundaryGap: false
      },
      yAxis: {
        type: 'value',
        position: 'right',
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: { fontSize: 10, color: '#d4af37', formatter: '{value}' },
        axisLine: { show: false },
        axisTick: { show: false },
        scale: true
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0], filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true, panByMouseMove: true },
        { type: 'inside', yAxisIndex: [0], filterMode: 'none' }
      ],
      series: [
        {
          name: '股價',
          type: 'line',
          data: enrichedStockHistory.map(d => ({ value: d.price, payload: d })),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: '#d4af37', width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(212, 175, 55, 0.1)' },
              { offset: 1, color: 'rgba(212, 175, 55, 0)' }
            ])
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: markLineData
          }
        },
        {
          name: '買入點',
          type: 'scatter',
          data: enrichedStockHistory.map((d, i) => d.isBuy ? [i, d.price] : null).filter(d => d !== null),
          symbolSize: 8,
          itemStyle: {
            color: '#fff',
            borderColor: '#d4af37',
            borderWidth: 2,
            shadowBlur: 10,
            shadowColor: 'rgba(212, 175, 55, 0.8)'
          },
          z: 10
        }
      ]
    }
  }

  // Handle Long Press
  const onChartReady = (instance: any) => {
    chartRef.current = instance
    const zr = instance.getZr()

    zr.on('mousedown', (params: any) => {
      longPressTimer.current = setTimeout(() => {
        instance.dispatchAction({
          type: 'showTip',
          x: params.event.zrX,
          y: params.event.zrY
        })
      }, 300)
    })

    zr.on('mousemove', (params: any) => {
      // If we are already showing tip (long pressed), update it
      // How to know if tip is showing? ECharts doesn't explicitly expose this easily, 
      // but we can track it or just clear timer if moving before 300ms.
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    })

    zr.on('mouseup', () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
      instance.dispatchAction({ type: 'hideTip' })
    })

    // Touch events for mobile
    zr.on('touchstart', (params: any) => {
      longPressTimer.current = setTimeout(() => {
        instance.dispatchAction({
          type: 'showTip',
          x: params.event.touches[0].zrX,
          y: params.event.touches[0].zrY
        })
      }, 300)
    })

    zr.on('touchmove', (params: any) => {
      // If dragging/panning, clear long press
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    })

    zr.on('touchend', () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
      instance.dispatchAction({ type: 'hideTip' })
    })
  }

  return (
    <div className="p-4 space-y-8 pb-20 animate-slide-up w-full overflow-x-hidden select-none [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none">
      {/* ── 1. 各股分析 ── */}
      <section className="space-y-4">
        <div className="flex flex-col space-y-3 px-1">
          <h3 className="flex items-center gap-2 text-[13px] font-black text-[var(--t2)] uppercase tracking-wider whitespace-nowrap">
            <TrendingUp size={16} className="text-accent inline mr-1" /> 單一個股走勢分析
          </h3>
          
          <div className="flex flex-col gap-3">
            <select 
              value={selSym} 
              onChange={e => setSelSym(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[15px] font-black text-[var(--t1)] outline-none focus:border-accent transition-all appearance-none cursor-pointer"
            >
              {holdings.map(h => (
                <option key={h.symbol} value={h.symbol}>{quotes[h.symbol]?.name_zh || getStockName(h.symbol)}</option>
              ))}
            </select>

            <div className="flex w-full gap-1.5 scrollbar-hide">
              {(['1M', '3M', '1Y', 'ALL'] as StockRange[]).map(r => (
                <button 
                  key={r} onClick={() => { setStockRange(r); setShowCustomStock(false); }}
                  className={`flex-1 py-2.5 rounded-xl text-[11px] font-black transition-all border ${stockRange === r && !showCustomStock ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
                >
                  {r === 'ALL' ? '全部' : r}
                </button>
              ))}
              <button 
                onClick={() => { setStockRange('CUSTOM'); setShowCustomStock(!showCustomStock); }}
                className={`px-4 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-black transition-all border ${stockRange === 'CUSTOM' ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
              >
                <CalendarIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        {showCustomStock && (
          <div className="flex items-center justify-end gap-3 px-1 py-1 animate-slide-up bg-white/5 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-[var(--t3)]">起</span>
              <DatePicker value={customStockStart} onChange={(v: string) => setCustomStockStart(v)} />
            </div>
            <div className="flex items-center gap-2 pr-2">
              <span className="text-[10px] font-black text-[var(--t3)]">迄</span>
              <DatePicker value={customStockEnd} onChange={(v: string) => setCustomStockEnd(v)} />
            </div>
          </div>
        )}

        <div className="card-base pt-4 pb-4 pl-4 pr-0 h-80 border-white/10 bg-black/20 relative overflow-hidden">
          {loadingStock && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm rounded-2xl"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
          <ReactECharts 
            option={getOption()} 
            style={{ height: '100%', width: '100%' }} 
            onChartReady={onChartReady}
            theme="dark"
          />
        </div>

        {selectedHolding && (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass p-4 border-white/5">
              <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-1">現時平均成本</div>
              <div className="text-base font-black text-[var(--t1)] font-mono">{selectedHolding.avg_cost.toFixed(2)}</div>
            </div>
            <div className="glass p-4 border-white/5">
              <div className="text-[10px] font-black text-[var(--t3)] uppercase mb-1">現時股價 vs 成本</div>
              <div className={`text-base font-black font-mono ${selectedHolding.pnl_pct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {selectedHolding.pnl_pct >= 0 ? '+' : ''}{selectedHolding.pnl_pct.toFixed(2)}%
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
