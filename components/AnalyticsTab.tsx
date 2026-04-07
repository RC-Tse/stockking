'use client'

import { useState, useMemo, useEffect } from 'react'
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
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-[12px] text-[var(--t2)] flex-1">差距金額</span>
                <span className={`font-mono ${data.pnlDiff >= 0 ? 'text-red-400' : 'text-green-400'}`}>{data.pnlDiff >= 0 ? '+' : ''}{fmtMoney(Math.round(data.pnlDiff))}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[12px] text-[var(--t2)] flex-1">損益%</span>
                <span className={`font-mono ${data.pnlPct >= 0 ? 'text-red-400' : 'text-green-400'}`}>{data.pnlPct >= 0 ? '+' : ''}{data.pnlPct.toFixed(2)}%</span>
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

  return (
    <div className="p-4 space-y-8 pb-20 animate-slide-up w-full overflow-x-hidden select-none [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none">
      {/* ── 1. 各股分析 ── */}
      <section className="space-y-4">
        <div className="flex flex-col space-y-3 px-1">
          <h3 className="flex items-center gap-2 text-[13px] font-black text-[var(--t2)] uppercase tracking-wider whitespace-nowrap">
            <TrendingUp size={16} className="text-accent inline mr-1" /> 單一個股走勢分析
          </h3>
          
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <select 
                value={selSym} 
                onChange={e => setSelSym(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-black text-[var(--t1)] outline-none focus:border-accent transition-all appearance-none cursor-pointer"
              >
                {holdings.map(h => (
                  <option key={h.symbol} value={h.symbol}>{h.symbol} {getStockName(h.symbol)}</option>
                ))}
              </select>

              <div className="flex gap-1.5 scrollbar-hide">
                {(['1M', '3M', '1Y', 'ALL'] as StockRange[]).map(r => (
                  <button 
                    key={r} onClick={() => { setStockRange(r); setShowCustomStock(false); }}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all border ${stockRange === r && !showCustomStock ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
                  >
                    {r === 'ALL' ? '全部' : r}
                  </button>
                ))}
                <button 
                  onClick={() => { setStockRange('CUSTOM'); setShowCustomStock(!showCustomStock); }}
                  className={`px-3 py-2 flex items-center gap-1.5 rounded-xl text-[10px] font-black transition-all border ${stockRange === 'CUSTOM' ? 'bg-accent text-bg-base border-accent' : 'bg-white/5 text-[var(--t3)] border-transparent'}`}
                >
                  <CalendarIcon size={12} />
                </button>
              </div>
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

        <div className="card-base pt-4 pb-4 pl-4 pr-0 h-80 border-white/10 bg-black/20 relative">
          {loadingStock && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-sm rounded-2xl"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={enrichedStockHistory} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={stockTicks} tickFormatter={formatTick} tick={{fontSize: 9, fill: 'var(--t3)'}} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={['auto', 'auto']} orientation="right" unit="元" tick={{fontSize: 10, fill: 'var(--accent)'}} axisLine={false} tickLine={false} allowDataOverflow={true} width={45} />
              <Tooltip content={<StockTooltip />} />
              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
              <Line type="stepAfter" dataKey="avgCost" stroke="rgba(255,255,255,0.8)" strokeDasharray="5 5" strokeWidth={2} dot={false} name="買入均價" />
              <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={renderBuyDot} name="股價線" />
              <Line type="monotone" dataKey="price" stroke="#e05050" strokeWidth={0} activeDot={false} dot={false} name="買入點" />
            </LineChart>
          </ResponsiveContainer>
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
