'use client'

import { useState, useEffect } from 'react'
import { UserSettings, calcFee, calcTax, fmtMoney } from '@/types'

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
  const [lots,      setLots]      = useState(1)
  const [shares,    setShares]    = useState(1)
  const [price,     setPrice]     = useState<number | ''>('')
  const [date,      setDate]      = useState(today)
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)

  // DCA states
  const [dcaAmount, setDcaAmount] = useState<number | ''>('')
  const [dcaDays, setDcaDays] = useState<number[]>([])
  const [drip, setDrip] = useState(false)
  const [smartLowPct, setSmartLowPct] = useState('5')
  const [smartLowAmt, setSmartLowAmt] = useState<number | ''>('')
  const [smartHighPct, setSmartHighPct] = useState('5')
  const [smartHighAmt, setSmartHighAmt] = useState<number | ''>('')

  // Reset when opened
  useEffect(() => {
    if (open) {
      setMode('SELECT')
      setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName('')
      setLots(1); setShares(1); setPrice('')
      setDate(today); setNote(''); setSaving(false)
      setDcaAmount(''); setDcaDays([]); setDrip(false)
      setSmartLowPct('5'); setSmartLowAmt(''); setSmartHighPct('5'); setSmartHighAmt('')
    }
  }, [open, today])

  async function fetchStockName(s: string) {
    let sym = s.trim().toUpperCase()
    if (!sym) return
    
    if (/^\d+$/.test(sym)) {
      sym = sym + '.TW'
      setSymbol(sym)
    }

    if (!sym.endsWith('.TW') && !sym.endsWith('.TWO')) {
      setStockName('僅支援 .TW 或 .TWO')
      return
    }

    setFetchingName(true)
    try {
      const res = await fetch(`/api/stocks/info?symbol=${sym}`)
      if (res.ok) {
        const data = await res.json()
        setStockName(data.name)
      } else {
        setStockName('查無此台股代號')
      }
    } catch (err) {
      setStockName('查詢失敗')
    } finally {
      setFetchingName(false)
    }
  }

  const actualShares = tradeType === 'FULL' ? lots * 1000 : shares
  const safePrice = typeof price === 'number' ? price : 0
  const amount = actualShares * safePrice
  const fee    = safePrice > 0 ? calcFee(amount, settings, action === 'SELL') : 0
  const tax    = safePrice > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net    = action === 'BUY' ? -(amount + fee) : (amount - fee - tax)

  async function submitOrder() {
    if (!symbol.trim() || safePrice <= 0 || actualShares <= 0) return
    setSaving(true)
    await onSave({
      symbol: symbol.trim().toUpperCase(),
      action,
      trade_date: date,
      shares: actualShares,
      price: safePrice,
      trade_type: tradeType,
      note,
    })
    setSaving(false)
  }

  async function submitDCA() {
    if (!symbol.trim() || !dcaAmount) return
    setSaving(true)
    // 這裡尚未有後端 API 支援儲存 DCA 設定，暫時模擬儲存後關閉
    await new Promise(r => setTimeout(r, 800))
    setSaving(false)
    onClose()
    alert('定期定額設定已儲存（此為預覽功能）')
  }

  function toggleDay(d: number) {
    setDcaDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

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
        className="w-full slide-up rounded-t-2xl pb-safe overflow-hidden flex flex-col"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          maxHeight: '92dvh',
          maxWidth: '100vw',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="px-5 pt-2 pb-6 overflow-y-auto overflow-x-hidden flex-1 w-full max-w-full">
          
          {mode === 'SELECT' && (
            <div className="space-y-6 py-6">
              <h2 className="font-black text-xl text-center" style={{ color: 'var(--t1)' }}>請選擇交易類型</h2>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMode('ORDER')} className="glass rounded-2xl p-6 flex flex-col items-center gap-3 active:scale-95 transition-transform" style={{ border: '1px solid var(--border-bright)' }}>
                  <div className="text-4xl">📝</div>
                  <div className="font-bold" style={{ color: 'var(--t1)' }}>單筆下單</div>
                  <div className="text-[10px] text-center" style={{ color: 'var(--t3)' }}>手動記錄買入與賣出</div>
                </button>
                <button onClick={() => setMode('DCA')} className="glass rounded-2xl p-6 flex flex-col items-center gap-3 active:scale-95 transition-transform" style={{ border: '1px solid var(--gold-dim)' }}>
                  <div className="text-4xl">⏳</div>
                  <div className="font-bold" style={{ color: 'var(--gold)' }}>定期定額</div>
                  <div className="text-[10px] text-center" style={{ color: 'var(--t3)' }}>自動紀律投資設定</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'ORDER' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <button onClick={() => setMode('SELECT')} className="text-xs text-gold font-bold px-2 py-1 -ml-2 rounded-lg active:bg-white/5">‹ 返回</button>
                <h2 className="font-black text-base" style={{ color: 'var(--t1)' }}>新增交易</h2>
                <div className="w-10" />
              </div>

              {/* Action */}
              <div>
                <Label>交易類型</Label>
                <div className="flex gap-2">
                  {(['BUY','SELL'] as Action[]).map(a => (
                    <button key={a} onClick={() => setAction(a)}
                      className="flex-1 py-3 rounded-xl text-sm font-bold transition-all border"
                      style={{
                        background: action === a ? (a === 'BUY' ? 'var(--red-dim)' : 'var(--grn-dim)') : 'var(--bg-hover)',
                        color: action === a ? (a === 'BUY' ? 'var(--red)' : 'var(--grn)') : 'var(--t3)',
                        borderColor: action === a ? (a === 'BUY' ? 'var(--red)' : 'var(--grn)') : 'transparent',
                      }}>
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
                    <span className="text-xs animate-pulse" style={{ color: 'var(--gold)' }}>查詢中…</span>
                  ) : stockName ? (
                    <span className="text-xs font-bold" style={{ color: 'var(--gold)' }}>{stockName}</span>
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
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border"
                      style={{
                        background: tradeType === t ? 'var(--gold-dim)' : 'var(--bg-hover)',
                        color: tradeType === t ? 'var(--gold)' : 'var(--t3)',
                        borderColor: tradeType === t ? 'var(--border-bright)' : 'transparent',
                      }}>
                      {t === 'FULL' ? '整張（1000股）' : '零股'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
                <div className="flex items-center gap-3">
                  <button onClick={() => tradeType === 'FULL' ? setLots(l => Math.max(1, l-1)) : setShares(s => Math.max(1, s-1))}
                    className="btn-ghost w-12 h-12 flex items-center justify-center text-xl font-black rounded-xl border border-white/5 bg-white/5">
                    −
                  </button>
                  <input
                    type="number" inputMode="numeric" pattern="[0-9]*"
                    value={tradeType === 'FULL' ? lots : shares}
                    onChange={e => {
                      const v = Math.max(1, parseInt(e.target.value) || 0)
                      tradeType === 'FULL' ? setLots(v) : setShares(v)
                    }}
                    className="flex-1 text-center font-black font-mono text-2xl input-base w-full"
                    style={{ color: 'var(--t1)', background: 'transparent' }}
                  />
                  <button onClick={() => tradeType === 'FULL' ? setLots(l => l+1) : setShares(s => s+1)}
                    className="btn-ghost w-12 h-12 flex items-center justify-center text-xl font-black rounded-xl border border-white/5 bg-white/5">
                    +
                  </button>
                </div>
                <p className="text-xs text-center mt-1.5 font-mono opacity-60">
                  = {actualShares.toLocaleString()} 股
                </p>
              </div>

              {/* Price & Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>成交價（元）</Label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value ? Number(e.target.value) : '')} placeholder="0.00" step="0.01" min="0" className="input-base font-mono text-base w-full" />
                </div>
                <div>
                  <Label>交易日期</Label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base font-mono text-sm w-full" style={{ colorScheme: 'dark' }} />
                </div>
              </div>

              {/* Note */}
              <div>
                <Label>備註（選填）</Label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="操作筆記…" className="input-base w-full" />
              </div>

              {/* Fee preview */}
              {safePrice > 0 && (
                <div className="rounded-xl p-3 space-y-1.5 bg-white/5 border border-white/10 shadow-inner">
                  <FeeRow label="交易金額" value={fmtMoney(Math.round(amount))} />
                  <FeeRow label="手續費"   value={fmtMoney(Math.round(fee))} />
                  {tax > 0 && <FeeRow label="交易稅"  value={fmtMoney(Math.round(tax))} />}
                  <div className="border-t pt-2 mt-2 flex justify-between items-center border-white/10">
                    <span className="text-xs font-bold" style={{ color: 'var(--t1)' }}>淨收支</span>
                    <span className="font-black font-mono text-base" style={{ color: net >= 0 ? 'var(--red)' : 'var(--grn)' }}>
                      {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
                    </span>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button onClick={submitOrder} disabled={saving || !symbol.trim() || safePrice <= 0 || actualShares <= 0} className="btn-primary w-full py-4 text-base font-black shadow-lg">
                {saving ? '新增中…' : '✅ 確認新增交易'}
              </button>
            </div>
          )}

          {mode === 'DCA' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <button onClick={() => setMode('SELECT')} className="text-xs text-gold font-bold px-2 py-1 -ml-2 rounded-lg active:bg-white/5">‹ 返回</button>
                <h2 className="font-black text-base" style={{ color: 'var(--gold)' }}>設定定期定額</h2>
                <div className="w-10" />
              </div>

              {/* Symbol */}
              <div>
                <div className="flex justify-between items-end mb-1.5">
                  <Label>股票代號</Label>
                  {fetchingName ? (
                    <span className="text-xs animate-pulse" style={{ color: 'var(--gold)' }}>查詢中…</span>
                  ) : stockName ? (
                    <span className="text-xs font-bold" style={{ color: 'var(--gold)' }}>{stockName}</span>
                  ) : null}
                </div>
                <input value={symbol} onChange={e => setSymbol(e.target.value)} onBlur={e => fetchStockName(e.target.value)} placeholder="例：0050.TW" className="input-base uppercase font-mono w-full" autoCapitalize="characters" />
              </div>

              {/* Amount */}
              <div>
                <Label>每次申購金額（元）</Label>
                <input type="number" inputMode="numeric" value={dcaAmount} onChange={e => setDcaAmount(e.target.value ? Number(e.target.value) : '')} placeholder="例如：5000" className="input-base font-mono text-lg w-full" />
              </div>

              {/* Days */}
              <div>
                <div className="flex justify-between items-end mb-1.5">
                  <Label>每月交易日 (可複選)</Label>
                  <span className="text-[10px] opacity-60">已選 {dcaDays.length} 天</span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({length: 31}, (_, i) => i + 1).map(d => {
                    const sel = dcaDays.includes(d)
                    return (
                      <button key={d} onClick={() => toggleDay(d)} 
                        className={`aspect-square rounded flex items-center justify-center text-xs font-mono font-bold transition-colors border ${sel ? 'bg-gold text-black border-gold' : 'bg-white/5 text-gray-400 border-white/5'}`}>
                        {d}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] mt-2 opacity-60 leading-relaxed">
                  ※ 系統判斷台股交易日（週一到週五、非國定假日），若遇未開盤日，改由下一個交易日買入。
                </p>
              </div>

              {/* DRIP */}
              <div className="glass rounded-xl p-4 flex items-start gap-3 border border-white/5">
                <div className="mt-1">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={drip} onChange={e => setDrip(e.target.checked)} />
                    <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gold peer-checked:after:bg-white"></div>
                  </label>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: drip ? 'var(--gold)' : 'var(--t1)' }}>股息再投資 (DRIP)</div>
                  <p className="text-[10px] mt-1 opacity-70 leading-relaxed">
                    依除息基準日庫存試算現金股息，於股息發放後次二營業日自動買入相同標的。
                  </p>
                </div>
              </div>

              {/* Smart DCA */}
              <div className="glass rounded-xl p-4 space-y-4 border border-white/5">
                <div className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--t1)' }}>
                  🧠 智慧加減碼設定
                </div>
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
                    <div className="text-xs font-bold text-green-400">逢低調整 (低於季均價)</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span>下跌幅度</span>
                      <select value={smartLowPct} onChange={e => setSmartLowPct(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1 outline-none text-green-400 font-mono">
                        <option value="0">&gt; 0%</option>
                        <option value="5">&ge; 5%</option>
                        <option value="10">&ge; 10%</option>
                        <option value="15">&ge; 15%</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span>申購金額調整為</span>
                      <input type="number" value={smartLowAmt} onChange={e => setSmartLowAmt(e.target.value ? Number(e.target.value) : '')} className="bg-black/40 border border-white/10 rounded px-2 py-1 outline-none font-mono flex-1 w-0 text-white" placeholder="元" />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                    <div className="text-xs font-bold text-red-400">逢高調整 (高於季均價)</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span>上漲幅度</span>
                      <select value={smartHighPct} onChange={e => setSmartHighPct(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1 outline-none text-red-400 font-mono">
                        <option value="0">&gt; 0%</option>
                        <option value="5">&ge; 5%</option>
                        <option value="10">&ge; 10%</option>
                        <option value="15">&ge; 15%</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span>申購金額調整為</span>
                      <input type="number" value={smartHighAmt} onChange={e => setSmartHighAmt(e.target.value ? Number(e.target.value) : '')} className="bg-black/40 border border-white/10 rounded px-2 py-1 outline-none font-mono flex-1 w-0 text-white" placeholder="元" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button className="flex-1 py-3.5 rounded-xl font-bold text-xs border border-white/10 bg-white/5 active:bg-white/10 transition-colors" style={{ color: 'var(--t2)' }}>
                  📊 報酬率試算
                </button>
                <button onClick={submitDCA} disabled={saving || !symbol.trim() || !dcaAmount || dcaDays.length === 0} className="flex-2 py-3.5 rounded-xl font-black text-sm shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100" style={{ background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-bright) 100%)', color: 'var(--bg-base)' }}>
                  {saving ? '儲存中…' : '💾 儲存設定'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs mb-1.5 block font-bold" style={{ color: 'var(--t3)' }}>{children}</label>
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span style={{ color: 'var(--t3)' }}>{label}</span>
      <span className="font-mono font-bold" style={{ color: 'var(--t1)' }}>{value}</span>
    </div>
  )
}
