'use client'

import { useState } from 'react'
import { Transaction, UserSettings, codeOnly, fmtMoney, getStockName, calcFee, calcTax } from '@/types'

interface Props {
  txs: Transaction[]
  settings: UserSettings
  onRefresh: () => void
}

const ACTION_LABEL: Record<string, string> = {
  BUY: '買入', SELL: '賣出', DCA: '定期定額',
}
const ACTION_COLOR: Record<string, string> = {
  BUY: 'text-red-400', SELL: 'text-green-400', DCA: 'text-gold',
}
const ACTION_BG: Record<string, string> = {
  BUY: 'bg-red-400/10', SELL: 'bg-green-400/10', DCA: 'bg-gold/10',
}

export default function TransactionsTab({ txs, settings, onRefresh }: Props) {
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)

  const filtered = filter.trim()
    ? txs.filter(t => 
        codeOnly(t.symbol).includes(filter.toUpperCase()) || 
        t.symbol.includes(filter.toUpperCase()) ||
        (t.name_zh || getStockName(t.symbol)).includes(filter)
      )
    : txs

  async function deleteTx(id: number) {
    if (!confirm('確定刪除這筆交易紀錄？')) return
    setDeleting(id)
    await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    onRefresh()
    setDeleting(null)
  }

  return (
    <div className="p-4 space-y-3 pb-32">
      {/* Search */}
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="輸入代號或名稱篩選…"
        className="input-base"
      />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="text-4xl opacity-20">🗒️</div>
          <p className="text-sm text-white/40">
            {filter ? '查無符合的紀錄' : '尚無交易紀錄'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(tx => (
            <TxRow 
              key={tx.id} 
              tx={tx} 
              settings={settings}
              deleting={deleting === tx.id} 
              onDelete={() => deleteTx(tx.id)} 
              onUpdated={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({ tx, settings, deleting, onDelete, onUpdated }: { 
  tx: Transaction; settings: UserSettings; deleting: boolean; onDelete: () => void; onUpdated: () => void 
}) {
  const [open, setOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  
  const color  = ACTION_COLOR[tx.action] ?? 'text-white/60'
  const bgColor = ACTION_BG[tx.action] ?? 'bg-white/5'

  if (isEditing) {
    return (
      <EditForm 
        tx={tx} 
        settings={settings} 
        onCancel={() => setIsEditing(false)} 
        onSaved={() => {
          setIsEditing(false)
          onUpdated()
        }}
      />
    )
  }

  return (
    <div className={`glass rounded-xl overflow-hidden border border-white/5 transition-all ${open ? 'border-white/20' : ''}`} style={{ opacity: deleting ? 0.5 : 1 }}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-white/5" onClick={() => setOpen(!open)}>
        {/* Action badge */}
        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${bgColor} ${color}`}>
          {ACTION_LABEL[tx.action] ?? tx.action}
        </span>

        {/* Symbol + Name */}
        <div className="flex flex-col min-w-0">
          <span className="font-black font-mono text-sm leading-tight text-white">
            {codeOnly(tx.symbol)}
          </span>
          <span className="text-[10px] font-bold truncate text-white/40">
            {tx.name_zh || getStockName(tx.symbol)}
          </span>
        </div>

        {/* Date */}
        <span className="text-[11px] flex-1 ml-1 text-white/30">{tx.trade_date}</span>

        {/* Net amount */}
        <span className={`font-bold font-mono text-sm shrink-0 ${tx.net_amount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
          {tx.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(tx.net_amount))}
        </span>

        <span className={`text-white/20 text-[10px] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3 border-t border-white/5 bg-white/[0.02]">
          <div className="grid grid-cols-3 gap-2 pt-3">
            <Detail label="股數"  value={`${tx.shares.toLocaleString()} 股`} />
            <Detail label="成交價" value={`${Number(tx.price).toFixed(2)}`} />
            <Detail label="金額"  value={fmtMoney(Math.round(tx.amount))} />
            <Detail label="手續費" value={fmtMoney(Math.round(tx.fee))} />
            <Detail label="交易稅" value={fmtMoney(Math.round(tx.tax))} />
            <Detail label="類型"  value={tx.trade_type} />
          </div>
          {tx.note && (
            <div className="text-[11px] px-2 py-1.5 rounded-lg bg-white/5 text-white/50 border border-white/5 italic">
              💬 {tx.note}
            </div>
          )}
          
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 text-xs py-2 rounded-lg font-bold bg-gold-dim text-gold border border-gold/20 active:scale-95 transition-transform">
              ✏️ 編輯
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="flex-1 text-xs py-2 rounded-lg font-bold bg-red-400/10 text-red-400 border border-red-400/20 active:scale-95 transition-transform">
              {deleting ? '刪除中…' : '🗑️ 刪除'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditForm({ tx, settings, onCancel, onSaved }: { 
  tx: Transaction; settings: UserSettings; onCancel: () => void; onSaved: () => void 
}) {
  const [date, setDate]     = useState(tx.trade_date)
  const [shares, setShares] = useState(tx.shares)
  const [price, setPrice]   = useState(tx.price)
  const [note, setNote]     = useState(tx.note || '')
  const [saving, setSaving] = useState(false)
  const [tradeType, setTradeType] = useState(tx.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots]     = useState(Math.floor(tx.shares / 1000) || 1)

  const actualShares = tradeType === 'FULL' ? lots * 1000 : shares
  const amount = actualShares * price
  const fee    = calcFee(amount, settings, tx.action === 'SELL')
  const tax    = tx.action === 'SELL' ? calcTax(amount, tx.symbol, settings) : 0
  const net    = (tx.action === 'BUY' || tx.action === 'DCA') ? -(amount + fee) : (amount - fee - tax)

  async function handleSave() {
    if (actualShares <= 0 || price <= 0) return
    setSaving(true)
    const r = await fetch('/api/transactions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tx.id, trade_date: date, shares: actualShares, price, note })
    })
    if (r.ok) onSaved()
    setSaving(false)
  }

  return (
    <div className="glass rounded-xl p-4 space-y-5 border-2 border-gold/40 my-2 slide-up bg-[#0d1018]">
      <div className="flex justify-between items-center">
        <h3 className="font-black text-sm text-gold">編輯交易 - {tx.symbol}</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 text-white/40 border border-white/5 uppercase">
          {tx.action}
        </span>
      </div>

      <div className="flex flex-col items-center">
        <Label>交易日期</Label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base text-center w-full py-2 text-sm" style={{ colorScheme: 'dark' }} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>方式</Label>
          <button onClick={() => setTradeType(prev => prev === 'FULL' ? 'FRACTIONAL' : 'FULL')} className={`w-full h-10 rounded-lg text-[10px] font-black transition-colors border ${tradeType === 'FULL' ? 'bg-gold-dim text-gold border-gold' : 'bg-white/5 text-white/40 border-white/10'}`}>{tradeType === 'FULL' ? '整張' : '零股'}</button>
        </div>
        <div>
          <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
          <input type="number" value={tradeType === 'FULL' ? lots : shares} onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 0); tradeType === 'FULL' ? setLots(v) : setShares(v) }} className="w-full input-base text-center h-10 font-mono text-sm" />
        </div>
        <div>
          <Label>成交價</Label>
          <input type="number" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-full input-base text-center h-10 font-mono text-sm" />
        </div>
      </div>

      <div>
        <Label>備註</Label>
        <input value={note} onChange={e => setNote(e.target.value)} className="w-full input-base py-2.5 px-3 text-sm" placeholder="點此輸入備註..." />
      </div>

      <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10">
        <div className="flex justify-between text-xs">
          <span className="opacity-40">手續費</span>
          <span className="font-mono font-bold text-white">{fmtMoney(Math.round(fee))}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between text-xs">
            <span className="opacity-40">交易稅</span>
            <span className="font-mono font-bold text-white">{fmtMoney(Math.round(tax))}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-2 border-t border-white/5">
          <span className="text-xs font-black opacity-60">預估淨收支</span>
          <span className={`text-lg font-black font-mono ${net >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
          </span>
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="flex-1 py-3 rounded-xl font-bold text-sm bg-white/5 text-white/60 border border-white/10 active:scale-95 transition-transform">取消</button>
        <button onClick={handleSave} disabled={saving} className="flex-2 py-3 rounded-xl font-black text-sm bg-gold text-base active:scale-95 transition-transform">{saving ? '儲存中...' : '儲存修改'}</button>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold opacity-30 uppercase tracking-tighter mb-0.5">{label}</div>
      <div className="font-mono text-[11px] font-bold text-white/80">{value}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[9px] mb-1 block font-bold opacity-30 uppercase tracking-widest text-center w-full">{children}</label>
}
