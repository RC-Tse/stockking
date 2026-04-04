'use client'

import { useState, useEffect } from 'react'
import { UserSettings, calcFee, calcTax, fmtMoney, DCAPlan } from '@/types'

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
  
  // Order states
  const [action,    setAction]    = useState<Action>('BUY')
  const [tradeType, setTradeType] = useState<TradeType>('FULL')
  const [symbol,    setSymbol]    = useState('')
  const [stockName, setStockName] = useState('')
  const [fetchingName, setFetchingName] = useState(false)
  const [lots,      setLots]      = useState<number | ''>('')
  const [shares,    setShares]    = useState<number | ''>('')
  const [price,     setPrice]     = useState<number | ''>('')
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)

  // DCA states
  const [dcaAmount, setDcaAmount] = useState<number | ''>('')
  const [dcaDays,   setDcaDays]   = useState<number[]>([])
  const [divReinvest, setDivReinvest] = useState(false)
  
  const [smartBuyEnabled, setSmartBuyEnabled] = useState(false)
  const [smartBuyThreshold, setSmartBuyThreshold] = useState('>0%')
  const [smartBuyAmount, setSmartBuyAmount] = useState<number | ''>('')
  
  const [smartSellEnabled, setSmartSellEnabled] = useState(false)
  const [smartSellThreshold, setSmartSellThreshold] = useState('>0%')
  const [smartSellAmount, setSmartSellAmount] = useState<number | ''>('')

  const [currentPrice, setCurrentPrice] = useState<number>(0)
  const [ma60, setMa60] = useState<number>(0)

  // Custom Date Picker states
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [viewDate, setViewDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())

  // Reset when opened
  useEffect(() => {
    if (open) {
      if (initialPlan) {
        setMode('DCA')
        setSymbol(initialPlan.symbol)
        setDcaAmount(initialPlan.amount)
        setDcaDays(initialPlan.days_of_month)
        setDivReinvest(initialPlan.dividend_reinvest)
        setSmartBuyEnabled(initialPlan.smart_buy_enabled)
        setSmartBuyThreshold(`${initialPlan.smart_buy_threshold.startsWith('>') || initialPlan.smart_buy_threshold.startsWith('≥') ? '' : '>'}${initialPlan.smart_buy_threshold}%`)
        setSmartBuyAmount(initialPlan.smart_buy_amount || '')
        setSmartSellEnabled(initialPlan.smart_sell_enabled)
        setSmartSellThreshold(`${initialPlan.smart_sell_threshold.startsWith('>') || initialPlan.smart_sell_threshold.startsWith('≥') ? '' : '>'}${initialPlan.smart_sell_threshold}%`)
        setSmartSellAmount(initialPlan.smart_sell_amount || '')
        fetchStockInfo(initialPlan.symbol)
      } else {
        setMode('SELECT')
        setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName('')
        setLots(''); setShares(''); setPrice(''); setNote('')
        setDcaAmount(''); setDcaDays([]); setDivReinvest(false)
        setSmartBuyEnabled(false); setSmartBuyThreshold('>0%'); setSmartBuyAmount('')
        setSmartSellEnabled(false); setSmartSellThreshold('>0%'); setSmartSellAmount('')
        setCurrentPrice(0); setMa60(0)
      }
      const today = new Date()
      setSelectedDate(today)
      setViewDate(today)
      setSaving(false)
    }
  }, [open, initialPlan])

  async function fetchStockInfo(s: string) {
    let sym = s.trim().toUpperCase()
    if (!sym) return
    if (/^\d+$/.test(sym)) {
      sym = sym + '.TW'
      setSymbol(sym)
    }
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
    } catch (err) {
      setStockName('')
    } finally {
      setFetchingName(false)
    }
  }

  const finalShares = tradeType === 'FULL' ? (Number(lots)||0) * 1000 : (Number(shares)||0)
  const safePrice = typeof price === 'number' ? price : 0
  const amount = finalShares * safePrice
  const fee    = safePrice > 0 ? calcFee(amount, settings, action === 'SELL') : 0
  const tax    = safePrice > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net    = action === 'BUY' ? -(amount + fee) : (amount - fee - tax)

  const tradeDateStr = selectedDate.toISOString().split('T')[0]

  async function submitOrder() {
    if (!symbol.trim() || safePrice <= 0 || finalShares <= 0) return
    setSaving(true)
    await onSave({
      symbol: symbol.trim().toUpperCase(),
      action,
      trade_date: tradeDateStr,
      shares: finalShares,
      price: safePrice,
      trade_type: tradeType,
      note,
    })
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
        smart_sell_amount: smartSellAmount || 0,
      }
      
      const res = await fetch('/api/dca', {
        method: initialPlan ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initialPlan ? { ...payload, id: initialPlan.id } : payload)
      })
      
      if (res.ok) {
        alert(initialPlan ? '定期定額計畫已更新' : '定期定額計畫已儲存')
        onSavePlan?.()
        onClose()
      } else {
        const errData = await res.json().catch(() => ({}))
        alert(`儲存失敗: ${errData.error || '未知錯誤'}`)
      }
    } catch (e) {
      alert('系統錯誤，請檢查網路連線')
    } finally {
      setSaving(false)
    }
  }

  const toggleDcaDay = (d: number) => {
    setDcaDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a,b) => a-b))
  }

  const canSubmitOrder = symbol.trim() !== '' && finalShares > 0 && safePrice > 0 && stockName !== ''
  const canSubmitDca = symbol.trim() !== '' && Number(dcaAmount) > 0 && dcaDays.length > 0 && stockName !== ''

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full slide-up rounded-t-[2.5rem] pb-safe overflow-hidden flex flex-col md:max-w-[480px] md:mx-auto" style={{ background: '#0d1018', border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none', maxHeight: '92dvh' }}>
        <div className="flex justify-center pt-4 pb-2 shrink-0">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        <div className="px-6 pt-2 pb-8 overflow-y-auto overflow-x-hidden flex-1 w-full" style={{ overflowX: 'hidden' }}>
          {mode === 'SELECT' && (
            <div className="space-y-8 py-8">
              <div className="text-center space-y-2">
                <h2 className="font-black text-2xl text-white">選擇交易類型</h2>
                <p className="text-sm text-white/30 font-medium tracking-wide">請選擇您要記錄的投資方式</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMode('ORDER')} className="group glass rounded-3xl p-8 flex flex-col items-center gap-4 active:scale-95 transition-all border border-white/5 hover:border-gold/30">
                  <div className="text-5xl group-hover:scale-110 transition-transform duration-300">📝</div>
                  <div className="font-black text-white text-lg tracking-tight">單筆下單</div>
                </button>
                <button onClick={() => setMode('DCA')} className="group glass rounded-3xl p-8 flex flex-col items-center gap-4 active:scale-95 transition-all border border-white/5 hover:border-gold/30">
                  <div className="text-5xl group-hover:scale-110 transition-transform duration-300">⏳</div>
                  <div className="font-black text-white text-lg tracking-tight">定期定額</div>
                </button>
              </div>
            </div>
          )}

          {(mode === 'ORDER' || mode === 'DCA') && (
            <div className="space-y-6 pb-4">
              <div className="flex items-center justify-between">
                {!initialPlan && (
                  <button onClick={() => setMode('SELECT')} className="flex items-center gap-1 text-xs text-gold font-black px-3 py-1.5 bg-gold/10 rounded-full active:bg-gold/20">
                    <span>‹</span> 返回
                  </button>
                )}
                <h2 className="font-black text-base text-white tracking-widest uppercase">
                  {mode === 'ORDER' ? '新增交易' : (initialPlan ? '編輯定期定額' : '設定定期定額')}
                </h2>
                <div className="w-14" />
              </div>

              {mode === 'ORDER' && (
                <>
                  <div className="space-y-2">
                    <Label>交易類型</Label>
                    <div className="flex gap-2.5">
                      {(['BUY','SELL'] as Action[]).map(a => (
                        <button key={a} onClick={() => setAction(a)} className={`flex-1 py-3.5 rounded-2xl text-sm font-black transition-all border-2 ${action === a ? (a === 'BUY' ? 'bg-red-400/20 text-red-400 border-red-400' : 'bg-green-400/20 text-green-400 border-green-400') : 'bg-white/5 text-white/30 border-transparent'}`}>
                          {a === 'BUY' ? '買入紀錄' : '賣出紀錄'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-end px-1">
                      <Label>股票代號</Label>
                      {fetchingName ? <span className="text-[10px] animate-pulse text-gold font-bold">搜尋中…</span> : stockName ? <span className="text-[11px] font-black text-gold uppercase bg-gold/10 px-2 py-0.5 rounded-md border border-gold/20">{stockName}</span> : null}
                    </div>
                    <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="輸入代號，如 2330" className="input-base uppercase font-black font-mono w-full text-lg py-4 px-5 rounded-2xl bg-white/5 border-white/10" autoCapitalize="characters" />
                  </div>

                  <div className="space-y-2">
                    <Label>交易方式</Label>
                    <div className="flex gap-2.5">
                      {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                        <button key={t} onClick={() => setTradeType(t)} className={`flex-1 py-3 rounded-2xl text-[11px] font-black tracking-wider transition-all border ${tradeType === t ? 'bg-gold-dim text-gold border-gold' : 'bg-white/5 text-white/30 border-transparent'}`}>
                          {t === 'FULL' ? '整張 (1000股)' : '盤後零股'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{tradeType === 'FULL' ? '交易張數' : '交易股數'}</Label>
                    <div className="flex items-center gap-4">
                      <button onClick={() => tradeType === 'FULL' ? setLots(l => l===''||l<=1?'':l-1) : setShares(s => s===''||s<=1?'':s-1)} className="btn-ghost w-14 h-14 flex items-center justify-center text-2xl font-black rounded-2xl border-2 border-white/5 bg-white/5 text-white/60">−</button>
                      <input type="number" inputMode="numeric" pattern="[0-9]*" value={tradeType === 'FULL' ? lots : shares} onFocus={e => e.target.select()} onChange={e => { const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0); tradeType === 'FULL' ? setLots(v) : setShares(v) }} placeholder="0" className="flex-1 text-center font-black font-mono text-3xl input-base w-full bg-transparent text-white" />
                      <button onClick={() => tradeType === 'FULL' ? setLots(l => Number(l||0)+1) : setShares(s => Number(s||0)+1)} className="btn-ghost w-14 h-14 flex items-center justify-center text-2xl font-black rounded-2xl border-2 border-white/5 bg-white/5 text-white/60">+</button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>成交價格 (每股)</Label>
                      <input type="number" inputMode="decimal" pattern="[0-9.]*" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" step="0.01" min="0" className="input-base font-black font-mono text-xl w-full text-white bg-white/5 border-white/10" />
                    </div>

                    <div className="space-y-2">
                      <Label>成交日期</Label>
                      <button onClick={() => setShowDatePicker(true)} className="input-base w-full text-left font-black font-mono text-lg py-4 bg-white/5 border-white/10 flex justify-between items-center">
                        <span>{tradeDateStr}</span>
                        <span className="text-gold">📅</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>操作備註</Label>
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="選填，例如：長期持有、波段操作" className="input-base w-full text-white bg-white/5 border-white/10 font-bold" />
                  </div>

                  {safePrice > 0 && finalShares > 0 && (
                    <div className="rounded-3xl p-5 space-y-2.5 bg-white/[0.03] border border-white/10">
                      <FeeRow label="估算交易金額" value={fmtMoney(Math.round(amount))} />
                      <FeeRow label="券商手續費"   value={fmtMoney(Math.round(fee))} />
                      {tax > 0 && <FeeRow label="證券交易稅"  value={fmtMoney(Math.round(tax))} />}
                      <div className="border-t border-white/10 pt-3 mt-3 flex justify-between items-center">
                        <span className="text-xs font-black text-white/40 uppercase tracking-widest">預估淨收支</span>
                        <span className={`font-black font-mono text-xl ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
                        </span>
                      </div>
                    </div>
                  )}

                  <button onClick={submitOrder} disabled={saving || !canSubmitOrder} className={`w-full py-5 text-lg font-black rounded-xl transition-all mt-4 ${canSubmitOrder ? 'active:scale-95' : 'bg-white/5 text-white/10 cursor-not-allowed border border-white/5'}`} style={{ background: canSubmitOrder ? 'linear-gradient(135deg, #c9a564, #e8c880)' : undefined, color: canSubmitOrder ? '#000' : undefined }}>
                    {saving ? '處理中…' : '✅ 確認新增交易紀錄'}
                  </button>
                </>
              )}

              {mode === 'DCA' && (
                <>
                  {/* 1. 股票代號 */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-end px-1">
                      <Label>股票代號</Label>
                      {fetchingName ? <span className="text-[10px] animate-pulse text-gold font-bold">搜尋中…</span> : stockName ? <span className="text-[11px] font-black text-gold uppercase bg-gold/10 px-2 py-0.5 rounded-md border border-gold/20">{stockName}</span> : null}
                    </div>
                    <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockInfo(e.target.value)} placeholder="輸入代號，如 0050" className="input-base uppercase font-black font-mono w-full text-lg py-4 px-5 rounded-2xl bg-white/5 border-white/10" autoCapitalize="characters" />
                  </div>

                  {/* 2. 每次申購金額 */}
                  <div className="space-y-2">
                    <Label>每次申購金額</Label>
                    <div className="relative">
                      <input type="number" inputMode="numeric" pattern="[0-9]*" value={dcaAmount} onChange={e => setDcaAmount(e.target.value===''?'':Number(e.target.value))} placeholder="例如：5000" className="input-base font-black font-mono text-xl w-full text-white bg-white/5 border-white/10 py-4 px-5 rounded-2xl pr-12" />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 font-bold">元</span>
                    </div>
                  </div>

                  {/* 3. 每月交易日 */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label>每月交易日</Label>
                      <span className="text-[10px] text-white/20 font-bold">可複選</span>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                        <button key={d} onClick={() => toggleDcaDay(d)} className={`aspect-square rounded-xl flex items-center justify-center text-sm font-black transition-all border ${dcaDays.includes(d) ? 'bg-[#c9a564] text-[#0d1018] border-[#c9a564]' : 'bg-white/5 text-white/30 border-white/5'}`}>{d}</button>
                      ))}
                    </div>
                    <p className="text-[10px] text-white/30 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5">
                      💡 備註：若遇未開盤日，改由下一個交易日買入
                    </p>
                  </div>

                  {/* 4. 股息再投資 */}
                  <div className="glass rounded-3xl p-5 space-y-3 border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-white text-sm">股息再投資</span>
                      <button onClick={() => setDivReinvest(!divReinvest)} className={`w-12 h-6 rounded-full relative transition-all ${divReinvest ? 'bg-[#c9a564]' : 'bg-white/10'}`}>
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${divReinvest ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                    <p className="text-[11px] text-white/40 leading-relaxed">
                      依除息基準日庫存試算現金股息，於股息發放後次二營業日自動買進相同標的
                    </p>
                  </div>

                  {/* 5. 智慧加減碼 */}
                  <div className="space-y-4">
                    <Label>智慧加減碼策略</Label>
                    
                    {stockName && currentPrice > 0 && (
                      <div className="flex gap-4 px-1 mb-2">
                        <div className="flex-1 bg-white/5 rounded-2xl p-3 border border-white/5">
                          <div className="text-[10px] text-white/30 font-bold mb-1">當前股價</div>
                          <div className="text-lg font-black font-mono text-white">{currentPrice}</div>
                        </div>
                        <div className="flex-1 bg-white/5 rounded-2xl p-3 border border-white/5">
                          <div className="text-[10px] text-white/30 font-bold mb-1">季均價 (MA60)</div>
                          <div className="text-lg font-black font-mono text-gold">{ma60.toFixed(2)}</div>
                        </div>
                      </div>
                    )}

                    {/* 逢低加碼 */}
                    <div className={`rounded-3xl p-5 border transition-all ${smartBuyEnabled ? 'bg-red-400/5 border-red-400/30' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex items-center gap-3 mb-4">
                        <input type="checkbox" checked={smartBuyEnabled} onChange={e => setSmartBuyEnabled(e.target.checked)} className="w-5 h-5 rounded border-white/20 bg-white/10 text-gold focus:ring-gold" />
                        <span className="font-black text-white">逢低調整</span>
                      </div>
                      
                      {smartBuyEnabled && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                          <div className="space-y-2">
                            <div className="text-[11px] text-white/40 font-bold">當收盤價低於季均價幅度：</div>
                            <div className="grid grid-cols-4 gap-2">
                              {['>0%', '≥5%', '≥10%', '≥15%'].map(t => (
                                <button key={t} onClick={() => setSmartBuyThreshold(t)} className={`py-2 rounded-xl text-[10px] font-black border transition-all ${smartBuyThreshold === t ? 'bg-red-400/20 text-red-400 border-red-400' : 'bg-white/5 text-white/30 border-transparent'}`}>
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="text-[11px] text-white/40 font-bold">將申購金額調整為：</div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setSmartBuyAmount(a => Math.max(0, Number(a||0)-100))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-white/60 font-black border border-white/10">-</button>
                              <input type="number" inputMode="numeric" value={smartBuyAmount} onChange={e => setSmartBuyAmount(e.target.value===''?'':Number(e.target.value))} className="flex-1 bg-white/10 border-white/10 rounded-xl py-2 text-center font-black font-mono text-white" placeholder="金額" />
                              <button onClick={() => setSmartBuyAmount(a => Number(a||0)+100)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-white/60 font-black border border-white/10">+</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 逢高減碼 */}
                    <div className={`rounded-3xl p-5 border transition-all ${smartSellEnabled ? 'bg-green-400/5 border-green-400/30' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex items-center gap-3 mb-4">
                        <input type="checkbox" checked={smartSellEnabled} onChange={e => setSmartSellEnabled(e.target.checked)} className="w-5 h-5 rounded border-white/20 bg-white/10 text-gold focus:ring-gold" />
                        <span className="font-black text-white">逢高調整</span>
                      </div>
                      
                      {smartSellEnabled && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                          <div className="space-y-2">
                            <div className="text-[11px] text-white/40 font-bold">當收盤價高於季均價幅度：</div>
                            <div className="grid grid-cols-4 gap-2">
                              {['>0%', '≥5%', '≥10%', '≥15%'].map(t => (
                                <button key={t} onClick={() => setSmartSellThreshold(t)} className={`py-2 rounded-xl text-[10px] font-black border transition-all ${smartSellThreshold === t ? 'bg-green-400/20 text-green-400 border-green-400' : 'bg-white/5 text-white/30 border-transparent'}`}>
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="text-[11px] text-white/40 font-bold">將申購金額調整為：</div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setSmartSellAmount(a => Math.max(0, Number(a||0)-100))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-white/60 font-black border border-white/10">-</button>
                              <input type="number" inputMode="numeric" value={smartSellAmount} onChange={e => setSmartSellAmount(e.target.value===''?'':Number(e.target.value))} className="flex-1 bg-white/10 border-white/10 rounded-xl py-2 text-center font-black font-mono text-white" placeholder="金額" />
                              <button onClick={() => setSmartSellAmount(a => Number(a||0)+100)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-white/60 font-black border border-white/10">+</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button onClick={submitDCA} disabled={saving || !canSubmitDca} className={`w-full py-5 text-lg font-black rounded-xl transition-all mt-4 ${canSubmitDca ? 'active:scale-95' : 'bg-white/5 text-white/10 cursor-not-allowed border border-white/5'}`} style={{ background: canSubmitDca ? 'linear-gradient(135deg, #c9a564, #e8c880)' : undefined, color: canSubmitDca ? '#000' : undefined }}>
                    {saving ? '處理中…' : (initialPlan ? '💾 更新定期定額計畫' : '💾 儲存定期定額計畫')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showDatePicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-[320px] glass p-5 space-y-4" style={{ background: '#141820', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center justify-between">
              <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1))} className="p-2 text-gold">◀</button>
              <div className="flex gap-2 font-black text-white">
                <span>{viewDate.getFullYear()}年</span>
                <span>{viewDate.getMonth()+1}月</span>
              </div>
              <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1))} className="p-2 text-gold">▶</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {['日','一','二','三','四','五','六'].map(d => <div key={d} className="text-[10px] font-bold text-white/30">{d}</div>)}
              {(() => {
                const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay()
                const days = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate()
                const cells = []
                for (let i=0; i<start; i++) cells.push(<div key={`e-${i}`} />)
                for (let d=1; d<=days; d++) {
                  const isSel = selectedDate.getFullYear() === viewDate.getFullYear() && selectedDate.getMonth() === viewDate.getMonth() && selectedDate.getDate() === d
                  cells.push(<button key={d} onClick={() => { setSelectedDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), d)); setShowDatePicker(false); }} className={`aspect-square flex items-center justify-center text-sm font-bold rounded-lg ${isSel ? 'bg-gold text-black' : 'text-white/80 hover:bg-white/5'}`}>{d}</button>)
                }
                return cells
              })()}
            </div>
            <button onClick={() => setShowDatePicker(false)} className="w-full py-2 text-xs font-bold text-white/40">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] mb-1 block font-black text-white/30 uppercase tracking-[0.2em] ml-1">{children}</label>
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-white/30 font-bold">{label}</span>
      <span className="font-black font-mono text-white/70">{value}</span>
    </div>
  )
}
