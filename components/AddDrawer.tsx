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
        setSmartBuyThreshold(`${initialPlan.smart_buy_threshold?.startsWith('>') || initialPlan.smart_buy_threshold?.startsWith('≥') ? '' : '>'}${initialPlan.smart_buy_threshold}%`)
        setSmartBuyAmount(initialPlan.smart_buy_amount || '')
        setSmartSellEnabled(initialPlan.smart_sell_enabled)
        setSmartSellThreshold(`${initialPlan.smart_sell_threshold?.startsWith('>') || initialPlan.smart_sell_threshold?.startsWith('≥') ? '' : '>'}${initialPlan.smart_sell_threshold}%`)
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
        alert(initialPlan ? '定期定額計畫已更新' : '定期定額計畫已儲存')
        onSavePlan?.()
        onClose() 
      }
      else { const errData = await res.json().catch(() => ({})); alert(`儲存失敗: ${errData.error || '未知錯誤'}`) }
    } catch (e) { alert('系統錯誤，請檢查網路連線') } finally { setSaving(false) }
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
                <h2 className="font-black text-3xl text-white tracking-tight">選擇交易類型</h2>
                <p className="text-base text-white/30 font-medium">請選擇您要記錄的投資方式</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMode('ORDER')} className="card-base p-10 flex flex-col items-center gap-5 active:scale-95 transition-all border-white/5 hover:border-gold/30">
                  <Pencil size={48} className="text-gold" />
                  <div className="font-black text-white text-xl">單筆下單</div>
                </button>
                <button onClick={() => setMode('DCA')} className="card-base p-10 flex flex-col items-center gap-5 active:scale-95 transition-all border-white/5 hover:border-gold/30">
                  <RefreshCw size={48} className="text-gold" />
                  <div className="font-black text-white text-xl">定期定額</div>
                </button>
              </div>
            </div>
          )}

          {(mode === 'ORDER' || mode === 'DCA') && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between">
                {!initialPlan && <button onClick={() => setMode('SELECT')} className="btn-secondary px-4 py-2 text-sm font-black">返回</button>}
                <h2 className="font-black text-lg text-white tracking-widest uppercase">{mode === 'ORDER' ? '新增交易' : (initialPlan ? '編輯計畫' : '設定計畫')}</h2>
                <div className="w-12" />
              </div>

              {mode === 'ORDER' && (
                <div className="space-y-6">
                  <div className="flex gap-2 p-1 bg-white/5 rounded-2xl">
                    {(['BUY','SELL'] as Action[]).map(a => (
                      <button key={a} onClick={() => setAction(a)} className={`flex-1 py-3.5 rounded-xl text-sm font-black transition-all ${action === a ? (a === 'BUY' ? 'bg-red-500 text-white shadow-lg' : 'bg-green-500 text-white shadow-lg') : 'text-white/30 hover:bg-white/5'}`}>{a === 'BUY' ? '買入紀錄' : '賣出紀錄'}</button>
                    ))}
                  </div>
                  
                  <div className="space-y-2">
                    <Label>股票代號</Label>
                    <div className="relative">
                      <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="代號 (如 2330)" className="input-base uppercase font-black font-mono text-xl py-4" />
                      {fetchingName && <RefreshCw size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gold animate-spin"/>}
                    </div>
                    {stockName && <div className="px-2 text-sm font-black text-gold/80">{stockName}</div>}
                  </div>

                  <div className="space-y-2">
                    <Label>交易方式</Label>
                    <div className="flex gap-2">
                      {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                        <button key={t} onClick={() => setTradeType(t)} className={`flex-1 py-3 rounded-xl text-xs font-black border transition-all ${tradeType === t ? 'bg-gold/10 text-gold border-gold' : 'bg-white/5 text-white/30 border-transparent'}`}>{t === 'FULL' ? '整張 (1000股)' : '零股'}</button>
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

                  <div className="space-y-2"><Label>操作備註</Label><input value={note} onChange={e => setNote(e.target.value)} className="input-base text-sm py-4" placeholder="點此輸入備註..." /></div>
                  
                  {safePrice > 0 && actualShares > 0 && (
                    <div className="card-base p-5 space-y-4 bg-black/40 border-gold/20">
                      <div className="flex justify-between items-center text-sm"><span className="opacity-40 font-bold">成交總額</span><span className="font-mono font-black">{fmtMoney(Math.round(amount))}</span></div>
                      <div className="flex justify-between items-center text-sm"><span className="opacity-40 font-bold">手續費 + 稅</span><span className="font-mono font-black">{fmtMoney(Math.floor(fee + tax))}</span></div>
                      <div className="flex justify-between items-center pt-4 border-t border-white/5">
                        <span className="text-base font-black text-white/60">預估淨收支</span>
                        <span className={`text-2xl font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>{net >= 0 ? '+' : ''}{fmtMoney(net)}</span>
                      </div>
                    </div>
                  )}
                  <button onClick={submitOrder} disabled={saving || !symbol || actualShares <= 0 || safePrice <= 0} className="w-full btn-primary py-5 text-lg shadow-xl shadow-gold/10">{saving ? '處理中...' : '確認新增交易'}</button>
                </div>
              )}

              {mode === 'DCA' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label>股票代號</Label>
                    <div className="relative">
                      <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="代號 (如 0050)" className="input-base uppercase font-black font-mono text-xl py-4" />
                      {fetchingName && <RefreshCw size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gold animate-spin"/>}
                    </div>
                    {stockName && <div className="px-2 text-sm font-black text-gold/80">{stockName}</div>}
                  </div>

                  <div className="space-y-2">
                    <Label>每次申購金額</Label>
                    <div className="relative">
                      <input type="number" inputMode="numeric" value={dcaAmount} onChange={e => setDcaAmount(e.target.value===''?'':Number(e.target.value))} className="input-base font-black font-mono text-xl py-4 pr-14" placeholder="5000" />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/20 font-black">元</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>每月交易日 <span className="lowercase text-[10px] opacity-40 ml-2">(可複選)</span></Label>
                    <div className="grid grid-cols-7 gap-2">
                      {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                        <button key={d} onClick={() => setDcaDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a,b)=>a-b))} className={`aspect-square rounded-full flex items-center justify-center text-sm font-black transition-all border ${dcaDays.includes(d) ? 'bg-gold text-bg-base border-gold shadow-lg shadow-gold/20 scale-110' : 'bg-white/5 text-white/30 border-transparent'}`}>{d}</button>
                      ))}
                    </div>
                  </div>

                  <div className="card-base p-5 border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-white text-sm">股息再投資</span>
                      <button onClick={() => setDivReinvest(!divReinvest)} className={`w-12 h-7 rounded-full relative transition-all ${divReinvest ? 'bg-gold' : 'bg-white/10'}`}>
                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${divReinvest ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    <p className="text-[11px] text-white/30 leading-relaxed">依基準日庫存試算，於發放後次二營業日自動買進相同標的。</p>
                  </div>

                  <div className="space-y-4 p-5 card-base border-gold/10 bg-gold/5">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings size={16} className="text-gold" />
                      <span className="font-black text-sm text-gold">智慧加減碼策略</span>
                    </div>
                    {currentPrice > 0 && (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="space-y-1"><Label>當前股價</Label><div className="font-mono font-black text-white">{currentPrice.toFixed(2)}</div></div>
                        <div className="space-y-1"><Label>季均價 (MA60)</Label><div className="font-mono font-black text-gold">{ma60.toFixed(2)}</div></div>
                      </div>
                    )}
                    
                    {/* Smart Buy */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={smartBuyEnabled} onChange={e=>setSmartBuyEnabled(e.target.checked)} className="w-4 h-4 rounded border-white/20 bg-black/20 text-gold focus:ring-gold" />
                        <span className="text-xs font-black text-white/80">逢低加碼</span>
                      </div>
                      {smartBuyEnabled && (
                        <div className="pl-6 space-y-3 animate-in fade-in slide-in-from-left-2">
                          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
                            {['>0%', '≥5%', '≥10%', '≥15%'].map(t => (
                              <button key={t} onClick={()=>setSmartBuyThreshold(t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all whitespace-nowrap ${smartBuyThreshold===t?'bg-red-500/20 text-red-400 border-red-500/40':'bg-white/5 text-white/30 border-transparent'}`}>{t}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-white/40 whitespace-nowrap">金額調至</span>
                            <input type="number" value={smartBuyAmount} onChange={e=>setSmartBuyAmount(Number(e.target.value))} className="input-base py-2 text-xs font-black font-mono text-center" placeholder="元" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Smart Sell */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={smartSellEnabled} onChange={e=>setSmartSellEnabled(e.target.checked)} className="w-4 h-4 rounded border-white/20 bg-black/20 text-gold focus:ring-gold" />
                        <span className="text-xs font-black text-white/80">逢高減碼</span>
                      </div>
                      {smartSellEnabled && (
                        <div className="pl-6 space-y-3 animate-in fade-in slide-in-from-left-2">
                          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
                            {['>0%', '≥5%', '≥10%', '≥15%'].map(t => (
                              <button key={t} onClick={()=>setSmartSellThreshold(t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all whitespace-nowrap ${smartSellThreshold===t?'bg-green-500/20 text-green-400 border-green-500/40':'bg-white/5 text-white/30 border-transparent'}`}>{t}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-white/40 whitespace-nowrap">金額調至</span>
                            <input type="number" value={smartSellAmount} onChange={e=>setSmartSellAmount(Number(e.target.value))} className="input-base py-2 text-xs font-black font-mono text-center" placeholder="元" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button onClick={submitDCA} disabled={saving || !symbol || !dcaAmount || !dcaDays.length} className="w-full btn-primary py-5 text-lg shadow-xl shadow-gold/10">{saving ? '處理中...' : (initialPlan ? '保存修改' : '開始定期定額計畫')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em] ml-1 mb-1.5 block">{children}</label> }
