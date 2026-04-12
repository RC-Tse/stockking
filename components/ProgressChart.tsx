'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { fmtMoney } from '@/types'

interface DataPoint {
  date: string
  actual: number | null
  ideal: number
  isFuture: boolean
  isIntersection?: boolean
}

interface ProgressChartProps {
  title: string
  subtitle: string
  data: DataPoint[]
  goal: number
  currentValue: number
  loading?: boolean
}

export default function ProgressChart({ title, subtitle, data, goal, currentValue, loading }: ProgressChartProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrubTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [isScrubbingMode, setIsScrubbingMode] = useState(false)
  
  const chartHeight = 300
  const pointWidth = 12 // Adjust based on data length or fixed
  const chartWidth = Math.max(0, data.length * pointWidth)
  const paddingX = 40
  
  // Calculate Y Domain
  const yAxis = useMemo(() => {
    const vals = data.filter(d => d.actual !== null && !d.isIntersection).flatMap(d => [d.actual!, d.ideal])
    if (vals.length === 0) return { domain: [0, goal || 100], ticks: [0, (goal || 100) / 2, goal || 100] }

    const dataMin = Math.min(0, ...vals)
    const dataMax = Math.max(goal, ...vals)
    
    const bufferMax = dataMax * 1.1
    const bufferMin = dataMin < 0 ? dataMin * 1.1 : 0
    
    const range = bufferMax - bufferMin
    const snapUnit = range > 10000 ? 1000 : 500
    
    const finalMax = Math.ceil(bufferMax / snapUnit) * snapUnit
    const finalMin = dataMin < 0 ? Math.floor(bufferMin / snapUnit) * snapUnit : 0
    
    const ticks = []
    for (let v = finalMin; v <= finalMax; v += snapUnit) {
      ticks.push(v)
    }
    return { 
      domain: [finalMin, finalMax] as [number, number], 
      ticks: Array.from(new Set(ticks)).sort((a,b) => a-b) 
    }
  }, [data, goal])

  const yScale = (val: number) => {
    const [min, max] = yAxis.domain
    return chartHeight - ((val - min) / (max - min)) * chartHeight
  }

  // Handlers for Sticky Scrubbing
  const handleTouchStart = () => {
    if (isScrubbingMode) return
    scrubTimerRef.current = setTimeout(() => {
      setIsScrubbingMode(true)
      if (window.navigator.vibrate) window.navigator.vibrate(10)
    }, 1000)
  }

  const handleTouchEnd = () => {
    if (scrubTimerRef.current) {
      clearTimeout(scrubTimerRef.current)
      scrubTimerRef.current = null
    }
  }

  const handleChartMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.type === 'touchmove' && isScrubbingMode) e.preventDefault()
    if (!scrollerRef.current || data.length === 0) return
    const rect = scrollerRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const scrollX = clientX - rect.left + scrollerRef.current.scrollLeft
    const idx = Math.floor((scrollX - paddingX / 2) / pointWidth)
    if (idx >= 0 && idx < data.length) {
      setActiveIdx(idx)
    }
  }

  const handleChartClick = () => {
    if (isScrubbingMode) {
      setIsScrubbingMode(false)
      setActiveIdx(null)
    }
  }

  if (loading) {
    return (
      <div className="h-[400px] flex items-center justify-center bg-[var(--bg-card)] rounded-[48px] border border-[var(--border-bright)]">
         <div className="flex flex-col items-center gap-2">
           <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
           <span className="text-[10px] font-black text-[var(--t2)] opacity-80 uppercase tracking-widest">載入數據中...</span>
         </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-slide-up w-full">
      <div className="flex items-end justify-between px-4">
        <div className="space-y-1">
          <h3 className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em]">{title}</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-[var(--t1)] font-mono">{fmtMoney(goal)}</span>
            <span className="text-[11px] font-bold text-accent opacity-60 uppercase tracking-widest">Goal</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em] mb-1">{subtitle}</div>
          <div className={`text-2xl font-black font-mono ${currentValue >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {fmtMoney(currentValue)}
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[48px] p-0 shadow-2xl relative overflow-hidden group">
        
        {/* Legends */}
        <div className="absolute top-10 left-0 right-0 flex justify-center gap-10 z-10 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0 border-t-2 border-[#fbbf24] border-dashed" />
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">理想</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-[3px] w-6 rounded-full overflow-hidden items-center">
              <div className="bg-[#ef4444] h-full flex-1" />
              <div className="bg-[#22c55e] h-full flex-1" />
            </div>
            <span className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">實際</span>
          </div>
        </div>

        <div 
          ref={scrollerRef}
          className={`h-[400px] w-full py-20 ${isScrubbingMode ? 'overflow-x-hidden' : 'overflow-x-auto'} scrollbar-hide`}
          style={{ WebkitOverflowScrolling: 'touch', touchAction: isScrubbingMode ? 'none' : 'pan-x' }}
        >
          <div 
            style={{ width: `${chartWidth + paddingX}px`, height: `${chartHeight}px`, position: 'relative' }}
            onClick={handleChartClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleChartMove}
            onTouchEnd={handleTouchEnd}
            onMouseMove={handleChartMove}
            onMouseLeave={() => { if (!isScrubbingMode) setActiveIdx(null) }}
          >
            <svg width={chartWidth + paddingX} height={chartHeight} className="overflow-visible">
              <g transform={`translate(${paddingX / 2}, 0)`}>
                {/* Y-Axis Grid */}
                {yAxis.ticks.map(t => (
                  <g key={t}>
                    <line x1="0" y1={yScale(t)} x2={chartWidth} y2={yScale(t)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                    <text x={chartWidth + 5} y={yScale(t) + 4} fill="#888" fontSize="10" fontWeight="900" textAnchor="start">
                      {Math.abs(t) >= 1000 ? `${(t/1000).toFixed(0)}K` : fmtMoney(t)}
                    </text>
                  </g>
                ))}

                {/* Y=0 thick line */}
                <line x1="0" y1={yScale(0)} x2={chartWidth} y2={yScale(0)} stroke="#ffffff" strokeWidth="2.5" opacity="0.9" />
                
                {/* X=0 thick line (Vertical start) */}
                <line x1="0" y1="0" x2="0" y2={chartHeight} stroke="#ffffff" strokeWidth="2.5" opacity="0.9" />

                {/* Ideal Path (Dashed) */}
                <path 
                  d={data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${i * pointWidth} ${yScale(d.ideal)}`).join(' ')}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  opacity="0.6"
                />

                {/* Actual Area & Line (Red/Green logic) */}
                {/* For simplicity we draw the line and use intersection logic to split color */}
                {/* Re-implementing the crossing-aware pathing is complex but needed for visual fidelity */}
                {(() => {
                   const segments: { type: 'red' | 'green', points: [number, number][] }[] = []
                   let currentSegment: { type: 'red' | 'green', points: [number, number][] } | null = null
                   
                   for (let i = 0; i < data.length; i++) {
                     const d = data[i]
                     const next = data[i + 1]
                     if (d.actual === null || d.isFuture) {
                       if (currentSegment) { segments.push(currentSegment); currentSegment = null; }
                       continue
                     }
                     
                     const isAhead = d.actual >= d.ideal
                     const type = isAhead ? 'red' : 'green'
                     const x = i * pointWidth
                     const y = yScale(d.actual)
                     
                     if (!currentSegment || currentSegment.type !== type) {
                        if (currentSegment) segments.push(currentSegment)
                        currentSegment = { type, points: [[x, y]] }
                     } else {
                        currentSegment.points.push([x, y])
                     }
                     
                     // Handle Crossing
                     if (next && next.actual !== null && !next.isFuture) {
                       const nextAhead = next.actual >= next.ideal
                       if (isAhead !== nextAhead) {
                         // Find crossing point Y
                         const dyActual = next.actual - d.actual
                         const dyIdeal = next.ideal - d.ideal
                         const denom = dyActual - dyIdeal
                         if (Math.abs(denom) > 0.0001) {
                            const t = (d.ideal - d.actual) / denom
                            const crossX = x + t * pointWidth
                            const crossY = yScale(d.actual + t * dyActual)
                            currentSegment.points.push([crossX, crossY])
                            segments.push(currentSegment)
                            currentSegment = { type: nextAhead ? 'red' : 'green', points: [[crossX, crossY]] }
                         }
                       }
                     }
                   }
                   if (currentSegment) segments.push(currentSegment)
                   
                   return segments.map((seg, si) => (
                     <React.Fragment key={si}>
                        {/* Area */}
                        <path 
                          d={`M ${seg.points[0][0]} ${yScale(0)} ` + seg.points.map(p => `L ${p[0]} ${p[1]}`).join(' ') + ` L ${seg.points[seg.points.length-1][0]} ${yScale(0)} Z`}
                          fill={seg.type === 'red' ? '#ef4444' : '#22c55e'}
                          fillOpacity="0.15"
                          stroke="none"
                        />
                        {/* Line */}
                        <path 
                          d={seg.points.map((p, pi) => `${pi === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')}
                          fill="none"
                          stroke={seg.type === 'red' ? '#ef4444' : '#22c55e'}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                     </React.Fragment>
                   ))
                })()}

                {/* X-Axis Month markers */}
                {data.map((d, i) => {
                  if (d.date.slice(8) !== '01') return null
                  const x = i * pointWidth
                  return (
                    <g key={i}>
                      <line x1={x} y1={chartHeight} x2={x} y2={chartHeight + 5} stroke="#888" strokeWidth="1" />
                      <text x={x} y={chartHeight + 20} fill="#888" fontSize="10" fontWeight="900" textAnchor="middle">
                        {parseInt(d.date.slice(5, 7))}月
                      </text>
                    </g>
                  )
                })}

                {/* Tooltip Scrubbing Indicator */}
                {isScrubbingMode && activeIdx !== null && data[activeIdx] && !data[activeIdx].isFuture && (
                  <g>
                    <line x1={activeIdx * pointWidth} y1="0" x2={activeIdx * pointWidth} y2={chartHeight} stroke="var(--accent)" strokeWidth="1.5" />
                    <circle cx={activeIdx * pointWidth} cy={yScale(data[activeIdx].actual || 0)} r="5" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
                  </g>
                )}
              </g>
            </svg>

            {/* Sticky Tooltip Card */}
            {isScrubbingMode && activeIdx !== null && data[activeIdx] && !data[activeIdx].isFuture && (
              <div 
                className="absolute top-0 pointer-events-none transition-all duration-75"
                style={{ 
                  left: `${Math.min(chartWidth - 100, Math.max(0, activeIdx * pointWidth - 80)) + paddingX / 2}px`,
                  top: '10%'
                }}
              >
                <div className="glass p-4 border-white/10 shadow-2xl backdrop-blur-3xl rounded-3xl min-w-[160px]">
                  <div className="text-[10px] text-[var(--t3)] font-black mb-3 uppercase tracking-widest">{data[activeIdx].date}</div>
                  <div className="space-y-2">
                    <div className="flex justify-between gap-6">
                      <span className="text-[11px] text-[var(--t2)] font-black">實際進度</span>
                      <span className={`text-[12px] font-mono font-black ${(data[activeIdx].actual || 0) >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                        {fmtMoney(data[activeIdx].actual || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-[11px] text-[var(--t2)] font-black">理想目標</span>
                      <span className="text-[12px] font-mono font-black text-[#fbbf24]">
                        {fmtMoney(data[activeIdx].ideal || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-white/5 flex justify-between gap-6">
                      <span className="text-[10px] text-[var(--t2)] font-black">差距</span>
                      <span className={`text-[12px] font-mono font-black ${(data[activeIdx].actual || 0) - data[activeIdx].ideal >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                        {fmtMoney((data[activeIdx].actual || 0) - data[activeIdx].ideal)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
