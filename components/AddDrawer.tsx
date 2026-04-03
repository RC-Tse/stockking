'use client'

import { useState, useEffect } from 'react'
import { UserSettings, calcFee, calcTax, fmtMoney, codeOnly } from '@/types'

interface Props {
  open: boolean
  settings: UserSettings
  onClose: () => void
  onSave: (payload: {
    symbol: string; action: string; trade_date: string;
    shares: number; price: number; trade_type: string; note: string;
  }) => Promise<void>
}

type Mode = 'SELECT' | 'ORDER' | 'DCA'
type Action = 'BUY' | 'SELL'
type TradeType = 'FULL' | 'FRACTIONAL'

export default function AddDrawer({ open, settings, onClose, onSave }: Props) {
  const today = new Date().toISOString().split('T')[0]

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
  const [date,      setDate]      = useState(today)
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)

  // Reset when opened
  useEffect(() => {
    if (open) {
      setMode('SELECT')
      setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName('')
      setLots(''); setShares(''); setPrice('')
      setDate(today); setNote(''); setSaving(false)
    }
  }, [open, today])

  async function fetchStockName(s: string) {
    let sym = s.trim().toUpperCase()
    if (!sym) return
    
    if (/^\d+$/.test(sym)) {
      sym = sym + '.TW'
      setSymbol(sym)
    }

    setFetchingName(true)
    try {
      // Use direct stock API which now handles names
      const res = await fetch(`/api/stocks?symbols=${sym}`)
      if (res.ok) {
        const data = await res.json()
        setStockName(data[sym]?.name_zh || '')
      } else {
        setStockName('')
      }
    } catch (err) {
      setStockName('')
    } finally {
      setFetchingName(false)
    }
  }

  const actualLots = lots === '' ? 0 : lots
  const actualShrs = shares === '' ? 0 : shares
  const finalShares = tradeType === 'FULL' ? actualLots * 1000 : actualShrs
  const safePrice = typeof price === 'number' ? price : 0
  const amount = finalShares * safePrice
  const fee    = safePrice > 0 ? calcFee(amount, settings, action === 'SELL') : 0
  const tax    = safePrice > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net    = action === 'BUY' ? -(amount + fee) : (amount - fee - tax)

  async function submitOrder() {
    if (!symbol.trim() || safePrice <= 0 || finalShares <= 0) return
    setSaving(true)
    await onSave({
      symbol: symbol.trim().toUpperCase(),
      action,
      trade_date: date,
      shares: finalShares,
      price: safePrice,
      trade_type: tradeType,
      note,
    })
    setSaving(false)
  }

  function handleMinus() {
    if (tradeType === 'FULL') {
      if (lots === '' || lots <= 1) setLots('')
      else setLots(lots - 1)
    } else {
      if (shares === '' || shares <= 1) setShares('')
      else setShares(shares - 1)
    }
  }

  function handlePlus() {
    if (tradeType === 'FULL') {
      if (lots === '') setLots(1)
      else setLots(lots + 1)
    } else {
      if (shares === '') setShares(1)
      else setShares(shares + 1)
    }
  }

  const canSubmit = symbol.trim() !== '' && finalShares > 0 && safePrice > 0 && stockName !== ''

  function onBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onBackdrop}
    >
      <div
        className="w-full slide-up rounded-t-[2.5rem] pb-safe overflow-hidden flex flex-col md:max-w-[480px] md:mx-auto"
        style={{
          background: '#0d1018',
          border: '1px solid rgba(255,255,255,0.1)',
          borderBottom: 'none',
          maxHeight: '92dvh',
        }}
        onClick={e => e.stopPropagation()}
      >
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
                <button onClick={() => alert('定期定額功能開發中，敬請期待')} className="group glass rounded-3xl p-8 flex flex-col items-center gap-4 active:scale-95 transition-all border border-white/5 opacity-40 grayscale">
                  <div className="text-5xl">⏳</div>
                  <div className="font-black text-white text-lg tracking-tight">定期定額</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'ORDER' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <button onClick={() => setMode('SELECT')} className="flex items-center gap-1 text-xs text-gold font-black px-3 py-1.5 bg-gold/10 rounded-full active:bg-gold/20">
                  <span>‹</span> 返回
                </button>
                <h2 className="font-black text-base text-white tracking-widest uppercase">新增交易</h2>
                <div className="w-14" />
              </div>

              {/* Action */}
              <div className="space-y-2">
                <Label>交易類型</Label>
                <div className="flex gap-2.5">
                  {(['BUY','SELL'] as Action[]).map(a => (
                    <button key={a} onClick={() => setAction(a)}
                      className={`flex-1 py-3.5 rounded-2xl text-sm font-black transition-all border-2 ${action === a ? (a === 'BUY' ? 'bg-red-400/20 text-red-400 border-red-400 shadow-[0_0_15px_rgba(248,113,113,0.3)]' : 'bg-green-400/20 text-green-400 border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.3)]') : 'bg-white/5 text-white/30 border-transparent'}`}>
                      {a === 'BUY' ? '買入紀錄' : '賣出紀錄'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Symbol */}
              <div className="space-y-2">
                <div className="flex justify-between items-end px-1">
                  <Label>股票代號</Label>
                  {fetchingName ? (
                    <span className="text-[10px] animate-pulse text-gold font-bold">搜尋中…</span>
                  ) : stockName ? (
                    <span className="text-[11px] font-black text-gold uppercase bg-gold/10 px-2 py-0.5 rounded-md border border-gold/20">{stockName}</span>
                  ) : null}
                </div>
                <input
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  onBlur={e => fetchStockName(e.target.value)}
                  placeholder="輸入代號，如 2330"
                  className="input-base uppercase font-black font-mono w-full text-lg py-4 px-5 rounded-2xl bg-white/5 border-white/10 focus:border-gold/50 transition-colors"
                  autoCapitalize="characters"
                />
              </div>

              {/* Trade type */}
              <div className="space-y-2">
                <Label>交易方式</Label>
                <div className="flex gap-2.5">
                  {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                    <button key={t} onClick={() => setTradeType(t)}
                      className={`flex-1 py-3 rounded-2xl text-[11px] font-black tracking-wider transition-all border ${tradeType === t ? 'bg-gold-dim text-gold border-gold' : 'bg-white/5 text-white/30 border-transparent'}`}>
                      {t === 'FULL' ? '整張 (1000股)' : '盤後零股'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div className="space-y-2">
                <Label>{tradeType === 'FULL' ? '交易張數' : '交易股數'}</Label>
                <div className="flex items-center gap-4">
                  <button onClick={handleMinus}
                    className="btn-ghost w-14 h-14 flex items-center justify-center text-2xl font-black rounded-2xl border-2 border-white/5 bg-white/5 text-white/60 active:scale-95 transition-all">
                    −
                  </button>
                  <input
                    type="number" inputMode="numeric" pattern="[0-9]*"
                    value={tradeType === 'FULL' ? lots : shares}
                    onFocus={e => e.target.select()}
                    onClick={e => (e.target as HTMLInputElement).value === '' ? null : (tradeType === 'FULL' ? setLots('') : setShares(''))}
                    onChange={e => {
                      const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
                      tradeType === 'FULL' ? setLots(v) : setShares(v)
                    }}
                    placeholder="0"
                    className="flex-1 text-center font-black font-mono text-3xl input-base w-full bg-transparent text-white placeholder:text-white/10"
                  />
                  <button onClick={handlePlus}
                    className="btn-ghost w-14 h-14 flex items-center justify-center text-2xl font-black rounded-2xl border-2 border-white/5 bg-white/5 text-white/60 active:scale-95 transition-all">
                    +
                  </button>
                </div>
                <p className="text-[11px] text-center font-black font-mono text-white/20 tracking-widest uppercase">
                  = {finalShares.toLocaleString()} TOTAL SHARES
                </p>
              </div>

              <div className="space-y-4">
                {/* Price */}
                <div className="space-y-2">
                  <Label>成交價格 (每股)</Label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" step="0.01" min="0" className="input-base font-black font-mono text-xl w-full text-white bg-white/5 border-white/10 py-4 px-5 rounded-2xl" />
                </div>

                {/* Date */}
                <div className="space-y-2">
                  <Label>成交日期</Label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base font-black font-mono text-base w-full text-white bg-white/5 border-white/10 py-4 px-5 rounded-2xl" style={{ colorScheme: 'dark', width: '100%', maxWidth: '100%' }} />
                </div>
              </div>

              {/* Note */}
              <div className="space-y-2">
                <Label>操作備註</Label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="選填，例如：長期持有、波段操作" className="input-base w-full text-white bg-white/5 border-white/10 py-4 px-5 rounded-2xl font-bold" />
              </div>

              {/* Fee preview */}
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

              {/* Submit */}
              <button 
                onClick={submitOrder} 
                disabled={saving || !canSubmit} 
                className={`w-full py-5 text-lg font-black rounded-xl transition-all mt-4 ${canSubmit ? 'bg-gradient-to-br from-[#FFD700] to-[#FF8C00] text-black active:scale-95 shadow-[0_8px_32px_rgba(255,215,0,0.2)]' : 'bg-white/5 text-white/10 cursor-not-allowed border border-white/5'}`}>
                {saving ? '處理中…' : '✅ 確認新增交易紀錄'}
              </button>
            </div>
          )}
        </div>
      </div>
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
