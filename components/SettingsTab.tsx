'use client'

import { useState } from 'react'
import { UserSettings } from '@/types'

interface Props {
  settings: UserSettings
  onSave: (s: UserSettings) => Promise<void>
}

export default function SettingsTab({ settings, onSave }: Props) {
  const [form, setForm] = useState<UserSettings>({ ...settings })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function set<K extends keyof UserSettings>(key: K, val: UserSettings[K]) {
    setForm(prev => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  async function submit() {
    setSaving(true)
    await onSave(form)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const effBuy  = form.buy_fee_rate  * form.buy_discount
  const effSell = form.sell_fee_rate * form.sell_discount

  return (
    <div className="p-4 space-y-4">

      {/* ── Broker ──────────────────────────────────────────── */}
      <Section title="🏦 券商與系統設定">
        <Field label="券商名稱">
          <input value={form.broker_name}
            onChange={e => set('broker_name', e.target.value)}
            className="input-base" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="持股上限（檔）">
            <input type="number" value={form.max_holdings} min={1} max={30}
              onChange={e => set('max_holdings', Number(e.target.value))}
              className="input-base" />
          </Field>
          <Field label="字體大小">
            <select value={form.font_size}
              onChange={e => set('font_size', e.target.value as any)}
              className="input-base">
              <option value="small">小 (Small)</option>
              <option value="medium">中 (Medium)</option>
              <option value="large">大 (Large)</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* ── Buy fee ─────────────────────────────────────────── */}
      <Section title="📈 買入手續費">
        <div className="grid grid-cols-2 gap-2">
          <Field label="基礎費率">
            <input type="number" value={form.buy_fee_rate} step="0.000001"
              onChange={e => set('buy_fee_rate', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
          <Field label="折扣（1=無折扣）">
            <input type="number" value={form.buy_discount} step="0.01" min="0.01" max="1"
              onChange={e => set('buy_discount', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
        </div>
        <Rate label="實際買入費率" value={effBuy} />
      </Section>

      {/* ── Sell fee ────────────────────────────────────────── */}
      <Section title="📉 賣出手續費">
        <div className="grid grid-cols-2 gap-2">
          <Field label="基礎費率">
            <input type="number" value={form.sell_fee_rate} step="0.000001"
              onChange={e => set('sell_fee_rate', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
          <Field label="折扣">
            <input type="number" value={form.sell_discount} step="0.01" min="0.01" max="1"
              onChange={e => set('sell_discount', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
        </div>
        <Rate label="實際賣出費率" value={effSell} />
      </Section>

      {/* ── Tax & min ───────────────────────────────────────── */}
      <Section title="💰 稅費設定">
        <div className="grid grid-cols-2 gap-2">
          <Field label="最低手續費（元）">
            <input type="number" value={form.fee_min} min={1}
              onChange={e => set('fee_min', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
          <Field label="股票交易稅">
            <input type="number" value={form.tax_stock} step="0.0001"
              onChange={e => set('tax_stock', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
          <Field label="ETF 交易稅">
            <input type="number" value={form.tax_etf} step="0.0001"
              onChange={e => set('tax_etf', Number(e.target.value))}
              className="input-base font-mono" />
          </Field>
        </div>
      </Section>

      {/* ── Info box ────────────────────────────────────────── */}
      <div className="rounded-xl p-3 text-xs space-y-1"
        style={{ background: 'var(--gold-dim)', border: '1px solid var(--border-bright)', color: 'var(--t2)' }}>
        <p className="font-bold" style={{ color: 'var(--gold)' }}>💡 常見設定參考</p>
        <p>• 國泰/富邦 電子下單：0.001425 × 0.285 ≈ <strong style={{ color: 'var(--t1)' }}>2.85 折</strong></p>
        <p>• 股票賣出交易稅：<strong style={{ color: 'var(--t1)' }}>0.003</strong>（千分之三）</p>
        <p>• ETF 賣出交易稅：<strong style={{ color: 'var(--t1)' }}>0.001</strong>（千分之一）</p>
      </div>

      {/* ── Save ────────────────────────────────────────────── */}
      <button onClick={submit} disabled={saving} className="btn-primary w-full py-3.5">
        {saving ? '儲存中…' : saved ? '✅ 已儲存！' : '💾 儲存設定'}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <h3 className="font-bold text-sm" style={{ color: 'var(--gold)' }}>{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--t2)' }}>{label}</label>
      {children}
    </div>
  )
}

function Rate({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-xs px-3 py-2 rounded-lg font-mono"
      style={{ background: 'var(--bg-hover)', color: 'var(--t2)' }}>
      {label}：<span style={{ color: 'var(--gold)', fontWeight: 700 }}>
        {(value * 100).toFixed(5)}%
      </span>
      <span className="ml-2 opacity-60">
        ≈ {(1 / 0.001425 * value).toFixed(2)} 折
      </span>
    </div>
  )
}
