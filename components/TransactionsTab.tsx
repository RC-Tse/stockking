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
  BUY: 'var(--red)', SELL: 'var(--grn)', DCA: 'var(--gold)',
}
const ACTION_BG: Record<string, string> = {
  BUY: 'var(--red-dim)', SELL: 'var(--grn-dim)', DCA: 'var(--gold-dim)',
}

export default function TransactionsTab({ txs, settings, onRefresh }: Props) {
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)

  const filtered = filter.trim()
    ? txs.filter(t => 
        codeOnly(t.symbol).includes(filter.toUpperCase()) || 
        t.symbol.includes(filter.toUpperCase()) ||
        getStockName(t.symbol).includes(filter)
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
    <div className="p-4 space-y-3">
      {/* Search */}
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="輸入代號或名稱篩選…"
        className="input-base"
      />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="text-4xl">🗒️</div>
          <p style={{ color: 'var(--t2)' }} className="text-sm">
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
  
  const color  = ACTION_COLOR[tx.action] ?? 'var(--t2)'
  const bgColor = ACTION_BG[tx.action] ?? 'var(--bg-hover)'

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
    <div className="glass rounded-xl overflow-hidden" style={{ opacity: deleting ? 0.5 : 1 }}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        {/* Action badge */}
        <span className="text-xs font-bold px-2 py-1 rounded-lg shrink-0"
          style={{ background: bgColor, color }}>
          {ACTION_LABEL[tx.action] ?? tx.action}
        </span>

        {/* Symbol + Name */}
        <div className="flex flex-col min-w-0">
          <span className="font-black font-mono text-sm leading-tight" style={{ color: 'var(--t1)' }}>
            {codeOnly(tx.symbol)}
          </span>
          <span className="text-[10px] font-bold truncate opacity-60" style={{ color: 'var(--t1)' }}>
            {getStockName(tx.symbol)}
          </span>
        </div>

        {/* Date */}
        <span className="text-xs flex-1 ml-1" style={{ color: 'var(--t3)' }}>{tx.trade_date}</span>

        {/* Net amount */}
        <span className="font-bold font-mono text-sm shrink-0"
          style={{ color: tx.net_amount >= 0 ? 'var(--red)' : 'var(--grn)' }}>
          {tx.net_amount >= 0 ? '+' : ''}{fmtMoney(Math.round(tx.net_amount))}
        </span>

        <span style={{ color: 'var(--t3)', fontSize: 11, transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="grid grid-cols-3 gap-2 pt-2">
            <Detail label="股數"  value={`${tx.shares.toLocaleString()} 股`} />
            <Detail label="成交價" value={`${Number(tx.price).toFixed(2)}`} />
            <Detail label="金額"  value={fmtMoney(Math.round(tx.amount))} />
            <Detail label="手續費" value={fmtMoney(Math.round(tx.fee))} />
            <Detail label="交易稅" value={fmtMoney(Math.round(tx.tax))} />
            <Detail label="類型"  value={tx.trade_type} />
          </div>
          {tx.note && (
            <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: 'var(--bg-hover)', color: 'var(--t2)' }}>
              💬 {tx.note}
            </div>
          )}
          
          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="btn-ghost flex-1 text-sm py-2"
              style={{ color: 'var(--gold)', borderColor: 'var(--gold-dim)' }}>
              ✏️ 編輯
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="btn-ghost flex-1 text-sm py-2"
              style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}>
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

  const amount = shares * price
  const fee    = calcFee(amount, settings, tx.action === 'SELL')
  const tax    = tx.action === 'SELL' ? calcTax(amount, tx.symbol, settings) : 0
  const net    = (tx.action === 'BUY' || tx.action === 'DCA') ? -(amount + fee) : (amount - fee - tax)

  async function handleSave() {
    if (shares <= 0 || price <= 0) return
    setSaving(true)
    const r = await fetch('/api/transactions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tx.id, trade_date: date, shares, price, note })
    })
    if (r.ok) onSaved()
    setSaving(false)
  }

  return (
    <div className="glass rounded-xl p-4 space-y-4 border-2" style={{ borderColor: 'var(--gold-dim)' }}>
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-sm" style={{ color: 'var(--gold)' }}>編輯交易 - {tx.symbol}</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" 
          style={{ background: 'var(--bg-hover)', color: 'var(--t3)' }}>
          {tx.action}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <Label>交易日期</Label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base text-sm" style={{ colorScheme: 'dark' }} />
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>股數</Label>
            <input type="number" value={shares} onChange={e => setShares(Number(e.target.value))} className="input-base text-sm font-mono" />
          </div>
          <div>
            <Label>成交價</Label>
            <input type="number" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} className="input-base text-sm font-mono" />
          </div>
        </div>

        <div>
          <Label>備註</Label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="備註..." className="input-base text-sm" />
        </div>

        {/* Preview */}
        <div className="rounded-lg p-2.5 space-y-1" style={{ background: 'var(--bg-hover)' }}>
          <div className="flex justify-between text-[10px]">
            <span style={{ color: 'var(--t3)' }}>手續費</span>
            <span style={{ color: 'var(--t1)' }}>{fmtMoney(Math.round(fee))}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between text-[10px]">
              <span style={{ color: 'var(--t3)' }}>交易稅</span>
              <span style={{ color: 'var(--t1)' }}>{fmtMoney(Math.round(tax))}</span>
            </div>
          )}
          <div className="flex justify-between text-xs font-bold pt-1 border-t border-white/5">
            <span style={{ color: 'var(--t1)' }}>淨收支</span>
            <span style={{ color: net >= 0 ? 'var(--red)' : 'var(--grn)' }}>
              {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-ghost flex-1 py-2 text-sm">取消</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2 text-sm">
          {saving ? '儲存中...' : '儲存修改'}
        </button>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--t3)' }}>{label}</div>
      <div className="font-mono text-xs font-bold" style={{ color: 'var(--t1)' }}>{value}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] mb-1 block font-bold" style={{ color: 'var(--t3)' }}>{children}</label>
}
