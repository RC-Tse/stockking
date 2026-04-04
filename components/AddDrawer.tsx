'use client'

import { useState, useEffect } from 'react'
import { UserSettings, calcFee, calcTax, fmtMoney, DCAPlan } from '@/types'
import { 
  Plus, 
  Pencil, 
  ChevronDown, 
  ChevronUp, 
  BarChart2 
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
        setMode('DCA'); setSymbol(initialPlan.symbol); setDcaAmount(initialPlan.amount); setDcaDays(initialPlan.days_of_month); setDivReinvest(initialPlan.dividend_reinvest); setSmartBuyEnabled(initialPlan.smart_buy_enabled); setSmartBuyThreshold(`${initialPlan.smart_buy_threshold.startsWith('>') || initialPlan.smart_buy_threshold.startsWith('≥') ? '' : '>'}${initialPlan.smart_buy_threshold}%`); setSmartBuyAmount(initialPlan.smart_buy_amount || ''); setSmartSellEnabled(initialPlan.smart_sell_enabled); setSmartSellThreshold(`${initialPlan.smart_sell_threshold.startsWith('>') || initialPlan.smart_sell_threshold.startsWith('≥') ? '' : '>'}${initialPlan.smart_sell_threshold}%`); setSmartSellAmount(initialPlan.smart_sell_amount || ''); fetchStockInfo(initialPlan.symbol)
      } else {
        setMode('SELECT'); setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName(''); setLots(''); setShares(''); setPrice(''); setNote(''); setDcaAmount(''); setDcaDays([]); setDivReinvest(false); setSmartBuyEnabled(false); setSmartBuyThreshold('>0%'); setSmartBuyAmount(''); setSmartSellEnabled(false); setSmartSellThreshold('>0%'); setSmartSellAmount(''); setCurrentPrice(0); setMa60(0)
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
      if (res.ok) { const data = await res.json(); setStockName(data.name || ''); setCurrentPrice(data.price || 0); setMa60(data.ma60 || 0) }
      else { const res2 = await fetch(`/api/stocks?symbols=${sym}`); if (res2.ok) { const data2 = await res2.json(); setStockName(data2[sym]?.name_zh || ''); setCurrentPrice(data2[sym]?.price || 0) } }
    } catch (err) { setStockName('') } finally { setFetchingName(false) }
  }

  const finalShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = typeof price === 'number' ? price : 0
  const amount = finalShares * safePrice
  const fee = safePrice > 0 ? calcFee(amount, settings, action === 'SELL') : 0
  const tax = safePrice > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net = action === 'BUY' ? -(Math.floor(amount) + Math.floor(fee)) : (Math.floor(amount) - Math.floor(fee) - Math.floor(tax))

  async function submitOrder() {
    if (!symbol.trim() || safePrice <= 0 || finalShares <= 0) return
    setSaving(true); await onSave({ symbol: symbol.trim().toUpperCase(), action, trade_date: selectedDateStr, shares: finalShares, price: safePrice, trade_type: tradeType, note }); setSaving(false)
  }

  async function submitDCA() {
    if (!symbol.trim() || !dcaAmount || dcaDays.length === 0) return
    setSaving(true)
    try {
      const payload = { symbol: symbol.trim().toUpperCase(), amount: dcaAmount, days_of_month: dcaDays, dividend_reinvest: divReinvest, smart_buy_enabled: smartBuyEnabled, smart_buy_threshold: smartBuyThreshold.replace('%', ''), smart_buy_amount: smartBuyAmount || 0, smart_sell_enabled: smartSellEnabled, smart_sell_threshold: smartSellThreshold.replace('%', ''), smart_sell_amount: smartSellAmount || 0 }
      const res = await fetch('/api/dca', { method: initialPlan ? 'PUT' : 'POST', body: JSON.stringify(initialPlan ? { ...payload, id: initialPlan.id } : payload) })
      if (res.ok) { alert(initialPlan ? '定期定額計畫已更新' : '定期定額計畫已儲存'); onSavePlan?.(); onClose() }
      else { const errData = await res.json().catch(() => ({})); alert(`儲存失敗: ${errData.error || '未知錯誤'}`) }
    } catch (e) { alert('系統錯誤，請檢查網路連線') } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.8)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full slide-up glass rounded-t-[2.5rem] pb-safe overflow-hidden flex flex-col md:max-w-[480px] md:mx-auto" style={{ maxHeight: '92dvh', borderBottom: 'none' }}>
        <div className="flex justify-center pt-4 pb-2 shrink-0"><div className="w-12 h-1.5 rounded-full bg-white/10" /></div>
        <div className="px-6 pt-2 pb-8 overflow-y-auto flex-1">
          {mode === 'SELECT' && (
            <div className="space-y-8 py-8 animate-slide-up">
              <div className="text-center space-y-2"><h2 className="font-black text-2xl text-white">選擇交易類型</h2><p className="text-sm text-white/30 font-medium">請選擇您要記錄的投資方式</p></div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMode('ORDER')} className="card-base p-8 flex flex-col items-center gap-4 active:scale-95 transition-all border-white/5 hover:border-gold/30">
                  <Pencil size={40} className="text-gold" /><div className="font-black text-white text-lg">單筆下單</div>
                </button>
                <button onClick={() => setMode('DCA')} className="card-base p-8 flex flex-col items-center gap-4 active:scale-95 transition-all border-white/5 hover:border-gold/30">
                  <Plus size={40} className="text-gold" /><div className="font-black text-white text-lg">定期定額</div>
                </button>
              </div>
            </div>
          )}

          {(mode === 'ORDER' || mode === 'DCA') && (
            <div className="space-y-6 pb-4 animate-slide-up">
              <div className="flex items-center justify-between">
                {!initialPlan && <button onClick={() => setMode('SELECT')} className="btn-secondary px-3 py-1.5 text-xs font-black">返回</button>}
                <h2 className="font-black text-base text-white tracking-widest uppercase">{mode === 'ORDER' ? '新增交易' : (initialPlan ? '編輯定期定額' : '設定定期定額')}</h2>
                <div className="w-12" />
              </div>

              {mode === 'ORDER' && (
                <div className="space-y-6">
                  <div className="flex gap-2">
                    {(['BUY','SELL'] as Action[]).map(a => (
                      <button key={a} onClick={() => setAction(a)} className={`flex-1 py-3.5 rounded-xl text-sm font-black transition-all border-2 ${action === a ? (a === 'BUY' ? 'bg-red-400/10 text-red-400 border-red-400' : 'bg-green-400/10 text-green-400 border-green-400') : 'bg-white/5 text-white/30 border-transparent'}`}>{a === 'BUY' ? '買入' : '賣出'}</button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label>股票代號</Label>
                    <div className="relative">
                      <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="輸入代號，如 2330" className="input-base uppercase font-black font-mono text-lg" />
                      {fetchingName && <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gold animate-spin"><RefreshCw size={14}/></div>}
                    </div>
                    {stockName && <div className="px-1 text-xs font-bold text-gold opacity-60">{stockName}</div>}
                  </div>
                  <div className="space-y-2">
                    <Label>成交日期</Label>
                    <DatePicker value={selectedDateStr} onChange={setSelectedDateStr} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>成交價格</Label><input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} className="input-base font-black font-mono" placeholder="0.00" /></div>
                    <div className="space-y-2"><Label>成交股數</Label><input type="number" inputMode="numeric" value={shares} onChange={e => setShares(e.target.value === '' ? '' : Number(e.target.value))} className="input-base font-black font-mono" placeholder="0" /></div>
                  </div>
                  <div className="space-y-2"><Label>備註</Label><input value={note} onChange={e => setNote(e.target.value)} className="input-base text-sm" placeholder="選填備註..." /></div>
                  
                  {safePrice > 0 && finalShares > 0 && (
                    <div className="card-base p-5 space-y-3 bg-black/20">
                      <div className="flex justify-between text-xs opacity-40 font-bold"><span>成交總額</span><span>{fmtMoney(Math.round(amount))}</span></div>
                      <div className="flex justify-between text-xs opacity-40 font-bold"><span>手續費 + 稅</span><span>{fmtMoney(fee + tax)}</span></div>
                      <div className="flex justify-between items-center pt-3 border-t border-white/5">
                        <span className="text-sm font-black text-white/60">預估淨收支</span>
                        <span className={`text-xl font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>{net >= 0 ? '+' : ''}{fmtMoney(net)}</span>
                      </div>
                    </div>
                  )}
                  <button onClick={submitOrder} disabled={saving || !symbol || finalShares <= 0 || safePrice <= 0} className="w-full btn-primary py-4">{saving ? '處理中...' : '確認新增交易'}</button>
                </div>
              )}

              {mode === 'DCA' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label>股票代號</Label>
                    <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="輸入代號，如 0050" className="input-base uppercase font-black font-mono text-lg" />
                    {stockName && <div className="text-xs font-bold text-gold opacity-60">{stockName}</div>}
                  </div>
                  <div className="space-y-2"><Label>每次申購金額</Label><div className="relative"><input type="number" inputMode="numeric" value={dcaAmount} onChange={e => setDcaAmount(e.target.value===''?'':Number(e.target.value))} className="input-base font-black font-mono text-lg pr-12" placeholder="5000" /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 font-black">元</span></div></div>
                  <div className="space-y-3">
                    <Label>每月交易日</Label>
                    <div className="grid grid-cols-7 gap-2">
                      {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                        <button key={d} onClick={() => setDcaDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a,b)=>a-b))} className={`aspect-square rounded-full flex items-center justify-center text-xs font-black transition-all border ${dcaDays.includes(d) ? 'bg-gold text-bg-base border-gold' : 'bg-white/5 text-white/20 border-transparent'}`}>{d}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={submitDCA} disabled={saving || !symbol || !dcaAmount || !dcaDays.length} className="w-full btn-primary py-4">{saving ? '處理中...' : '儲存定期定額計畫'}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[10px] font-black text-white/30 uppercase tracking-widest ml-1 mb-1 block">{children}</label> }
function RefreshCw({ size, className }: any) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg> }
