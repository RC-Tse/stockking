'use client'

import { useState, useEffect } from 'react'
import { UserSettings, calcFee, calcTax, fmtMoney, DCAPlan, getStockName } from '@/types'
import { 
  Plus, 
  Pencil, 
  ChevronDown, 
  ChevronUp, 
  BarChart2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Settings
} from 'lucide-react'
import DatePicker from './DatePicker'

interface Props {
  open: boolean
  settings: UserSettings
  onClose: () => void
  initialPlan?: DCAPlan | null
  onSave: (payload: {
    symbol: string; action: string; trade_date: string;
    shares: number; price: number; trade_type: string; note: string;
  }) => Promise<void>
  onSavePlan?: () => void
}

type Mode = 'ORDER'
type Action = 'BUY' | 'SELL'
type TradeType = 'FULL' | 'FRACTIONAL'

export default function AddDrawer({ open, settings, onClose, initialPlan, onSave, onSavePlan }: Props) {
  const [mode, setMode] = useState<Mode>('ORDER')
  const [action, setAction] = useState<Action>('BUY')
  const [tradeType, setTradeType] = useState<TradeType>('FULL')
  const [symbol, setSymbol] = useState('')
  const [stockName, setStockName] = useState('')
  const [fetchingName, setFetchingName] = useState(false)
  const [lots, setLots] = useState<number | ''>('')
  const [shares, setShares] = useState<number | ''>('')
  const [price, setPrice] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [isDca, setIsDca] = useState(false)
  
  const [currentPrice, setCurrentPrice] = useState<number>(0)
  const [ma60, setMa60] = useState<number>(0)
  const [selectedDateStr, setSelectedDateStr] = useState('')

  useEffect(() => {
    if (open) {
      const today = new Date(), y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate()
      const todayStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      
      setMode('ORDER')
      setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName(''); setLots(''); setShares(''); setPrice(''); setNote(''); setIsDca(false)
      setCurrentPrice(0); setMa60(0)
      setSelectedDateStr(todayStr); setSaving(false)
    }
  }, [open])

  async function fetchStockInfo(s: string) {
    let sym = s.trim().toUpperCase()
    if (!sym) return
    if (/^\d+$/.test(sym)) { sym = sym + '.TW'; setSymbol(sym) }
    setFetchingName(true)
    try {
      const res = await fetch(`/api/stocks/info?symbol=${sym}`)
      if (res.ok) { 
        const data = await res.json()
        setStockName(data.name || '')
        setCurrentPrice(data.price || 0)
        setMa60(data.ma60 || 0)
      } else {
        const res2 = await fetch(`/api/stocks?symbols=${sym}`)
        if (res2.ok) {
          const data2 = await res2.json()
          setStockName(data2[sym]?.name_zh || '')
          setCurrentPrice(data2[sym]?.price || 0)
        }
      }
    } catch (err) { setStockName('') } finally { setFetchingName(false) }
  }

  const actualShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = typeof price === 'number' ? price : 0
  const amount = actualShares * safePrice
  const fee = safePrice > 0 ? calcFee(amount, settings, action === 'SELL', isDca) : 0
  const tax = safePrice > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net = action === 'BUY' ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))

  async function submitOrder() {
    if (!symbol.trim() || safePrice <= 0 || actualShares <= 0) return
    setSaving(true); 
    
    let finalNote = note.trim()
    if (isDca) {
      finalNote = finalNote ? `${finalNote} (定期定額)` : '定期定額'
    }

    await onSave({ 
      symbol: symbol.trim().toUpperCase(), 
      action: isDca && action === 'BUY' ? 'DCA' : action, 
      trade_date: selectedDateStr, 
      shares: actualShares, 
      price: safePrice, 
      trade_type: tradeType, 
      note: finalNote
    }); 
    setSaving(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-end" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full slide-up glass rounded-t-[2.5rem] pb-safe overflow-hidden flex flex-col md:max-w-[480px] md:mx-auto border border-white/10 border-b-0" style={{ maxHeight: '94dvh' }}>
        <div className="flex justify-center pt-4 pb-2 shrink-0"><div className="w-12 h-1.5 rounded-full bg-white/10" /></div>
        <div className="px-6 pt-2 pb-10 overflow-y-auto flex-1 no-scrollbar">
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between pb-2">
              <div className="w-12" />
              <h2 className="font-black text-lg text-[var(--t1)] tracking-widest uppercase">手動交易紀錄</h2>
              <div className="w-12" />
            </div>

            <div className="space-y-6">
              <div className="flex gap-2 p-1 bg-white/5 rounded-2xl">
                {(['BUY','SELL'] as Action[]).map(a => (
                  <button key={a} onClick={() => setAction(a)} className={`flex-1 py-3.5 rounded-xl text-sm font-black transition-all ${action === a ? (a === 'BUY' ? 'bg-red-500 text-white shadow-lg' : 'bg-green-500 text-white shadow-lg') : 'text-[var(--t2)] hover:bg-white/5'}`}>{a === 'BUY' ? '買入紀錄' : '賣出紀錄'}</button>
                ))}
              </div>
              
              <div className="space-y-2">
                <Label>股票代碼</Label>
                <div className="relative">
                  <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="代碼 (如 2330)" className="input-base uppercase font-black font-mono text-xl py-4" />
                  {fetchingName && <RefreshCw size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-accent animate-spin"/>}
                </div>
                {stockName && <div className="px-2 text-sm font-black text-accent/80">{stockName}</div>}
              </div>

              <div className="space-y-2">
                <Label>交易單位</Label>
                <div className="flex gap-2">
                  {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                    <button key={t} onClick={() => setTradeType(t)} className={`flex-1 py-3 rounded-xl text-xs font-black border transition-all ${tradeType === t ? 'bg-accent/10 text-accent border-accent' : 'bg-white/5 text-[var(--t2)] border-transparent'}`}>{t === 'FULL' ? '整張 (1000股)' : '零股'}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{tradeType === 'FULL' ? '交易張數' : '交易股數'}</Label>
                  <input type="number" inputMode="numeric" value={tradeType === 'FULL' ? lots : shares} onChange={e => { const v = e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v as any):setShares(v as any)}} className="input-base font-black font-mono text-xl py-4 text-center" placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label>成交價格</Label>
                  <input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className="input-base font-black font-mono text-xl py-4 text-center" placeholder="0.00" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>成交日期</Label>
                <DatePicker value={selectedDateStr} onChange={setSelectedDateStr} />
              </div>

              <div className="space-y-2"><Label>交易備註</Label><input value={note} onChange={e => setNote(e.target.value)} className="input-base text-sm py-4" placeholder="點此輸入備註..." /></div>
              
              {action === 'BUY' && (
                <div className="card-base p-4 flex items-center justify-between border-white/5 bg-white/5">
                  <div className="flex items-center gap-3">
                    <RefreshCw size={20} className="text-accent" />
                    <div>
                      <div className="text-sm font-black text-[var(--t1)]">定期定額</div>
                      <div className="text-[10px] text-[var(--t3)] font-bold">開啟後將自動在備註加上定期定額標記</div>
                    </div>
                  </div>
                  <button onClick={() => setIsDca(!isDca)} className={`w-12 h-7 rounded-full relative transition-all ${isDca ? 'bg-accent' : 'bg-white/10'}`}>
                    <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${isDca ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              )}

              {safePrice > 0 && actualShares > 0 && (
                <div className="card-base p-5 space-y-4 bg-black/40 border-accent/20">
                  <div className="flex justify-between items-center text-sm"><span className="opacity-40 font-bold">成交總額</span><span className="font-mono font-black">{fmtMoney(Math.round(amount))}</span></div>
                  <div className="flex justify-between items-center text-sm"><span className="opacity-40 font-bold">手續費 + 稅</span><span className="font-mono font-black">{fmtMoney(Math.floor(fee + tax))}</span></div>
                  <div className="flex justify-between items-center pt-4 border-t border-white/5">
                    <span className="text-base font-black text-[var(--t2)]">評估淨收支</span>
                    <span className={`text-2xl font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>{net >= 0 ? '+' : ''}{fmtMoney(net)}</span>
                  </div>
                </div>
              )}
              <button onClick={submitOrder} disabled={saving || !symbol || actualShares <= 0 || safePrice <= 0} className="w-full btn-primary py-5 text-lg shadow-xl shadow-accent/20">{saving ? '處理中...' : '確認記錄交易'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[11px] font-black text-[var(--t2)] uppercase tracking-[0.2em] ml-1 mb-1.5 block">{children}</label> }
