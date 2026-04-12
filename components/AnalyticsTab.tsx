'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, getStockName, codeOnly } from '@/types'
import { useGesture } from '@use-gesture/react'
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion'
import { TrendingUp, RefreshCw, Calendar as CalendarIcon, Info } from 'lucide-react'
import DatePicker from './DatePicker'
import { usePortfolio } from './providers/PortfolioContext'
import YearlyPnLChart from './YearlyPnLChart'

type StockRange = '1M' | '3M' | '6M' | '9M' | '1Y' | 'CUSTOM'

interface Props {
  onRefresh: () => void
}

export default function AnalyticsTab({ onRefresh }: Props) {
  const { stats, quotes, settings } = usePortfolio()
  const { holdings } = stats
  
  const currentYear = new Date().getFullYear().toString()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const yearGoal = useMemo(() => {
    return settings.year_goals?.[selectedYear] || (selectedYear === currentYear ? settings.year_goal : 0)
  }, [settings, selectedYear, currentYear])

  const hasGoal = yearGoal > 0

  // Flatten transactions from allHistoryStats for local use
  const transactions = useMemo(() => {
    const all: Transaction[] = []
    Object.values(stats.fullHistoryStats).forEach((s: any) => {
      s.history.forEach((h: any) => all.push(h))
    })
    return all
  }, [stats.fullHistoryStats])

  // ── Stock Chart States ──
  const [selSym, setSelSym] = useState(holdings[0]?.symbol || '')
  const [stockRange, setStockRange] = useState<StockRange>(settings.stock_chart_default_range || '1M')
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
      // 為了支援左右平移，我們統一抓取較長的範圍，或者根據所選範圍抓取
      const rangeMap: Record<StockRange, string> = { 
        '1M': '1y', '3M': '1y', '6M': '1y', '9M': '2y', '1Y': '2y', 'CUSTOM': '5y' 
      }
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
    
    // 1. 直接使用原始交易數據，不進行日期補點 (無開盤即不顯示)
    const sortedRaw = [...stockHistory].sort((a,b) => a.date.localeCompare(b.date))
    const firstDate = sortedRaw[0].date
    
    const txs = [...transactions].filter(t => t.symbol === selSym).sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let txIdx = 0
    let inventory: { shares: number, cost: number }[] = []
    let currentAvgCost: number | null = null

    // 處理圖表開始日期之前的交易
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

    const processed = sortedRaw.map((h) => {
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
      
      const open = h.open ?? h.price
      const close = h.price
      const high = h.high ?? h.price
      const low = h.low ?? h.price

      return {
        ...h,
        open, high, low, close,
        isBuy,
        txPrice,
        txShares,
        avgCost: currentAvgCost,
        isUp: close >= open,
        candleBody: [Math.min(open, close), Math.max(open, close)],
        candleWick: [low, high],
        timestamp: new Date(h.date).getTime()
      }
    })

    if (stockRange === 'CUSTOM') {
      return processed.filter(d => d.date >= customStockStart && d.date <= customStockEnd)
    }
    return processed
  }, [stockHistory, transactions, selSym, stockRange, customStockStart, customStockEnd])

  const formatTick = (ts: number) => {
    const d = new Date(ts)
    let effectiveRange = stockRange
    if (effectiveRange === 'CUSTOM') {
      const start = new Date(customStockStart).getTime()
      const end = new Date(customStockEnd).getTime()
      const diffMonths = (end - start) / (1000 * 60 * 60 * 24 * 30.44)
      if (diffMonths >= 11) effectiveRange = '1Y'
    }

    if (effectiveRange === '1Y') {
      return `${d.getMonth() + 1}月`
    }
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const customTicks = useMemo(() => {
    if (!enrichedStockHistory.length) return []
    const data = enrichedStockHistory
    const results: number[] = []
    const seenDates = new Set<string>()
    
    let effectiveRange = stockRange
    if (effectiveRange === 'CUSTOM') {
      const start = new Date(customStockStart).getTime()
      const end = new Date(customStockEnd).getTime()
      const diffMonths = (end - start) / (1000 * 60 * 60 * 24 * 30.44)
      if (diffMonths <= 1.5) effectiveRange = '1M'
      else if (diffMonths <= 4.5) effectiveRange = '3M'
      else if (diffMonths <= 11) effectiveRange = '6M'
      else effectiveRange = '1Y'
    }
    
    let targetDays = [1]
    if (effectiveRange === '1M') targetDays = [1, 10, 20]
    else if (effectiveRange === '3M') targetDays = [1, 15]
    else targetDays = [1] // 6M, 1Y

    // 取得所有出現過的月份
    const months = Array.from(new Set(data.map(d => d.date.substring(0, 7))))

    months.forEach(m => {
      targetDays.forEach(td => {
        const targetStr = `${m}-${String(td).padStart(2, '0')}`
        // 尋找該月份中大於等於目標日的第一個交易日
        const found = data.find(d => d.date >= targetStr && d.date.startsWith(m))
        if (found && !seenDates.has(found.date)) {
          results.push(found.timestamp)
          seenDates.add(found.date)
        }
      })
    })

    // [MOD] 強制加入今日 (最後一筆) 與起始日 (第一筆)
    const first = data[0].timestamp
    const last = data[data.length - 1].timestamp
    
    // 避讓邏輯：若既有刻度與強制刻度相差 5 天內 (5 * 24 * 3600 * 1000) 則過濾掉既有刻度
    const PROXIMITY_MS = 5 * 24 * 3600 * 1000
    const filteredResults = results.filter(ts => {
      const distToFirst = Math.abs(ts - first)
      const distToLast = Math.abs(ts - last)
      return distToFirst > PROXIMITY_MS && distToLast > PROXIMITY_MS
    })

    const finalTicks = [...filteredResults, first, last]
    return finalTicks.sort((a,b) => a - b)
  }, [enrichedStockHistory, stockRange, customStockStart, customStockEnd])

  // 計算全域價格極值與固定刻度
  const yAxisMetrics = useMemo(() => {
    if (!enrichedStockHistory.length) return { min: 0, max: 0, ticks: [] }
    const prices = enrichedStockHistory.map(d => d.price)
    const avgCosts = enrichedStockHistory.filter(d => d.avgCost !== null).map(d => d.avgCost as number)
    const allVals = [...prices, ...avgCosts]
    const min = Math.min(...allVals) * 0.95
    const max = Math.max(...allVals) * 1.05
    
    const count = 5
    const step = (max - min) / (count - 1)
    const ticks = Array.from({ length: count }, (_, i) => max - i * step)
    
    return { min, max, ticks }
  }, [enrichedStockHistory])

  const renderBuyDot = (props: any) => {
    const { cx, cy, payload } = props
    if (payload.isBuy) {
      return (
        <circle 
          key={`dot-${payload.date}`} 
          cx={cx} cy={cy} r={5} 
          fill="#e05050" 
          stroke="#fff" 
          strokeWidth={2} 
        />
      )
    }
    return null
  }

  const [activePoint, setActivePoint] = useState<{ y: number, price: number } | null>(null)

  const handleMouseMove = (e: any) => {
    if (isScrubbing && e && e.activeCoordinate && e.activePayload) {
      setActivePoint({
        y: e.activeCoordinate.y,
        price: e.activePayload[0].payload.price
      })
    } else {
      setActivePoint(null)
    }
  }

  const StockTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="glass p-3 border-white/10 text-sm font-bold shadow-2xl z-50">
          <div className="text-[11px] text-[var(--t3)] mb-2 uppercase tracking-widest">{data.date}</div>
          <div className="flex justify-between gap-4 mb-1">
            <span className="text-[12px] text-[var(--t2)] flex-1">收盤價</span>
            <span className="font-mono text-accent">{(data.price ?? 0).toFixed(2)}</span>
          </div>
          {data.avgCost !== null && (
            <>
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-[12px] text-[var(--t2)] flex-1">對應均價</span>
                <span className="font-mono text-[rgba(255,255,255,0.8)]">{(data.avgCost ?? 0).toFixed(2)}</span>
              </div>
            </>
          )}
          {data.isBuy && (
            <div className="mt-2 pt-2 border-t border-[#e05050]/20">
              <div className="text-[11px] font-black text-[#e05050] mb-0.5">買入紀錄</div>
              <div className="flex justify-between gap-4">
                <span className="text-[11px] text-[#e05050]/70">價格:</span>
                <span className="text-[11px] text-[#e05050]">{(data.txPrice ?? 0).toFixed(2)} 元</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[11px] text-[#e05050]/70">數量:</span>
                <span className="text-[11px] text-[#e05050]">{(data.txShares ?? 0).toLocaleString()} 股</span>
              </div>
              <div className="flex justify-between gap-4 mt-1 border-t border-[#e05050]/20 pt-1">
                <span className="text-[11px] text-[#e05050]/70">買入後新均價:</span>
                <span className="text-[11px] font-black text-[#e05050]">{(data.avgCost ?? 0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )
    }
    return null
  }

  const scrollerRef = useRef<HTMLDivElement>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const scrubTimer = useRef<any>(null)

  // ── Step 2-3: 雙軸縮放與佈局狀態 ──
  const [pointWidth, setPointWidth] = useState(16) // 每根 K 線佔用的寬度
  const [yDomain, setYDomain] = useState<[number, number]>([0, 100])
  const [visibleIdxRange, setVisibleIdxRange] = useState<[number, number]>([0, 30])
  const [isManualY, setIsManualY] = useState(false)
  
  const chartHeight = 280
  const candleGap = 4
  const candleWidth = useMemo(() => {
    // K 線主體寬度約為單個點寬度的 90%，實現「緊貼」感
    return Math.max(2, pointWidth * 0.9)
  }, [pointWidth])

  const totalPoints = enrichedStockHistory.length
  const totalWidth = totalPoints * pointWidth

  // Step 4: 自動適配 (Auto-scale) 邏輯
  useEffect(() => {
    if (isManualY || !enrichedStockHistory.length) return
    const [start, end] = visibleIdxRange
    const visibleData = enrichedStockHistory.slice(start, end + 1)
    if (!visibleData.length) return

    const vals = visibleData.flatMap(d => [d.high, d.low, d.open, d.close])
      .filter(v => typeof v === 'number' && v > 0)
    if (vals.length === 0) return

    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const range = max - min
    
    // 尋找能被 4 整除的範圍以確保 5 個整數標籤等距
    const pad = range * 0.05
    let newMin = Math.floor(min - pad)
    let newMax = Math.ceil(max + pad)
    let newRange = newMax - newMin
    while (newRange % 4 !== 0) {
      newMax++
      newRange = newMax - newMin
    }
    
    setYDomain([newMin, newMax])
  }, [visibleIdxRange, enrichedStockHistory, isManualY])

  // 監聽滾動以決定可見區間
  const handleScroll = () => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const scrollLeft = scroller.scrollLeft
    const viewportWidth = scroller.clientWidth
    
    const startIdx = Math.floor(scrollLeft / pointWidth)
    const endIdx = Math.ceil((scrollLeft + viewportWidth) / pointWidth)
    
    setVisibleIdxRange([Math.max(0, startIdx), Math.min(totalPoints - 1, endIdx)])
  }

  // 手勢控制：雙指縮放 (X 軸數據密度 + Y 軸區間)
  const bind = useGesture(
    {
      onPinch: ({ offset: [d], delta: [scale] }) => {
        setIsManualY(true)
        // 1. Y 軸價格縮放 (上下縮放)
        const zoomY = Math.pow(1.01, -d)
        const rangeY = yDomain[1] - yDomain[0]
        const midY = (yDomain[1] + yDomain[0]) / 2
        const newRangeY = rangeY * zoomY
        setYDomain([midY - newRangeY / 2, midY + newRangeY / 2])

        // 2. X 軸 K 線寬度縮放 (左右縮放)
        // 根據縮放手勢調整 pointWidth
        setPointWidth(prev => {
          const next = prev * (1 + scale * 0.05)
          return Math.min(100, Math.max(4, next)) // 限制寬度在 4px 到 100px 之間
        })
      },
      onDrag: ({ delta: [, dy], first }) => {
        if (first) setIsManualY(true)
        const rangeY = yDomain[1] - yDomain[0]
        const pricePerPixel = rangeY / chartHeight
        const shiftY = dy * pricePerPixel
        setYDomain([yDomain[0] + shiftY, yDomain[1] + shiftY])
      }
    },
    { drag: { filterTaps: true, threshold: 5 }, pinch: { axis: 'y' } }
  )

  const yScale = (price: number) => {
    const min = yDomain[0]
    const max = yDomain[1]
    return chartHeight - ((price - min) / (max - min)) * chartHeight
  }

  // 初始視野校正：右對齊
  useEffect(() => {
    if (enrichedStockHistory.length > 0 && scrollerRef.current) {
      setTimeout(() => {
        if (scrollerRef.current) {
          scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth
          handleScroll()
        }
      }, 100)
    }
  }, [enrichedStockHistory.length, selSym])

  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const handleChartMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isScrubbing || !enrichedStockHistory.length) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const scrollX = clientX - rect.left + scroller.scrollLeft
    const idx = Math.floor(scrollX / pointWidth)
    if (idx >= 0 && idx < enrichedStockHistory.length) {
      setActiveIdx(idx)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (scrubTimer.current) clearTimeout(scrubTimer.current)
    scrubTimer.current = setTimeout(() => {
      setIsScrubbing(true)
    }, 150)
  }

  const onPointerUp = () => {
    if (scrubTimer.current) {
      clearTimeout(scrubTimer.current)
      scrubTimer.current = null
    }
    setIsScrubbing(false)
    setActiveIdx(null)
  }

  return (
    <div className="p-4 space-y-8 pb-20 animate-slide-up w-full overflow-x-hidden select-none [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none">
      {/* ── 0. 年度進度圖 ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">年度進度回顧</span>
            <select 
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1 text-[12px] font-black text-accent outline-none ml-2"
            >
              {['2023', '2024', '2025', '2026', '2027'].map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>
          </div>

        </div>

        {hasGoal ? (
          <YearlyPnLChart 
            transactions={transactions} 
            settings={{ ...settings, year_goal: yearGoal }} 
            year={Number(selectedYear)}
          />
        ) : (
          <div className="bg-[var(--bg-card)] border border-dashed border-accent/20 rounded-[48px] p-12 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-accent/5 rounded-full flex items-center justify-center mx-auto mb-2">
              <span className="text-2xl">🎯</span>
            </div>
            <h4 className="text-[15px] font-black text-[var(--t1)]">尚未設定 {selectedYear} 年度目標</h4>
            <p className="text-[12px] text-[var(--t2)] opacity-60 leading-relaxed max-w-[200px] mx-auto">
              請前往「設定」頁面為該年份設定投資獲利目標，以便開始追蹤進度。
            </p>
            <div className="pt-2">
              <button 
               onClick={() => {
                 window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' }))
               }}
               className="px-6 py-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent text-[12px] font-black active:scale-95 transition-all"
              >
                前往設定
              </button>
            </div>
          </div>
        )}
      </section>

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
              className="w-full bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-xl px-4 py-3 text-[15px] font-black text-[var(--t2)] outline-none focus:border-accent transition-all appearance-none cursor-pointer shadow-lg"
            >
              {holdings.map(h => (
                <option key={h.symbol} value={h.symbol} className="bg-[var(--bg-card)]">
                  {quotes[h.symbol]?.name_zh || getStockName(h.symbol)} ({codeOnly(h.symbol)})
                </option>
              ))}
            </select>

            <div className="flex w-full gap-1.5 scrollbar-hide">
              {(['1M', '3M', '6M', '9M', '1Y'] as StockRange[]).map(r => (
                <button 
                  key={r} onClick={() => { setStockRange(r); setShowCustomStock(false); }}
                  className={`flex-1 py-2.5 rounded-xl text-[11px] font-black transition-all border ${stockRange === r && !showCustomStock ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-[var(--bg-card)] text-[var(--t2)] opacity-60 border-[var(--border-bright)] whitespace-nowrap'}`}
                >
                  {r}
                </button>
              ))}
              <button 
                onClick={() => { setStockRange('CUSTOM'); setShowCustomStock(!showCustomStock); }}
                className={`px-4 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-black transition-all border ${stockRange === 'CUSTOM' ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-[var(--bg-card)] text-[var(--t2)] opacity-60 border-[var(--border-bright)]'}`}
              >
                <CalendarIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        {showCustomStock && (
          <div className="flex items-center justify-end gap-3 px-1 py-1 animate-slide-up bg-[var(--bg-card)] rounded-2xl border border-[var(--border-bright)] shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-[var(--t2)] opacity-60">起</span>
              <DatePicker value={customStockStart} onChange={(v: string) => setCustomStockStart(v)} fixedYear={Number(selectedYear)} />
            </div>
            <div className="flex items-center gap-2 pr-2">
              <span className="text-[10px] font-black text-[var(--t2)] opacity-60">迄</span>
              <DatePicker value={customStockEnd} onChange={(v: string) => setCustomStockEnd(v)} fixedYear={Number(selectedYear)} />
            </div>
          </div>
        )        <div className="relative group bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex h-[320px]">
            {/* 1. Plot Area (Scrollable) */}
            <div 
              {...bind()}
              ref={scrollerRef}
              onScroll={handleScroll}
              onMouseMove={handleChartMove}
              onTouchMove={handleChartMove}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              className={`flex-1 relative overflow-x-auto overflow-y-hidden scrollbar-hide py-4 pl-4 ${isScrubbing ? 'overflow-x-hidden' : ''}`}
              style={{ WebkitOverflowScrolling: 'touch', touchAction: 'none' }}
            >
              <div style={{ width: `${totalWidth}px`, height: `${chartHeight}px`, position: 'relative' }}>
                <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
                  {/* Grid Lines (Horizontal) - 5 Equidistant Integer Ticks */}
                  {[0, 0.25, 0.5, 0.75, 1].map(p => {
                    const price = yDomain[0] + (yDomain[1] - yDomain[0]) * p
                    const y = yScale(price)
                    return (
                      <line key={p} x1="0" y1={y} x2="100%" y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
                    )
                  })}
                  
                  {/* Cost Line (White Dashed) */}
                  {selectedHolding && selectedHolding.avg_cost > 0 && (
                    <g>
                      <line 
                        x1="0" 
                        y1={yScale(selectedHolding.avg_cost)} 
                        x2="100%" 
                        y2={yScale(selectedHolding.avg_cost)} 
                        stroke="#ffffff" 
                        strokeWidth="1.5" 
                        strokeDasharray="4 4" 
                        opacity="0.4"
                      />
                    </g>
                  )}

                  {settings.stock_chart_style === 'detailed' ? (
                    <g>
                      {enrichedStockHistory.map((d, i) => {
                        const midX = i * pointWidth + pointWidth / 2
                        const yHigh = yScale(d.high)
                        const yLow = yScale(d.low)
                        const yOpen = yScale(d.open)
                        const yClose = yScale(d.close)
                        const bodyTop = Math.min(yOpen, yClose)
                        const bodyHeight = Math.max(1, Math.abs(yOpen - yClose))
                        const color = d.isUp ? '#ef4444' : '#22c55e'
                        
                        return (
                          <g key={i}>
                            {/* Vertical Align: K-line center at midX */}
                            <line x1={midX} y1={yHigh} x2={midX} y2={yLow} stroke={color} strokeWidth="1.5" />
                            <rect 
                              x={midX - candleWidth / 2} 
                              y={bodyTop} 
                              width={candleWidth} 
                              height={bodyHeight} 
                              fill={color} 
                              rx="1"
                            />
                            
                            {/* Step 5: Buy Point Marker (White Box with Red Dot) */}
                            {d.isBuy && (
                              <g transform={`translate(${midX}, ${yScale(d.txPrice)})`}>
                                <rect x="-6" y="-6" width="12" height="12" fill="white" rx="2" stroke="white" strokeWidth="1" />
                                <circle cx="0" cy="0" r="3" fill="#ef4444" />
                              </g>
                            )}
                          </g>
                        )
                      })}
                    </g>
                  ) : (
                    <path 
                      d={enrichedStockHistory.map((d, i) => {
                        const x = i * pointWidth + pointWidth / 2
                        return `${i === 0 ? 'M' : 'L'} ${x} ${yScale(d.close)}`
                      }).join(' ')}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="3"
                    />
                  )}

                  {/* Scrubbing Indicators */}
                  {isScrubbing && activeIdx !== null && enrichedStockHistory[activeIdx] && (
                    <g>
                      <line 
                        x1={activeIdx * pointWidth + pointWidth / 2} 
                        y1="0" 
                        x2={activeIdx * pointWidth + pointWidth / 2} 
                        y2="100%" 
                        stroke="var(--accent)" 
                        strokeWidth="1" 
                        strokeDasharray="4 2" 
                      />
                      <circle 
                        cx={activeIdx * pointWidth + pointWidth / 2} 
                        cy={yScale(enrichedStockHistory[activeIdx].close)} 
                        r="4" 
                        fill="var(--accent)" 
                        stroke="#fff" 
                        strokeWidth="2" 
                      />
                    </g>
                  )}
                </svg>
                
                {/* X-Axis Dates */}
                <div className="absolute bottom-0 left-0 right-0 h-4 flex items-center pointer-events-none">
                  {enrichedStockHistory.map((d, i) => {
                    if (i % 5 !== 0) return null // 每 5 天顯示一次日期以補空間
                    return (
                      <div key={i} className="absolute text-[9px] font-black text-white/30 whitespace-nowrap -translate-x-1/2" style={{ left: i * pointWidth + pointWidth / 2 }}>
                        {d.date.slice(5)}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* 2. Sticky Y-Axis Zone (Right Aligned, Fixed) */}
            <div className="w-14 bg-black/40 backdrop-blur-md border-l border-white/5 flex flex-col justify-between py-6 z-30 sticky right-0" style={{ height: '320px' }}>
              {[1, 0.75, 0.5, 0.25, 0].map(p => {
                const val = yDomain[0] + (yDomain[1] - yDomain[0]) * p
                return (
                  <div key={p} className="px-2">
                    <div className="text-[10px] font-black text-white/60 text-right tabular-nums">
                      {Math.round(val ?? 0).toLocaleString()}
                    </div>
                  </div>
                )
              })}
              
              {/* Sync Cost Label on Y-Axis */}
              {selectedHolding && selectedHolding.avg_cost > 0 && (
                <div 
                  className="absolute right-0 bg-white text-black text-[9px] font-black px-1 rounded-l-sm transition-all shadow-lg"
                  style={{ top: yScale(selectedHolding.avg_cost) + 16 }} // +16 for padding/center
                >
                  COST
                </div>
              )}
            </div>
          </div>
          
          {loadingStock && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><RefreshCw size={24} className="animate-spin text-accent" /></div>}

          {isScrubbing && activeIdx !== null && enrichedStockHistory[activeIdx] && (
            <div className="absolute top-4 left-4 z-40 p-3 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl pointer-events-none animate-in fade-in duration-200">
               <div className="text-[10px] font-black text-accent uppercase mb-1">{enrichedStockHistory[activeIdx].date}</div>
               <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                 <div className="text-[10px] text-white/40">開盤</div><div className="text-[11px] font-black text-white">{(enrichedStockHistory[activeIdx].open ?? 0).toFixed(1)}</div>
                 <div className="text-[10px] text-white/40">最高</div><div className="text-[11px] font-black text-[#ef4444]">{(enrichedStockHistory[activeIdx].high ?? 0).toFixed(1)}</div>
                 <div className="text-[10px] text-white/40">最低</div><div className="text-[11px] font-black text-[#22c55e]">{(enrichedStockHistory[activeIdx].low ?? 0).toFixed(1)}</div>
                 <div className="text-[10px] text-white/40">收盤</div><div className="text-[11px] font-black text-white">{(enrichedStockHistory[activeIdx].close ?? 0).toFixed(1)}</div>
               </div>
            </div>
          )}
        </div>

        {selectedHolding && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
              <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時平均成本</div>
              <div className="text-[18px] font-black text-[var(--t1)] font-mono">{(selectedHolding.avg_cost ?? 0).toFixed(2)}</div>
            </div>
            <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
              <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時股價 vs 成本</div>
              <div className={`text-[18px] font-black font-mono ${(selectedHolding.pnl_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {(selectedHolding.pnl_pct ?? 0) >= 0 ? '+' : ''}{(selectedHolding.pnl_pct ?? 0).toFixed(2)}%
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
