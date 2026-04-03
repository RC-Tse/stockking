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
          <span className="font-black font-mono text-sm leading-tight text-white">
            {codeOnly(tx.symbol)}
          </span>
          <span className="text-[10px] font-bold truncate text-white/40">
            {tx.name_zh || getStockName(tx.symbol)}
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
  const [tradeType, setTradeType] = useState(tx.shares % 1000 === 0 ? 'FULL' : 'FRACTIONAL')
  const [lots, setLots]     = useState(Math.floor(tx.shares / 1000) || 1)
  const [saving, setSaving] = useState(false)

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
    <div className="glass rounded-xl p-4 space-y-5 border-2 border-gold/40 my-2 slide-up shadow-2xl bg-black/60">
      <div className="flex justify-between items-center">
        <h3 className="font-black text-sm" style={{ color: 'var(--gold)' }}>編輯交易 - {tx.symbol}</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" 
          style={{ background: 'var(--bg-hover)', color: 'var(--t3)' }}>
          {tx.action}
        </span>
      </div>

      {/* 第一區：交易日期 */}
      <div className="flex flex-col items-center">
        <Label>交易日期</Label>
        <input 
          type="date" 
          value={date} 
          onChange={e => setDate(e.target.value)} 
          className="input-base text-center w-48 py-2 text-sm" 
          style={{ colorScheme: 'dark' }} 
        />
      </div>

      {/* 第二區：三個欄位橫排 */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>方式</Label>
          <button 
            onClick={() => setTradeType(prev => prev === 'FULL' ? 'FRACTIONAL' : 'FULL')}
            className="w-full h-10 rounded-lg text-[10px] font-black transition-colors border"
            style={{ 
              background: tradeType === 'FULL' ? 'var(--gold-dim)' : 'var(--bg-hover)',
              color: tradeType === 'FULL' ? 'var(--gold)' : 'var(--t3)',
              borderColor: tradeType === 'FULL' ? 'var(--gold)' : 'var(--border)'
            }}>
            {tradeType === 'FULL' ? '整張' : '零股'}
          </button>
        </div>
        <div>
          <Label>{tradeType === 'FULL' ? '張數' : '股數'}</Label>
          <input 
            type="number" 
            value={tradeType === 'FULL' ? lots : shares} 
            onChange={e => {
              const v = Math.max(1, parseInt(e.target.value) || 0)
              tradeType === 'FULL' ? setLots(v) : setShares(v)
            }} 
            className="w-full input-base text-center h-10 font-mono text-sm" 
          />
        </div>
        <div>
          <Label>成交價</Label>
          <input 
            type="number" 
            step="0.01" 
            value={price} 
            onChange={e => setPrice(Number(e.target.value))} 
            className="w-full input-base text-center h-10 font-mono text-sm" 
          />
        </div>
      </div>
      {tradeType === 'FULL' && (
        <p className="text-[10px] text-center -mt-4 opacity-50 font-mono">
          = {actualShares.toLocaleString()} 股
        </p>
      )}

      {/* 第三區：備註輸入框 */}
      <div>
        <Label>備註</Label>
        <input 
          value={note} 
          onChange={e => setNote(e.target.value)} 
          className="w-full input-base py-2.5 px-3 text-sm" 
          placeholder="點此輸入備註..." 
        />
      </div>

      {/* 第四區：費用試算區塊 */}
      <div className="rounded-xl p-3 space-y-2 bg-white/5 border border-white/10 shadow-inner">
        <div className="flex justify-between text-xs">
          <span style={{ color: 'var(--t3)' }}>手續費</span>
          <span className="font-mono font-bold" style={{ color: 'var(--t1)' }}>{fmtMoney(Math.round(fee))}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--t3)' }}>交易稅</span>
            <span className="font-mono font-bold" style={{ color: 'var(--t1)' }}>{fmtMoney(Math.round(tax))}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-2 border-t border-white/10">
          <span className="text-xs font-black" style={{ color: 'var(--t2)' }}>預估淨收支</span>
          <span className="text-lg font-black font-mono" style={{ color: net >= 0 ? 'var(--red)' : 'var(--grn)' }}>
            {net >= 0 ? '+' : ''}{fmtMoney(Math.round(net))}
          </span>
        </div>
      </div>

      {/* 第五區：取消和儲存修改按鈕 */}
      <div className="flex gap-3 pt-1">
        <button 
          onClick={onCancel} 
          className="flex-1 py-3 rounded-xl font-bold text-sm bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
          style={{ color: 'var(--t2)' }}>
          取消
        </button>
        <button 
          onClick={handleSave} 
          disabled={saving} 
          className="flex-2 py-3 rounded-xl font-black text-sm transition-all active:scale-95 shadow-lg"
          style={{ 
            background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-bright) 100%)',
            color: 'var(--bg-base)',
            boxShadow: '0 4px 15px var(--gold-glow)'
          }}>
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
  return <label className="text-[10px] mb-1 block font-bold opacity-50 uppercase tracking-tight text-center w-full">{children}</label>
}
