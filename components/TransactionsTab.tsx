'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Transaction, UserSettings, codeOnly, fmtMoney, getStockName, calcFee, calcTax } from '@/types'
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
  ClipboardList
} from 'lucide-react'
import DatePicker from './DatePicker'
import ConfirmModal from './ConfirmModal'

interface Props {
  txs: Transaction[]
  settings: UserSettings
  onRefresh: () => void
}

type TabMode = 'SELF' | 'REALIZED'
type RangeMode = 'month' | '3months' | 'year' | 'all' | 'custom'

export default function TransactionsTab({ txs, settings, onRefresh }: Props) {
  const [tab, setTab] = useState<TabMode>('SELF')
  const [filter, setFilter] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Realized Tab States
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [expandedRealized, setExpandedRealized] = useState<string | null>(null)

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({ [`${new Date().getFullYear()}-${new Date().getMonth() + 1}`]: true })

  const filtered = useMemo(() => {
    let result = txs
    // SELF tab shows all manual transactions (DCA is just a subtype of BUY)
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
    // User requested "Last 3 months" to be: April 7 -> Feb 1. (Month - 2)
    if (rangeMode === '3months') return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0], end: today }
    return { start: customStart, end: customEnd }
  }, [rangeMode, customStart, customEnd])

  const realizedData = useMemo(() => {
    if (tab !== 'REALIZED') return null
    const sorted = [...txs].sort((a,b) => a.trade_date.localeCompare(b.trade_date) || a.id - b.id)
    const inventory: any = {}, stats: Record<string, any> = {}

    for (const tx of sorted) {
      const isSell = tx.action === 'SELL'
      const inRange = tx.trade_date >= realizedRange.start && tx.trade_date <= realizedRange.end
      
      if (!inventory[tx.symbol]) inventory[tx.symbol] = []
      if (!stats[tx.symbol]) stats[tx.symbol] = { buy: 0, sell: 0, realized: 0, fee: 0, tax: 0, count: 0, history: [] }
      const stock = stats[tx.symbol]

      if (!isSell) {
        // Buy / DCA: Record in inventory
        const isDca = tx.action === 'DCA' || tx.trade_type === 'DCA'
        const f = calcFee(tx.amount, settings, false, isDca)
        const principal = tx.amount 
        inventory[tx.symbol].push({ 
          shares: tx.shares, 
          principal, 
          fee: f, 
          origShares: tx.shares,
          date: tx.trade_date, 
          id: tx.id 
        })
        stock.history.push({ ...tx, type: 'BUY', net: -Math.floor(principal + f) })
      } else {
        // Sell: Match against FIFO inventory
        const f = calcFee(tx.amount, settings, true)
        const t = calcTax(tx.amount, tx.symbol, settings)
        const sellProceeds = Math.floor(tx.amount - f - t)
        
        let rem = tx.shares
        let matchedBuyCostTotal = 0
        let matchedBuyFeeTotal = 0
        const matches = []
        
        while (rem > 0 && inventory[tx.symbol].length) {
          const lot = inventory[tx.symbol][0]
          const take = Math.min(lot.shares, rem)
          const ratio = take / lot.origShares
          const matchedPrincipal = (take / lot.shares) * lot.principal
          const matchedFee = ratio * lot.fee
          matchedBuyCostTotal += (matchedPrincipal + matchedFee)
          matchedBuyFeeTotal += matchedFee
          matches.push({ date: lot.date, shares: take })
          lot.shares -= take; lot.principal -= matchedPrincipal; rem -= take
          if (lot.shares <= 0) inventory[tx.symbol].shift()
        }
        
        const finalMatchedCost = Math.floor(matchedBuyCostTotal)
        const profit = sellProceeds - finalMatchedCost
        
        if (inRange) {
          stock.buy += finalMatchedCost
          stock.sell += sellProceeds
          stock.fee += (matchedBuyFeeTotal + f)
          stock.tax += t
          stock.realized += profit
          stock.count++
        }
        stock.history.push({ ...tx, type: 'SELL', matches, profit, net: sellProceeds })
      }
    }

    // Step 2: Post-process stocks and calculate summary via integer summation
    let totalBuy = 0, totalSell = 0, totalFee = 0, totalTax = 0, totalRealized = 0, sellCount = 0
    const stocks = Object.entries(stats)
      .filter(([, s]) => s.count > 0)
      .map(([sym, s]) => {
        const rounded = {
          symbol: sym,
          ...s,
          buy: Math.floor(s.buy),
          sell: Math.floor(s.sell),
          realized: Math.floor(s.realized),
          fee: Math.floor(s.fee),
          tax: Math.floor(s.tax)
        }
        totalBuy += rounded.buy
        totalSell += rounded.sell
        totalFee += rounded.fee
        totalTax += rounded.tax
        totalRealized += rounded.realized
        sellCount += s.count
        return rounded
      })
      .sort((a, b) => b.realized - a.realized)

    return { 
      summary: { totalBuy, totalSell, totalFee, totalTax, totalRealized, buyCount: sellCount, sellCount }, 
      stocks 
    }
  }, [txs, tab, realizedRange, settings])

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

  const confirmDelete = async () => {
    if (!deletingId) return
    await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id: deletingId }) })
    setDeletingId(null); onRefresh()
  }

  const [exportOpen, setExportOpen] = useState(false)

  return (
    <div className="p-4 space-y-6 pb-32 tabular-nums">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex bg-white/[0.03] p-1 rounded-xl border border-white/5">
          {([{id:'SELF',label:'手動交易'},{id:'REALIZED',label:'已實交易'}] as const).map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} className={`flex-1 py-2.5 text-sm font-black rounded-lg transition-all relative ${tab===t.id?'text-accent bg-white/5':'text-[var(--t2)]'}`}>{t.label}{tab===t.id && <div className="absolute bottom-0 inset-x-4 h-0.5 bg-accent rounded-full" />}</button>
          ))}
        </div>
        <button onClick={()=>setExportOpen(true)} className="w-11 h-11 flex items-center justify-center glass active:bg-white/10 text-accent transition-all"><Download size={20}/></button>
      </div>

      {tab === 'REALIZED' ? (
        <div className="space-y-6 animate-slide-up">
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {['all','year','3months', 'month', 'custom'].map(opt => (
              <button key={opt} onClick={()=>setRangeMode(opt as any)} className={`px-4 py-2 rounded-full text-xs font-black border transition-all ${rangeMode===opt?'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20':'bg-bg-hover text-[var(--t2)] border-transparent'}`}>{opt==='all'?'全部':opt==='year'?'今年':opt==='3months'?'近三個月':opt==='month'?'本月':'自訂'}</button>
            ))}
          </div>
          {rangeMode === 'custom' && <div className="flex items-center gap-2 animate-slide-up"><DatePicker value={customStart} onChange={setCustomStart} className="flex-1"/><span className="opacity-20">~</span><DatePicker value={customEnd} onChange={setCustomEnd} className="flex-1"/></div>}

          <div className="glass p-5 space-y-6 border-white/10 shadow-xl">
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <StatItem label="總買入額" value={fmtMoney(realizedData!.summary.totalBuy)} sub={`${realizedData!.summary.buyCount}筆`}/>
              <StatItem label="總賣出額" value={fmtMoney(realizedData!.summary.totalSell)} sub={`${realizedData!.summary.sellCount}筆`}/>
              <StatItem label="總手續費" value={fmtMoney(realizedData!.summary.totalFee)} sub={`${realizedData!.summary.buyCount+realizedData!.summary.sellCount}筆`}/>
              <StatItem label="總交易稅" value={fmtMoney(realizedData!.summary.totalTax)} sub={`${realizedData!.summary.sellCount}筆`}/>
            </div>
            <div className="pt-6 border-t border-white/5 flex justify-between items-end">
              <span className="text-[11px] font-black text-[var(--t3)] uppercase tracking-widest">已實現損益合計</span>
              <span className={`font-black font-mono text-2xl ${realizedData!.summary.totalRealized>=0?'text-red-400':'text-green-400'}`}>{realizedData!.summary.totalRealized>=0?'+':''}{fmtMoney(realizedData!.summary.totalRealized)}</span>
            </div>
          </div>

          <div className="space-y-3">
            {realizedData!.stocks.map(s => (
              <RealizedStockCard key={s.symbol} s={s} expanded={expandedRealized===s.symbol} onToggle={()=>setExpandedRealized(expandedRealized===s.symbol?null:s.symbol)} settings={settings} onUpdated={onRefresh} onDelete={(id:number)=>setDeletingId(id)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-slide-up">
          <div className="px-1"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜尋股票代碼或名稱.." className="input-base py-4 text-base"/></div>
          {Object.keys(groupedData).sort((a,b)=>b.localeCompare(a)).map(year => (
            <div key={year} className="space-y-4">
              <div className="flex items-center gap-3 px-2 opacity-40"><Calendar size={16} className="text-accent"/><span className="font-black text-lg text-[var(--t1)]">{year} 年</span><div className="h-px flex-1 bg-white/5"/></div>
              {Object.keys(groupedData[year]).sort((a,b)=>Number(b)-Number(a)).map(month => (
                <div key={month} className="space-y-2">
                  <button onClick={()=>{const k=`${year}-${month}`; setExpandedMonths(p=>({...p, [k]:!p[k]}))}} className="w-full flex justify-between p-4 card-base border-white/10 active:bg-bg-hover transition-all"><div className="flex items-center gap-2"><span className="font-black text-[var(--t1)]">{month} 月</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--t3)] font-bold">{groupedData[year][month].txs.length} 筆</span></div><div className={`font-mono font-black text-base ${groupedData[year][month].pnl>=0?'text-red-400':'text-green-400'}`}>{groupedData[year][month].pnl>=0?'+':''}{fmtMoney(Math.round(groupedData[year][month].pnl))}</div></button>
                  {expandedMonths[`${year}-${month}`] && <div className="space-y-3 pt-1">{groupedData[year][month].txs.map((tx:any)=><TxRow key={tx.id} tx={tx} settings={settings} onDelete={(id:number)=>setDeletingId(id)} onUpdated={onRefresh}/>)}</div>}
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

function RealizedStockCard({ s, expanded, onToggle, settings, onUpdated, onDelete }: any) {
  const [name, setName] = useState(getStockName(s.symbol))
  useEffect(() => { fetch(`/api/stockname?symbol=${s.symbol}`).then(res => res.json()).then(data => { if (data.name_zh) setName(data.name_zh) }) }, [s.symbol])
  return (
    <div className={`card-base overflow-hidden border transition-all ${expanded?'border-accent shadow-lg shadow-accent/5':'border-white/5'}`}>
      <button onClick={onToggle} className="w-full p-4 text-left space-y-3 active:bg-bg-hover">
        <div className="flex justify-between items-center"><div className="flex items-center gap-2"><span className="font-black text-[16px] text-[var(--t1)] truncate">{name}</span><span className="text-[10px] font-mono opacity-30">{codeOnly(s.symbol)}</span></div><span className={`font-black font-mono text-[16px] ${s.realized>=0?'text-red-400':'text-green-400'}`}>{s.realized>=0?'+':''}{fmtMoney(Math.round(s.realized))}</span></div>
        <div className="flex justify-between text-[11px] font-bold text-[var(--t3)]"><span>投入 {fmtMoney(Math.round(s.buy))}</span><span>回收 {fmtMoney(Math.round(s.sell))}</span></div>
      </button>
      {expanded && (
        <div className="bg-black/20 border-t border-white/5 p-4 space-y-5">
          {s.history.map((tx:any) => (
            <div key={tx.id} className="space-y-2 animate-in fade-in slide-in-from-left-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-md font-black text-[9px] border ${tx.action==='BUY'||tx.action==='DCA'?'bg-red-400/10 text-red-400 border-red-400/20':'bg-green-400/10 text-green-400 border-green-400/20'}`}>{tx.action==='SELL'?'賣出':'買入'}</span>
                  <span className="opacity-40 text-[11px] font-mono">{tx.trade_date}</span>
                  {(tx.action === 'DCA' || tx.trade_type === 'DCA') && <span className="text-yellow-500 bg-yellow-400/10 border border-yellow-500/20 px-1.5 py-0.5 rounded font-black text-[9px] leading-none">定期定額</span>}
                </div>
                <span className="font-black text-[var(--t1)] text-[12px]">{(tx.shares ?? 0).toLocaleString()} 股 @ {(tx.price ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pl-1">
                <span className="opacity-20 text-[10px] font-bold">費 {fmtMoney(calcFee(tx.amount, settings, tx.action==='SELL', tx.action==='DCA' || tx.trade_type==='DCA'))}{tx.action==='SELL'&&` 稅 ${fmtMoney(calcTax(tx.amount, tx.symbol, settings))}`}</span>
                <span className={`font-mono font-black text-[12px] ${tx.net_amount>=0?'text-red-400':'text-green-400'}`}>
                  {tx.net_amount>=0?'+':''}{fmtMoney(tx.type==='BUY' ? -Math.floor(tx.amount + calcFee(tx.amount, settings, false, tx.action==='DCA' || tx.trade_type==='DCA')) : Math.floor(tx.amount - calcFee(tx.amount, settings, true) - calcTax(tx.amount, tx.symbol, settings)))}
                </span>
              </div>
              {tx.matches?.map((m:any,i:number)=><div key={i} className="pl-4 border-l-2 border-white/10 text-[10px] text-[var(--t3)] italic py-0.5 ml-1">沖銷 {m.date} 買入 ({m.shares} 股)</div>)}
              {tx.type==='SELL' && <div className={`text-right font-black text-[11px] pt-1.5 border-t border-white/5 ${tx.profit>=0?'text-red-400/60':'text-green-400/60'}`}>此筆損益 {tx.profit>=0?'+':''}{fmtMoney(Math.round(tx.profit))}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatItem({ label, value, sub }: any) { return <div className="flex flex-col"><span className="text-[11px] font-black text-[var(--t3)] uppercase tracking-widest mb-1">{label}</span><span className="font-black font-mono text-xl text-[var(--t1)] leading-tight">{value}</span><span className="text-[10px] font-black text-[var(--t3)] mt-1 uppercase">{sub}</span></div> }

function TxRow({ tx, settings, onDelete, onUpdated }: any) {
  const [open, setOpen] = useState(false), [isEditing, setIsEditing] = useState(false)
  if (isEditing) return <div className="p-5 card-base border-accent/40 shadow-2xl animate-slide-up"><EditForm tx={tx} settings={settings} onCancel={()=>setIsEditing(false)} onSaved={()=>{setIsEditing(false);onUpdated()}}/></div>
  return (
    <div className="card-base overflow-hidden border-white/10 shadow-md">
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between p-4 text-left active:bg-bg-hover transition-all">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-black text-[var(--t1)] text-[16px] truncate">{tx.name_zh || getStockName(tx.symbol)}</span>
            <span className="text-[10px] font-mono opacity-20">{codeOnly(tx.symbol)}</span>
          </div>
          <div className="text-[11px] font-bold text-[var(--t3)] mt-1 flex items-center gap-2">
            <span>{tx.trade_date} · {(tx.shares ?? 0).toLocaleString()} 股</span>
            {(tx.action === 'DCA' || tx.trade_type === 'DCA') && <span className="text-yellow-500 bg-yellow-400/10 border border-yellow-500/20 px-1.5 py-0.5 rounded font-black tracking-widest text-[9px] leading-none mb-px">定期定額</span>}
          </div>
        </div>
        <div className={`text-right font-black font-mono text-[16px] shrink-0 ${tx.net_amount>=0?'text-red-400':'text-green-400'}`}>
          {tx.net_amount>=0?'+':''}{fmtMoney(tx.net_amount)}
        </div>
      </button>
      {open && (
        <div className="bg-black/20 p-5 pt-0 border-t border-white/5 space-y-5 animate-slide-up">
          <div className="grid grid-cols-3 gap-4 pt-5">
            <DetailItem label="股數" value={(tx.shares ?? 0).toLocaleString()}/>
            <DetailItem label="價格" value={(tx.price ?? 0).toFixed(2)}/>
            <DetailItem label="費用" value={fmtMoney(calcFee(tx.amount, settings, tx.action==='SELL', tx.action==='DCA' || tx.trade_type==='DCA') + (tx.action==='SELL'?calcTax(tx.amount, tx.symbol, settings):0))}/>
          </div>
          {tx.note && <div className="p-3 rounded-xl bg-white/5 text-[11px] text-[var(--t2)] italic leading-relaxed border border-white/5">"{tx.note}"</div>}
          <div className="flex gap-3 pt-1"><button onClick={()=>setIsEditing(true)} className="flex-[3] btn-primary py-3 flex items-center justify-center gap-2 text-sm"><Pencil size={16}/>編輯</button><button onClick={()=>onDelete(tx.id)} className="flex-1 btn-danger py-3 flex items-center justify-center active:scale-95 transition-all"><Trash2 size={18}/></button></div>
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value }: any) { return <div><div className="text-[10px] font-black text-[var(--t3)] uppercase tracking-tighter mb-1">{label}</div><div className="text-sm font-black text-[var(--t1)] font-mono">{value}</div></div> }

function EditForm({ tx, settings, onCancel, onSaved }: any) {
  const [loading, setLoading] = useState(false)
  const [date, setDate] = useState(tx.trade_date), [shares, setShares] = useState<number|''>(tx.shares), [price, setPrice] = useState<number|''>(tx.price), [note, setNote] = useState(tx.note || '')
  const [tradeType, setTradeType] = useState(tx.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots] = useState<number | ''>(Math.floor(tx.shares / 1000) || 1)
  const [isDcaOpt, setIsDcaOpt] = useState(tx.action === 'DCA')
  const isBuy = tx.action === 'BUY' || tx.action === 'DCA'
  const finalShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = Number(price) || 0
  const amount = finalShares * safePrice
  const actionToSave = isBuy ? (isDcaOpt ? 'DCA' : 'BUY') : 'SELL'
  const fee = calcFee(amount, settings, !isBuy, actionToSave === 'DCA')
  const tax = tx.action === 'SELL' ? calcTax(amount, tx.symbol, settings) : 0
  const net = isBuy ? -Math.floor(amount + fee) : Math.floor(amount - fee - tax)
  
  const isValid = finalShares > 0 && safePrice > 0 && (
    date !== tx.trade_date || 
    finalShares !== tx.shares || 
    safePrice !== tx.price || 
    note !== (tx.note||'') ||
    isDcaOpt !== (tx.action === 'DCA')
  )
  
  const handleSave = async () => {
    setLoading(true); await fetch('/api/transactions', { method: 'PUT', body: JSON.stringify({ id: tx.id, trade_date: date, shares: finalShares, price: safePrice, note, action: actionToSave }) })
    onSaved()
  }
  return (
    <div className="space-y-5">
      <div className="text-center pb-3 border-b border-white/5"><h4 className="font-black text-sm text-accent">編輯：{isBuy?'買入':'賣出'} {tx.name_zh || tx.symbol}</h4></div>
      <div className="flex gap-2 p-1 bg-black/20 rounded-xl">
        <button onClick={() => setTradeType('FULL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FULL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)]'}`}>整張 (1000股)</button>
        <button onClick={() => setTradeType('FRACTIONAL')} className={`flex-1 py-2 text-[10px] font-black rounded-lg transition-all ${tradeType==='FRACTIONAL'?'bg-accent text-bg-base shadow-md':'text-[var(--t3)]'}`}>零股</button>
      </div>

      {isBuy && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
          <span className="text-[11px] font-black text-[var(--t2)] tracking-widest uppercase">定期定額</span>
          <button 
            onClick={() => setIsDcaOpt(!isDcaOpt)}
            className={`w-12 h-6 rounded-full relative transition-colors ${isDcaOpt ? 'bg-yellow-500' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${isDcaOpt ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label>{tradeType==='FULL'?'張數':'股數'}</Label><input type="number" value={tradeType==='FULL'?lots:shares} onFocus={()=>tradeType==='FULL'?setLots(''):setShares('')} onChange={e=>{const v=e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v as any):setShares(v as any)}} className="input-base text-center font-black py-3" /></div>
        <div className="space-y-1.5"><Label>成交價</Label><input type="number" step="0.01" value={price} onFocus={()=>setPrice('')} onChange={e=>setPrice(e.target.value===''?'':Number(e.target.value))} className="input-base text-center font-black py-3" /></div>
      </div>
      <div className="space-y-1.5"><Label>交易日期</Label><DatePicker value={date} onChange={setDate} /></div>
      <div className="space-y-1.5"><Label>備註</Label><input value={note} onChange={e=>setNote(e.target.value)} className="input-base text-sm py-3" placeholder="選填..." /></div>
      <div className="card-base p-4 space-y-2 bg-black/20 text-[11px] font-bold">
        <div className="flex justify-between opacity-40"><span>手續費 + 稅</span><span>{fmtMoney(fee + tax)}</span></div>
        <div className="flex justify-between items-center pt-2 border-t border-white/5"><span className="text-[var(--t2)]">預估淨收支</span><span className={`text-base font-black ${net>=0?'text-red-400':'text-green-400'}`}>{net>=0?'+':''}{fmtMoney(net)}</span></div>
      </div>
      <div className="flex gap-3 pt-1"><button onClick={handleSave} disabled={!isValid} className="flex-[3] btn-primary py-3.5">確認修改</button><button onClick={onCancel} className="flex-1 btn-secondary py-3.5">取消</button></div>
    </div>
  )
}

function ExportModal({ onClose }: any) {
  const [range, setRange] = useState('all'), [start, setStart] = useState(''), [end, setEnd] = useState(''), [loading, setLoading] = useState(false)
  const handleExport = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/export?start_date=${start||'2000-01-01'}&end_date=${end||new Date().toISOString().split('T')[0]}`)
      const blob = await res.blob(), url = window.URL.createObjectURL(blob), a = document.createElement('a')
      a.href = url; a.download = `交易紀錄.xlsx`; document.body.appendChild(a); a.click(); document.body.removeChild(a); alert('報表導出成功'); onClose()
    } catch(e) { alert('導出失敗') } finally { setLoading(false) }
  }
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="glass w-full max-w-sm p-8 space-y-8 border-white/10 animate-in zoom-in-95">
        <div className="text-center space-y-1"><h3 className="font-black text-xl text-[var(--t1)]">導出交易紀錄</h3><p className="text-xs text-[var(--t3)]">產生一份 Excel 列表下載</p></div>
        <div className="grid grid-cols-2 gap-2.5">{['month','year','all','custom'].map(o=><button key={o} onClick={()=>setRange(o)} className={`py-3.5 rounded-xl text-xs font-black border transition-all ${range===o?'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20':'bg-white/5 text-[var(--t2)] border-transparent active:bg-white/10'}`}>{o==='month'?'本月':o==='year'?'今年':o==='all'?'全部':'自訂'}</button>)}</div>
        {range==='custom'&&<div className="space-y-3 animate-slide-up"><div className="space-y-1"><Label>起始日期</Label><DatePicker value={start} onChange={setStart}/></div><div className="space-y-1"><Label>結束日期</Label><DatePicker value={end} onChange={setEnd}/></div></div>}
        <div className="flex gap-3 pt-2"><button onClick={handleExport} disabled={loading} className="flex-[3] btn-primary py-4 text-base shadow-lg shadow-accent/10">{loading?'處理中...':'確認導出'}</button><button onClick={onClose} className="flex-1 btn-secondary py-4 text-base">取消</button></div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[10px] font-black opacity-30 uppercase tracking-widest ml-1 mb-1 block">{children}</label> }
