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
    
    // 1. Create a full sequence of calendar days within the fetched range
    const sortedRaw = [...stockHistory].sort((a,b) => a.date.localeCompare(b.date))
    const firstDate = sortedRaw[0].date
    const lastDate = sortedRaw[sortedRaw.length - 1].date
    
    const allDays: string[] = []
    let curr = new Date(firstDate)
    const end = new Date(lastDate)
    while (curr <= end) {
      allDays.push(curr.toISOString().split('T')[0])
      curr.setDate(curr.getDate() + 1)
    }

    const historyMap = new Map(sortedRaw.map(h => [h.date, h]))
    let lastKnownPrice = sortedRaw[0].price

    // 2. Padding logic (If holiday, use previous close)
    const padded = allDays.map(date => {
      const existing = historyMap.get(date)
      if (existing) {
        lastKnownPrice = existing.price
        return { ...existing }
      }
      return { date, price: lastKnownPrice, isPadded: true }
    })

    const txs = [...transactions].filter(t => t.symbol === selSym).sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    
    let txIdx = 0
    let inventory: { shares: number, cost: number }[] = []
    let currentAvgCost: number | null = null

    // Pre-start inventory
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

    const processed = padded.map((h) => {
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
        open, high, low,
        isBuy,
        txPrice,
        txShares,
        avgCost: currentAvgCost,
        pnlDiff: currentAvgCost !== null ? (h.price - currentAvgCost) * totalShares : 0,
        pnlPct: currentAvgCost !== null && currentAvgCost !== 0 ? ((h.price - currentAvgCost) / currentAvgCost) * 100 : 0,
        // For Candlestick
        candleBody: [Math.min(open, close), Math.max(open, close)],
        candleWick: [low, high],
        isUp: close >= open
      }
    })

    let finalData = processed
    if (stockRange === 'CUSTOM') {
      finalData = processed.filter(d => d.date >= customStockStart && d.date <= customStockEnd)
    }
    return finalData.map(d => ({...d, timestamp: new Date(d.date).getTime()}))
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

  // 計算圖表寬度比例
  // 1M 約 22 個交易日, 3M 約 66, 6M 約 132...
  const [pointsPerWindow] = useState(25)
  const [yDomain, setYDomain] = useState<[number, number]>([0, 100])
  const [isManualY, setIsManualY] = useState(false)
  const pointers = useRef<Map<number, {x: number, y: number}>>(new Map())
  const chartHeight = 280
  const yPadding = 0.05 // 5% padding
