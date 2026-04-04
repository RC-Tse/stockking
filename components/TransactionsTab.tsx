'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Transaction, UserSettings, codeOnly, fmtMoney, getStockName, calcFee, calcTax, DCAPlan } from '@/types'
import { 
  Download, 
  TrendingUp, 
  TrendingDown, 
  Repeat, 
  Trash2, 
  Pencil, 
  ChevronDown,
  Calendar,
  BarChart2
} from 'lucide-react'
import DatePicker from './DatePicker'

interface Props {
  txs: Transaction[]
  settings: UserSettings
  onRefresh: () => void
  onEditDca?: (plan: DCAPlan) => void
}

type TabMode = 'SELF' | 'DCA' | 'REALIZED'
type RangeMode = 'month' | '3months' | 'year' | 'all' | 'custom'

export default function TransactionsTab({ txs, settings, onRefresh, onEditDca }: Props) {
  const [tab, setTab] = useState<TabMode>('SELF')
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [dcaPlans, setDcaPlans] = useState<DCAPlan[]>([])
  const [showCancelled, setShowCancelled] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  // Realized Tab States
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [expandedRealized, setExpandedRealized] = useState<string | null>(null)

  // States for accordion (SELF and DCA)
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({ [new Date().getFullYear().toString()]: true })
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({ [`${new Date().getFullYear()}-${new Date().getMonth() + 1}`]: true })

  const fetchDcaPlans = useCallback(async () => {
    const res = await fetch('/api/dca')
    if (res.ok) {
      const data = await res.json()
      setDcaPlans(data)
    }
  }, [])

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

  useEffect(() => {
    if (tab === 'DCA') fetchDcaPlans()
  }, [tab, fetchDcaPlans])

  const filtered = useMemo(() => {
    let result = txs
    if (tab === 'SELF') result = result.filter(t => t.trade_type !== 'DCA')
    else if (tab === 'DCA') result = result.filter(t => t.trade_type === 'DCA')
    if (filter.trim() && tab !== 'REALIZED') {
      result = result.filter(t => codeOnly(t.symbol).includes(filter.toUpperCase()) || t.symbol.includes(filter.toUpperCase()) || (t.name_zh || getStockName(t.symbol)).includes(filter))
    }
    return result
  }, [txs, tab, filter])

  const realizedRange = useMemo(() => {
    const today = new Date().toISOString().split('T')[0], now = new Date()
    if (rangeMode === 'all') return { start: '2000-01-01', end: today }
    if (rangeMode === 'year') return { start: `${now.getFullYear()}-01-01`, end: today }
    if (rangeMode === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: today }
    if (rangeMode === '3months') return { start: new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0], end: today }
    return { start: customStart, end: customEnd }
  }, [rangeMode, customStart, customEnd])

  const realizedData = useMemo(() => {
    if (tab !== 'REALIZED') return null
    const sorted = [...txs].sort((a,b) => a.trade_date.localeCompare(b.trade_date) || a.id - b.id)
    const inventory: any = {}, stats: Record<string, any> = {}
    let totalBuy = 0, totalSell = 0, totalFee = 0, totalTax = 0, totalRealized = 0, buyCount = 0, sellCount = 0

    for (const tx of sorted) {
      const inRange = tx.trade_date >= realizedRange.start && tx.trade_date <= realizedRange.end
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      if (!stats[tx.symbol]) stats[tx.symbol] = { buy: 0, sell: 0, realized: 0, count: 0, history: [] }
      const stock = stats[tx.symbol]

      if (tx.action !== 'SELL') {
        inventory[tx.symbol].push({ shares: tx.shares, cost: tx.amount + tx.fee, date: tx.trade_date, id: tx.id })
        if (inRange) { totalBuy += tx.amount; totalFee += tx.fee; buyCount++; stock.buy += tx.amount; stock.count++ }
        stock.history.push({ ...tx, type: 'BUY' })
      } else {
        let rem = tx.shares, costBasis = 0, matches = []
        while (rem > 0 && inventory[tx.symbol].length) {
          const lot = inventory[tx.symbol][0], take = Math.min(lot.shares, rem), unit = lot.cost / lot.shares, pCost = take * unit
          costBasis += pCost; matches.push({ date: lot.date, shares: take })
          lot.shares -= take; lot.cost -= pCost; rem -= take
          if (lot.shares <= 0) inventory[tx.symbol].shift()
        }
        const profit = tx.net_amount - costBasis
        if (inRange) { totalSell += tx.amount; totalFee += tx.fee; totalTax += tx.tax; totalRealized += profit; sellCount++; stock.sell += tx.amount; stock.realized += profit; stock.count++ }
        stock.history.push({ ...tx, type: 'SELL', matches, profit })
      }
    }
    return { summary: { totalBuy, totalSell, totalFee, totalTax, totalRealized, buyCount, sellCount }, stocks: Object.entries(stats).filter(([,s])=>s.count>0).map(([sym,s])=>({symbol:sym, ...s})).sort((a,b)=>b.realized-a.realized) }
  }, [txs, tab, realizedRange])

  const groupedData = useMemo(() => {
    const groups: any = {}, today = new Date()
    filtered.forEach((t:any) => {
      const d = new Date(t.trade_date)
      if (d > today) return
      const y = d.getFullYear().toString(), m = (d.getMonth()+1).toString()
      if (!groups[y]) groups[y] = {}
      if (!groups[y][m]) groups[y][m] = { txs: [], pnl: 0 }
      groups[y][m].txs.push(t); groups[y][m].pnl += t.net_amount
    })
    return groups
  }, [filtered])

  return (
    <div className="p-4 space-y-6 pb-32">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex bg-white/[0.03] p-1 rounded-xl border border-white/5">
          {([{id:'SELF',label:'自行交易'},{id:'DCA',label:'定期定額'},{id:'REALIZED',label:'已實交易'}] as const).map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} className={`flex-1 py-2.5 text-sm font-black rounded-lg transition-all relative ${tab===t.id?'text-gold bg-white/5':'text-white/30'}`}>{t.label}{tab===t.id && <div className="absolute bottom-0 inset-x-4 h-0.5 bg-gold rounded-full"/>}</button>
          ))}
        </div>
        <button onClick={()=>setExportOpen(true)} className="w-11 h-11 flex items-center justify-center glass active:bg-white/10 text-gold"><Download size={20}/></button>
      </div>

      {tab === 'REALIZED' ? (
        <div className="space-y-6 animate-slide-up">
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {['all','year','3months','month','custom'].map(opt => (
              <button key={opt} onClick={()=>setRangeMode(opt as any)} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${rangeMode===opt?'bg-gold text-bg-base border-gold':'bg-bg-hover text-white/40 border-transparent'}`}>{opt==='all'?'全部':opt==='year'?'今年':opt==='3months'?'近3月':opt==='month'?'本月':'自訂'}</button>
            ))}
          </div>
          {rangeMode === 'custom' && <div className="flex items-center gap-2"><DatePicker value={customStart} onChange={setCustomStart} className="flex-1"/><span className="opacity-20">~</span><DatePicker value={customEnd} onChange={setCustomEnd} className="flex-1"/></div>}

          <div className="glass p-5 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <StatItem label="總買進" value={fmtMoney(realizedData!.summary.totalBuy)} sub={`${realizedData!.summary.buyCount}筆`}/>
              <StatItem label="總賣出" value={fmtMoney(realizedData!.summary.totalSell)} sub={`${realizedData!.summary.sellCount}筆`}/>
              <StatItem label="總手續費" value={fmtMoney(realizedData!.summary.totalFee)} sub={`${realizedData!.summary.buyCount+realizedData!.summary.sellCount}筆`}/>
              <StatItem label="總交易稅" value={fmtMoney(realizedData!.summary.totalTax)} sub={`${realizedData!.summary.sellCount}筆`}/>
            </div>
            <div className="pt-5 border-t border-white/5 flex justify-between items-end">
              <span className="text-[11px] font-black text-white/30 uppercase tracking-widest">已實現損益</span>
              <span className={`font-black font-mono text-2xl ${realizedData!.summary.totalRealized>=0?'text-red-400':'text-green-400'}`}>{realizedData!.summary.totalRealized>=0?'+':''}{fmtMoney(Math.round(realizedData!.summary.totalRealized))}</span>
            </div>
          </div>

          <div className="space-y-3">
            {realizedData!.stocks.map(s => (
              <div key={s.symbol} className={`card-base overflow-hidden border transition-all ${expandedRealized===s.symbol?'border-gold':''}`}>
                <button onClick={()=>setExpandedRealized(expandedRealized===s.symbol?null:s.symbol)} className="w-full p-4 text-left space-y-2 active:bg-bg-hover">
                  <div className="flex justify-between items-center"><div className="flex items-center gap-2"><span className="font-black text-white">{getStockName(s.symbol)}</span><span className="text-[10px] font-mono opacity-30">{codeOnly(s.symbol)}</span></div><span className={`font-black font-mono ${s.realized>=0?'text-red-400':'text-green-400'}`}>{s.realized>=0?'+':''}{fmtMoney(Math.round(s.realized))}</span></div>
                  <div className="flex justify-between text-[10px] font-bold text-white/20"><span>買入 {fmtMoney(s.buy)}</span><span>賣出 {fmtMoney(s.sell)}</span></div>
                </button>
                {expandedRealized === s.symbol && (
                  <div className="bg-black/20 border-t border-white/5 p-4 space-y-4">
                    {s.history.map((tx:any) => (
                      <div key={tx.id} className="space-y-1 text-xs">
                        <div className="flex justify-between"><div className="flex items-center gap-2"><span className={`px-1.5 py-0.5 rounded-md font-black text-[9px] ${tx.type==='BUY'?'bg-red-400/10 text-red-400':'bg-green-400/10 text-green-400'}`}>{tx.type==='BUY'?'買入':'賣出'}</span><span className="opacity-40">{tx.trade_date}</span></div><span className="font-black text-white/80">{tx.shares.toLocaleString()}股 @ {tx.price.toFixed(2)}</span></div>
                        <div className="flex justify-between pl-1"><span className="opacity-20 text-[10px]">費{fmtMoney(tx.fee)}{tx.tax>0&&` 稅${fmtMoney(tx.tax)}`}</span><span className={`font-mono font-black ${tx.net_amount>=0?'text-red-400':'text-green-400'}`}>{tx.net_amount>=0?'+':''}{fmtMoney(tx.net_amount)}</span></div>
                        {tx.matches?.map((m:any,i:number)=><div key={i} className="pl-4 border-l border-white/10 text-[9px] opacity-20 italic">↳ 沖銷 {m.date} 買入 ({m.shares}股)</div>)}
                        {tx.type==='SELL' && <div className={`text-right font-black text-[10px] pt-1 ${tx.profit>=0?'text-red-400/60':'text-green-400/60'}`}>此筆損益 {tx.profit>=0?'+':''}{fmtMoney(Math.round(tx.profit))}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-slide-up">
          <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜尋股票代號或名稱..." className="input-base"/>
          {tab === 'SELF' ? (
            Object.keys(groupedData).sort((a,b)=>b.localeCompare(a)).map(year => (
              <div key={year} className="space-y-3">
                <div className="flex items-center gap-2 px-1"><span className="text-gold"><Calendar size={14}/></span><span className="font-black text-lg text-white">{year}年</span><div className="h-px flex-1 bg-white/5"/></div>
                {Object.keys(groupedData[year]).sort((a,b)=>Number(b)-Number(a)).map(month => (
                  <div key={month} className="space-y-2">
                    <button onClick={()=>{const k=`${year}-${month}`; setExpandedMonths(p=>({...p, [k]:!p[k]}))}} className="w-full flex justify-between p-4 card-base active:bg-bg-hover"><div className="flex items-center gap-2"><span className="font-bold text-white/80">{month}月</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/20">{groupedData[year][month].txs.length}筆</span></div><div className={`font-mono font-bold ${groupedData[year][month].pnl>=0?'text-red-400':'text-green-400'}`}>{groupedData[year][month].pnl>=0?'+':''}{fmtMoney(Math.round(groupedData[year][month].pnl))}</div></button>
                    {expandedMonths[`${year}-${month}`] && <div className="space-y-2 pt-1">{groupedData[year][month].txs.map((tx:any)=><TxRow key={tx.id} tx={tx} settings={settings} onDelete={()=>deleteTx(tx.id)} onUpdated={onRefresh}/>)}</div>}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="space-y-8">
              <div className="space-y-3"><h3 className="text-xs font-black text-white/30 uppercase tracking-widest px-1">進行中的計畫</h3>{activePlans.length?activePlans.map(p=>(<div key={p.id} className="card-base p-4 flex justify-between items-center"><div className="space-y-1"><div className="flex items-center gap-2"><span className="font-black text-white">{getStockName(p.symbol)}</span><span className="text-[10px] font-mono opacity-30">{codeOnly(p.symbol)}</span></div><div className="text-[11px] font-bold text-white/40">每次 {fmtMoney(p.amount)}元 · 每月 {p.days_of_month.join(', ')}日</div></div><div className="flex gap-2"><button onClick={()=>onEditDca?.(p)} className="p-2 rounded-lg bg-white/5 text-gold border border-white/10 active:scale-90 transition-all"><Pencil size={14}/></button><button onClick={()=>toggleDcaStatus(p)} className="p-2 rounded-lg bg-red-400/5 text-red-400 border border-red-400/10 active:scale-90 transition-all"><Trash2 size={14}/></button></div></div>)):<div className="text-center py-10 opacity-20 text-sm italic">尚無定期定額計畫</div>}</div>
              <div className="space-y-3"><h3 className="text-xs font-black text-white/30 uppercase tracking-widest px-1">申購紀錄</h3>{Object.keys(groupedData).sort((a,b)=>b.localeCompare(a)).map(y=>(<div key={y} className="space-y-2">{Object.keys(groupedData[y]).sort((a,b)=>Number(b)-Number(a)).map(m=>(<div key={m} className="space-y-2">{groupedData[y][m].txs.map((tx:any)=><TxRow key={tx.id} tx={tx} settings={settings} onDelete={()=>deleteTx(tx.id)} onUpdated={onRefresh}/>)}</div>))}</div>))}</div>
            </div>
          )}
        </div>
      )}
      {exportOpen && <ExportModal onClose={()=>setExportOpen(false)} />}
    </div>
  )
}

function StatItem({ label, value, sub }: any) { return <div className="flex flex-col"><span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1.5">{label}</span><span className="font-black font-mono text-lg text-white/80 leading-none">{value}</span><span className="text-[9px] font-bold text-white/10 mt-1.5">{sub}</span></div> }

function TxRow({ tx, settings, onDelete, onUpdated }: any) {
  const [open, setOpen] = useState(false), [isEditing, setIsEditing] = useState(false)
  if (isEditing) return <div className="p-4 card-base border-gold space-y-4"><EditForm tx={tx} settings={settings} onCancel={()=>setIsEditing(false)} onSaved={()=>{setIsEditing(false);onUpdated()}}/></div>
  const isBuy = tx.action === 'BUY' || tx.action === 'DCA'
  return (
    <div className="card-base overflow-hidden border-white/5">
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center gap-3 p-4 text-left active:bg-bg-hover">
        <div className={`p-2 rounded-lg ${isBuy?'bg-red-400/10 text-red-400':'bg-green-400/10 text-green-400'}`}>{isBuy?<TrendingUp size={16}/>:<TrendingDown size={16}/>}</div>
        <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="font-black text-white truncate">{tx.name_zh || getStockName(tx.symbol)}</span><span className="text-[10px] font-mono opacity-20">{codeOnly(tx.symbol)}</span></div><div className="text-[10px] font-bold text-white/20">{tx.trade_date} · {tx.shares.toLocaleString()}股</div></div>
        <div className={`text-right font-black font-mono ${tx.net_amount>=0?'text-red-400':'text-green-400'}`}>{tx.net_amount>=0?'+':''}{fmtMoney(tx.net_amount)}</div>
      </button>
      {open && (
        <div className="bg-black/20 p-4 pt-0 border-t border-white/5 space-y-4">
          <div className="grid grid-cols-3 gap-2 pt-4">
            <DetailItem label="股數" value={tx.shares.toLocaleString()}/>
            <DetailItem label="價格" value={tx.price.toFixed(2)}/>
            <DetailItem label="費用" value={fmtMoney(tx.fee+tx.tax)}/>
          </div>
          {tx.note && <div className="p-2 rounded bg-white/5 text-[10px] text-white/40 italic">"{tx.note}"</div>}
          <div className="flex gap-2"><button onClick={()=>setIsEditing(true)} className="flex-1 btn-secondary py-2 flex items-center justify-center gap-2 text-xs"><Pencil size={14}/>編輯</button><button onClick={onDelete} className="flex-1 btn-danger py-2 flex items-center justify-center gap-2 text-xs bg-red-400/5 border-red-400/20 text-red-400/60"><Trash2 size={14}/>刪除</button></div>
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value }: any) { return <div><div className="text-[9px] font-black text-white/20 uppercase mb-0.5">{label}</div><div className="text-xs font-black text-white/70 font-mono">{value}</div></div> }

function EditForm({ tx, settings, onCancel, onSaved }: any) {
  const [date, setDate] = useState(tx.trade_date), [shares, setShares] = useState(tx.shares), [price, setPrice] = useState(tx.price), [note, setNote] = useState(tx.note || '')
  const handleSave = async () => {
    await fetch('/api/transactions', { method: 'PUT', body: JSON.stringify({ id: tx.id, trade_date: date, shares, price, note }) })
    onSaved()
  }
  return (
    <div className="space-y-4">
      <DatePicker value={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3"><input type="number" value={shares} onChange={e=>setShares(Number(e.target.value))} className="input-base font-black font-mono"/><input type="number" step="0.01" value={price} onChange={e=>setPrice(Number(e.target.value))} className="input-base font-black font-mono"/></div>
      <input value={note} onChange={e=>setNote(e.target.value)} className="input-base text-sm" placeholder="備註..."/>
      <div className="flex gap-2"><button onClick={handleSave} className="flex-1 btn-primary py-3">儲存</button><button onClick={onCancel} className="w-1/4 btn-secondary py-3">取消</button></div>
    </div>
  )
}

function ExportModal({ onClose }: any) {
  const [range, setRange] = useState('all'), [start, setStart] = useState(''), [end, setEnd] = useState(''), [loading, setLoading] = useState(false)
  const handleExport = async () => {
    setLoading(true)
    const res = await fetch(`/api/export?start_date=${start||'2000-01-01'}&end_date=${end||new Date().toISOString().split('T')[0]}`)
    const blob = await res.blob(), url = window.URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = `交易紀錄.xlsx`; a.click(); onClose()
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80">
      <div className="glass w-full max-w-sm p-6 space-y-6">
        <h3 className="font-black text-lg text-white text-center">匯出 Excel</h3>
        <div className="grid grid-cols-2 gap-2">{['month','year','all','custom'].map(o=><button key={o} onClick={()=>setRange(o)} className={`py-3 rounded-xl text-xs font-bold border transition-all ${range===o?'bg-gold/10 text-gold border-gold/30':'bg-white/5 text-white/40 border-transparent'}`}>{o==='month'?'本月':o==='year'?'今年':o==='all'?'全部':'自訂'}</button>)}</div>
        {range==='custom'&&<div className="space-y-2"><DatePicker value={start} onChange={setStart}/><DatePicker value={end} onChange={setEnd}/></div>}
        <div className="flex gap-2"><button onClick={handleExport} disabled={loading} className="flex-1 btn-primary">確認匯出</button><button onClick={onClose} className="w-1/4 btn-secondary">取消</button></div>
      </div>
    </div>
  )
}
