'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, getStockName, codeOnly } from '@/types'
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend
} from 'recharts'
import { TrendingUp, RefreshCw, Calendar as CalendarIcon } from 'lucide-react'
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
      
      return {
        ...h,
        isBuy,
        txPrice,
        txShares,
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

  const formatTick = (ts: number) => {
    const d = new Date(ts)
    let effectiveRange = stockRange
    if (effectiveRange === 'CUSTOM') {
      const start = new Date(customStockStart).getTime()
      const end = new Date(customStockEnd).getTime()
      const diffMonths = (end - start) / (1000 * 60 * 60 * 24 * 30.44)
      if (diffMonths >= 11) effectiveRange = '1Y'
    }

    if (effectiveRange === 'ALL') {
      return `${d.getMonth() + 1}`
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
    else targetDays = [1] // 6M, 1Y, ALL

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
    return results.sort((a,b) => a - b)
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
            <span className="font-mono text-accent">{data.price.toFixed(2)}</span>
          </div>
          {data.avgCost !== null && (
            <>
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-[12px] text-[var(--t2)] flex-1">對應均價</span>
                <span className="font-mono text-[rgba(255,255,255,0.8)]">{data.avgCost.toFixed(2)}</span>
              </div>
            </>
          )}
          {data.isBuy && (
            <div className="mt-2 pt-2 border-t border-[#e05050]/20">
              <div className="text-[11px] font-black text-[#e05050] mb-0.5">買入紀錄</div>
              <div className="flex justify-between gap-4">
                <span className="text-[11px] text-[#e05050]/70">價格:</span>
                <span className="text-[11px] text-[#e05050]">{data.txPrice.toFixed(2)} 元</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[11px] text-[#e05050]/70">數量:</span>
                <span className="text-[11px] text-[#e05050]">{data.txShares.toLocaleString()} 股</span>
              </div>
              <div className="flex justify-between gap-4 mt-1 border-t border-[#e05050]/20 pt-1">
                <span className="text-[11px] text-[#e05050]/70">買入後新均價:</span>
                <span className="text-[11px] font-black text-[#e05050]">{data.avgCost.toFixed(2)}</span>
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
  const pointsPerWindow = useMemo(() => {
    switch(stockRange) {
      case '1M': return 22
      case '3M': return 66
      case '6M': return 132
      case '9M': return 198
      case '1Y': return 252
      default: return Math.max(22, enrichedStockHistory.length)
    }
  }, [stockRange, enrichedStockHistory.length])

  const chartWidthPercent = useMemo(() => {
    if (!enrichedStockHistory.length) return '100%'
    const ratio = enrichedStockHistory.length / pointsPerWindow
    return `${Math.max(100, ratio * 100)}%`
  }, [enrichedStockHistory.length, pointsPerWindow])

  // 自動捲動到最右側
  useEffect(() => {
    if (scrollerRef.current && enrichedStockHistory.length) {
      const el = scrollerRef.current
      // 延遲執行確保 DOM 已經渲染完成
      const timer = setTimeout(() => {
        el.scrollLeft = el.scrollWidth
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [enrichedStockHistory.length, stockRange])

  const handlePointerDown = (e: React.PointerEvent) => {
    // 只有觸控或左鍵長按才觸發
    if (e.pointerType === 'mouse' && e.button !== 0) return
    
    scrubTimer.current = setTimeout(() => {
      setIsScrubbing(true)
      if (window.navigator.vibrate) try { window.navigator.vibrate(10) } catch(e){}
    }, 300)
  }

  const handlePointerUp = () => {
    if (scrubTimer.current) {
      clearTimeout(scrubTimer.current)
      scrubTimer.current = null
    }
    setIsScrubbing(false)
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

          {hasGoal && (
            <div className="border border-[#fbbf24]/40 bg-[#fbbf24]/10 backdrop-blur-md px-4 py-2 rounded-2xl flex flex-col items-end shadow-lg scale-90 origin-right transition-all hover:scale-95">
              <span className="text-[9px] font-black text-[#fbbf24] opacity-70 uppercase tracking-widest">{selectedYear} 年度獲益目標</span>
              <span className="text-[13px] font-black text-[#fbbf24] font-mono">{fmtMoney(Math.round(yearGoal))}</span>
            </div>
          )}
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
              <DatePicker value={customStockStart} onChange={(v: string) => setCustomStockStart(v)} />
            </div>
            <div className="flex items-center gap-2 pr-2">
              <span className="text-[10px] font-black text-[var(--t2)] opacity-60">迄</span>
              <DatePicker value={customStockEnd} onChange={(v: string) => setCustomStockEnd(v)} />
            </div>
          </div>
        )}

        <div className="flex justify-center items-center gap-6 mb-2 text-[11px] font-black text-[var(--t2)] opacity-80 animate-slide-up">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} /> 股價線</div>
          <div className="flex items-center gap-1.5"><div className="w-4 h-0 border-b-2 border-dashed" style={{ borderColor: 'rgba(255,255,255,0.8)' }} /> 買入均價</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full border-2 border-white bg-[#e05050]" /> 買入點</div>
        </div>

        <div className="relative group">
          <div 
            ref={scrollerRef}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className={`bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl pt-4 pb-4 pl-4 pr-0 relative overflow-x-auto overflow-y-hidden scrollbar-hide touch-pan-x shadow-2xl ${isScrubbing ? 'overflow-x-hidden' : ''}`}
            style={{ WebkitOverflowScrolling: 'touch', height: '320px' }}
          >
            {loadingStock && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm rounded-2xl"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
            
            <div style={{ width: chartWidthPercent, height: '280px', minWidth: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                  data={enrichedStockHistory} 
                  margin={{ top: 10, right: 45, left: 0, bottom: 5 }}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setActivePoint(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={true} />
                  <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={customTicks} tickFormatter={formatTick} tick={{fontSize: 11, fontWeight: 900, fill: 'var(--t2)', opacity: 0.6}} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} interval={0} />
                  <YAxis domain={[yAxisMetrics.min, yAxisMetrics.max]} orientation="right" tick={false} axisLine={false} tickLine={false} hide />
                  <Tooltip 
                    content={<StockTooltip />} 
                    active={isScrubbing}
                  />
                  <Line type="stepAfter" dataKey="avgCost" stroke="rgba(255,255,255,0.8)" strokeDasharray="5 5" strokeWidth={2} dot={false} name="買入均價" isAnimationActive={false} />
                  <Line type="linear" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={renderBuyDot} name="股價線" isAnimationActive={false} />
                  <Line type="linear" dataKey="price" stroke="#e05050" strokeWidth={0} activeDot={false} dot={false} name="買入點" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 右側固定 Y 軸 - 懸浮刻度 (無背景遮罩) */}
          <div 
            className="absolute right-0 top-0 bottom-0 w-[42px] z-20 pointer-events-none border-l border-white/5 flex flex-col justify-between py-[46px] px-1"
          >
            {yAxisMetrics.ticks.map((t, i) => (
              <div 
                key={i} 
                className="text-[9px] font-black text-[var(--t1)] text-right font-mono pr-1"
                style={{ 
                  textShadow: '0px 0px 4px rgba(0, 0, 0, 0.9), 0px 0px 8px rgba(0, 0, 0, 0.6)'
                }}
              >
                {t.toFixed(0)}
              </div>
            ))}
          </div>

          {/* 右側固定 Y 軸價格標籤 - 查價模式 */}
          {isScrubbing && activePoint && (
            <div 
              className="absolute right-0 pointer-events-none z-50 flex items-center transition-transform duration-75"
              style={{ 
                top: 0,
                transform: `translateY(${activePoint.y + 16}px)` 
              }}
            >
              <div className="bg-[#e05050] text-white text-[10px] font-black px-2 py-1 rounded-l shadow-xl border-y border-l border-white/20 whitespace-nowrap">
                {activePoint.price.toFixed(2)}
              </div>
              <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[4px] border-l-[#e05050]" />
            </div>
          )}

        </div>

        {selectedHolding && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
              <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時平均成本</div>
              <div className="text-[18px] font-black text-[var(--t1)] font-mono">{selectedHolding.avg_cost.toFixed(2)}</div>
            </div>
            <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
              <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時股價 vs 成本</div>
              <div className={`text-[18px] font-black font-mono ${selectedHolding.pnl_pct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {selectedHolding.pnl_pct >= 0 ? '+' : ''}{selectedHolding.pnl_pct.toFixed(2)}%
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
