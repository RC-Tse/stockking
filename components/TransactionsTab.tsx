'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Transaction, UserSettings, codeOnly, fmtMoney, getStockName, calcFee, calcTax, DCAPlan } from '@/types'
import DatePicker from './DatePicker'

interface Props {
  txs: Transaction[]
  settings: UserSettings
  onRefresh: () => void
  onEditDca?: (plan: DCAPlan) => void
}

const ACTION_LABEL: Record<string, string> = {
  BUY: '買入', SELL: '賣出', DCA: '定期定額',
}
const ACTION_COLOR: Record<string, string> = {
  BUY: 'text-red-400', SELL: 'text-green-400', DCA: 'text-gold',
}
const ACTION_BG: Record<string, string> = {
  BUY: 'bg-red-400/10', SELL: 'bg-green-400/10', DCA: 'bg-gold/10',
}

type TabMode = 'SELF' | 'DCA'

export default function TransactionsTab({ txs, settings, onRefresh, onEditDca }: Props) {
  const [tab, setTab] = useState<TabMode>('SELF')
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [dcaPlans, setDcaPlans] = useState<DCAPlan[]>([])
  const [showCancelled, setShowCancelled] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  
  // States for accordion
  const now = new Date()
  const currentYear = now.getFullYear().toString()
  const currentMonth = (now.getMonth() + 1).toString()
  
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({ [currentYear]: true })
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({ [`${currentYear}-${currentMonth}`]: true })

  const fetchDcaPlans = useCallback(async () => {
    const res = await fetch('/api/dca')
    if (res.ok) {
      const data = await res.json()
      setDcaPlans(data)
    }
  }, [])

  useEffect(() => {
    if (tab === 'DCA') {
      fetchDcaPlans()
    }
  }, [tab, fetchDcaPlans])

  const filtered = useMemo(() => {
    let result = txs
    if (tab === 'SELF') {
      result = result.filter(t => t.trade_type !== 'DCA')
    } else {
      result = result.filter(t => t.trade_type === 'DCA')
    }

    if (filter.trim()) {
      result = result.filter(t => 
        codeOnly(t.symbol).includes(filter.toUpperCase()) || 
        t.symbol.includes(filter.toUpperCase()) ||
        (t.name_zh || getStockName(t.symbol)).includes(filter)
      )
    }
    return result
  }, [txs, tab, filter])

  // Grouping logic
  const groupedData = useMemo(() => {
    const groups: Record<string, Record<string, { txs: Transaction[], pnl: number }>> = {}
    const today = new Date()
    
    filtered.forEach(t => {
      const d = new Date(t.trade_date)
      if (d > today) return // Skip future dates
      
      const year = d.getFullYear().toString()
      const month = (d.getMonth() + 1).toString()
      
      if (!groups[year]) groups[year] = {}
      if (!groups[year][month]) groups[year][month] = { txs: [], pnl: 0 }
      
      groups[year][month].txs.push(t)
      groups[year][month].pnl += t.net_amount
    })
    
    return groups
  }, [filtered])

  const sortedYears = Object.keys(groupedData).sort((a, b) => b.localeCompare(a))

  async function deleteTx(id: number) {
    if (!confirm('確定刪除這筆交易紀錄？')) return
    setDeleting(id)
    await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    onRefresh()
    setDeleting(null)
  }

  async function toggleDcaStatus(plan: DCAPlan) {
    const res = await fetch('/api/dca', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: plan.id, is_active: !plan.is_active })
    })
    if (res.ok) fetchDcaPlans()
  }

  const toggleYear = (y: string) => {
    setExpandedYears(prev => ({ ...prev, [y]: !prev[y] }))
  }

  const toggleMonth = (y: string, m: string) => {
    const key = `${y}-${m}`
    setExpandedMonths(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const activePlans = dcaPlans.filter(p => p.is_active)
  const inactivePlans = dcaPlans.filter(p => !p.is_active)

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Tabs + Export */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex bg-white/[0.03] p-1 rounded-xl border border-white/5">
          <button 
            onClick={() => setTab('SELF')}
            className={`flex-1 py-2.5 text-base md:text-xs font-black rounded-lg transition-all relative ${tab === 'SELF' ? 'text-white bg-white/5' : 'text-white/30'}`}
          >
            自行交易
            {tab === 'SELF' && <div className="absolute bottom-0 inset-x-4 h-0.5 bg-white rounded-full" />}
          </button>
          <button 
            onClick={() => setTab('DCA')}
            className={`flex-1 py-2.5 text-base md:text-xs font-black rounded-lg transition-all relative ${tab === 'DCA' ? 'text-white bg-white/5' : 'text-white/30'}`}
          >
            定期定額
            {tab === 'DCA' && <div className="absolute bottom-0 inset-x-4 h-0.5 bg-white rounded-full" />}
          </button>
        </div>
        <button 
          onClick={() => setExportOpen(true)}
          className="w-11 h-11 flex items-center justify-center glass rounded-xl border border-white/5 active:bg-white/10 text-xl"
        >
          📥
        </button>
      </div>

      {tab === 'SELF' ? (
        <>
          {/* Search */}
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="搜尋代號、名稱或備註…"
            className="input-base text-base md:text-sm"
          />

          {sortedYears.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="text-4xl opacity-20">🗒️</div>
              <p className="text-sm text-white/40">
                {filter ? '查無符合的紀錄' : '尚無交易紀錄'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedYears.map(year => (
                <div key={year} className="space-y-2">
                  {/* Year Header */}
                  <button 
                    onClick={() => toggleYear(year)}
                    className="w-full flex items-center gap-2 px-1 py-2 group"
                  >
                    <span className={`text-xs transition-transform duration-200 ${expandedYears[year] ? 'rotate-90' : ''}`} style={{ color: 'var(--gold)' }}>▶</span>
                    <span className="font-black text-xl md:text-lg text-white group-active:opacity-60">{year}年</span>
                    <div className="h-[1px] flex-1 bg-white/5" />
                  </button>

                  {expandedYears[year] && (
                    <div className="pl-2 space-y-3">
                      {Object.keys(groupedData[year])
                        .sort((a, b) => Number(b) - Number(a))
                        .map(month => {
                          const data = groupedData[year][month]
                          const isExpanded = expandedMonths[`${year}-${month}`]
                          
                          return (
                            <div key={`${year}-${month}`} className="space-y-2">
                              {/* Month Header */}
                              <button 
                                onClick={() => toggleMonth(year, month)}
                                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 active:bg-white/10 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-lg md:text-sm text-white/80">{month}月</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-white/40">{data.txs.length}筆</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className={`font-mono text-base md:text-xs font-bold ${data.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                                    {data.pnl >= 0 ? '+' : ''}{fmtMoney(Math.round(data.pnl))}
                                  </span>
                                  <span className={`text-[10px] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--t3)' }}>▼</span>
                                </div>
                              </button>

                              {/* Transaction Rows */}
                              {isExpanded && (
                                <div className="space-y-2 pt-1">
                                  {data.txs.map(tx => (
                                    <TxRow 
                                      key={tx.id} 
                                      tx={tx} 
                                      settings={settings}
                                      deleting={deleting === tx.id} 
                                      onDelete={() => deleteTx(tx.id)} 
                                      onUpdated={onRefresh}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-8">
          {/* ① 我的定期定額計畫 */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-white/30 uppercase tracking-[0.2em] px-1 flex justify-between items-center">
              <span>進行中的計畫</span>
              <span className="text-[10px] bg-gold/10 text-gold px-2 py-0.5 rounded-md">{activePlans.length}</span>
            </h3>
            {activePlans.length === 0 ? (
              <div className="glass p-8 text-center rounded-2xl border border-white/5 text-white/20 text-xs">
                尚無進行中的定期定額計畫
              </div>
            ) : (
              <div className="space-y-3">
                {activePlans.map(plan => (
                  <div key={plan.id} className="glass p-4 rounded-2xl border border-white/5 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-lg md:text-base text-white">{getStockName(plan.symbol, plan.name_zh)}</span>
                        <span className="text-[10px] font-mono text-white/30">{codeOnly(plan.symbol)}</span>
                      </div>
                      <div className="text-sm md:text-[11px] font-bold text-white/40">
                        每次 {fmtMoney(plan.amount)} 元 · 每月 {plan.days_of_month.join('、')} 日
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => onEditDca?.(plan)} className="text-[10px] font-black bg-white/5 text-white/60 px-3 py-1.5 rounded-lg border border-white/10 active:scale-95 transition-all">編輯</button>
                      <button onClick={() => toggleDcaStatus(plan)} className="text-[10px] font-black bg-red-400/10 text-red-400 px-3 py-1.5 rounded-lg border border-red-400/10 active:scale-95 transition-all">暫停</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ② 申購紀錄 */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-white/30 uppercase tracking-[0.2em] px-1">申購紀錄 (歷史)</h3>
            {sortedYears.length === 0 ? (
              <div className="glass p-8 text-center rounded-2xl border border-white/5 text-white/20 text-xs">
                尚無定期定額交易紀錄
              </div>
            ) : (
              <div className="space-y-4">
                {sortedYears.map(year => (
                  <div key={year} className="space-y-2">
                    <button onClick={() => toggleYear(year)} className="w-full flex items-center gap-2 px-1 py-1 group">
                      <span className={`text-[10px] transition-transform ${expandedYears[year] ? 'rotate-90' : ''}`} style={{ color: 'var(--gold)' }}>▶</span>
                      <span className="font-black text-base text-white/60">{year}年</span>
                      <div className="h-[1px] flex-1 bg-white/5" />
                    </button>
                    {expandedYears[year] && (
                      <div className="space-y-3">
                        {Object.keys(groupedData[year]).sort((a,b) => Number(b)-Number(a)).map(month => {
                          const data = groupedData[year][month]
                          const isExpanded = expandedMonths[`${year}-${month}`]
                          return (
                            <div key={month} className="space-y-2">
                              <button onClick={() => toggleMonth(year, month)} className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                                <span className="font-bold text-sm md:text-xs text-white/40">{month}月 ({data.txs.length}筆)</span>
                                <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--t3)' }}>▼</span>
                              </button>
                              {isExpanded && (
                                <div className="space-y-2">
                                  {data.txs.map(tx => (
                                    <TxRow key={tx.id} tx={tx} settings={settings} deleting={deleting === tx.id} onDelete={() => deleteTx(tx.id)} onUpdated={onRefresh} />
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ③ 已撤銷的計畫 */}
          <div className="space-y-3">
            <button onClick={() => setShowCancelled(!showCancelled)} className="w-full text-xs font-black text-white/20 uppercase tracking-[0.2em] px-1 flex justify-between items-center py-2 border-t border-white/5 mt-8">
              <span>已撤銷的計畫 ({inactivePlans.length})</span>
              <span className={`transition-transform ${showCancelled ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {showCancelled && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                {inactivePlans.length === 0 ? (
                  <div className="text-center py-4 text-[10px] text-white/10 font-bold uppercase tracking-widest italic">目前無撤銷計畫</div>
                ) : (
                  inactivePlans.map(plan => (
                    <div key={plan.id} className="glass p-4 rounded-2xl border border-white/5 flex items-center justify-between gap-4 opacity-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-black text-lg md:text-base text-white">{getStockName(plan.symbol, plan.name_zh)}</span>
                          <span className="text-[10px] font-mono text-white/30">{codeOnly(plan.symbol)}</span>
                        </div>
                        <div className="text-sm md:text-[11px] font-bold text-white/40">
                          每次 {fmtMoney(plan.amount)} 元 · 每月 {plan.days_of_month.join('、')} 日
                        </div>
                      </div>
                      <button onClick={() => toggleDcaStatus(plan)} className="text-[10px] font-black bg-gold/10 text-gold px-3 py-1.5 rounded-lg border border-gold/10 active:scale-95 transition-all">重新啟用</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export Modal */}
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
    </div>
  )
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const [range, setRange] = useState<'month' | '3months' | 'year' | 'all' | 'custom'>('month')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    let s = start, e = end
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    
    if (range === 'month') {
      s = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
      e = today
    } else if (range === '3months') {
      s = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0]
      e = today
    } else if (range === 'year') {
      s = `${now.getFullYear()}-01-01`
      e = today
    } else if (range === 'all') {
      s = '2000-01-01'
      e = today
    }

    if (!s || !e) return alert('請選擇日期區間')

    setLoading(true)
    try {
      const res = await fetch(`/api/export?start_date=${s}&end_date=${e}`)
      if (!res.ok) throw new Error('匯出失敗')
      
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `存股王_交易紀錄_${s}_${e}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      alert('✅ 匯出成功')
      onClose()
    } catch (err) {
      alert('匯出發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80">
      <div className="w-full max-w-[360px] glass p-6 rounded-3xl border border-white/10 space-y-6 animate-in zoom-in-95">
        <div className="text-center">
          <h3 className="font-black text-lg text-white">匯出交易紀錄</h3>
          <p className="text-xs text-white/30 mt-1">產生成 Excel 報表下載</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'month', label: '本月' },
            { id: '3months', label: '近 3 個月' },
            { id: 'year', label: '今年' },
            { id: 'all', label: '全部' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setRange(opt.id as any)} className={`py-3 rounded-xl text-xs font-bold border transition-all ${range === opt.id ? 'bg-gold/10 text-gold border-gold/30' : 'bg-white/5 text-white/40 border-transparent'}`}>
              {opt.label}
            </button>
          ))}
          <button onClick={() => setRange('custom')} className={`col-span-2 py-3 rounded-xl text-xs font-bold border transition-all ${range === 'custom' ? 'bg-gold/10 text-gold border-gold/30' : 'bg-white/5 text-white/40 border-transparent'}`}>
            自訂區間
          </button>
        </div>

        {range === 'custom' && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-1">開始日期</label>
              <DatePicker value={start} onChange={setStart} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-1">結束日期</label>
              <DatePicker value={end} onChange={setEnd} />
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="w-1/4 py-4 rounded-2xl font-bold text-sm bg-white/5 text-white/40 active:scale-95 transition-all">取消</button>
          <button onClick={handleExport} disabled={loading} className="flex-1 py-4 rounded-2xl font-black text-sm bg-gold text-[#0d1018] active:scale-95 transition-all disabled:opacity-50">
            {loading ? '產生中...' : '確認匯出'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TxRow({ tx, settings, deleting, onDelete, onUpdated }: { 
  tx: Transaction; settings: UserSettings; deleting: boolean; onDelete: () => void; onUpdated: () => void 
}) {
  const [open, setOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  
  const color  = ACTION_COLOR[tx.action] ?? 'text-white/60'
  const bgColor = ACTION_BG[tx.action] ?? 'bg-white/5'

  if (isEditing) {
    return (
      <EditForm 
        tx={tx} 
        settings={settings} 
        onCancel={() => setIsEditing(false)} 
        onSaved={() => {
          setIsEditing(false)
          onUpdated()
        }}
      />
    )
  }

  const isDCA = tx.trade_type === 'DCA'

  return (
    <div className={`glass rounded-xl overflow-hidden border border-white/5 transition-all ${open ? 'border-white/20' : ''}`} style={{ opacity: deleting ? 0.5 : 1 }}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-white/5" onClick={() => setOpen(!open)}>
        {/* Action badge / DCA Label */}
        {isDCA ? (
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-gold-dim text-gold border border-gold/20 shrink-0 whitespace-nowrap">定期定額</span>
        ) : (
          <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${bgColor} ${color}`}>
            {ACTION_LABEL[tx.action] ?? tx.action}
          </span>
        )}

        {/* Symbol + Name */}
        <div className="flex flex-col min-w-0">
          <span className="font-black font-mono text-sm leading-tight text-white">
            {codeOnly(tx.symbol)}
          </span>
          <span className="text-[10px] font-bold truncate text-white/40">
            {tx.name_zh || getStockName(tx.symbol)}
          </span>
        </div>

        {/* Date */}
        <span className="text-sm md:text-[11px] flex-1 ml-1 text-white/30">{tx.trade_date.split('-').slice(1).join('/')}</span>

        {/* Net amount */}
        <span className={`font-bold font-mono text-lg md:text-sm shrink-0 ${tx.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
          {tx.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(tx.net_amount))}
        </span>

        <span className={`text-white/20 text-[10px] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3 border-t border-white/5 bg-white/[0.02]">
          <div className="grid grid-cols-3 gap-2 pt-3">
            {isDCA && <Detail label="申購金額" value={fmtMoney(Math.round(tx.amount + tx.fee))} />}
            <Detail label="買入股數"  value={`${tx.shares.toLocaleString()} 股`} />
            <Detail label="成交價" value={`${Number(tx.price).toFixed(2)}`} />
            {!isDCA && <Detail label="金額"  value={fmtMoney(Math.round(tx.amount))} />}
            <Detail label="手續費" value={fmtMoney(Math.round(tx.fee))} />
            {tx.tax > 0 && <Detail label="交易稅" value={fmtMoney(Math.round(tx.tax))} />}
            <Detail label="淨收支"  value={fmtMoney(Math.round(tx.net_amount))} />
          </div>
          {tx.note && (
            <div className="text-[11px] px-2 py-1.5 rounded-lg bg-white/5 text-white/50 border border-white/5 italic">
              💬 {tx.note}
            </div>
          )}
          
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 text-xs py-2 rounded-lg font-bold bg-gold-dim text-gold border border-gold/20 active:scale-95 transition-transform">
              ✏️ 編輯
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="flex-1 text-xs py-2 rounded-lg font-bold bg-red-400/10 text-red-400 border border-red-400/20 active:scale-95 transition-transform">
              {deleting ? '刪除中…' : '🗑️ 刪除'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditForm({ tx, settings, onCancel, onSaved }: { 
  tx: Transaction; settings: UserSettings; onCancel: () => void; onSaved: () => void 
}) {
  const [date, setDate]     = useState(tx.trade_date)
  const [shares, setShares] = useState<number | ''>(tx.shares)
  const [price, setPrice]   = useState<number | ''>(tx.price)
  const [note, setNote]     = useState(tx.note || '')
  const [saving, setSaving] = useState(false)
  const [tradeType, setTradeType] = useState(tx.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots]     = useState<number | ''>(Math.floor(tx.shares / 1000) || 1)

  const actualShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = Number(price) || 0
  const amount = actualShares * safePrice
  const fee    = calcFee(amount, settings, tx.action === 'SELL')
  const tax    = tx.action === 'SELL' ? calcTax(amount, tx.symbol, settings) : 0
  const net    = (tx.action === 'BUY' || tx.action === 'DCA') ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))

  // Validation
  const hasChanged = date !== tx.trade_date || actualShares !== tx.shares || safePrice !== tx.price || note !== (tx.note || '')
  const isValid = actualShares > 0 && safePrice > 0 && hasChanged

  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    const r = await fetch('/api/transactions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tx.id, trade_date: date, shares: actualShares, price: safePrice, note })
    })
    if (r.ok) onSaved()
    setSaving(false)
  }

  return (
    <div className="glass rounded-xl p-4 space-y-5 border-2 border-gold/40 my-2 slide-up bg-[#0d1018]">
      <div className="flex justify-between items-center">
        <h3 className="font-black text-sm text-gold">編輯交易 - {tx.symbol}</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 text-white/40 border border-white/5 uppercase">
          {tx.action}
        </span>
      </div>

      <div className="flex flex-col items-center">
        <Label>交易日期</Label>
        <DatePicker value={date} onChange={setDate} />
      </div>

      <div className="space-y-2">
        <Label>交易方式</Label>
        <div className="flex gap-2">
          <button onClick={() => setTradeType('FULL')} className={`flex-1 h-10 rounded-lg text-[10px] font-black transition-all border ${tradeType === 'FULL' ? 'bg-[#c9a56433] text-gold border-gold' : 'bg-transparent text-white/30 border-white/10'}`}>整張 (1000股)</button>
          <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 h-10 rounded-lg text-[10px] font-black transition-all border ${tradeType === 'FRACTIONAL' ? 'bg-[#c9a56433] text-gold border-gold' : 'bg-transparent text-white/30 border-white/10'}`}>零股</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
          <input 
            type="number" inputMode="numeric" 
            value={tradeType === 'FULL' ? lots : shares} 
            onFocus={() => {
              if (tradeType === 'FULL') setLots('')
              else setShares('')
            }}
            onChange={e => { 
              const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
              if (tradeType === 'FULL') setLots(v)
              else setShares(v)
            }} 
            className="w-full input-base text-center h-12 font-black font-mono text-lg bg-white/5 border-white/10" 
          />
          {tradeType === 'FULL' && lots !== '' && (
            <div className="text-[10px] text-center mt-1 text-white/30 font-bold">= {(Number(lots)*1000).toLocaleString()} 股</div>
          )}
        </div>
        <div>
          <Label>成交價</Label>
          <input 
            type="number" inputMode="decimal" step="0.01" 
            value={price} 
            onFocus={() => setPrice('')}
            onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} 
            className="w-full input-base text-center h-12 font-black font-mono text-lg bg-white/5 border-white/10" 
          />
        </div>
      </div>

      <div>
        <Label>備註</Label>
        <input value={note} onChange={e => setNote(e.target.value)} className="w-full input-base py-3 px-4 text-sm bg-white/5 border-white/10" placeholder="點此輸入備註..." />
      </div>

      <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10 text-xs font-bold">
        <div className="flex justify-between">
          <span className="opacity-40">手續費</span>
          <span className="font-mono text-white">{fmtMoney(fee)}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between">
            <span className="opacity-40">交易稅</span>
            <span className="font-mono text-white">{fmtMoney(tax)}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-2 border-t border-white/5">
          <span className="opacity-60 uppercase text-[10px]">預估淨收支</span>
          <span className={`text-lg font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {net >= 0 ? '+' : ''}{fmtMoney(net)}
          </span>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={!isValid || saving} className="w-3/4 py-4 rounded-xl font-black text-sm transition-all active:scale-95" style={isValid ? { background: 'linear-gradient(135deg, #c9a564, #e8c880)', color: '#0d1018', fontWeight: 800 } : { background: '#444', color: '#888', cursor: 'not-allowed', opacity: 0.5 }}>
          {saving ? '儲存中...' : '儲存修改'}
        </button>
        <button onClick={onCancel} className="w-1/4 py-4 rounded-xl font-bold text-sm bg-white/10 text-white/60 active:scale-95 transition-all">
          取消
        </button>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold opacity-30 uppercase tracking-tighter mb-0.5">{label}</div>
      <div className="font-mono text-[11px] font-bold text-white/80">{value}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[9px] mb-1 block font-bold opacity-30 uppercase tracking-widest text-center w-full">{children}</label>
}
