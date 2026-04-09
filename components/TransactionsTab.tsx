'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Transaction, UserSettings, codeOnly, fmtMoney, getStockName, calcFee, calcTax } from '@/types'
import { usePortfolio } from './providers/PortfolioContext'
import { 
  Download, 
  TrendingUp, 
  TrendingDown, 
  Repeat, 
  Trash2, 
  Pencil, 
  ChevronDown,
  Calendar,
  BarChart2,
} from 'lucide-react'
import DatePicker from './DatePicker'
import ConfirmModal from './ConfirmModal'

interface Props {
  onRefresh: () => void
}

type TabMode = 'SELF' | 'REALIZED'
type RangeMode = 'month' | '3months' | 'year' | 'all' | 'custom'

export default function TransactionsTab({ onRefresh }: Props) {
  const { stats } = usePortfolio()
  const { fullHistoryStats } = stats
  const [tab, setTab] = useState<TabMode>('SELF')
  const [filter, setFilter] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [expandedRealized, setExpandedRealized] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({ [`${new Date().getFullYear()}-${new Date().getMonth() + 1}`]: true })

  const filtered = useMemo(() => {
    const allTxs: Transaction[] = []
    Object.values(fullHistoryStats).forEach((s: any) => {
      s.history.forEach((h: any) => allTxs.push(h))
    })
    let result = allTxs.sort((a,b) => b.trade_date.localeCompare(a.trade_date) || b.id - a.id)
    if (filter.trim() && tab !== 'REALIZED') {
      result = result.filter(t => codeOnly(t.symbol).includes(filter.toUpperCase()) || t.symbol.includes(filter.toUpperCase()) || (t.name_zh || getStockName(t.symbol)).includes(filter))
    }
    return result
  }, [fullHistoryStats, tab, filter])

  const realizedRange = useMemo(() => {
    const today = new Date().toISOString().split('T')[0], now = new Date()
    if (rangeMode === 'all') return { start: '2000-01-01', end: today }
    if (rangeMode === 'year') return { start: `${now.getFullYear()}-01-01`, end: today }
    if (rangeMode === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: today }
    if (rangeMode === '3months') return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0], end: today }
    return { start: customStart, end: customEnd }
  }, [rangeMode, customStart, customEnd])

  const realizedData = useMemo(() => {
    if (tab !== 'REALIZED') return null
    const stats_map: Record<string, any> = {}
    Object.entries(fullHistoryStats).forEach(([sym, s]: [string, any]) => {
      const inRangeHistory = s.history.filter((h: any) => h.type === 'SELL' && h.trade_date >= realizedRange.start && h.trade_date <= realizedRange.end)
      if (inRangeHistory.length > 0) {
        const local = { buy: 0, sell: 0, realized: 0, fee: 0, tax: 0, count: inRangeHistory.length, history: s.history }
        inRangeHistory.forEach((h: any) => {
          local.buy += h.realizedCost; local.sell += h.net; local.fee += (h.fee || 0); local.tax += (h.tax || 0); local.realized += h.profit
        })
        stats_map[sym] = local
      }
    })
    const stocks = Object.entries(stats_map).map(([sym, s]) => ({ symbol: sym, ...s })).sort((a, b) => b.realized - a.realized)
    const summary = stocks.reduce((acc, s) => ({
      totalBuy: acc.totalBuy + s.buy, totalSell: acc.totalSell + s.sell, totalFee: acc.totalFee + s.fee, totalTax: acc.totalTax + s.tax, totalRealized: acc.totalRealized + s.realized, sellCount: acc.sellCount + s.count
    }), { totalBuy: 0, totalSell: 0, totalFee: 0, totalTax: 0, totalRealized: 0, sellCount: 0 })
    return { stocks, summary }
  }, [tab, fullHistoryStats, realizedRange])

  const groupedData = useMemo(() => {
    const groups: any = {}
    filtered.forEach((tx: any) => {
      const [y, m] = tx.trade_date.split('-')
      if (!groups[y]) groups[y] = {}
      if (!groups[y][m]) groups[y][m] = { txs: [], pnl: 0 }
      groups[y][m].txs.push(tx)
      if (tx.type === 'SELL') groups[y][m].pnl += (tx.profit || 0)
    })
    return groups
  }, [filtered])

  const confirmDelete = async () => {
    if (!deletingId) return
    await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id: deletingId }) })
    setDeletingId(null); onRefresh()
  }

  return (
    <div className="p-4 space-y-6 tabular-nums pb-32">
      <div className="flex bg-[var(--bg-card)] p-1.5 rounded-2xl border border-[var(--border-bright)] shadow-xl relative z-10 items-center gap-1.5">
        <button onClick={() => setTab('SELF')} className={`flex-1 py-3 text-[13px] font-black rounded-xl transition-all ${tab === 'SELF' ? 'bg-accent text-bg-base shadow-lg shadow-accent/20' : 'text-[var(--t2)] opacity-40 hover:opacity-100'}`}>手動紀錄</button>
        <button onClick={() => setTab('REALIZED')} className={`flex-1 py-3 text-[13px] font-black rounded-xl transition-all ${tab === 'REALIZED' ? 'bg-accent text-bg-base shadow-lg shadow-accent/20' : 'text-[var(--t2)] opacity-40 hover:opacity-100'}`}>已實現損益</button>
        <button 
          onClick={() => setExportOpen(true)} 
          className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-accent active:scale-90 transition-all shadow-md group"
          title="匯出報表"
        >
          <Download size={20} className="group-hover:translate-y-0.5 transition-transform" />
        </button>
      </div>

      {tab === 'REALIZED' ? (
        <div className="space-y-6 animate-slide-up">
          <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <span className="text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-[0.2em]">統計區間</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {['month', '3months', 'year', 'all'].map(m => (
                <button key={m} onClick={() => setRangeMode(m as any)} className={`py-3 rounded-xl text-[10px] font-black border transition-all ${rangeMode === m ? 'bg-accent text-bg-base border-accent shadow-md' : 'bg-white/5 text-[var(--t2)] border-transparent opacity-60'}`}>
                  {m === 'month' ? '本月' : m === '3months' ? '三月' : m === 'year' ? '今年' : '全部'}
                </button>
              ))}
            </div>
            <button onClick={() => setRangeMode('custom')} className={`w-full mt-2 py-3 rounded-xl text-[10px] font-black border transition-all ${rangeMode === 'custom' ? 'bg-accent text-bg-base border-accent shadow-md' : 'bg-white/5 text-[var(--t2)] border-transparent opacity-60'}`}>自訂日期範疇</button>
            {rangeMode === 'custom' && (
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/5 animate-slide-up">
                <div className="space-y-1.5"><Label>開始日期</Label><DatePicker value={customStart} onChange={setCustomStart}/></div>
                <div className="space-y-1.5"><Label>結束日期</Label><DatePicker value={customEnd} onChange={setCustomEnd}/></div>
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-6 shadow-2xl space-y-8">
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <StatItem label="總買入額" value={fmtMoney(realizedData!.summary.totalBuy)} sub={`${realizedData!.summary.sellCount}筆`}/>
              <StatItem label="總賣出額" value={fmtMoney(realizedData!.summary.totalSell)} sub={`${realizedData!.summary.sellCount}筆`}/>
              <StatItem label="總手續費" value={fmtMoney(realizedData!.summary.totalFee)} sub="合計"/>
              <StatItem label="總交易稅" value={fmtMoney(realizedData!.summary.totalTax)} sub={`${realizedData!.summary.sellCount}筆`}/>
            </div>
            <div className="pt-6 border-t border-white/5 flex justify-between items-end">
              <span className="text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest">已實現損益合計</span>
              <span className={`font-black font-mono text-2xl ${realizedData!.summary.totalRealized>=0?'text-red-400':'text-green-400'}`}>{realizedData!.summary.totalRealized>=0?'+':''}{fmtMoney(realizedData!.summary.totalRealized)}</span>
            </div>
          </div>

          <div className="space-y-3">
            {realizedData!.stocks.map(s => (
              <RealizedStockCard key={s.symbol} s={s} expanded={expandedRealized===s.symbol} onToggle={()=>setExpandedRealized(expandedRealized===s.symbol?null:s.symbol)} onUpdated={onRefresh} onDelete={(id:number)=>setDeletingId(id)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-slide-up">
          <div className="px-1"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜尋股票代碼或名稱.." className="w-full bg-[var(--bg-card)] border border-[var(--border-bright)] rounded-2xl py-4 px-6 text-[15px] font-black text-[var(--t2)] outline-none focus:border-accent shadow-xl placeholder:opacity-30 transition-all"/></div>
          {Object.keys(groupedData).sort((a,b)=>b.localeCompare(a)).map(year => (
            <div key={year} className="space-y-4">
              <div className="flex items-center gap-3 px-2 opacity-40"><Calendar size={16} className="text-accent"/><span className="font-black text-lg text-[var(--t1)]">{year} 年</span><div className="h-px flex-1 bg-white/5"/></div>
              {Object.keys(groupedData[year]).sort((a,b)=>Number(b)-Number(a)).map(month => (
                <div key={month} className="space-y-2">
                  <button onClick={()=>{const k=`${year}-${month}`; setExpandedMonths(p=>({...p, [k]:!p[k]}))}} className={`w-full flex justify-between p-5 bg-[var(--bg-card)] border-[0.5px] ${expandedMonths[`${year}-${month}`] ? 'border-[var(--accent)] ring-1 ring-[var(--accent-bright)]/30 shadow-lg' : 'border-[var(--border-bright)]'} rounded-2xl active:bg-white/5 transition-all shadow-xl`}><div className="flex items-center gap-3"><span className="font-black text-[18px] text-[var(--t1)]">{month} 月</span><span className="text-[10px] px-2.5 py-1 rounded-full bg-white/10 text-[var(--t2)] opacity-60 font-black tracking-widest">{groupedData[year][month].txs.length} 筆</span></div><div className={`font-mono font-black text-[18px] ${groupedData[year][month].pnl>=0?'text-red-400':'text-green-400'}`}>{groupedData[year][month].pnl>=0?'+':''}{fmtMoney(Math.round(groupedData[year][month].pnl))}</div></button>
                  {expandedMonths[`${year}-${month}`] && <div className="space-y-3 pt-1">{groupedData[year][month].txs.map((tx:any)=><TxRow key={tx.id} tx={tx} onDelete={(id:number)=>setDeletingId(id)} onUpdated={onRefresh}/>)}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <ConfirmModal open={!!deletingId} onCancel={()=>setDeletingId(null)} onConfirm={confirmDelete} />
      {exportOpen && <ExportModal onClose={()=>setExportOpen(false)} />}
    </div>
  )
}

function RealizedStockCard({ s, expanded, onToggle, onUpdated, onDelete }: any) {
  const [name, setName] = useState(getStockName(s.symbol))
  useEffect(() => { fetch(`/api/stockname?symbol=${s.symbol}`).then(res => res.json()).then(data => { if (data.name_zh) setName(data.name_zh) }) }, [s.symbol])
  return (
    <div className={`bg-[var(--bg-card)] border-[0.5px] ${expanded?'border-[var(--accent)] ring-1 ring-[var(--accent-bright)]/30 shadow-2xl':'border-[var(--border-bright)]'} rounded-2xl overflow-hidden transition-all shadow-xl`}>
      <button onClick={onToggle} className="w-full p-5 text-left space-y-4 active:bg-white/5">
        <div className="flex justify-between items-center"><div className="flex items-center gap-2"><span className="font-black text-[17px] text-[var(--t1)] tracking-tight truncate">{name}</span><span className="text-[12px] font-mono text-[var(--t2)] opacity-60 mt-0.5">{codeOnly(s.symbol)}</span></div><span className={`font-black font-mono text-[17px] ${s.realized>=0?'text-red-400':'text-green-400'}`}>{s.realized>=0?'+':''}{fmtMoney(s.realized)}</span></div>
        <div className="flex justify-between text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest"><span>投入 {fmtMoney(s.buy)}</span><span>回收 {fmtMoney(s.sell)}</span></div>
      </button>
      {expanded && (
        <div className="bg-black/30 border-t border-white/5 p-5 space-y-6">
          {s.history.map((tx:any) => (
            <div key={tx.id} className="space-y-2 animate-in fade-in slide-in-from-left-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full font-black text-[10px] border ${tx.action==='BUY'||tx.action==='DCA'?'bg-red-400/10 text-red-400 border-red-400/20':'bg-green-400/10 text-green-400 border-green-400/20'}`}>{tx.action==='SELL'?'賣出':'買入'}</span>
                  <span className="text-[var(--t2)] opacity-60 text-[11px] font-mono">{tx.trade_date}</span>
                </div>
                <span className="font-black text-[var(--t2)] opacity-90 text-[13px]">{(tx.shares ?? 0).toLocaleString()} 股 <span className="text-[10px] opacity-20">@</span> {(tx.price ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pl-1">
                <span className="font-mono font-black text-[14px] ${tx.realizedCost! == undefined ? 'text-red-400' : 'text-green-400'}">{tx.realizedCost !== undefined ? `成本 ${fmtMoney(tx.realizedCost)}` : ''}</span>
              </div>
              {tx.matches?.map((m:any,i:number)=><div key={i} className="pl-4 border-l-2 border-white/10 text-[10px] text-[var(--t3)] italic py-0.5 ml-1">沖銷 {m.date} 買入 ({m.shares} 股)</div>)}
              {tx.type==='SELL' && (
                <div className={`text-right font-black text-[10px] pt-1.5 border-t border-white/5 space-x-2 ${tx.profit>=0?'text-red-400/60':'text-green-400/60'}`}>
                  <span>此筆損益 {tx.profit>=0?'+':''}{fmtMoney(tx.profit)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({ tx, onDelete, onUpdated }: any) {
  const [open, setOpen] = useState(false), [isEditing, setIsEditing] = useState(false)
  if (isEditing) return <div className="p-5 bg-[var(--bg-card)] border-[var(--border-bright)] rounded-2xl shadow-2xl animate-slide-up"><EditForm tx={tx} onCancel={()=>setIsEditing(false)} onSaved={()=>{setIsEditing(false);onUpdated()}}/></div>
  return (
    <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl overflow-hidden shadow-xl">
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between p-5 text-left active:bg-white/5 transition-all">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-[var(--t1)] text-[17px] tracking-tight truncate">{tx.name_zh || getStockName(tx.symbol)}</span>
            <span className="text-[12px] font-mono text-[var(--t2)] opacity-40">{codeOnly(tx.symbol)}</span>
          </div>
          <div className="text-[11px] font-black text-[var(--t2)] opacity-60 mt-1.5 flex items-center gap-2 uppercase tracking-widest">
            <span>{tx.trade_date} · {(tx.shares ?? 0).toLocaleString()} 股</span>
          </div>
        </div>
        <div className={`text-right font-black font-mono text-[17px] shrink-0 ${tx.net_amount>=0?'text-red-400':'text-green-400'}`}>
          {tx.net_amount>=0?'+':''}{fmtMoney(tx.net_amount || 0)}
        </div>
      </button>
      {open && (
        <div className="bg-black/30 p-6 pt-0 border-t border-white/5 space-y-6 animate-slide-up">
          <div className="grid grid-cols-3 gap-4 pt-6">
            <DetailItem label="股數" value={(tx.shares ?? 0).toLocaleString()}/>
            <DetailItem label="價格" value={(tx.price ?? 0).toFixed(2)}/>
          </div>
          {tx.note && <div className="p-4 rounded-xl bg-white/5 text-[12px] text-[var(--t2)] opacity-70 italic leading-relaxed border border-white/5">"{tx.note}"</div>}
          <div className="flex gap-3 pt-1"><button onClick={()=>setIsEditing(true)} className="flex-[3] btn-primary py-3 flex items-center justify-center gap-2 text-sm"><Pencil size={16}/>編輯</button><button onClick={()=>onDelete(tx.id)} className="flex-1 btn-danger py-3 flex items-center justify-center active:scale-95 transition-all"><Trash2 size={18}/></button></div>
        </div>
      )}
    </div>
  )
}

function StatItem({ label, value, sub }: any) { return <div className="flex flex-col"><span className="text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest mb-1.5">{label}</span><span className="font-black font-mono text-[20px] text-[var(--t1)] leading-tight">{value}</span><span className="text-[10px] font-black text-[var(--t2)] opacity-40 mt-1 uppercase tracking-tighter">{sub}</span></div> }
function DetailItem({ label, value }: any) { return <div><div className="text-[10px] font-black text-[var(--t2)] opacity-60 uppercase tracking-widest mb-1.5">{label}</div><div className="text-[15px] font-bold text-[var(--t1)] font-mono">{value}</div></div> }

function EditForm({ tx, onCancel, onSaved }: any) {
  const { stats } = usePortfolio()
  const [date, setDate] = useState(tx.trade_date), [shares, setShares] = useState<number|''>(tx.shares), [price, setPrice] = useState<number|''>(tx.price), [note, setNote] = useState(tx.note || '')
  const [tradeType, setTradeType] = useState(tx.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots] = useState<number | ''>(Math.floor(tx.shares / 1000) || 1)
  const isBuy = tx.action === 'BUY' || tx.action === 'DCA'
  const finalShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = Number(price) || 0
  const amount = finalShares * safePrice
  const net = isBuy ? -amount : amount // Simplified display in edit

  const handleSave = async () => {
    await fetch('/api/transactions', { method: 'PUT', body: JSON.stringify({ id: tx.id, trade_date: date, shares: finalShares, price: safePrice, note }) })
    onSaved()
  }
  return (
    <div className="space-y-5">
      <div className="text-center pb-3 border-b border-white/5"><h4 className="font-black text-sm text-accent">編輯：{isBuy?'買入':'賣出'} {tx.name_zh || tx.symbol}</h4></div>
      <div className="flex gap-2 p-1 bg-black/20 rounded-xl">
        <button onClick={() => setTradeType('FULL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FULL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)]'}`}>整張 (1000股)</button>
        <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FRACTIONAL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)]'}`}>零股</button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label>{tradeType==='FULL'?'張數':'股數'}</Label><input type="number" value={tradeType==='FULL'?lots:shares} onChange={e=>{const v=e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v as any):setShares(v as any)}} className="input-base text-center font-black py-3" /></div>
        <div className="space-y-1.5"><Label>成交價</Label><input type="number" step="0.01" value={price} onChange={e=>setPrice(e.target.value===''?'':Number(e.target.value))} className="input-base text-center font-black py-3" /></div>
      </div>
      <div className="space-y-1.5"><Label>交易日期</Label><DatePicker value={date} onChange={setDate} /></div>
      <div className="space-y-1.5"><Label>備註</Label><input value={note} onChange={e=>setNote(e.target.value)} className="input-base text-sm py-3" placeholder="選填..." /></div>
      <div className="flex gap-3 pt-1"><button onClick={handleSave} className="flex-[3] btn-primary py-3.5">確認修改</button><button onClick={onCancel} className="flex-1 btn-secondary py-3.5">取消</button></div>
    </div>
  )
}

function ExportModal({ onClose }: any) {
  const [range, setRange] = useState('month'), [start, setStart] = useState(''), [end, setEnd] = useState(''), [loading, setLoading] = useState(false)
  
  const getRangeInfo = () => {
    const today = new Date(), todayStr = today.toISOString().split('T')[0]
    let s = '2000-01-01', e = todayStr, desc = '全部'
    
    if (range === 'month') {
      s = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
      desc = '本月'
    } else if (range === '3months') {
      s = new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().split('T')[0]
      desc = '三個月'
    } else if (range === '6months') {
      s = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().split('T')[0]
      desc = '六個月'
    } else if (range === 'year') {
      const lastYear = new Date()
      lastYear.setFullYear(today.getFullYear() - 1)
      s = lastYear.toISOString().split('T')[0]
      desc = '一年'
    } else if (range === 'this_year') {
      s = `${today.getFullYear()}-01-01`
      desc = '今年'
    } else if (range === 'custom') {
      s = start; e = end; desc = '自訂區間'
    }
    return { s, e, desc }
  }

  const handleExport = async () => {
    setLoading(true)
    const { s, e, desc } = getRangeInfo()
    if (range === 'custom' && (!s || !e)) { alert('請選擇完整日期區間'); setLoading(false); return }
    
    const dateTag = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const filename = `存股紀錄_${dateTag}_${desc}.xlsx`
    
    try {
      const res = await fetch(`/api/export?start_date=${s}&end_date=${e}&filename=${encodeURIComponent(filename)}`)
      const blob = await res.blob(), url = window.URL.createObjectURL(blob), a = document.createElement('a')
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); alert('報表導出成功'); onClose()
    } catch(e) { alert('導出失敗') } finally { setLoading(false) }
  }

  const options = [
    { id: 'month', label: '本月' },
    { id: '3months', label: '三個月' },
    { id: '6months', label: '六個月' },
    { id: 'year', label: '一年' },
    { id: 'this_year', label: '今年' },
    { id: 'all', label: '全部' },
    { id: 'custom', label: '自訂' },
  ]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="glass w-full max-w-sm p-8 space-y-8 border-white/10 animate-in zoom-in-95 rounded-[2.5rem] shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-accent/20">
            <Download className="text-accent" size={32} />
          </div>
          <h3 className="font-black text-2xl text-[var(--t1)]">導出紀錄</h3>
          <p className="text-xs text-[var(--t3)] font-medium opacity-60">選擇匯出時間區間，產出 Excel 報表</p>
        </div>
        
        <div className="grid grid-cols-3 gap-2">
          {options.map(o => (
            <button 
              key={o.id} 
              onClick={() => setRange(o.id)} 
              className={`py-3 rounded-2xl text-[11px] font-black border transition-all active:scale-95 ${
                range === o.id ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20' : 'bg-white/5 text-[var(--t2)] border-transparent hover:bg-white/10'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {range === 'custom' && (
          <div className="space-y-4 animate-slide-up p-5 rounded-3xl bg-black/20 border border-white/5">
            <div className="space-y-2"><Label>起始日期</Label><DatePicker value={start} onChange={setStart}/></div>
            <div className="space-y-2"><Label>結束日期</Label><DatePicker value={end} onChange={setEnd}/></div>
          </div>
        )}

        <div className="flex gap-4 pt-4">
          <button 
            onClick={handleExport} 
            disabled={loading} 
            className="flex-[3] btn-primary py-4.5 text-base font-black shadow-lg shadow-accent/10 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? '產生中...' : '確認匯出'}
          </button>
          <button 
            onClick={onClose} 
            className="flex-1 btn-secondary py-4.5 text-base font-black active:scale-95 transition-all"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[11px] font-black text-[var(--t2)] opacity-60 uppercase tracking-[0.15em] ml-1 mb-1.5 block">{children}</label> }
