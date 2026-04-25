'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Holding, Transaction, UserSettings, Quote } from '@/types'
import { fmtMoney } from '@/utils/formatters'
import { getStockName } from '@/utils/stock'
import { codeOnly, calculateTxParts } from '@/utils/calculations'
import { useGesture } from '@use-gesture/react'
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion'
import { TrendingUp, RefreshCw, Calendar as CalendarIcon, Info, Newspaper, ExternalLink } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { usePortfolio } from '@/components/providers/PortfolioContext'
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
253:       '1M': '1y', '3M': '1y', '6M': '1y', '9M': '2y', '1Y': '2y', 'CUSTOM': '5y' 
63:       }
64:       try {
65:         const res = await fetch(`/api/stocks/info?symbol=${selSym}&range=${rangeMap[stockRange]}`)
66:         if (res.ok) {
67:           const data = await res.json()
68:           setStockHistory(data.history || [])
69:         }
70:       } catch (e) { console.error(e) } finally { setLoading(false) }
71:     }
72:     fetchHistory()
73:   }, [selSym, stockRange])
74: 
75:   const selectedHolding = useMemo(() => sortedHoldings.find(h => h.symbol === selSym), [sortedHoldings, selSym])
76: 
77:   const enrichedStockHistory = useMemo(() => {
78:     if (!stockHistory.length) return []
79:     
80:     // 1. 直接使用原始交易數據，不進行日期補點 (無開盤即不顯示)
81:     const sortedRaw = [...stockHistory].sort((a,b) => a.date.localeCompare(b.date))
82:     const firstDate = sortedRaw[0].date
83:     
84:     const txs = [...transactions].filter(t => t.symbol === selSym).sort((a, b) => {
85:       if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
86:       return a.id - b.id
87:     })
88:     
89:     let txIdx = 0
90:     let currentAvgCost: number | null = null
91:     let totalShares = 0
92:     let totalCost = 0
93: 
94:     const processed = sortedRaw.map((h, i) => {
95:       let isBuy = false
96:       let txPrice = 0
97:       let txShares = 0
98: 
99:       // 先記錄當天開始時的持倉成本，作為顯示參考
100:       const costAtStartOfDay = currentAvgCost
101: 
102:       while (txIdx < txs.length && txs[txIdx].trade_date <= h.date) {
103:         const tx = txs[txIdx]
104:         const { absNet } = calculateTxParts(tx.shares, tx.price, tx.action, tx.symbol, settings)
105:         
106:         if (tx.action !== 'SELL') {
107:           totalShares += tx.shares
108:           totalCost += absNet
109:           isBuy = true
110:           txPrice = tx.price
111:           txShares += tx.shares
112:         } else {
113:           // Weighted Average: cost removed is based on the average before the sell
114:           const avgBefore = totalShares > 0 ? totalCost / totalShares : 0
115:           const mBuyCost = tx.shares === totalShares ? totalCost : Math.floor(tx.shares * avgBefore)
116:           
117:           totalShares -= tx.shares
118:           totalCost -= mBuyCost
119:         }
120:         txIdx++
121:       }
122:       
123:       const newAvgCost = totalShares > 0 ? totalCost / totalShares : null
124:       
125:       // 均價線繪製邏輯：保持與持股頁面一致的移動加權平均
126:       const displayAvgCost = (totalShares > 0) ? newAvgCost : (costAtStartOfDay || null);
127:       currentAvgCost = newAvgCost // 更新為下一日起始狀態
128: 
129:       const open = h.open ?? h.price
130:       const close = h.price
131:       const high = h.high ?? h.price
132:       const low = h.low ?? h.price
133: 
134:       return {
135:         ...h,
136:         open, high, low, close,
137:         isBuy,
138:         txPrice,
139:         txShares,
140:         avgCost: displayAvgCost,
141:         isUp: close >= open,
142:         candleBody: [Math.min(open, close), Math.max(open, close)],
143:         candleWick: [low, high],
144:         timestamp: new Date(h.date).getTime()
145:       }
146:     })
147: 
148:     if (stockRange === 'CUSTOM') {
149:       return processed.filter(d => d.date >= customStockStart && d.date <= customStockEnd)
150:     }
151:     return processed
152:   }, [stockHistory, transactions, selSym, stockRange, customStockStart, customStockEnd])
153: 
154:   const formatTick = (ts: number) => {
155:     const d = new Date(ts)
156:     let effectiveRange = stockRange
157:     if (effectiveRange === 'CUSTOM') {
158:       const start = new Date(customStockStart).getTime()
159:       const end = new Date(customStockEnd).getTime()
160:       const diffMonths = (end - start) / (1000 * 60 * 60 * 24 * 30.44)
161:       if (diffMonths >= 11) effectiveRange = '1Y'
162:     }
163: 
164:     if (effectiveRange === '1Y') {
165:       return `${d.getMonth() + 1}月`
166:     }
167:     return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
168:   }
169: 
170:   const customTicks = useMemo(() => {
171:     if (!enrichedStockHistory.length) return []
172:     const data = enrichedStockHistory
173:     const results: number[] = []
174:     const seenDates = new Set<string>()
175:     
176:     let effectiveRange = stockRange
177:     if (effectiveRange === 'CUSTOM') {
178:       const start = new Date(customStockStart).getTime()
179:       const end = new Date(customStockEnd).getTime()
180:       const diffMonths = (end - start) / (1000 * 60 * 60 * 24 * 30.44)
181:       if (diffMonths <= 1.5) effectiveRange = '1M'
182:       else if (diffMonths <= 4.5) effectiveRange = '3M'
183:       else if (diffMonths <= 11) effectiveRange = '6M'
184:       else effectiveRange = '1Y'
185:     }
186:     
187:     let targetDays = [1]
188:     if (effectiveRange === '1M') targetDays = [1, 10, 20]
189:     else if (effectiveRange === '3M') targetDays = [1, 15]
190:     else targetDays = [1] // 6M, 1Y
191: 
192:     // 取得所有出現過的月份
193:     const months = Array.from(new Set(data.map(d => d.date.substring(0, 7))))
194: 
195:     months.forEach(m => {
196:       targetDays.forEach(td => {
197:         const targetStr = `${m}-${String(td).padStart(2, '0')}`
198:         // 尋找該月份中大於等於目標日的第一個交易日
199:         const found = data.find(d => d.date >= targetStr && d.date.startsWith(m))
200:         if (found && !seenDates.has(found.date)) {
201:           results.push(found.timestamp)
202:           seenDates.add(found.date)
203:         }
204:       })
205:     })
206: 
207:     // [MOD] 強制加入今日 (最後一筆) 與起始日 (第一筆)
208:     const first = data[0].timestamp
209:     const last = data[data.length - 1].timestamp
210:     
211:     // 避讓邏輯：若既有刻度與強制刻度相差 5 天內 (5 * 24 * 3600 * 1000) 則過濾掉既有刻度
212:     const PROXIMITY_MS = 5 * 24 * 3600 * 1000
213:     const filteredResults = results.filter(ts => {
214:       const distToFirst = Math.abs(ts - first)
215:       const distToLast = Math.abs(ts - last)
216:       return distToFirst > PROXIMITY_MS && distToLast > PROXIMITY_MS
217:     })
218: 
219:     const finalTicks = [...filteredResults, first, last]
220:     return finalTicks.sort((a,b) => a - b)
221:   }, [enrichedStockHistory, stockRange, customStockStart, customStockEnd])
222: 
223:   // 計算全域價格極值與固定刻度
224:   const yAxisMetrics = useMemo(() => {
225:     if (!enrichedStockHistory.length) return { min: 0, max: 0, ticks: [] }
226:     const prices = enrichedStockHistory.map(d => d.price)
227:     const avgCosts = enrichedStockHistory.filter(d => d.avgCost !== null).map(d => d.avgCost as number)
228:     const allVals = [...prices, ...avgCosts]
229:     const min = Math.min(...allVals) * 0.95
230:     const max = Math.max(...allVals) * 1.05
231:     
232:     const count = 5
233:     const step = (max - min) / (count - 1)
234:     const ticks = Array.from({ length: count }, (_, i) => max - i * step)
235:     
236:     return { min, max, ticks }
237:   }, [enrichedStockHistory])
238: 
239:   const renderBuyDot = (props: any) => {
240:     const { cx, cy, payload } = props
241:     if (payload.isBuy) {
242:       return (
243:         <circle 
244:           key={`dot-${payload.date}`} 
245:           cx={cx} cy={cy} r={5} 
246:           fill="#e05050" 
247:           stroke="#fff" 
248:           strokeWidth={2} 
249:         />
250:       )
251:     }
252:     return null
253:   }
254: 
255:   const [activePoint, setActivePoint] = useState<{ y: number, price: number } | null>(null)
256: 
257:   const handleMouseMove = (e: any) => {
258:     if (isScrubbing && e && e.activeCoordinate && e.activePayload) {
259:       setActivePoint({
260:         y: e.activeCoordinate.y,
261:         price: e.activePayload[0].payload.price
262:       })
263:     } else {
264:       setActivePoint(null)
265:     }
266:   }
267: 
268:   const StockTooltip = ({ active, payload }: any) => {
269:     if (active && payload && payload.length) {
270:       const data = payload[0].payload
271:       const open = data.open ?? 0
272:       const close = data.price ?? 0
273:       
274:       const getValColor = (val: number, ref: number, relation: 'high' | 'low' | 'close' | 'cost') => {
275:         if (relation === 'high') return val > ref ? 'text-[#ef4444]' : 'text-white'
276:         if (relation === 'low') return val < ref ? 'text-[#22c55e]' : 'text-white'
277:         if (relation === 'close') {
278:           if (val > ref) return 'text-[#ef4444]'
279:           if (val < ref) return 'text-[#22c55e]'
280:           return 'text-white'
281:         }
282:         if (relation === 'cost') {
283:           if (val > close) return 'text-[#ef4444]'
284:           if (val < close) return 'text-[#22c55e]'
285:           return 'text-white'
286:         }
287:         return 'text-white'
288:       }
289: 
290:       return (
291:         <div className="glass p-3 border-white/10 text-sm font-bold shadow-2xl z-50">
292:           <div className="text-[11px] text-[var(--t3)] mb-2 uppercase tracking-widest">{data.date}</div>
293:           <div className="flex justify-between gap-4 mb-1">
294:             <span className="text-[12px] text-[var(--t2)] flex-1">收盤價</span>
295:             <span className={`font-mono ${getValColor(close, open, 'close')}`}>{close.toFixed(2)}</span>
296:           </div>
297:           {data.avgCost !== null && (
298:             <div className="flex justify-between gap-4 mb-1">
299:               <span className="text-[12px] text-[var(--t2)] flex-1">對應均價</span>
300:               <span className={`font-mono ${getValColor(data.avgCost, close, 'cost')}`}>{(data.avgCost ?? 0).toFixed(2)}</span>
301:             </div>
302:           )}
303:           {data.isBuy && (
304:             <div className="mt-2 pt-2 border-t border-[#e05050]/20">
305:               <div className="text-[11px] font-black text-[#e05050] mb-0.5">買入紀錄</div>
306:               <div className="flex justify-between gap-4">
307:                 <span className="text-[11px] text-[#e05050]/70">價格:</span>
308:                 <span className="text-[11px] text-[#e05050]">{(data.txPrice ?? 0).toFixed(2)} 元</span>
309:               </div>
310:               <div className="flex justify-between gap-4">
311:                 <span className="text-[11px] text-[#e05050]/70">數量:</span>
312:                 <span className="text-[11px] text-[#e05050]">{(data.txShares ?? 0).toLocaleString()} 股</span>
313:               </div>
314:               <div className="flex justify-between gap-4 mt-1 border-t border-[#e05050]/20 pt-1">
315:                 <span className="text-[11px] text-[#e05050]/70">買入後新均價:</span>
316:                 <span className="text-[11px] font-black text-[#e05050]">{(data.avgCost ?? 0).toFixed(2)}</span>
317:               </div>
318:             </div>
319:           )}
320:         </div>
321:       )
322:     }
323:     return null
324:   }
325: 
326:   const scrollerRef = useRef<HTMLDivElement>(null)
327:   const [isScrubbing, setIsScrubbing] = useState(false)
328:   const scrubTimer = useRef<any>(null)
329: 
330:   // ── Step 2-3: 雙軸縮放與佈局狀態 ──
331:   const [pointWidth, setPointWidth] = useState(16) // 每根 K 線佔用的寬度
332:   const [yDomain, setYDomain] = useState<[number, number]>([0, 100])
333:   const [visibleIdxRange, setVisibleIdxRange] = useState<[number, number]>([0, 30])
334:   const [isManualY, setIsManualY] = useState(false)
335:   
336:   const chartHeight = 280
337:   const candleGap = 4
338:   const candleWidth = useMemo(() => {
339:     // K 線主體寬度約為單個點寬度的 90%，實現「緊貼」感
340:     return Math.max(2, pointWidth * 0.9)
341:   }, [pointWidth])
342: 
343:   const totalPoints = enrichedStockHistory.length
344:   const totalWidth = totalPoints * pointWidth
345: 
346:   // Step 4: 自動適配 (Auto-scale) 邏輯
347:   useEffect(() => {
348:     if (isManualY || !enrichedStockHistory.length) return
349:     const [start, end] = visibleIdxRange
350:     const visibleData = enrichedStockHistory.slice(start, end + 1)
351:     if (!visibleData.length) return
352: 
353:     const vals = visibleData.flatMap(d => [d.high, d.low, d.open, d.close])
354:       .filter(v => typeof v === 'number' && v > 0)
355:     if (vals.length === 0) return
356: 
357:     const min = Math.min(...vals)
358:     const max = Math.max(...vals)
359:     const range = max - min
360:     const pad = range * 0.1
361:     let rawMin = min - pad
362:     let rawMax = max + pad
363: 
364:     // 移除強制將最新收盤價置中於 Y 軸的邏輯，讓 K 線自然展開並平均分散在 Y 軸上
365:     let newMin = Math.floor(rawMin)
366:     let newMax = Math.ceil(rawMax)
367:     let newRange = newMax - newMin
368:     // 確保 Range 正確且能被 4 整除
369:     while (newRange % 4 !== 0 || newRange < 4) {
370:       newMax++
371:       newRange = newMax - newMin
372:     }
373:     
406:     setYDomain([newMin, newMax])
407:   }, [visibleIdxRange, enrichedStockHistory, isManualY])
408: 
409:   // 監聽滾動以決定可見區間
410:   const handleScroll = () => {
411:     const scroller = scrollerRef.current
412:     if (!scroller) return
413:     const scrollLeft = scroller.scrollLeft
414:     const viewportWidth = scroller.clientWidth
415:     
416:     const startIdx = Math.floor(scrollLeft / pointWidth)
417:     const endIdx = Math.ceil((scrollLeft + viewportWidth) / pointWidth)
418:     
419:     setVisibleIdxRange([Math.max(0, startIdx), Math.min(totalPoints - 1, endIdx)])
420:   }
421: 
422:   // 手勢控制：雙指縮放 (X 軸數據密度 + Y 軸區間)
423:   const bind = useGesture(
424:     {
425:       onPinch: ({ offset: [d], delta: [scale] }) => {
426:         setIsManualY(true)
427:         // 1. Y 軸價格縮放 (上下縮放)
428:         const zoomY = Math.pow(1.01, -d)
429:         const rangeY = yDomain[1] - yDomain[0]
430:         const midY = (yDomain[1] + yDomain[0]) / 2
431:         const newRangeY = rangeY * zoomY
432:         setYDomain([midY - newRangeY / 2, midY + newRangeY / 2])
433: 
434:         // 2. X 軸 K 線寬度縮放 (左右縮放)
435:         // 根據縮放手勢調整 pointWidth
436:         setPointWidth(prev => {
437:           const next = prev * (1 + scale * 0.05)
438:           return Math.min(100, Math.max(4, next)) // 限制寬度在 4px 到 100px 之間
439:         })
440:       },
441:       onDrag: ({ delta: [, dy], first }) => {
442:         if (isScrubbingMode) return // 查價時不移動圖表
443:         if (first) setIsManualY(true)
444:         const rangeY = yDomain[1] - yDomain[0]
445:         const pricePerPixel = rangeY / chartHeight
446:         const shiftY = dy * pricePerPixel
447:         setYDomain([yDomain[0] + shiftY, yDomain[1] + shiftY])
448:       }
449:     },
450:     { drag: { filterTaps: true, threshold: 5 }, pinch: { eventOptions: { passive: false } } }
451:   )
452: 
453:   const yScale = (price: number) => {
454:     const min = yDomain[0]
455:     const max = yDomain[1]
456:     return chartHeight - ((price - min) / (max - min)) * chartHeight
457:   }
458: 
459:   useEffect(() => {
460:     setIsManualY(false) // 切換個股時重置為自動對齊模式
461:     if (enrichedStockHistory.length > 0 && scrollerRef.current) {
462:       const chartWidth = scrollerRef.current.clientWidth - 32 // 扣除 padding
463:       
464:       // 根據範圍設定目標顯示的天數
465:       const targetDaysMap: Record<string, number> = {
466:         '1M': 22,
467:         '3M': 66,
468:         '6M': 132,
469:         '9M': 200,
470:         '1Y': 250,
471:         'CUSTOM': 30
472:       }
473:       const targetDays = targetDaysMap[stockRange] || 30
474:       
475:       // 計算適合的 pointWidth
476:       const idealPointWidth = Math.max(4, Math.min(60, chartWidth / targetDays))
477:       setPointWidth(idealPointWidth)
478: 
479:       setTimeout(() => {
480:         if (scrollerRef.current) {
481:           scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth
482:           handleScroll()
483:         }
484:       }, 100)
485:     }
486:   }, [enrichedStockHistory.length, selSym, stockRange])
487: 
488:   const [activeIdx, setActiveIdx] = useState<number | null>(null)
489:   const scrubTimerRef = useRef<NodeJS.Timeout | null>(null)
490:   const [isScrubbingMode, setIsScrubbingMode] = useState(false)
491:   const lastPosRef = useRef({ x: 0, y: 0 })
492: 
493:   const handleStartTimer = (e: React.TouchEvent | React.MouseEvent) => {
494:     if (isScrubbingMode) return
495:     // Only allow long-press for touch events (mobile)
496:     if (e.type !== 'touchstart') return
497: 
498:     const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
499:     const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
500:     lastPosRef.current = { x: clientX, y: clientY }
501: 
502:     scrubTimerRef.current = setTimeout(() => {
503:       setIsScrubbingMode(true)
504:       if (window.navigator.vibrate) window.navigator.vibrate(10)
505:     }, 1000)
506:   }
507: 
508:   const handleEndTimer = () => {
509:     if (scrubTimerRef.current) {
510:       clearTimeout(scrubTimerRef.current)
511:       scrubTimerRef.current = null
512:     }
513:   }
514: 
515:   // 單點螢幕退出查價模式
516:   const handleChartClick = () => {
517:     if (isScrubbingMode) {
518:       setIsScrubbingMode(false)
519:       setActiveIdx(null)
520:     }
521:   }
522: 
523:   const handleChartDoubleClick = (e: React.MouseEvent) => {
524:     if (isScrubbingMode) return
525:     setIsScrubbingMode(true)
526:     if (!scrollerRef.current || enrichedStockHistory.length === 0) return
527:     const rect = scrollerRef.current.getBoundingClientRect()
528:     const scrollX = e.clientX - rect.left + scrollerRef.current.scrollLeft
529:     const idx = Math.floor(scrollX / pointWidth)
530:     if (idx >= 0 && idx < enrichedStockHistory.length) {
531:       setActiveIdx(idx)
532:     }
533:   }
534: 
535:   const handleChartMove = (e: React.MouseEvent | React.TouchEvent) => {
536:     const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
537:     const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
538: 
539:     // 如果正在計時但尚未進入查價模式，檢查位移是否超過門檻 (10px) 以區分拖拽與長按
540:     if (scrubTimerRef.current && !isScrubbingMode) {
541:       const dx = Math.abs(clientX - lastPosRef.current.x)
542:       const dy = Math.abs(clientY - lastPosRef.current.y)
543:       if (dx > 10 || dy > 10) {
544:         handleEndTimer()
545:       }
546:     }
547: 
548:     if (e.type === 'touchmove' && !isScrubbingMode) {
549:       // 如果不是查價模式，讓瀏覽器處理原生捲動
550:       return
551:     }
552: 
553:     if (e.type === 'touchmove' && isScrubbingMode) {
554:       e.preventDefault() // 禁用捲動
555:     }
556: 
557:     if (!scrollerRef.current || enrichedStockHistory.length === 0) return
558:     const scroller = scrollerRef.current
559:     if (!scroller) return
560:     const rect = scroller.getBoundingClientRect()
561:     const localY = clientY - rect.top
562: 
563:     // 如果進入查價模式且滑鼠位於上方資訊框區域 (Y < 120px)，暫停更新索引以方便點擊新聞按鈕
564:     // 僅針對 mousemove，手機端觸控移動仍維持同步
565:     if (isScrubbingMode && e.type === 'mousemove' && localY < 120) {
566:       return
567:     }
568: 
569:     const scrollX = clientX - rect.left + scroller.scrollLeft
570:     const idx = Math.floor(scrollX / pointWidth)
571:     if (idx >= 0 && idx < enrichedStockHistory.length) {
572:       setActiveIdx(idx)
573:     }
574:   }
575: 
576:   const handleSearchNews = (index: number) => {
577:     if (!enrichedStockHistory[index]) return
578:     const stockName = quotes[selSym]?.name_zh || getStockName(selSym)
579:     const stockCode = codeOnly(selSym)
580:     const query = `${stockName} ${stockCode}`
581:     
582:     // 計算搜尋範圍：前一個交易日到下一個交易日 (包含)
583:     const startData = index > 0 ? enrichedStockHistory[index - 1] : enrichedStockHistory[index]
584:     const endData = index < enrichedStockHistory.length - 1 ? enrichedStockHistory[index + 1] : enrichedStockHistory[index]
585: 
586:     const formatDateForGoogle = (dateStr: string) => {
587:       const [y, m, d] = dateStr.split('-')
588:       return `${m}/${d}/${y}`
589:     }
590: 
591:     const minDate = formatDateForGoogle(startData.date)
592:     const maxDate = formatDateForGoogle(endData.date)
593:     
594:     // Build Google News Search URL with calculated date range
595:     const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=cdr:1,cd_min:${minDate},cd_max:${maxDate}`
596:     window.open(url, '_blank')
597:   }
598: 
599:   return (
600:     <div className="p-4 space-y-8 pb-20 animate-slide-up w-full overflow-x-hidden select-none [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none">
601:       {/* ── 1. 各股分析 ── */}
602:       <section className="space-y-4">
603:         <div className="flex flex-col space-y-3 px-1">
604:           <h3 className="flex items-center gap-2 text-[13px] font-black text-[var(--t2)] uppercase tracking-wider whitespace-nowrap">
605:             <TrendingUp size={16} className="text-accent inline mr-1" /> 單一個股走勢分析
606:           </h3>
607:           
608:           <div className="flex flex-col gap-3">
609:              <select 
610:               value={selSym} 
611:               onChange={e => setSelSym(e.target.value)}
612:               className="w-full bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-xl px-4 py-3 text-[15px] font-black text-[var(--t2)] outline-none focus:border-accent transition-all appearance-none cursor-pointer shadow-lg"
613:             >
614:               {sortedHoldings.map(h => (
615:                 <option key={h.symbol} value={h.symbol} className="bg-[var(--bg-card)]">
616:                   {quotes[h.symbol]?.name_zh || getStockName(h.symbol)} ({codeOnly(h.symbol)})
617:                 </option>
618:               ))}
619:             </select>
620: 
621:             <div className="flex w-full gap-1.5 scrollbar-hide">
622:               {(['1M', '3M', '6M', '9M', '1Y'] as StockRange[]).map(r => (
623:                 <button 
624:                   key={r} onClick={() => { 
625:                     setStockRange(r); 
626:                     setShowCustomStock(false);
627:                     // 儲存預設範圍至資料庫
628:                     updateSettings({ stock_chart_default_range: r });
629:                   }}
630:                   className={`flex-1 py-2.5 rounded-xl text-[11px] font-black transition-all border ${stockRange === r && !showCustomStock ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-[var(--bg-card)] text-[var(--t2)] opacity-60 border-[var(--border-bright)] whitespace-nowrap'}`}
631:                 >
632:                   {r}
633:                 </button>
634:               ))}
635:               <button 
636:                 onClick={() => { setStockRange('CUSTOM'); setShowCustomStock(!showCustomStock); }}
637:                 className={`px-4 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-black transition-all border ${stockRange === 'CUSTOM' ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-[var(--bg-card)] text-[var(--t2)] opacity-60 border-[var(--border-bright)]'}`}
638:               >
639:                 <CalendarIcon size={14} />
640:               </button>
641:             </div>
642:           </div>
643:         </div>
644: 
645:         {showCustomStock && (
646:           <div className="flex items-center justify-end gap-3 px-1 py-1 animate-slide-up bg-[var(--bg-card)] rounded-2xl border border-[var(--border-bright)] shadow-xl">
647:             <div className="flex items-center gap-2">
648:               <span className="text-[10px] font-black text-[var(--t2)] opacity-60">起</span>
649:               <DatePicker value={customStockStart} onChange={(v: string) => setCustomStockStart(v)} fixedYear={Number(selectedYear)} />
650:             </div>
651:             <div className="flex items-center gap-2 pr-2">
652:               <span className="text-[10px] font-black text-[var(--t2)] opacity-60">迄</span>
653:               <DatePicker value={customStockEnd} onChange={(v: string) => setCustomStockEnd(v)} fixedYear={Number(selectedYear)} />
654:             </div>
655:           </div>
656:         )}
657: 
658:         <div className="relative group bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl shadow-2xl overflow-hidden">
659:           <div className="flex h-[320px]">
660:             {/* 1. Plot Area (Scrollable) */}
661:             <div 
662:               {...bind()}
663:               ref={scrollerRef}
664:               onScroll={handleScroll}
665:               className={`flex-1 relative ${isScrubbingMode ? 'overflow-x-hidden' : 'overflow-x-auto'} overflow-y-hidden scrollbar-hide pl-4`}
666:               style={{ WebkitOverflowScrolling: 'touch', touchAction: isScrubbingMode ? 'none' : 'pan-x' }}
667:             >
668:               <div style={{ width: `${totalWidth}px`, height: `${chartHeight}px`, position: 'relative', marginTop: '16px' }}>
669:                     <svg 
670:                         width={enrichedStockHistory.length * pointWidth} 
671:                         height="100%" 
672:                         className="overflow-visible"
673:                         style={{ touchAction: isScrubbingMode ? 'none' : 'pan-x' }}
674:                         onClick={handleChartClick}
675:                         onDoubleClick={handleChartDoubleClick}
676:                         onMouseMove={handleChartMove}
677:                         onMouseLeave={() => { 
678:                           handleEndTimer()
679:                           if (!isScrubbingMode) setActiveIdx(null) 
680:                         }}
681:                         onTouchStart={handleStartTimer}
682:                         onTouchMove={handleChartMove}
683:                         onTouchEnd={handleEndTimer}
684:                       >
685:                     <g>
686:                       {/* Horizontal Grid Lines (aligned with price ticks) */}
687:                       {[0, 1, 2, 3, 4].map(i => {
688:                         const y = chartHeight * (i * 0.25)
689:                         return (
690:                           <line key={i} x1="0" y1={y} x2="100%" y2={y} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
691:                         )
692:                       })}
693: 
694:                       {/* Vertical Grid Lines (Month starts & Buy days) */}
695:                       {enrichedStockHistory.map((d, i) => {
696:                         const isMonthStart = i === 0 || d.date.slice(5, 7) !== enrichedStockHistory[i - 1].date.slice(5, 7)
697:                         if (!isMonthStart && !d.isBuy) return null
698: 
699:                         const x = i * pointWidth + pointWidth / 2
700:                         return (
701:                           <line 
702:                             key={`vgrid-${i}`} 
703:                             x1={x} y1="0" x2={x} y2={chartHeight} 
704:                             stroke="rgba(255,255,255,0.06)" 
705:                             strokeWidth="1" 
706:                           />
707:                         )
708:                       })}
709:                     </g>
710:                   
711:                   {settings.stock_chart_style === 'detailed' ? (
712:                     <g>
713:                       {enrichedStockHistory.map((d, i) => {
714:                         const midX = i * pointWidth + pointWidth / 2
715:                         const yHigh = yScale(d.high)
716:                         const yLow = yScale(d.low)
717:                         const yOpen = yScale(d.open)
718:                         const yClose = yScale(d.close)
719:                         const bodyTop = Math.min(yOpen, yClose)
720:                         const bodyHeight = Math.max(1, Math.abs(yOpen - yClose))
721:                         const color = d.isUp ? '#ef4444' : '#22c55e'
722:                         
723:                         return (
724:                           <g key={i}>
725:                             {/* Vertical Align: K-line center at midX */}
726:                             <line x1={midX} y1={yHigh} x2={midX} y2={yLow} stroke={color} strokeWidth="1.5" />
727:                             <rect 
728:                               x={midX - candleWidth / 2} 
729:                               y={bodyTop} 
730:                               width={candleWidth} 
731:                               height={bodyHeight} 
732:                               fill={color} 
733:                               rx="1"
734:                             />
735:                           </g>
736:                         )
737:                       })}
738:                     </g>
739:                   ) : (
740:                     <path 
741:                       d={enrichedStockHistory.map((d, i) => {
742:                         const x = i * pointWidth + pointWidth / 2
743:                         return `${i === 0 ? 'M' : 'L'} ${x} ${yScale(d.close)}`
744:                       }).join(' ')}
745:                       fill="none"
746:                       stroke="var(--accent)"
747:                       strokeWidth="3"
748:                     />
749:                   )}
750: 
751:                   {/* Step Cost Line (Piecewise Horizontal Path) - Moved AFTER candles to be on top */}
752:                   <path 
753:                     d={(() => {
754:                       let pathStr = ''
755:                       let isDrawing = false
756:                       enrichedStockHistory.forEach((d, i) => {
757:                         const x = i * pointWidth + pointWidth / 2
758:                         const nextX = (i + 1) * pointWidth + pointWidth / 2
759:                         if (d.avgCost !== null) {
760:                           const y = yScale(d.avgCost)
761:                           if (!isDrawing) {
762:                             pathStr += `M ${x} ${y} L ${nextX} ${y} `
763:                             isDrawing = true
764:                           } else {
765:                             pathStr += `L ${x} ${y} L ${nextX} ${y} `
766:                           }
767:                         } else {
768:                           isDrawing = false
769:                         }
770:                       })
771:                       return pathStr
772:                     })()}
773:                     fill="none"
774:                     stroke="#ffffff"
775:                     strokeWidth="1.5"
776:                     strokeDasharray="4 4"
777:                     opacity="0.6"
778:                   />
779: 
780:                   {/* Scrubbing Indicators */}
781:                   {isScrubbingMode && activeIdx !== null && enrichedStockHistory[activeIdx] && (
782:                     <g>
783:                       <line 
784:                         x1={activeIdx * pointWidth + pointWidth / 2} 
785:                         y1="0" 
786:                         x2={activeIdx * pointWidth + pointWidth / 2} 
787:                         y2={chartHeight} 
788:                         stroke="var(--accent)" 
789:                         strokeWidth="1.5" 
790:                       />
791:                       <circle 
792:                         cx={activeIdx * pointWidth + pointWidth / 2} 
793:                         cy={yScale(enrichedStockHistory[activeIdx].close)} 
794:                         r="4" 
795:                         fill="var(--accent)" 
796:                         stroke="#fff" 
797:                         strokeWidth="2" 
798:                       />
799:                     </g>
800:                   )}
801:                 </svg>
802:                 
803:                 {/* X-Axis Dates */}
804:                 <div className="absolute bottom-0 left-0 right-0 h-4 flex items-center pointer-events-none">
805:                   {enrichedStockHistory.map((d, i) => {
806:                     const isMonthStart = i === 0 || d.date.slice(5, 7) !== enrichedStockHistory[i - 1].date.slice(5, 7)
807:                     if (!isMonthStart && !d.isBuy) return null 
808:                     
809:                     const label = isMonthStart ? `${parseInt(d.date.slice(5, 7))}月` : d.date.slice(5)
810: 
811:                     return (
812:                       <div 
813:                         key={i} 
814:                         className={`absolute text-[9px] font-black whitespace-nowrap -translate-x-1/2 transition-all px-1.5 py-0.5 rounded-sm ${d.isBuy ? 'bg-[#facc15] text-black z-20 shadow-md transform scale-110' : 'text-white/20'}`} 
815:                         style={{ left: i * pointWidth + pointWidth / 2, bottom: d.isBuy ? '2px' : '0px' }}
816:                       >
817:                         {label}
818:                       </div>
819:                     )
820:                   })}
821:                 </div>
822:               </div>
823:             </div>
824: 
825:             {/* 2. Sticky Y-Axis Zone (Right Aligned, Fixed) */}
826:             <div className="w-14 bg-black/40 backdrop-blur-md border-l border-white/5 relative z-30 sticky right-0 h-full">
827:               <div className="relative w-full" style={{ height: `${chartHeight}px`, marginTop: '16px' }}>
828:                 {[0, 1, 2, 3, 4].map(i => {
829:                   const p = 1 - (i * 0.25)
830:                   const val = yDomain[0] + (yDomain[1] - yDomain[0]) * p
831:                   const y = chartHeight * (i * 0.25)
832:                   return (
833:                     <div 
834:                       key={p} 
835:                       className="absolute w-full flex items-center pr-2"
836:                       style={{ top: y, transform: 'translateY(-50%)' }}
837:                     >
838:                       <div className="w-2 h-[1px] bg-white/20 mr-1.5" />
839:                       <div className="text-[10px] font-black text-white/60 tabular-nums">
840:                         {Math.round(val ?? 0).toLocaleString()}
841:                       </div>
842:                     </div>
843:                   )
844:                 })}
845:               </div>
846:             </div>
847:           </div>
848:           
849:           {loadingStock && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><RefreshCw size={24} className="animate-spin text-accent" /></div>}
850: 
851:           {isScrubbingMode && activeIdx !== null && enrichedStockHistory[activeIdx] && (
852:             <div 
853:               className="absolute top-4 z-40 p-3 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in fade-in duration-200 min-w-[140px] flex flex-col gap-3 transition-all duration-300"
854:               style={(() => {
855:                 const scrollLeft = scrollerRef.current?.scrollLeft || 0
856:                 const containerWidth = scrollerRef.current?.clientWidth || 300
857:                 const rawX = activeIdx * pointWidth + pointWidth / 2
858:                 const localX = rawX - scrollLeft
859:                 const isLeftHalf = localX < containerWidth / 2
860:                 
861:                 // 增加偏移量 (60px) 以拉開資訊框與垂直線的距離
862:                 if (isLeftHalf) {
863:                   return { left: localX + 60, right: 'auto' }
864:                 } else {
865:                   return { right: containerWidth - localX + 60, left: 'auto' }
866:                 }
867:               })()}
868:             >
869:                <div>
870:                  <div className="text-[10px] font-black text-accent uppercase mb-1">{enrichedStockHistory[activeIdx].date}</div>
871:                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
872:                    {(() => {
873:                      const d = enrichedStockHistory[activeIdx]
874:                      const open = d.open ?? 0
875:                      const close = d.close ?? 0
876:                      const high = d.high ?? 0
877:                      const low = d.low ?? 0
878:                      
879:                      const getC = (v: number, ref: number, rel: string) => {
880:                        if (rel === 'h') return v > ref ? '#ef4444' : '#fff'
881:                        if (rel === 'l') return v < ref ? '#22c55e' : '#fff'
882:                        if (v > ref) return '#ef4444'
883:                        if (v < ref) return '#22c55e'
884:                        return '#fff'
885:                      }
886: 
887:                      return (
888:                        <>
889:                           <div className="text-[10px] text-white/40">開盤</div><div className="text-[11px] font-black text-white">{open.toFixed(1)}</div>
890:                           <div className="text-[10px] text-white/40">最高</div><div className="text-[11px] font-black" style={{ color: getC(high, open, 'h') }}>{high.toFixed(1)}</div>
891:                           <div className="text-[10px] text-white/40">最低</div><div className="text-[11px] font-black" style={{ color: getC(low, open, 'l') }}>{low.toFixed(1)}</div>
892:                           <div className="text-[10px] text-white/40">收盤</div><div className="text-[11px] font-black" style={{ color: getC(close, open, 'c') }}>{close.toFixed(1)}</div>
893:                           {d.avgCost && (
894:                             <>
895:                               <div className="text-[10px] text-white/40">均價</div><div className="text-[11px] font-black" style={{ color: getC(d.avgCost, close, 'avg') }}>{d.avgCost.toFixed(1)}</div>
896:                             </>
897:                           )}
898:                        </>
899:                      )
900:                    })()}
901:                  </div>
902:                </div>
903: 
904:                <button 
905:                 onClick={(e) => {
906:                   e.stopPropagation();
907:                   handleSearchNews(activeIdx);
908:                 }}
909:                 className="flex items-center justify-center gap-2 py-2 px-3 bg-accent/20 hover:bg-accent/30 border border-accent/30 rounded-xl transition-all group/btn active:scale-95"
910:                >
911:                  <Newspaper size={12} className="text-accent group-hover/btn:scale-110 transition-transform" />
912:                  <span className="text-[11px] font-black text-accent">搜尋當日新聞</span>
913:                  <ExternalLink size={10} className="text-accent/50 ml-auto" />
914:                </button>
915:             </div>
916:           )}
917:         </div>
918: 
919:         {selectedHolding && (
920:           <div className="grid grid-cols-2 gap-3">
921:             <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
922:               <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時平均成本</div>
923:               <div className="text-[18px] font-black text-[var(--t1)] font-mono">
924:                 {(selectedHolding.avg_cost ?? 0).toFixed(2)}
925:               </div>
926:             </div>
927:             <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-4 shadow-xl">
928:               <div className="text-[11px] font-black text-[var(--t2)] opacity-70 uppercase mb-1">現時股價 vs 成本</div>
929:               <div className={`text-[18px] font-black font-mono ${(selectedHolding.pnl_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
930:                 {selectedHolding.pnl_pct !== undefined ? `${selectedHolding.pnl_pct >= 0 ? '+' : ''}${selectedHolding.pnl_pct.toFixed(2)}%` : '0.00%'}
931:               </div>
932:             </div>
933:           </div>
934:         )}
935:       </section>
936: 
937:       {/* ── 0. 年度進度圖 (移至下方) ── */}
938:       <section className="space-y-4">
939:         <div className="flex items-center justify-between px-1">
940:           <div className="flex items-center gap-2">
941:             <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">年度目標進度</span>
942:             <select 
943:               value={selectedYear}
944:               onChange={e => setSelectedYear(e.target.value)}
945:               className="bg-white/5 border border-white/10 rounded-lg px-3 py-1 text-[12px] font-black text-accent outline-none ml-2"
946:             >
947:               {['2023', '2024', '2025', '2026', '2027'].map(y => <option key={y} value={y}>{y} 年</option>)}
948:             </select>
949:           </div>
950: 
951:         </div>
952: 
953:         {hasGoal ? (
954:           <YearlyPnLChart 
955:             transactions={transactions} 
956:             settings={{ ...settings, year_goal: yearGoal }} 
957:             year={Number(selectedYear)}
958:           />
959:         ) : (
960:           <div className="bg-[var(--bg-card)] border border-dashed border-accent/20 rounded-[48px] p-12 text-center space-y-4 shadow-sm">
961:             <div className="w-16 h-16 bg-accent/5 rounded-full flex items-center justify-center mx-auto mb-2">
962:               <span className="text-2xl">🎯</span>
963:             </div>
964:             <h4 className="text-[15px] font-black text-[var(--t1)]">尚未設定 {selectedYear} 年度目標</h4>
965:             <p className="text-[12px] text-[var(--t2)] opacity-60 leading-relaxed max-w-[200px] mx-auto">
966:               請前往「設定」頁面為該年份設定投資獲利目標，以便開始追蹤進度。
967:             </p>
968:             <div className="pt-2">
969:               <button 
970:                onClick={() => {
971:                  window.dispatchEvent(new CustomEvent('changeTab', { detail: 'settings' }))
972:                }}
973:                className="px-6 py-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent text-[12px] font-black active:scale-95 transition-all"
974:               >
975:                 前往設定
976:               </button>
977:             </div>
978:           </div>
979:         )}
980:       </section>
981: 
982:       {/* ── 00. 總進度圖 (移至最下方) ── */}
983:       <section className="space-y-4">
984:         <div className="px-1">
985:           <span className="text-[13px] font-black text-[var(--t2)] uppercase tracking-wider">總目標進度</span>
986:         </div>
987:         <TotalPnLChart 
988:           transactions={stats.fullHistoryStats ? Object.values(stats.fullHistoryStats).flatMap((s: any) => s.history) : []} 
989:           settings={settings} 
990:         />
991:       </section>
992:     </div>
993:   )
994: }
