'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  className?: string
}

type View = 'CALENDAR' | 'YEAR' | 'MONTH'

export default function DatePicker({ value, onChange, className = '' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<View>('CALENDAR')
  
  // viewDate determines which month/year the calendar or grid is currently showing
  // It defaults to the current value or today
  const initialDate = value ? new Date(value) : new Date()
  const [viewDate, setViewDate] = useState(initialDate)
  
  const containerRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Format display value: YYYY年MM月DD日
  const displayValue = value ? (() => {
    const [y, m, d] = value.split('-')
    return `${y}年${m}月${d}日`
  })() : ''

  const currentYear = viewDate.getFullYear()
  const currentMonth = viewDate.getMonth() // 0-indexed

  const moveMonth = (delta: number) => {
    setViewDate(new Date(currentYear, currentMonth + delta, 1))
  }

  const selectDate = (d: number) => {
    const newDateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    onChange(newDateStr)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <input
        readOnly
        value={displayValue}
        onClick={() => {
          setIsOpen(!isOpen)
          setView('CALENDAR')
          if (value) setViewDate(new Date(value))
        }}
        className="input-base w-full text-left font-black font-mono text-lg py-4 bg-white/5 border-white/10 cursor-pointer focus:outline-none"
        placeholder="選擇日期"
      />

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100] glass p-5 space-y-4 shadow-2xl animate-in fade-in slide-in-from-top-2" 
             style={{ background: '#141820', border: '1px solid rgba(255,255,255,0.1)', minWidth: '300px' }}>
          
          {/* Header */}
          <div className="flex items-center justify-between">
            <button 
              onClick={() => moveMonth(-1)} 
              className="p-2 text-gold disabled:opacity-20"
              disabled={view !== 'CALENDAR'}
            >◀</button>
            
            <div className="flex gap-2 font-black text-white">
              <button 
                onClick={() => setView(view === 'YEAR' ? 'CALENDAR' : 'YEAR')}
                className={`px-2 py-1 rounded transition-colors ${view === 'YEAR' ? 'bg-gold text-black' : 'hover:bg-white/5'}`}
              >
                {currentYear}年
              </button>
              <button 
                onClick={() => setView(view === 'MONTH' ? 'CALENDAR' : 'MONTH')}
                className={`px-2 py-1 rounded transition-colors ${view === 'MONTH' ? 'bg-gold text-black' : 'hover:bg-white/5'}`}
              >
                {currentMonth + 1}月
              </button>
            </div>
            
            <button 
              onClick={() => moveMonth(1)} 
              className="p-2 text-gold disabled:opacity-20"
              disabled={view !== 'CALENDAR'}
            >▶</button>
          </div>

          {/* View: CALENDAR */}
          {view === 'CALENDAR' && (
            <div className="grid grid-cols-7 gap-1 text-center">
              {['日','一','二','三','四','五','六'].map(d => (
                <div key={d} className="text-[10px] font-bold text-white/30 py-1">{d}</div>
              ))}
              {(() => {
                const startDay = new Date(currentYear, currentMonth, 1).getDay()
                const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
                const cells = []
                for (let i = 0; i < startDay; i++) {
                  cells.push(<div key={`empty-${i}`} />)
                }
                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                  const isSelected = value === dateStr
                  cells.push(
                    <button
                      key={d}
                      onClick={() => selectDate(d)}
                      className={`aspect-square flex items-center justify-center text-sm font-bold rounded-lg transition-all ${
                        isSelected ? 'bg-gold text-black' : 'text-white/80 hover:bg-white/5'
                      }`}
                    >
                      {d}
                    </button>
                  )
                }
                return cells
              })()}
            </div>
          )}

          {/* View: YEAR */}
          {view === 'YEAR' && (
            <div className="grid grid-cols-3 gap-2 py-2">
              {(() => {
                const thisYear = new Date().getFullYear()
                const years = []
                for (let y = thisYear - 7; y <= thisYear + 2; y++) {
                  years.push(y)
                }
                return years.map(y => (
                  <button
                    key={y}
                    onClick={() => {
                      setViewDate(new Date(y, currentMonth, 1))
                      setView('CALENDAR')
                    }}
                    className={`py-3 rounded-xl text-sm font-black transition-all ${
                      currentYear === y 
                        ? 'bg-[#c9a564] text-[#0d1018]' 
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {y}
                  </button>
                ))
              })()}
            </div>
          )}

          {/* View: MONTH */}
          {view === 'MONTH' && (
            <div className="grid grid-cols-3 gap-2 py-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <button
                  key={m}
                  onClick={() => {
                    setViewDate(new Date(currentYear, m - 1, 1))
                    setView('CALENDAR')
                  }}
                  className={`py-3 rounded-xl text-sm font-black transition-all ${
                    currentMonth + 1 === m 
                      ? 'bg-[#c9a564] text-[#0d1018]' 
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {m}月
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
