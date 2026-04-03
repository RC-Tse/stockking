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
  const [lots,      setLots]      = useState<number | ''>(1)
  const [shares,    setShares]    = useState<number | ''>(1)
  const [price,     setPrice]     = useState<number | ''>('')
  const [date,      setDate]      = useState(today)
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)

  // Reset when opened
  useEffect(() => {
    if (open) {
      setMode('SELECT')
      setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName('')
      setLots(1); setShares(1); setPrice('')
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
      const res = await fetch(`/api/stockname?symbol=${sym}`)
      if (res.ok) {
        const data = await res.json()
        setStockName(data.name_zh)
      } else {
        setStockName('代號不正確')
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

  const canSubmit = symbol.trim() !== '' && finalShares > 0 && safePrice > 0

  function onBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onBackdrop}
    >
      <div
        className="w-full slide-up rounded-t-2xl pb-safe overflow-hidden flex flex-col md:max-w-[480px] md:mx-auto"
        style={{
          background: '#0d1018',
          border: '1px solid rgba(255,255,255,0.1)',
          borderBottom: 'none',
          maxHeight: '92dvh',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/10" />
        </div>

        <div className="px-5 pt-2 pb-6 overflow-y-auto overflow-x-hidden flex-1 w-full">
          
          {mode === 'SELECT' && (
            <div className="space-y-6 py-6">
              <h2 className="font-black text-xl text-center text-white">選擇交易類型</h2>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMode('ORDER')} className="glass rounded-2xl p-6 flex flex-col items-center gap-3 active:scale-95 transition-transform border border-white/5">
                  <div className="text-4xl text-white">📝</div>
                  <div className="font-bold text-white">單筆下單</div>
                </button>
                <button onClick={() => alert('敬請期待')} className="glass rounded-2xl p-6 flex flex-col items-center gap-3 active:scale-95 transition-transform border border-white/5 opacity-40">
                  <div className="text-4xl">⏳</div>
                  <div className="font-bold text-white">定期定額</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'ORDER' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <button onClick={() => setMode('SELECT')} className="text-xs text-gold font-bold px-2 py-1 -ml-2 rounded-lg active:bg-white/5">‹ 返回</button>
                <h2 className="font-black text-base text-white">新增交易</h2>
                <div className="w-10" />
              </div>

              {/* Action */}
              <div>
                <Label>交易類型</Label>
                <div className="flex gap-2">
                  {(['BUY','SELL'] as Action[]).map(a => (
                    <button key={a} onClick={() => setAction(a)}
                      className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border ${action === a ? (a === 'BUY' ? 'bg-red-400/20 text-red-400 border-red-400' : 'bg-green-400/20 text-green-400 border-green-400') : 'bg-white/5 text-white/40 border-transparent'}`}>
                      {a === 'BUY' ? '買入' : '賣出'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Symbol */}
              <div>
                <div className="flex justify-between items-end mb-1.5">
                  <Label>股票代號</Label>
                  {fetchingName ? (
                    <span className="text-[10px] animate-pulse text-gold">查詢中…</span>
                  ) : stockName ? (
                    <span className="text-[10px] font-black text-gold uppercase">{stockName}</span>
                  ) : null}
                </div>
                <input
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  onBlur={e => fetchStockName(e.target.value)}
                  placeholder="例：2330.TW"
                  className="input-base uppercase font-mono w-full"
                  autoCapitalize="characters"
                />
              </div>

              {/* Trade type */}
              <div>
                <Label>交易方式</Label>
                <div className="flex gap-2">
                  {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                    <button key={t} onClick={() => setTradeType(t)}
                      className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold transition-all border ${tradeType === t ? 'bg-gold-dim text-gold border-gold' : 'bg-white/5 text-white/40 border-transparent'}`}>
                      {t === 'FULL' ? '整張（1000股）' : '零股'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
                <div className="flex items-center gap-3">
                  <button onClick={handleMinus}
                    className="btn-ghost w-12 h-12 flex items-center justify-center text-xl font-black rounded-xl border border-white/5 bg-white/5 text-white">
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
                    className="flex-1 text-center font-black font-mono text-2xl input-base w-full bg-transparent text-white"
                  />
                  <button onClick={handlePlus}
                    className="btn-ghost w-12 h-12 flex items-center justify-center text-xl font-black rounded-xl border border-white/5 bg-white/5 text-white">
                    +
                  </button>
                </div>
                <p className="text-[10px] text-center mt-1.5 font-mono text-white/20">
                  = {finalShares.toLocaleString()} 股
                </p>
              </div>

              {/* Price */}
              <div>
                <Label>成交價（元）</Label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" step="0.01" min="0" className="input-base font-mono text-base w-full text-white" />
              </div>

              {/* Date */}
              <div>
                <Label>交易日期</Label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base font-mono text-sm w-full text-white" style={{ colorScheme: 'dark' }} />
              </div>

              {/* Note */}
              <div>
                <Label>備註（選填）</Label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="操作筆記…" className="input-base w-full text-white" />
              </div>

              {/* Fee preview */}
              {safePrice > 0 && (
                <div className="rounded-xl p-3 space-y-1.5 bg-white/5 border border-white/10 shadow-inner">
                  <FeeRow label="交易金額" value={fmtMoney(Math.round(amount))} />
                  <FeeRow label="手續費"   value={fmtMoney(Math.round(fee))} />
                  {tax > 0 && <FeeRow label="交易稅"  value={fmtMoney(Math.round(tax))} />}
                  <div className="border-t pt-2 mt-2 flex justify-between items-center border-white/5">
                    <span className="text-xs font-bold text-white/60">淨收支</span>
                    <span className={`font-black font-mono text-base ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
                    </span>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button 
                onClick={submitOrder} 
                disabled={saving || !canSubmit} 
                className={`w-full py-4 text-base font-black rounded-2xl transition-all shadow-lg ${canSubmit ? 'bg-gradient-to-br from-gold to-gold-bright text-base active:scale-95' : 'bg-white/5 text-white/20 cursor-not-allowed'}`}>
                {saving ? '處理中…' : '✅ 確認新增交易'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] mb-1 block font-bold text-white/30 uppercase tracking-widest">{children}</label>
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-white/40">{label}</span>
      <span className="font-mono font-bold text-white/80">{value}</span>
    </div>
  )
}
