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

type Action = 'BUY' | 'SELL' | 'DCA'
type TradeType = 'FULL' | 'FRACTIONAL'

export default function AddDrawer({ open, settings, onClose, onSave }: Props) {
  const today = new Date().toISOString().split('T')[0]

  const [action,    setAction]    = useState<Action>('BUY')
  const [tradeType, setTradeType] = useState<TradeType>('FULL')
  const [symbol,    setSymbol]    = useState('')
  const [stockName, setStockName] = useState('')
  const [fetchingName, setFetchingName] = useState(false)
  const [lots,      setLots]      = useState(1)
  const [shares,    setShares]    = useState(1)
  const [price,     setPrice]     = useState(0)
  const [date,      setDate]      = useState(today)
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)

  // Reset when opened
  useEffect(() => {
    if (open) {
      setAction('BUY'); setTradeType('FULL'); setSymbol(''); setStockName('')
      setLots(1); setShares(1); setPrice(0)
      setDate(today); setNote(''); setSaving(false)
    }
  }, [open, today])

  async function fetchStockName(s: string) {
    const sym = s.trim().toUpperCase()
    if (!sym || sym.length < 2) return
    setFetchingName(true)
    try {
      const res = await fetch(`/api/stocks/info?symbol=${sym}`)
      if (res.ok) {
        const data = await res.json()
        setStockName(data.name)
      } else {
        setStockName('找不到此代號')
      }
    } catch (err) {
      setStockName('')
    } finally {
      setFetchingName(false)
    }
  }

  const actualShares = tradeType === 'FULL' ? lots * 1000 : shares
  const amount = actualShares * price
  const fee    = price > 0 ? calcFee(amount, settings, action === 'SELL') : 0
  const tax    = price > 0 && action === 'SELL' ? calcTax(amount, symbol, settings) : 0
  const net    = action === 'BUY' || action === 'DCA' ? -(amount + fee) : (amount - fee - tax)

  async function submit() {
    if (!symbol.trim() || price <= 0 || actualShares <= 0) return
    setSaving(true)
    await onSave({
      symbol: symbol.trim().toUpperCase(),
      action,
      trade_date: date,
      shares: actualShares,
      price,
      trade_type: tradeType,
      note,
    })
    setSaving(false)
  }

  // Backdrop click
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
        className="w-full slide-up rounded-t-2xl pb-safe"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          maxHeight: '92dvh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="px-5 pt-2 pb-6 space-y-4">
          <h2 className="font-black text-base" style={{ color: 'var(--t1)' }}>新增交易</h2>

          {/* ── Action ─────────────────────────────────────── */}
          <div>
            <Label>交易類型</Label>
            <div className="flex gap-2">
              {(['BUY','SELL','DCA'] as Action[]).map(a => (
                <button key={a} onClick={() => setAction(a)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: action === a
                      ? (a === 'BUY' ? 'var(--red-dim)' : a === 'SELL' ? 'var(--grn-dim)' : 'var(--gold-dim)')
                      : 'var(--bg-hover)',
                    color: action === a
                      ? (a === 'BUY' ? 'var(--red)' : a === 'SELL' ? 'var(--grn)' : 'var(--gold)')
                      : 'var(--t3)',
                    border: action === a ? `1px solid ${a === 'BUY' ? 'var(--red)' : a === 'SELL' ? 'var(--grn)' : 'var(--gold)'}` : '1px solid transparent',
                  }}>
                  {a === 'BUY' ? '買入' : a === 'SELL' ? '賣出' : '定期定額'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Symbol ─────────────────────────────────────── */}
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
              className="input-base uppercase font-mono"
              autoCapitalize="characters"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
              上市加 .TW，上櫃加 .TWO，ETF 直接輸入代號
            </p>
          </div>

          {/* ── Trade type (full / fractional) ─────────────── */}
          <div>
            <Label>交易方式</Label>
            <div className="flex gap-2">
              {(['FULL','FRACTIONAL'] as TradeType[]).map(t => (
                <button key={t} onClick={() => setTradeType(t)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                  style={{
                    background: tradeType === t ? 'var(--gold-dim)' : 'var(--bg-hover)',
                    color: tradeType === t ? 'var(--gold)' : 'var(--t3)',
                    border: tradeType === t ? '1px solid var(--border-bright)' : '1px solid transparent',
                  }}>
                  {t === 'FULL' ? '整張（1000股）' : '零股'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Quantity ────────────────────────────────────── */}
          <div>
            <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
            <div className="flex items-center gap-3">
              <button onClick={() => tradeType === 'FULL' ? setLots(l => Math.max(1, l-1)) : setShares(s => Math.max(1, s-1))}
                className="btn-ghost w-11 h-11 flex items-center justify-center text-xl font-black rounded-xl">
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={tradeType === 'FULL' ? lots : shares}
                onChange={e => {
                  const v = Math.max(1, parseInt(e.target.value) || 0)
                  tradeType === 'FULL' ? setLots(v) : setShares(v)
                }}
                className="flex-1 text-center font-black font-mono text-2xl input-base"
                style={{ color: 'var(--t1)', background: 'transparent' }}
              />
              <button onClick={() => tradeType === 'FULL' ? setLots(l => l+1) : setShares(s => s+1)}
                className="btn-ghost w-11 h-11 flex items-center justify-center text-xl font-black rounded-xl">
                +
              </button>
            </div>
            <p className="text-xs text-center mt-1 font-mono" style={{ color: 'var(--t3)' }}>
              = {actualShares.toLocaleString()} 股
            </p>
          </div>

          {/* ── Price ───────────────────────────────────────── */}
          <div>
            <Label>成交價（元）</Label>
            <input
              type="number"
              value={price || ''}
              onChange={e => setPrice(Number(e.target.value))}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="input-base font-mono text-lg"
            />
          </div>

          {/* ── Date ────────────────────────────────────────── */}
          <div>
            <Label>交易日期</Label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="input-base font-mono"
              style={{ colorScheme: 'dark' }} />
          </div>

          {/* ── Note ────────────────────────────────────────── */}
          <div>
            <Label>備註（選填）</Label>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="操作筆記…"
              className="input-base" />
          </div>

          {/* ── Fee preview ─────────────────────────────────── */}
          {price > 0 && (
            <div className="rounded-xl p-3 space-y-1.5"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--t2)' }}>費用試算</div>
              <FeeRow label="交易金額" value={fmtMoney(Math.round(amount))} />
              <FeeRow label="手續費"   value={fmtMoney(Math.round(fee))} />
              {tax > 0 && <FeeRow label="交易稅"  value={fmtMoney(Math.round(tax))} />}
              <div className="border-t pt-1.5 flex justify-between"
                style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs font-bold" style={{ color: 'var(--t1)' }}>淨收支</span>
                <span className="font-black font-mono text-sm"
                  style={{ color: net >= 0 ? 'var(--red)' : 'var(--grn)' }}>
                  {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))} 元
                </span>
              </div>
            </div>
          )}

          {/* ── Submit ──────────────────────────────────────── */}
          <button
            onClick={submit}
            disabled={saving || !symbol.trim() || price <= 0}
            className="btn-primary w-full py-4 text-base">
            {saving ? '新增中…' : '✅ 確認新增'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs mb-1.5 block font-semibold" style={{ color: 'var(--t2)' }}>{children}</label>
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span style={{ color: 'var(--t3)' }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--t1)' }}>{value}</span>
    </div>
  )
}
