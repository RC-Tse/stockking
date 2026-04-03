'use client'

import { useState } from 'react'
import { Transaction, codeOnly, fmtMoney, getStockName } from '@/types'

interface Props {
  txs: Transaction[]
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

export default function TransactionsTab({ txs, onRefresh }: Props) {
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
            <TxRow key={tx.id} tx={tx} deleting={deleting === tx.id} onDelete={() => deleteTx(tx.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({ tx, deleting, onDelete }: { tx: Transaction; deleting: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const color  = ACTION_COLOR[tx.action] ?? 'var(--t2)'
  const bgColor = ACTION_BG[tx.action] ?? 'var(--bg-hover)'

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
        <div className="px-4 pb-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
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
          <button
            onClick={onDelete}
            disabled={deleting}
            className="btn-ghost w-full text-sm py-2"
            style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}>
            {deleting ? '刪除中…' : '🗑️ 刪除此筆'}
          </button>
        </div>
      )}
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
