'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  className?: string
}

type View = 'CALENDAR' | 'YEAR' | 'MONTH'

export default function DatePicker({ value, onChange, className = '' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<View>('CALENDAR')
  
  const initialDate = value ? new Date(value) : new Date()
  const [viewDate, setViewDate] = useState(initialDate)
  
  const containerRef = useRef<HTMLDivElement>(null)

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

  const displayValue = value ? (() => {
    const [y, m, d] = value.split('-')
    return `${y}年${m}月${d}日`
  })() : ''

  const currentYear = viewDate.getFullYear()
  const currentMonth = viewDate.getMonth() 

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
        className="input-base cursor-pointer focus:border-gold font-mono font-black"
        placeholder="選擇日期"
      />

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100] p-5 space-y-6 shadow-2xl animate-slide-up glass" 
             style={{ minWidth: '300px' }}>
          
          <div className="flex items-center justify-between">
            <button onClick={() => moveMonth(-1)} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-hover text-gold active:scale-90 transition-all" disabled={view !== 'CALENDAR'}>
              <ChevronLeft size={20}/>
            </button>
            
            <div className="flex gap-2 font-black text-white text-[20px]">
              <button onClick={() => setView(view === 'YEAR' ? 'CALENDAR' : 'YEAR')} className={`px-2 rounded ${view === 'YEAR' ? 'text-gold' : ''}`}>
                {currentYear} 年
              </button>
              <button onClick={() => setView(view === 'MONTH' ? 'CALENDAR' : 'MONTH')} className={`px-2 rounded ${view === 'MONTH' ? 'text-gold' : ''}`}>
                {currentMonth + 1} 月
              </button>
            </div>
            
            <button onClick={() => moveMonth(1)} className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-hover text-gold active:scale-90 transition-all" disabled={view !== 'CALENDAR'}>
              <ChevronRight size={20}/>
            </button>
          </div>

          {view === 'CALENDAR' && (
            <div className="grid grid-cols-7 gap-1.5">
              {['日','一','二','三','四','五','六'].map((d, i) => (
                <div key={d} className={`text-center text-[11px] font-bold py-1 ${i===0?'text-red-400':i===6?'text-gold':'text-white/20'}`}>{d}</div>
              ))}
              {(() => {
                const startDay = new Date(currentYear, currentMonth, 1).getDay()
                const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
                const cells = []
                for (let i = 0; i < startDay; i++) cells.push(<div key={`empty-${i}`} />)
                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                  const isSelected = value === dateStr
                  const isToday = new Date().toISOString().split('T')[0] === dateStr
                  cells.push(
                    <button
                      key={d}
                      onClick={() => selectDate(d)}
                      className={`aspect-square flex items-center justify-center text-[14px] font-black rounded-full transition-all border ${
                        isSelected ? 'bg-gold text-bg-base border-gold' : isToday ? 'border-gold/50 text-white' : 'bg-bg-hover text-white border-transparent'
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

          {view === 'YEAR' && (
            <div className="grid grid-cols-3 gap-2">
              {(() => {
                const thisY = new Date().getFullYear()
                return Array.from({length:10}, (_,i)=>thisY-7+i).map(y => (
                  <button key={y} onClick={() => { setViewDate(new Date(y, currentMonth, 1)); setView('CALENDAR') }}
                    className={`py-4 rounded-xl font-black transition-all ${currentYear === y ? 'bg-gold text-bg-base' : 'bg-bg-hover text-white/40'}`}
                  >{y}</button>
                ))
              })()}
            </div>
          )}

          {view === 'MONTH' && (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <button key={m} onClick={() => { setViewDate(new Date(currentYear, m - 1, 1)); setView('CALENDAR') }}
                  className={`py-4 rounded-xl font-black transition-all ${currentMonth + 1 === m ? 'bg-gold text-bg-base' : 'bg-bg-hover text-white/40'}`}
                >{m}月</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