const chartWidthPercent = useMemo(() => {
    if (!enrichedStockHistory.length) return '100%'
    const ratio = enrichedStockHistory.length / pointsPerWindow
    return `${Math.max(100, ratio * 100)}%`
  }, [enrichedStockHistory.length, pointsPerWindow])

  const yearMetrics = useMemo(() => {
    if (!enrichedStockHistory.length) return null
    const vals = enrichedStockHistory.flatMap(d => [d.open, d.high, d.low, d.close]
      .filter(v => typeof v === 'number' && v > 0)) as number[]
    if (vals.length === 0) return null
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [enrichedStockHistory])

  // 初始化 Y 軸對齊
  useEffect(() => {
    if (yearMetrics && !isManualY) {
      const range = yearMetrics.max - yearMetrics.min
      setYDomain([yearMetrics.min - range * yPadding, yearMetrics.max + range * yPadding])
    }
  }, [yearMetrics, isManualY])

  // Step 2: 初始視野校正 - 自動滾動至最右端 (最新的數據點)
  useEffect(() => {
    if (enrichedStockHistory.length > 0 && scrollerRef.current) {
      const scroller = scrollerRef.current
      // 延遲執行以確保寬度已計算完成
      const timer = setTimeout(() => {
        scroller.scrollLeft = scroller.scrollWidth
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [enrichedStockHistory.length, selSym])

  // 手勢控制：雙指縮放與垂直平移
  const bind = useGesture(
    {
      onPinch: ({ offset: [d], first }) => {
        if (first) setIsManualY(true)
        const zoom = Math.pow(1.01, -d) 
        const range = yDomain[1] - yDomain[0]
        const newRange = range * zoom

        // Step 3: 手勢優化 - 以「最新收盤價」為縮放錨點
        const lastPrice = enrichedStockHistory[enrichedStockHistory.length - 1]?.close || 0
        const weight = (lastPrice - yDomain[0]) / range
        
        const newMin = lastPrice - weight * newRange
        const newMax = newMin + newRange
        setYDomain([newMin, newMax])
      },
      onDrag: ({ delta: [, dy], first }) => {
        if (first) setIsManualY(true)
        const range = yDomain[1] - yDomain[0]
        const pricePerPixel = range / chartHeight
        const shift = dy * pricePerPixel
        setYDomain([yDomain[0] + shift, yDomain[1] + shift])
      }
    },
    { drag: { filterTaps: true, threshold: 5 } }
  )

  const yScale = (price: number) => {
    const min = yDomain[0]
    const max = yDomain[1]
    return chartHeight - ((price - min) / (max - min)) * chartHeight
  }

  // 查價位置管理
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const handleChartMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isScrubbing || !enrichedStockHistory.length) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const scrollX = clientX - rect.left + scroller.scrollLeft
    const totalWidth = scroller.scrollWidth
    const idx = Math.floor((scrollX / totalWidth) * enrichedStockHistory.length)
    if (idx >= 0 && idx < enrichedStockHistory.length) {
      setActiveIdx(idx)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (scrubTimer.current) clearTimeout(scrubTimer.current)
    scrubTimer.current = setTimeout(() => {
      setIsScrubbing(true)
    }, 150)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      if (scrubTimer.current) {
        clearTimeout(scrubTimer.current)
        scrubTimer.current = null
      }
      setIsScrubbing(false)
      setActiveIdx(null)
    }
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
        )}

        <div className="flex justify-center items-center gap-6 mb-2 text-[11px] font-black text-[var(--t2)] opacity-80 animate-slide-up">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: settings.stock_chart_style === 'detailed' ? '#ef4444' : 'var(--accent)' }} /> {settings.stock_chart_style === 'detailed' ? '陽線 (漲)' : '股價線'}</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: settings.stock_chart_style === 'detailed' ? '#22c55e' : 'rgba(255,255,255,0.7)' }} /> {settings.stock_chart_style === 'detailed' ? '陰線 (跌)' : '買入均價'}</div>
        </div>

        <div className="relative group bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex">
            {/* 1. Plot Area (Scrollable) */}
            <div 
              {...bind()}
              ref={scrollerRef}
              onMouseMove={handleChartMove}
              onTouchMove={handleChartMove}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              className={`flex-1 relative overflow-x-auto overflow-y-hidden scrollbar-hide py-4 pl-4 ${isScrubbing ? 'overflow-x-hidden' : ''}`}
              style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
            >
              {loadingStock && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
              
              <div style={{ width: chartWidthPercent, height: `${chartHeight}px`, minWidth: '100%' }}>
                <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
                  {/* Grid Lines (Horizontal) */}
                  {[0, 0.25, 0.5, 0.75, 1].map(p => {
                    const price = yDomain[0] + (yDomain[1] - yDomain[0]) * p
                    const y = yScale(price)
                    return (
                      <line key={p} x1="0" y1={y} x2="100%" y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
                    )
                  })}
                  
                  {/* Cost Line */}
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
                      <text 
                        x="4" 
                        y={yScale(selectedHolding.avg_cost) - 4} 
                        fill="#ffffff" 
                        fontSize="10" 
                        fontWeight="900" 
                        opacity="0.4"
                      >
                        成本 {(selectedHolding.avg_cost ?? 0).toFixed(1)}
                      </text>
                    </g>
                  )}

                  {settings.stock_chart_style === 'detailed' ? (
                    <g>
                      {enrichedStockHistory.map((d, i) => {
                        const x = `${(i / (enrichedStockHistory.length - 1)) * 100}%`
                        const yHigh = yScale(d.high)
                        const yLow = yScale(d.low)
                        const yOpen = yScale(d.open)
                        const yClose = yScale(d.close)
                        const bodyTop = Math.min(yOpen, yClose)
                        const bodyHeight = Math.max(1, Math.abs(yOpen - yClose))
                        const color = d.isUp ? '#ef4444' : '#22c55e'
                        
                        return (
                          <g key={i}>
                            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
                            <rect 
                              x={i === 0 ? 0 : `calc(${x} - 6px)`} 
                              y={bodyTop} 
                              width="12" 
                              height={bodyHeight} 
                              fill={color} 
                              rx="1"
                            />
                          </g>
                        )
                      })}
                    </g>
                  ) : (
                    <path 
                      d={enrichedStockHistory.map((d, i) => {
                        const x = `${(i / (enrichedStockHistory.length - 1)) * 100}%`
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
                        x1={`${(activeIdx / (enrichedStockHistory.length - 1)) * 100}%`} 
                        y1="0" 
                        x2={`${(activeIdx / (enrichedStockHistory.length - 1)) * 100}%`} 
                        y2="100%" 
                        stroke="var(--accent)" 
                        strokeWidth="1" 
                        strokeDasharray="4 2" 
                      />
                      <circle 
                        cx={`${(activeIdx / (enrichedStockHistory.length - 1)) * 100}%`} 
                        cy={yScale(enrichedStockHistory[activeIdx].close)} 
                        r="4" 
                        fill="var(--accent)" 
                        stroke="#fff" 
                        strokeWidth="2" 
                      />
                    </g>
                  )}
                </svg>
              </div>

              {/* X-Axis Ticks (Outside SVG to scroll with it) */}
              <div className="relative h-6 mt-2 pb-2" style={{ width: chartWidthPercent }}>
                {customTicks.map(t => {
                  const idx = enrichedStockHistory.findIndex(d => d.timestamp === t)
                  if (idx === -1) return null
                  const x = `${(idx / (enrichedStockHistory.length - 1)) * 100}%`
                  return (
                    <div key={t} className="absolute top-0 -translate-x-1/2 text-[10px] font-black text-[var(--t3)]" style={{ left: x }}>
                      {formatTick(t)}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 2. Sticky Y-Axis Area */}
            <div className="w-12 bg-black/30 backdrop-blur-md border-l border-[var(--border-bright)] flex flex-col justify-between py-4 pr-1 z-20 sticky right-0" style={{ height: `${chartHeight}px` }}>
              {[1, 0.75, 0.5, 0.25, 0].map(p => {
                const val = yDomain[0] + (yDomain[1] - yDomain[0]) * p
                return (
                  <div key={p} className="text-[10px] font-black text-[var(--t3)] text-right pr-1 tabular-nums">
                    {(val ?? 0).toFixed(1)}
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* Scrubbing Tooltip Overlay */}
          {isScrubbing && activeIdx !== null && enrichedStockHistory[activeIdx] && (
            <div className="absolute top-6 left-6 z-30 p-3 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl pointer-events-none animate-in fade-in duration-200">
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
