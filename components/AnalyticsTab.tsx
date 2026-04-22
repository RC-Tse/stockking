'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, getStockName, codeOnly } from '@/types'
import { useGesture } from '@use-gesture/react'
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion'
import { TrendingUp, RefreshCw, Calendar as CalendarIcon, Info, Newspaper, ExternalLink } from 'lucide-react'
import DatePicker from './DatePicker'
import { usePortfolio } from './providers/PortfolioContext'
import YearlyPnLChart from './YearlyPnLChart'
import TotalPnLChart from './TotalPnLChart'

type StockRange = '1M' | '3M' | '6M' | '9M' | '1Y' | 'CUSTOM'

interface Props {
  onRefresh: () => void
}

export default function AnalyticsTab({ onRefresh }: Props) {
  const { stats, quotes, settings, updateSettings } = usePortfolio()

  const sortedHoldings = useMemo(() => {
    return [...(stats.holdings || [])].sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0))
  }, [stats.holdings])
  
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
  const [selSym, setSelSym] = useState(sortedHoldings[0]?.symbol || '')
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

  const selectedHolding = useMemo(() => sortedHoldings.find(h => h.symbol === selSym), [sortedHoldings, selSym])

  const enrichedStockHistory = useMemo(() => {
    if (!stockHistory.length) return []
    
    // 1. 直接使用原始交易數據，不進行日期補點 (無開盤即不顯示)
    const sortedRaw = [...stockHistory].sort((a,b) => a.date.localeCompare(b.date))
    const firstDate = sortedRaw[0].date
    
    const txs = [...transactions].filter(t => t.symbol === selSym).sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
      return a.id - b.id
    })
    
    let txIdx = 0
    let currentAvgCost: number | null = null
    let totalShares = 0
    let totalCost = 0

    const processed = sortedRaw.map((h, i) => {
      let isBuy = false
      let txPrice = 0
      let txShares = 0

      // 先記錄當天開始時的持倉成本，作為顯示參考
      const costAtStartOfDay = currentAvgCost

      while (txIdx < txs.length && txs[txIdx].trade_date <= h.date) {
        const tx = txs[txIdx]
        const { absNet } = calculateTxParts(tx.shares, tx.price, tx.action, tx.symbol, settings)
        
        if (tx.action !== 'SELL') {
          totalShares += tx.shares
          totalCost += absNet
          isBuy = true
          txPrice = tx.price
          txShares += tx.shares
        } else {
          // Weighted Average: cost removed is based on the average before the sell
          const avgBefore = totalShares > 0 ? totalCost / totalShares : 0
          const mBuyCost = tx.shares === totalShares ? totalCost : Math.floor(tx.shares * avgBefore)
          
          totalShares -= tx.shares
          totalCost -= mBuyCost
        }
        txIdx++
      }
      
      const newAvgCost = totalShares > 0 ? totalCost / totalShares : null
      
      // 均價線繪製邏輯：保持與持股頁面一致的移動加權平均
      const displayAvgCost = (totalShares > 0) ? newAvgCost : (costAtStartOfDay || null);
      currentAvgCost = newAvgCost // 更新為下一日起始狀態

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
        avgCost: displayAvgCost,
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
      const open = data.open ?? 0
      const close = data.price ?? 0
      
      const getValColor = (val: number, ref: number, relation: 'high' | 'low' | 'close' | 'cost') => {
        if (relation === 'high') return val > ref ? 'text-[#ef4444]' : 'text-white'
        if (relation === 'low') return val < ref ? 'text-[#22c55e]' : 'text-white'
        if (relation === 'close') {
          if (val > ref) return 'text-[#ef4444]'
          if (val < ref) return 'text-[#22c55e]'
          return 'text-white'
        }
        if (relation === 'cost') {
          if (val > close) return 'text-[#ef4444]'
          if (val < close) return 'text-[#22c55e]'
          return 'text-white'
        }
        return 'text-white'
      }

      return (
        <div className="glass p-3 border-white/10 text-sm font-bold shadow-2xl z-50">
          <div className="text-[11px] text-[var(--t3)] mb-2 uppercase tracking-widest">{data.date}</div>
          <div className="flex justify-between gap-4 mb-1">
            <span className="text-[12px] text-[var(--t2)] flex-1">收盤價</span>
            <span className={`font-mono ${getValColor(close, open, 'close')}`}>{close.toFixed(2)}</span>
          </div>
          {data.avgCost !== null && (
            <div className="flex justify-between gap-4 mb-1">
              <span className="text-[12px] text-[var(--t2)] flex-1">對應均價</span>
              <span className={`font-mono ${getValColor(data.avgCost, close, 'cost')}`}>{(data.avgCost ?? 0).toFixed(2)}</span>
            </div>
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
    const pad = range * 0.1
    let rawMin = min - pad
    let rawMax = max + pad

    // 移除強制將最新收盤價置中於 Y 軸的邏輯，讓 K 線自然展開並平均分散在 Y 軸上
    let newMin = Math.floor(rawMin)
    let newMax = Math.ceil(rawMax)
    let newRange = newMax - newMin
    // 確保 Range 正確且能被 4 整除
    while (newRange % 4 !== 0 || newRange < 4) {
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
        if (isScrubbingMode) return // 查價時不移動圖表
        if (first) setIsManualY(true)
        const rangeY = yDomain[1] - yDomain[0]
        const pricePerPixel = rangeY / chartHeight
        const shiftY = dy * pricePerPixel
        setYDomain([yDomain[0] + shiftY, yDomain[1] + shiftY])
      }
    },
    { drag: { filterTaps: true, threshold: 5 }, pinch: { eventOptions: { passive: false } } }
  )

  const yScale = (price: number) => {
    const min = yDomain[0]
    const max = yDomain[1]
    return chartHeight - ((price - min) / (max - min)) * chartHeight
  }

  useEffect(() => {
    setIsManualY(false) // 切換個股時重置為自動對齊模式
    if (enrichedStockHistory.length > 0 && scrollerRef.current) {
      const chartWidth = scrollerRef.current.clientWidth - 32 // 扣除 padding
      
      // 根據範圍設定目標顯示的天數
      const targetDaysMap: Record<string, number> = {
        '1M': 22,
        '3M': 66,
        '6M': 132,
        '9M': 200,
        '1Y': 250,
        'CUSTOM': 30
      }
      const targetDays = targetDaysMap[stockRange] || 30
      
      // 計算適合的 pointWidth
      const idealPointWidth = Math.max(4, Math.min(60, chartWidth / targetDays))
      setPointWidth(idealPointWidth)

      setTimeout(() => {
        if (scrollerRef.current) {
          scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth
          handleScroll()
        }
      }, 100)
    }
  }, [enrichedStockHistory.length, selSym, stockRange])

  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const scrubTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [isScrubbingMode, setIsScrubbingMode] = useState(false)
  const lastPosRef = useRef({ x: 0, y: 0 })

  const handleStartTimer = (e: React.TouchEvent | React.MouseEvent) => {
    if (isScrubbingMode) return
    // Only allow long-press for touch events (mobile)
    if (e.type !== 'touchstart') return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    lastPosRef.current = { x: clientX, y: clientY }

    scrubTimerRef.current = setTimeout(() => {
      setIsScrubbingMode(true)
      if (window.navigator.vibrate) window.navigator.vibrate(10)
    }, 1000)
  }

  const handleEndTimer = () => {
    if (scrubTimerRef.current) {
      clearTimeout(scrubTimerRef.current)
      scrubTimerRef.current = null
    }
  }

  // 單點螢幕退出查價模式
  const handleChartClick = () => {
    if (isScrubbingMode) {
      setIsScrubbingMode(false)
      setActiveIdx(null)
    }
  }

  const handleChartDoubleClick = (e: React.MouseEvent) => {
    if (isScrubbingMode) return
    setIsScrubbingMode(true)
    if (!scrollerRef.current || enrichedStockHistory.length === 0) return
    const rect = scrollerRef.current.getBoundingClientRect()
    const scrollX = e.clientX - rect.left + scrollerRef.current.scrollLeft
    const idx = Math.floor(scrollX / pointWidth)
    if (idx >= 0 && idx < enrichedStockHistory.length) {
      setActiveIdx(idx)
    }
  }

  const handleChartMove = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    // 如果正在計時但尚未進入查價模式，檢查位移是否超過門檻 (10px) 以區分拖拽與長按
    if (scrubTimerRef.current && !isScrubbingMode) {
      const dx = Math.abs(clientX - lastPosRef.current.x)
      const dy = Math.abs(clientY - lastPosRef.current.y)
      if (dx > 10 || dy > 10) {
        handleEndTimer()
      }
    }

    if (e.type === 'touchmove' && !isScrubbingMode) {
      // 如果不是查價模式，讓瀏覽器處理原生捲動
      return
    }

    if (e.type === 'touchmove' && isScrubbingMode) {
      e.preventDefault() // 禁用捲動
    }

    if (!scrollerRef.current || enrichedStockHistory.length === 0) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const localY = clientY - rect.top

    // 如果進入查價模式且滑鼠位於上方資訊框區域 (Y < 120px)，暫停更新索引以方便點擊新聞按鈕
    // 僅針對 mousemove，手機端觸控移動仍維持同步
    if (isScrubbingMode && e.type === 'mousemove' && localY < 120) {
      return
    }

    const scrollX = clientX - rect.left + scroller.scrollLeft
    const idx = Math.floor(scrollX / pointWidth)
    if (idx >= 0 && idx < enrichedStockHistory.length) {
      setActiveIdx(idx)
    }
  }

  const handleSearchNews = (index: number) => {
    if (!enrichedStockHistory[index]) return
    const stockName = quotes[selSym]?.name_zh || getStockName(selSym)
    const stockCode = codeOnly(selSym)
    const query = `${stockName} ${stockCode}`
    
    // 計算搜尋範圍：前一個交易日到下一個交易日 (包含)
    const startData = index > 0 ? enrichedStockHistory[index - 1] : enrichedStockHistory[index]
    const endData = index < enrichedStockHistory.length - 1 ? enrichedStockHistory[index + 1] : enrichedStockHistory[index]

    const formatDateForGoogle = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-')
      return `${m}/${d}/${y}`
    }

    const minDate = formatDateForGoogle(startData.date)
    const maxDate = formatDateForGoogle(endData.date)
    
    // Build Google News Search URL with calculated date range
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=cdr:1,cd_min:${minDate},cd_max:${maxDate}`
    window.open(url, '_blank')
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
              className="w-full bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-xl px-4 py-3 text-[15px] font-black text-[var(--t2)] outline-none focus:border-accent transition-all appearance-none cursor-pointer shadow-lg"
            >
              {sortedHoldings.map(h => (
                <option key={h.symbol} value={h.symbol} className="bg-[var(--bg-card)]">
                  {quotes[h.symbol]?.name_zh || getStockName(h.symbol)} ({codeOnly(h.symbol)})
                </option>
              ))}
            </select>

            <div className="flex w-full gap-1.5 scrollbar-hide">
              {(['1M', '3M', '6M', '9M', '1Y'] as StockRange[]).map(r => (
                <button 
                  key={r} onClick={() => { 
                    setStockRange(r); 
                    setShowCustomStock(false);
                    // 儲存預設範圍至資料庫
                    updateSettings({ stock_chart_default_range: r });
                  }}
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

        <div className="relative group bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex h-[320px]">
            {/* 1. Plot Area (Scrollable) */}
            <div 
              {...bind()}
              ref={scrollerRef}
              onScroll={handleScroll}
              className={`flex-1 relative ${isScrubbingMode ? 'overflow-x-hidden' : 'overflow-x-auto'} overflow-y-hidden scrollbar-hide pl-4`}
              style={{ WebkitOverflowScrolling: 'touch', touchAction: isScrubbingMode ? 'none' : 'pan-x' }}
            >
              <div style={{ width: `${totalWidth}px`, height: `${chartHeight}px`, position: 'relative', marginTop: '16px' }}>
                    <svg 
                        width={enrichedStockHistory.length * pointWidth} 
                        height="100%" 
                        className="overflow-visible"
                        style={{ touchAction: isScrubbingMode ? 'none' : 'pan-x' }}
                        onClick={handleChartClick}
                        onDoubleClick={handleChartDoubleClick}
                        onMouseMove={handleChartMove}
                        onMouseLeave={() => { 
                          handleEndTimer()
                          if (!isScrubbingMode) setActiveIdx(null) 
                        }}
                        onTouchStart={handleStartTimer}
                        onTouchMove={handleChartMove}
                        onTouchEnd={handleEndTimer}
                      >
                    <g>
                      {/* Horizontal Grid Lines (aligned with price ticks) */}
                      {[0, 1, 2, 3, 4].map(i => {
                        const y = chartHeight * (i * 0.25)
                        return (
                          <line key={i} x1="0" y1={y} x2="100%" y2={y} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                        )
                      })}

                      {/* Vertical Grid Lines (Month starts & Buy days) */}
                      {enrichedStockHistory.map((d, i) => {
                        const isMonthStart = i === 0 || d.date.slice(5, 7) !== enrichedStockHistory[i - 1].date.slice(5, 7)
                        if (!isMonthStart && !d.isBuy) return null

                        const x = i * pointWidth + pointWidth / 2
                        return (
                          <line 
                            key={`vgrid-${i}`} 
                            x1={x} y1="0" x2={x} y2={chartHeight} 
                            stroke="rgba(255,255,255,0.06)" 
                            strokeWidth="1" 
                          />
                        )
                      })}
                    </g>
                  
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

                  {/* Step Cost Line (Piecewise Horizontal Path) - Moved AFTER candles to be on top */}
                  <path 
                    d={(() => {
                      let pathStr = ''
                      let isDrawing = false
                      enrichedStockHistory.forEach((d, i) => {
                        const x = i * pointWidth + pointWidth / 2
                        const nextX = (i + 1) * pointWidth + pointWidth / 2
                        if (d.avgCost !== null) {
                          const y = yScale(d.avgCost)
                          if (!isDrawing) {
                            pathStr += `M ${x} ${y} L ${nextX} ${y} `
                            isDrawing = true
                          } else {
                            pathStr += `L ${x} ${y} L ${nextX} ${y} `
                          }
                        } else {
                          isDrawing = false
                        }
                      })
                      return pathStr
                    })()}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    opacity="0.6"
                  />

                  {/* Scrubbing Indicators */}
                  {isScrubbingMode && activeIdx !== null && enrichedStockHistory[activeIdx] && (
                    <g>
                      <line 
                        x1={activeIdx * pointWidth + pointWidth / 2} 
                        y1="0" 
                        x2={activeIdx * pointWidth + pointWidth / 2} 
                        y2={chartHeight} 
                        stroke="var(--accent)" 
                        strokeWidth="1.5" 
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
                    const isMonthStart = i === 0 || d.date.slice(5, 7) !== enrichedStockHistory[i - 1].date.slice(5, 7)
                    if (!isMonthStart && !d.isBuy) return null 
                    
                    const label = isMonthStart ? `${parseInt(d.date.slice(5, 7))}月` : d.date.slice(5)

                    return (
                      <div 
                        key={i} 
                        className={`absolute text-[9px] font-black whitespace-nowrap -translate-x-1/2 transition-all px-1.5 py-0.5 rounded-sm ${d.isBuy ? 'bg-[#facc15] text-black z-20 shadow-md transform scale-110' : 'text-white/20'}`} 
                        style={{ left: i * pointWidth + pointWidth / 2, bottom: d.isBuy ? '2px' : '0px' }}
                      >
                        {label}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* 2. Sticky Y-Axis Zone (Right Aligned, Fixed) */}
            <div className="w-14 bg-black/40 backdrop-blur-md border-l border-white/5 relative z-30 sticky right-0 h-full">
              <div className="relative w-full" style={{ height: `${chartHeight}px`, marginTop: '16px' }}>
                {[0, 1, 2, 3, 4].map(i => {
                  const p = 1 - (i * 0.25)
                  const val = yDomain[0] + (yDomain[1] - yDomain[0]) * p
                  const y = chartHeight * (i * 0.25)
                  return (
                    <div 
                      key={p} 
                      className="absolute w-full flex items-center pr-2"
                      style={{ top: y, transform: 'translateY(-50%)' }}
                    >
                      <div className="w-2 h-[1px] bg-white/20 mr-1.5" />
                      <div className="text-[10px] font-black text-white/60 tabular-nums">
                        {Math.round(val ?? 0).toLocaleString()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          
          {loadingStock && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><RefreshCw size={24} className="animate-spin text-accent" /></div>}

          {isScrubbingMode && activeIdx !== null && enrichedStockHistory[activeIdx] && (
            <div 
              className="absolute top-4 z-40 p-3 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in fade-in duration-200 min-w-[140px] flex flex-col gap-3 transition-all duration-300"
              style={(() => {
                const scrollLeft = scrollerRef.current?.scrollLeft || 0
                const containerWidth = scrollerRef.current?.clientWidth || 300
                const rawX = activeIdx * pointWidth + pointWidth / 2
                const localX = rawX - scrollLeft
                const isLeftHalf = localX < containerWidth / 2
                
                // 增加偏移量 (60px) 以拉開資訊框與垂直線的距離
                if (isLeftHalf) {
                  return { left: localX + 60, right: 'auto' }
                } else {
                  return { right: containerWidth - localX + 60, left: 'auto' }
                }
              })()}
            >
               <div>
                 <div className="text-[10px] font-black text-accent uppercase mb-1">{enrichedStockHistory[activeIdx].date}</div>
                 <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                   {(() => {
                     const d = enrichedStockHistory[activeIdx]
                     const open = d.open ?? 0
                     const close = d.close ?? 0
                     const high = d.high ?? 0
                     const low = d.low ?? 0
                     
                     const getC = (v: number, ref: number, rel: string) => {
                       if (rel === 'h') return v > ref ? '#ef4444' : '#fff'
                       if (rel === 'l') return v < ref ? '#22c55e' : '#fff'
                       if (v > ref) return '#ef4444'
                       if (v < ref) return '#22c55e'
                       return '#fff'
                     }

                     return (
                       <>
                          <div className="text-[10px] text-white/40">開盤</div><div className="text-[11px] font-black text-white">{open.toFixed(1)}</div>
                          <div className="text-[10px] text-white/40">最高</div><div className="text-[11px] font-black" style={{ color: getC(high, open, 'h') }}>{high.toFixed(1)}</div>
                          <div className="text-[10px] text-white/40">最低</div><div className="text-[11px] font-black" style={{ color: getC(low, open, 'l') }}>{low.toFixed(1)}</div>
                          <div className="text-[10px] text-white/40">收盤</div><div className="text-[11px] font-black" style={{ color: getC(close, open, 'c') }}>{close.toFixed(1)}</div>
                          {d.avgCost && (
                            <>
                              <div className="text-[10px] text-white/40">均價</div><div className="text-[11px] font-black" style={{ color: getC(d.avgCost, close, 'avg') }}>{d.avgCost.toFixed(1)}</div>
                            </>
                          )}
                       </>
                     )
                   })()}
                 </div>
               </div>

               <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleSearchNews(activeIdx);
                }}
                className="flex items-center justify-center gap-2 py-2 px-3 bg-accent/20 hover:bg-accent/30 border border-accent/30 rounded-xl transition-all group/btn active:scale-95"
               >
                 <Newspaper size={12} className="text-accent group-hover/btn:scale-110 transition-transform" />
                 <span className="text-[11px] font-black text-accent">搜尋當日新聞</span>
                 <ExternalLink size={10} className="text-accent/50 ml-auto" />
               </button>
            </div>
          )}
        </div>

        {selectedHolding && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
              <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時平均成本</div>
              <div className="text-[18px] font-black text-[var(--t1)] font-mono">
                {(selectedHolding.avg_cost ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
              <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時股價 vs 成本</div>
              <div className={`text-[18px] font-black font-mono ${(selectedHolding.pnl_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {selectedHolding.pnl_pct !== undefined ? `${selectedHolding.pnl_pct >= 0 ? '+' : ''}${selectedHolding.pnl_pct.toFixed(2)}%` : '0.00%'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── 0. 年度進度圖 (移至下方) ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">年度目標進度</span>
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

      {/* ── 00. 總進度圖 (移至最下方) ── */}
      <section className="space-y-4">
        <div className="px-1">
          <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">總目標進度</span>
        </div>
        <TotalPnLChart 
          transactions={stats.fullHistoryStats ? Object.values(stats.fullHistoryStats).flatMap((s: any) => s.history) : []} 
          settings={settings} 
        />
      </section>
    </div>
  )
}
