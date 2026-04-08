'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Holding, Transaction, UserSettings, Quote, fmtMoney, getStockName } from '@/types'
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend
} from 'recharts'
import { TrendingUp, RefreshCw, Calendar as CalendarIcon } from 'lucide-react'
import DatePicker from './DatePicker'

interface Props {
  holdings: Holding[]
  transactions: Transaction[]
  settings: UserSettings
  quotes: Record<string, Quote>
}

type StockRange = '1M' | '3M' | '6M' | '9M' | '1Y' | 'ALL' | 'CUSTOM'

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
      // 為了支援左右平移，我們統一抓取較長的範圍，或者根據所選範圍抓取
      const rangeMap: Record<StockRange, string> = { 
        '1M': '1y', '3M': '1y', '6M': '1y', '9M': '2y', '1Y': '2y', 'ALL': '5y', 'CUSTOM': '5y' 
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
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const stockTicks = useMemo(() => {
    if (!enrichedStockHistory.length) return []
    const start = enrichedStockHistory[0].timestamp
    const end = enrichedStockHistory[enrichedStockHistory.length - 1].timestamp
    const ticks = [start, end]
    const mid = start + (end - start) / 2
    ticks.push(mid)
    return ticks.sort((a,b) => a - b)
  }, [enrichedStockHistory])

  const renderBuyDot = (props: any) => {
    const { cx, cy, payload } = props
    if (payload.isBuy) {
      return (
        <circle 
          key={`dot-${payload.date}`} 
          cx={cx} cy={cy} r={5} 
          fill="#e05050" stroke="#fff" strokeWidth={2} 
          style={{filter: 'drop-shadow(0 0 4px #e05050)'}} 
        />
      )
    }
    return null
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
              {(['1M', '3M', '6M', '9M', '1Y', 'ALL'] as StockRange[]).map(r => (
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

        <div 
          ref={scrollerRef}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`card-base pt-4 pb-4 pl-4 pr-0 border-white/10 bg-black/20 relative overflow-x-auto overflow-y-hidden scrollbar-hide touch-pan-x ${isScrubbing ? 'overflow-x-hidden' : ''}`}
          style={{ WebkitOverflowScrolling: 'touch', height: '320px' }}
        >
          {loadingStock && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm rounded-2xl"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
          
          <div style={{ width: chartWidthPercent, height: '280px', minWidth: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={enrichedStockHistory} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={stockTicks} tickFormatter={formatTick} tick={{fontSize: 9, fill: 'var(--t3)'}} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} orientation="right" unit="元" tick={{fontSize: 10, fill: 'var(--accent)'}} axisLine={false} tickLine={false} allowDataOverflow={true} width={45} />
                <Tooltip 
                  content={<StockTooltip />} 
                  active={isScrubbing}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                <Line type="stepAfter" dataKey="avgCost" stroke="rgba(255,255,255,0.8)" strokeDasharray="5 5" strokeWidth={2} dot={false} name="買入均價" isAnimationActive={false} />
                <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={renderBuyDot} name="股價線" isAnimationActive={false} />
                <Line type="monotone" dataKey="price" stroke="#e05050" strokeWidth={0} activeDot={false} dot={false} name="買入點" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
