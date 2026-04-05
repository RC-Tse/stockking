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

type Mode = 'SELECT' | 'ORDER' | 'DCA'
type Action = 'BUY' | 'SELL'
type TradeType = 'FULL' | 'FRACTIONAL'

export default function AddDrawer({ open, settings, onClose, initialPlan, onSave, onSavePlan }: Props) {
  const [mode, setMode] = useState<Mode>('SELECT')
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
  
  // DCA states
  const [dcaAmount, setDcaAmount] = useState<number | ''>('')
  const [dcaDays, setDcaDays] = useState<number[]>([])
  const [divReinvest, setDivReinvest] = useState(false)
  const [smartBuyEnabled, setSmartBuyEnabled] = useState(false)
  const [smartBuyThreshold, setSmartBuyThreshold] = useState('>0%')
  const [smartBuyAmount, setSmartBuyAmount] = useState<number | ''>('')
  const [smartSellEnabled, setSmartSellEnabled] = useState(false)
  const [smartSellThreshold, setSmartSellThreshold] = useState('>0%')
  const [smartSellAmount, setSmartSellAmount] = useState<number | ''>('')
  
  const [currentPrice, setCurrentPrice] = useState<number>(0)
  const [ma60, setMa60] = useState<number>(0)
  const [selectedDateStr, setSelectedDateStr] = useState('')

  useEffect(() => {
    if (open) {
      const today = new Date(), y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate()
      const todayStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      
      if (initialPlan) {
        setMode('DCA')
        setSymbol(initialPlan.symbol)
        setDcaAmount(initialPlan.amount)
        setDcaDays(initialPlan.days_of_month || [])
        setDivReinvest(initialPlan.dividend_reinvest)
        setSmartBuyEnabled(initialPlan.smart_buy_enabled)
        setSmartBuyThreshold(`${initialPlan.smart_buy_threshold?.startsWith('>') || initialPlan.smart_buy_threshold?.startsWith('??) ? '' : '>'}${initialPlan.smart_buy_threshold}%`)
        setSmartBuyAmount(initialPlan.smart_buy_amount || '')
        setSmartSellEnabled(initialPlan.smart_sell_enabled)
        setSmartSellThreshold(`${initialPlan.smart_sell_threshold?.startsWith('>') || initialPlan.smart_sell_threshold?.startsWith('??) ? '' : '>'}${initialPlan.smart_sell_threshold}%`)
        setSmartSellAmount(initialPlan.smart_sell_amount || '')
        fetchStockInfo(initialPlan.symbol)
      } else {
        setMode('SELECT')
        setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName(''); setLots(''); setShares(''); setPrice(''); setNote('')
        setDcaAmount(''); setDcaDays([]); setDivReinvest(false); setSmartBuyEnabled(false); setSmartBuyThreshold('>0%'); setSmartBuyAmount(''); setSmartSellEnabled(false); setSmartSellThreshold('>0%'); setSmartSellAmount(''); setCurrentPrice(0); setMa60(0)
      }
      setSelectedDateStr(todayStr); setSaving(false)
    }
  }, [open, initialPlan])

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
  const fee = safePrice > 0 ? calcFee(amount, settings, action === 'SELL') : 0
  const tax = safePrice > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net = action === 'BUY' ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))

  async function submitOrder() {
    if (!symbol.trim() || safePrice <= 0 || actualShares <= 0) return
    setSaving(true); 
    await onSave({ 
      symbol: symbol.trim().toUpperCase(), 
      action, 
      trade_date: selectedDateStr, 
      shares: actualShares, 
      price: safePrice, 
      trade_type: tradeType, 
      note 
    }); 
    setSaving(false)
  }

  async function submitDCA() {
    if (!symbol.trim() || !dcaAmount || dcaDays.length === 0) return
    setSaving(true)
    try {
      const payload = { 
        symbol: symbol.trim().toUpperCase(), 
        amount: dcaAmount, 
        days_of_month: dcaDays, 
        dividend_reinvest: divReinvest, 
        smart_buy_enabled: smartBuyEnabled, 
        smart_buy_threshold: smartBuyThreshold.replace('%', ''), 
        smart_buy_amount: smartBuyAmount || 0, 
        smart_sell_enabled: smartSellEnabled, 
        smart_sell_threshold: smartSellThreshold.replace('%', ''), 
        smart_sell_amount: smartSellAmount || 0 
      }
      const url = initialPlan ? `/api/dca/${initialPlan.id}` : '/api/dca'
      const res = await fetch(url, { 
        method: initialPlan ? 'PUT' : 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) 
      })
      if (res.ok) { 
        alert(initialPlan ? '定�?定�?計畫已更?? : '定�?定�?計畫已儲�?)
        onSavePlan?.()
        onClose() 
      }
      else { const errData = await res.json().catch(() => ({})); alert(`?��?失�?: ${errData.error || '?�知?�誤'}`) }
    } catch (e) { alert('系統?�誤，�?檢查網路???') } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-end" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full slide-up glass rounded-t-[2.5rem] pb-safe overflow-hidden flex flex-col md:max-w-[480px] md:mx-auto border border-white/10 border-b-0" style={{ maxHeight: '94dvh' }}>
        <div className="flex justify-center pt-4 pb-2 shrink-0"><div className="w-12 h-1.5 rounded-full bg-white/10" /></div>
        <div className="px-6 pt-2 pb-10 overflow-y-auto flex-1 no-scrollbar">
          {mode === 'SELECT' && (
            <div className="space-y-8 py-10 animate-in fade-in slide-in-from-bottom-4">
              <div className="text-center space-y-2">
                <h2 className="font-black text-3xl text-[var(--t1)] tracking-tight">??交?類?</h2>
                <p className="text-base text-[var(--t2)] font-medium">請選?您要???????</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMode('ORDER')} className="card-base p-10 flex flex-col items-center gap-5 active:scale-95 transition-all border-white/5 hover:border-accent/30">
                  <Pencil size={48} className="text-accent" />
                  <div className="font-black text-white text-xl">?��?下單</div>
                </button>
                <button onClick={() => setMode('DCA')} className="card-base p-10 flex flex-col items-center gap-5 active:scale-95 transition-all border-white/5 hover:border-accent/30">
                  <RefreshCw size={48} className="text-accent" />
                  <div className="font-black text-white text-xl">定�?定�?</div>
                </button>
              </div>
            </div>
          )}

          {(mode === 'ORDER' || mode === 'DCA') && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between">
                {!initialPlan && <button onClick={() => setMode('SELECT')} className="btn-secondary px-4 py-2 text-sm font-black">返?</button>}
                <h2 className="font-black text-lg text-[var(--t1)] tracking-widest uppercase">{mode === 'ORDER' ? '??交?' : (initialPlan ? '編輯計畫' : '設?計畫')}</h2>
                <div className="w-12" />
              </div>

              {mode === 'ORDER' && (
                <div className="space-y-6">
                  <div className="flex gap-2 p-1 bg-white/5 rounded-2xl">
                    {(['BUY','SELL'] as Action[]).map(a => (
                      <button key={a} onClick={() => setAction(a)} className={`flex-1 py-3.5 rounded-xl text-sm font-black transition-all ${action === a ? (a === 'BUY' ? 'bg-red-500 text-white shadow-lg' : 'bg-green-500 text-white shadow-lg') : 'text-[var(--t2)] hover:bg-white/5'}`}>{a === 'BUY' ? '買入紀?? : '�?��紀??}</button>
                    ))}
                  </div>
                  
                  <div className="space-y-2">
                    <Label>?�票�??</Label>
                    <div className="relative">
                      <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="�?? (�?2330)" className="input-base uppercase font-black font-mono text-xl py-4" />
                      {fetchingName && <RefreshCw size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-accent animate-spin"/>}
                    </div>
                    {stockName && <div className="px-2 text-sm font-black text-accent/80">{stockName}</div>}
                  </div>

                  <div className="space-y-2">
                    <Label>交�??��?</Label>
                    <div className="flex gap-2">
                      {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                        <button key={t} onClick={() => setTradeType(t)} className={`flex-1 py-3 rounded-xl text-xs font-black border transition-all ${tradeType === t ? 'bg-accent/10 text-accent border-accent' : 'bg-white/5 text-[var(--t2)] border-transparent'}`}>{t === 'FULL' ? '?�張 (1000??' : '?�股'}</button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{tradeType === 'FULL' ? '交�?張數' : '交�??�數'}</Label>
                      <input type="number" inputMode="numeric" value={tradeType === 'FULL' ? lots : shares} onChange={e => { const v = e.target.value===''?'':Number(e.target.value); tradeType==='FULL'?setLots(v as any):setShares(v as any)}} className="input-base font-black font-mono text-xl py-4 text-center" placeholder="0" />
                    </div>
                    <div className="space-y-2">
                      <Label>?�交?�格</Label>
                      <input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className="input-base font-black font-mono text-xl py-4 text-center" placeholder="0.00" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>?�交?��?</Label>
                    <DatePicker value={selectedDateStr} onChange={setSelectedDateStr} />
                  </div>

                  <div className="space-y-2"><Label>?��??�註</Label><input value={note} onChange={e => setNote(e.target.value)} className="input-base text-sm py-4" placeholder="點此輸入?�註..." /></div>
                  
                  {safePrice > 0 && actualShares > 0 && (
                    <div className="card-base p-5 space-y-4 bg-black/40 border-accent/20">
                      <div className="flex justify-between items-center text-sm"><span className="opacity-40 font-bold">?�交總�?</span><span className="font-mono font-black">{fmtMoney(Math.round(amount))}</span></div>
                      <div className="flex justify-between items-center text-sm"><span className="opacity-40 font-bold">?��?�?+ �?/span><span className="font-mono font-black">{fmtMoney(Math.floor(fee + tax))}</span></div>
                      <div className="flex justify-between items-center pt-4 border-t border-white/5">
                        <span className="text-base font-black text-[var(--t2)]">?估淨收??/span>
                        <span className={`text-2xl font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>{net >= 0 ? '+' : ''}{fmtMoney(net)}</span>
                      </div>
                    </div>
                  )}
                  <button onClick={submitOrder} disabled={saving || !symbol || actualShares <= 0 || safePrice <= 0} className="w-full btn-primary py-5 text-lg shadow-xl shadow-accent/20">{saving ? '?��?�?..' : '確�??��?交�?'}</button>
                </div>
              )}

              {mode === 'DCA' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label>?�票�??</Label>
                    <div className="relative">
                      <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="�?? (�?0050)" className="input-base uppercase font-black font-mono text-xl py-4" />
                      {fetchingName && <RefreshCw size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-accent animate-spin"/>}
                    </div>
                    {stockName && <div className="px-2 text-sm font-black text-accent/80">{stockName}</div>}
                  </div>

                  <div className="space-y-2">
                    <Label>每次?�購?��?</Label>
                    <div className="relative">
                      <input type="number" inputMode="numeric" value={dcaAmount} onChange={e => setDcaAmount(e.target.value===''?'':Number(e.target.value))} className="input-base font-black font-mono text-xl py-4 pr-14" placeholder="5000" />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[var(--t3)] font-black">??/span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>每�?交�???<span className="lowercase text-[10px] opacity-40 ml-2">(?��???</span></Label>
                    <div className="grid grid-cols-7 gap-2">
                      {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                        <button key={d} onClick={() => setDcaDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a,b)=>a-b))} className={`aspect-square rounded-full flex items-center justify-center text-sm font-black transition-all border ${dcaDays.includes(d) ? 'bg-accent text-bg-base border-accent shadow-lg shadow-accent/20 scale-110' : 'bg-white/5 text-[var(--t2)] border-transparent'}`}>{d}</button>
                      ))}
                    </div>
                  </div>

                  <div className="card-base p-5 border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-[var(--t1)] text-sm">?息???/span>
                      <button onClick={() => setDivReinvest(!divReinvest)} className={`w-12 h-7 rounded-full relative transition-all ${divReinvest ? 'bg-accent' : 'bg-white/10'}`}>
                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${divReinvest ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--t2)] leading-relaxed">依基準日庫�?試�?，於?�放後次二�?業日?��?買進相?��??��?/p>
                  </div>

                  <div className="space-y-4 p-5 card-base border-accent/10 bg-accent/5">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings size={16} className="text-accent" />
                      <span className="font-black text-sm text-accent">?�慧?��?碼�???/span>
                    </div>
                    {currentPrice > 0 && (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="space-y-1"><Label>?��??�價</Label><div className="font-mono font-black text-white">{currentPrice.toFixed(2)}</div></div>
                        <div className="space-y-1"><Label>�????(MA60)</Label><div className="font-mono font-black text-accent">{ma60.toFixed(2)}</div></div>
                      </div>
                    )}
                    
                    {/* Smart Buy */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={smartBuyEnabled} onChange={e=>setSmartBuyEnabled(e.target.checked)} className="w-4 h-4 rounded border-white/20 bg-black/20 text-accent focus:ring-accent" />
                        <span className="text-xs font-black text-[var(--t1)]">?��??�碼</span>
                      </div>
                      {smartBuyEnabled && (
                        <div className="pl-6 space-y-3 animate-in fade-in slide-in-from-left-2">
                          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
                            {['>0%', '??%', '??0%', '??5%'].map(t => (
                              <button key={t} onClick={()=>setSmartBuyThreshold(t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all whitespace-nowrap ${smartBuyThreshold===t?'bg-red-500/20 text-red-400 border-red-500/40':'bg-white/5 text-[var(--t2)] border-transparent'}`}>{t}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-[var(--t2)] whitespace-nowrap">?��?調至</span>
                            <input type="number" value={smartBuyAmount} onChange={e=>setSmartBuyAmount(Number(e.target.value))} className="input-base py-2 text-xs font-black font-mono text-center" placeholder="?? />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Smart Sell */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={smartSellEnabled} onChange={e=>setSmartSellEnabled(e.target.checked)} className="w-4 h-4 rounded border-white/20 bg-black/20 text-accent focus:ring-accent" />
                        <span className="text-xs font-black text-[var(--t1)]">?��?減碼</span>
                      </div>
                      {smartSellEnabled && (
                        <div className="pl-6 space-y-3 animate-in fade-in slide-in-from-left-2">
                          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
                            {['>0%', '??%', '??0%', '??5%'].map(t => (
                              <button key={t} onClick={()=>setSmartSellThreshold(t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all whitespace-nowrap ${smartSellThreshold===t?'bg-green-500/20 text-green-400 border-green-500/40':'bg-white/5 text-[var(--t2)] border-transparent'}`}>{t}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-[var(--t2)] whitespace-nowrap">?��?調至</span>
                            <input type="number" value={smartSellAmount} onChange={e=>setSmartSellAmount(Number(e.target.value))} className="input-base py-2 text-xs font-black font-mono text-center" placeholder="?? />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button onClick={submitDCA} disabled={saving || !symbol || !dcaAmount || !dcaDays.length} className="w-full btn-primary py-5 text-lg shadow-xl shadow-accent/20">{saving ? '?��?�?..' : (initialPlan ? '保�?修改' : '?��?定�?定�?計畫')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[11px] font-black text-[var(--t2)] uppercase tracking-[0.2em] ml-1 mb-1.5 block">{children}</label> }
