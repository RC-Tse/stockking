'use client'

import { useState } from 'react'
import { CONCEPT_GROUPS, Quote, codeOnly } from '@/types'

interface Props {
  quotes: Record<string, Quote>
  onFetchQuotes: (syms: string[]) => Promise<void>
}

export default function ConceptsTab({ quotes, onFetchQuotes }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading]   = useState<string | null>(null)

  async function toggleGroup(name: string) {
    if (expanded === name) { setExpanded(null); return }
    setExpanded(name)
    const syms = CONCEPT_GROUPS[name].stocks.map(([s]) => s)
    const need = syms.filter(s => !quotes[s])
    if (need.length) {
      setLoading(name)
      await onFetchQuotes(need)
      setLoading(null)
    }
  }

  return (
    <div className="p-4 space-y-2">
      <div className="text-xs mb-3 px-1" style={{ color: 'var(--t3)' }}>
        點擊概念群組查看個股即時行情
      </div>

      {Object.entries(CONCEPT_GROUPS).map(([name, group]) => {
        const isOpen = expanded === name
        const isLoading = loading === name

        return (
          <div key={name} className="glass rounded-xl overflow-hidden">
            {/* Group header */}
            <button
              className="w-full flex items-center justify-between px-4 py-3.5 transition-colors text-left"
              style={{ background: isOpen ? 'rgba(201,165,100,0.06)' : 'transparent' }}
              onClick={() => toggleGroup(name)}
            >
              <div className="min-w-0">
                <div className="font-bold text-sm" style={{ color: 'var(--t1)' }}>{name}</div>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--t2)' }}>{group.desc}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-xs font-mono" style={{ color: 'var(--t3)' }}>
                  {group.stocks.length} 檔
                </span>
                <span style={{ color: 'var(--gold)', fontSize: 12, transform: isOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
              </div>
            </button>

            {/* Expanded stock list */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[0,1,2].map(i => <div key={i} className="shimmer h-10 rounded-lg" />)}
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {group.stocks.map(([sym, label]) => {
                      const q = quotes[sym]
                      const isUp = q && q.change > 0
                      const isDn = q && q.change < 0
                      return (
                        <div key={sym}
                          className="flex items-center justify-between px-4 py-2.5"
                          style={{ background: 'transparent' }}
                        >
                          {/* Symbol + name */}
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-black text-sm font-mono" style={{ color: 'var(--gold)', minWidth: 40 }}>
                              {codeOnly(sym)}
                            </span>
                            <span className="text-xs truncate" style={{ color: 'var(--t2)' }}>{label}</span>
                          </div>

                          {/* Quote */}
                          {q ? (
                            <div className="flex items-center gap-3 shrink-0 text-right">
                              <div>
                                <div className="font-bold font-mono text-sm" style={{ color: 'var(--t1)' }}>
                                  {q.price.toFixed(2)}
                                </div>
                              </div>
                              <div className={`text-xs font-mono px-2 py-0.5 rounded-full font-bold min-w-[72px] text-center`}
                                style={{
                                  background: isUp ? 'var(--red-dim)' : isDn ? 'var(--grn-dim)' : 'var(--bg-hover)',
                                  color: isUp ? 'var(--red)' : isDn ? 'var(--grn)' : 'var(--flat)',
                                }}>
                                {q.change >= 0 ? '+' : ''}{q.change.toFixed(2)}
                                <span className="opacity-70 ml-0.5">({q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(1)}%)</span>
                              </div>
                            </div>
                          ) : (
                            <div className="shimmer w-24 h-6 rounded" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
