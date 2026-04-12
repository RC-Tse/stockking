'use client'

import React, { useState, useMemo, useRef } from 'react'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const scrubTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [isScrubbingMode, setIsScrubbingMode] = useState(false)
  
  const viewBoxWidth = 1000
  const chartHeight = 320

  // Calculate Y Domain
  const yAxis = useMemo(() => {
    const vals = data.filter(d => d.actual !== null && !d.isIntersection).flatMap(d => [d.actual!, d.ideal])
    if (vals.length === 0) return { domain: [0, goal || 100], ticks: [0, (goal || 100) / 2, goal || 100] }

    const dataMin = Math.min(0, ...vals)
    const dataMax = Math.max(goal, ...vals)
    
    const bufferMax = dataMax > 0 ? dataMax * 1.15 : 0
    const bufferMin = dataMin < 0 ? dataMin * 1.15 : - (dataMax * 0.05)
    
    const range = bufferMax - bufferMin
    
    // Nice numbers for steps
    const findStep = (target: number) => {
      const exp = Math.floor(Math.log10(target))
      const frac = target / Math.pow(10, exp)
      let niceFrac
      if (frac <= 1) niceFrac = 1
      else if (frac <= 2) niceFrac = 2
      else if (frac <= 5) niceFrac = 5
      else niceFrac = 10
      return niceFrac * Math.pow(10, exp)
    }
    
    const targetTicks = 6
    const snapUnit = findStep(range / targetTicks)
    
    // Align min/max to snapUnit
    const finalMax = Math.ceil(bufferMax / snapUnit) * snapUnit
    const finalMin = Math.floor(bufferMin / snapUnit) * snapUnit
    
    const ticks = []
    for (let v = finalMin; v <= finalMax; v += snapUnit) {
      if (!ticks.includes(v)) ticks.push(v)
    }

    return { 
      domain: [finalMin, finalMax] as [number, number], 
      ticks: ticks.sort((a,b) => a-b) 
    }
  }, [data, goal])

  const yScale = (val: number) => {
    const [min, max] = yAxis.domain
    const range = max - min
    if (range === 0) return chartHeight / 2
    return chartHeight - ((val - min) / range) * chartHeight
  }

  const getX = (i: number) => {
    if (data.length <= 1) return 0
    return (i / (data.length - 1)) * viewBoxWidth
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
    if (!containerRef.current || data.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const scrollX = clientX - rect.left
    const idx = Math.round((scrollX / rect.width) * (data.length - 1))
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

  const firstYear = data.length > 0 ? data[0].date.slice(0, 4) : ''
  const lastYear = data.length > 0 ? data[data.length - 1].date.slice(0, 4) : ''
  const isCrossYear = firstYear !== lastYear

  return (
    <div className="space-y-4 animate-slide-up w-full overflow-hidden">
      <div className="flex items-end justify-between px-4">
        <div className="space-y-1">
          <h3 className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em]">{title}</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-[var(--t1)] font-mono">
               {Math.abs(goal) >= 1000 ? `${(goal / 1000).toLocaleString()}K` : goal.toLocaleString()}
            </span>
            <span className="text-[11px] font-bold text-accent opacity-60 uppercase tracking-widest">Goal</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-black text-[var(--t2)] opacity-40 uppercase tracking-[0.2em] mb-1">{subtitle}</div>
          <div className={`text-2xl font-black font-mono ${currentValue >= 0 ? 'text-red-400' : 'text-green-400'}`}>
             {Math.abs(currentValue) >= 1000 ? `${currentValue >= 0 ? '+' : '-'}${(Math.abs(currentValue) / 1000).toLocaleString()}K` : fmtMoney(currentValue)}
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-[48px] p-0 shadow-2xl relative overflow-hidden group">
        
        {/* Legends - Moved to Top Center */}
        <div className="absolute top-8 left-0 right-0 flex justify-center gap-8 z-10 pointer-events-none">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-0 border-t-2 border-[#fbbf24] border-dashed opacity-80" />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">理想進度</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-[4px] w-6 rounded-full overflow-hidden items-center shadow-sm">
              <div className="bg-[#ef4444] h-full flex-1" />
              <div className="bg-[#22c55e] h-full flex-1" />
            </div>
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">實際進度</span>
          </div>
        </div>

        <div 
          ref={containerRef}
          className="h-[420px] w-full pt-24 pb-12 px-0 select-none touch-none"
        >
          <div 
            style={{ width: '100%', height: '100%', position: 'relative' }}
            onClick={handleChartClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleChartMove}
            onTouchEnd={handleTouchEnd}
            onMouseMove={handleChartMove}
            onMouseLeave={() => { if (!isScrubbingMode) setActiveIdx(null) }}
          >
            <svg viewBox={`0 0 ${viewBoxWidth} ${chartHeight}`} className="w-full h-full overflow-visible">
              <g>
                {/* Y-Axis Grid */}
                {yAxis.ticks.map(t => (
                  <g key={t}>
                    <line x1="0" y1={yScale(t)} x2="100%" y2={yScale(t)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                    <text x={viewBoxWidth - 4} y={yScale(t) - 4} fill="white" fillOpacity="0.2" fontSize="9" fontWeight="900" textAnchor="end">
                      {Math.abs(t) >= 1000 ? `${(t/1000).toLocaleString()}K` : t.toLocaleString()}
                    </text>
                  </g>
                ))}

                {/* Y=0 thick line (Horizontal) */}
                <line x1="0" y1={yScale(0)} x2="100%" y2={yScale(0)} stroke="#ffffff" strokeWidth="2" opacity="0.6" />
                
                {/* X=0 thick line (Vertical start) */}
                <line x1="0" y1="0" x2="0" y2={chartHeight} stroke="#ffffff" strokeWidth="2" opacity="0.6" />

                {/* Ideal Path (Dashed) */}
                <path 
                  d={data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${yScale(d.ideal)}`).join(' ')}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  opacity="0.4"
                />

                {/* Actual Area & Line (Red/Green logic) */}
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
                     const x = getX(i)
                     const y = yScale(d.actual)
                     
                     if (!currentSegment || currentSegment.type !== type) {
                        if (currentSegment) segments.push(currentSegment)
                        currentSegment = { type, points: [[x, y]] }
                     } else {
                        currentSegment.points.push([x, y])
                     }
                     
                     if (next && next.actual !== null && !next.isFuture) {
                       const nextAhead = next.actual >= next.ideal
                       if (isAhead !== nextAhead) {
                          const dyActual = next.actual - d.actual
                          const dyIdeal = next.ideal - d.ideal
                          const denom = dyActual - dyIdeal
                          if (Math.abs(denom) > 0.0001) {
                             const t = (d.ideal - d.actual) / denom
                             const crossX = x + t * (getX(i+1) - x)
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
                        {/* Solid Area Filler */}
                        <path 
                          d={`M ${seg.points[0][0]} ${yScale(yAxis.domain[0])} L ${seg.points[0][0]} ${seg.points[0][1]} ` + seg.points.map(p => `L ${p[0]} ${p[1]}`).join(' ') + ` L ${seg.points[seg.points.length-1][0]} ${yScale(yAxis.domain[0])} Z`}
                          fill={seg.type === 'red' ? '#ef4444' : '#22c55e'}
                          fillOpacity="0.12"
                          stroke="none"
                        />
                        {/* Actual Line */}
                        <path 
                          d={seg.points.map((p, pi) => `${pi === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')}
                          fill="none"
                          stroke={seg.type === 'red' ? '#ef4444' : '#22c55e'}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                     </React.Fragment>
                   ))
                })()}

                {/* X-Axis Month markers */}
                {data.map((d, i) => {
                  const day = d.date.slice(8)
                  if (day !== '01') return null
                  const year = d.date.slice(0, 4)
                  const month = parseInt(d.date.slice(5, 7))
                  const x = getX(i)

                  // User requirements:
                  // 1. Label 1st of each month as month.
                  // 2. 3Y+ (long range) show only Jan and July.
                  // 3. If crossed year, label year on Jan.
                  
                  let shouldShow = false
                  if (data.length <= 800) {
                    // Small to medium ranges (1M to ~2Y)
                    shouldShow = true 
                  } else {
                    // Long ranges (3Y+)
                    shouldShow = (month === 1 || month === 7)
                  }

                  if (!shouldShow) return null
                  
                  const isJan = month === 1
                  const label = (isCrossYear && isJan) ? `${year}/${month}` : `${month}月`
                  
                  return (
                    <g key={i}>
                      <text x={x} y={chartHeight + 20} fill="white" fillOpacity="0.3" fontSize="10" fontWeight="900" textAnchor="middle">
                        {label}
                      </text>
                    </g>
                  )
                })}

                {/* Tooltip Scrubbing Indicator */}
                {isScrubbingMode && activeIdx !== null && data[activeIdx] && !data[activeIdx].isFuture && (
                  <g>
                    <line x1={getX(activeIdx)} y1="0" x2={getX(activeIdx)} y2={chartHeight} stroke="var(--accent)" strokeWidth="1.5" />
                    <circle cx={getX(activeIdx)} cy={yScale(data[activeIdx].actual || 0)} r="5" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
                  </g>
                )}
              </g>
            </svg>

            {/* Sticky Tooltip Card */}
            {isScrubbingMode && activeIdx !== null && data[activeIdx] && !data[activeIdx].isFuture && (
              <div 
                className="absolute top-0 pointer-events-none transition-all duration-75"
                style={{ 
                   left: `${Math.min(90, Math.max(10, (getX(activeIdx) / viewBoxWidth) * 100))}%`,
                   transform: 'translateX(-50%)',
                   top: '10%'
                }}
              >
                <div className="glass p-4 border-white/10 shadow-2xl backdrop-blur-3xl rounded-3xl min-w-[160px]">
                  <div className="text-[10px] text-white/40 font-black mb-3 uppercase tracking-widest">{data[activeIdx].date}</div>
                  <div className="space-y-2">
                    <div className="flex justify-between gap-6">
                      <span className="text-[11px] text-white/60 font-black">實際進度</span>
                      <span className={`text-[12px] font-mono font-black ${(data[activeIdx].actual || 0) >= 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                        {fmtMoney(data[activeIdx].actual || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-[11px] text-white/60 font-black">理想目標</span>
                      <span className="text-[12px] font-mono font-black text-[#fbbf24]">
                        {fmtMoney(data[activeIdx].ideal || 0)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-white/5 flex justify-between gap-6">
                      <span className="text-[10px] text-white/40 font-black">差距</span>
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
