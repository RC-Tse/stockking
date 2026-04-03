'use client'

import { useState } from 'react'
import { UserSettings } from '@/types'

interface Props {
  settings: UserSettings
  onSignOut: () => Promise<void>
  onSave: (s: UserSettings) => Promise<void>
}

type View = 'MAIN' | 'FEES' | 'GOALS' | 'UI'

export default function SettingsTab({ settings, onSignOut, onSave }: Props) {
  const [view, setView] = useState<View>('MAIN')
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
    setTimeout(() => {
      setSaved(false)
      setView('MAIN')
    }, 1000)
  }

  async function handleSignOut() {
    if (confirm('確定要登出嗎？')) {
      await onSignOut()
    }
  }

  if (view === 'FEES') {
    const effBuy  = form.buy_fee_rate  * form.buy_discount
    const effSell = form.sell_fee_rate * form.sell_discount
    return (
      <div className="p-4 space-y-4 slide-in">
        <button onClick={() => setView('MAIN')} className="text-xs text-gold flex items-center gap-1 font-bold">
          ‹ 返回設定
        </button>
        <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>手續費設定</h2>
        
        <Section title="🏦 券商設定">
          <Field label="券商名稱">
            <input value={form.broker_name} onChange={e => set('broker_name', e.target.value)} className="input-base" />
          </Field>
          <Field label="最低手續費（元）">
            <input type="number" value={form.fee_min} min={1} onChange={e => set('fee_min', Number(e.target.value))} className="input-base font-mono" />
          </Field>
        </Section>

        <Section title="📈 買入手續費">
          <div className="grid grid-cols-2 gap-2">
            <Field label="基礎費率">
              <input type="number" value={form.buy_fee_rate} step="0.000001" onChange={e => set('buy_fee_rate', Number(e.target.value))} className="input-base font-mono" />
            </Field>
            <Field label="折扣（1=無折扣）">
              <input type="number" value={form.buy_discount} step="0.01" min="0.01" max="1" onChange={e => set('buy_discount', Number(e.target.value))} className="input-base font-mono" />
            </Field>
          </div>
          <Rate label="實際買入費率" value={effBuy} />
        </Section>

        <Section title="📉 賣出手續費">
          <div className="grid grid-cols-2 gap-2">
            <Field label="基礎費率">
              <input type="number" value={form.sell_fee_rate} step="0.000001" onChange={e => set('sell_fee_rate', Number(e.target.value))} className="input-base font-mono" />
            </Field>
            <Field label="折扣">
              <input type="number" value={form.sell_discount} step="0.01" min="0.01" max="1" onChange={e => set('sell_discount', Number(e.target.value))} className="input-base font-mono" />
            </Field>
          </div>
          <Rate label="實際賣出費率" value={effSell} />
        </Section>

        <Section title="💰 交易稅與定期定額">
          <div className="grid grid-cols-2 gap-2">
            <Field label="股票交易稅">
              <input type="number" value={form.tax_stock} step="0.0001" onChange={e => set('tax_stock', Number(e.target.value))} className="input-base font-mono" />
            </Field>
            <Field label="ETF 交易稅">
              <input type="number" value={form.tax_etf} step="0.0001" onChange={e => set('tax_etf', Number(e.target.value))} className="input-base font-mono" />
            </Field>
          </div>
          <Field label="定期定額手續費率（單筆）">
            <input type="number" value={form.dca_fee_rate} step="0.000001" onChange={e => set('dca_fee_rate', Number(e.target.value))} className="input-base font-mono" />
          </Field>
        </Section>

        <button onClick={submit} disabled={saving} className="btn-primary w-full py-3.5 mt-4">
          {saving ? '儲存中…' : saved ? '✅ 已儲存！' : '💾 儲存手續費設定'}
        </button>
      </div>
    )
  }

  if (view === 'GOALS') {
    return (
      <div className="p-4 space-y-4 slide-in">
        <button onClick={() => setView('MAIN')} className="text-xs text-gold flex items-center gap-1 font-bold">
          ‹ 返回設定
        </button>
        <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>目標設定</h2>
        
        <Section title="🎯 年度與總目標金額">
          <Field label="年目標金額（元）">
            <input type="number" inputMode="numeric" value={form.year_goal || ''} onChange={e => set('year_goal', Number(e.target.value))} className="input-base font-mono text-lg" placeholder="例如：100000" />
          </Field>
          <Field label="總目標金額（元）">
            <input type="number" inputMode="numeric" value={form.total_goal || ''} onChange={e => set('total_goal', Number(e.target.value))} className="input-base font-mono text-lg" placeholder="例如：10000000" />
          </Field>
        </Section>

        <button onClick={submit} disabled={saving} className="btn-primary w-full py-3.5 mt-4">
          {saving ? '儲存中…' : saved ? '✅ 已儲存！' : '💾 儲存目標設定'}
        </button>
      </div>
    )
  }

  if (view === 'UI') {
    return (
      <div className="p-4 space-y-4 slide-in">
        <button onClick={() => setView('MAIN')} className="text-xs text-gold flex items-center gap-1 font-bold">
          ‹ 返回設定
        </button>
        <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>介面設定</h2>
        
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="text-4xl opacity-50">🛠️</div>
          <p style={{ color: 'var(--t2)' }} className="text-sm font-bold">
            敬請期待
          </p>
        </div>
      </div>
    )
  }

  // MAIN VIEW
  return (
    <div className="p-4 space-y-3">
      <h2 className="text-xl font-black mb-6 px-1" style={{ color: 'var(--t1)' }}>設定</h2>
      
      <ListItem icon="💰" title="手續費設定" subtitle="券商費率、折扣與交易稅" onClick={() => setView('FEES')} />
      <ListItem icon="🎯" title="目標設定" subtitle="年度與總目標金額" onClick={() => setView('GOALS')} />
      <ListItem icon="🎨" title="介面設定" subtitle="外觀與顯示偏好" onClick={() => setView('UI')} />
      
      <div className="pt-4">
        <ListItem icon="👋" title="登出帳號" subtitle="安全登出當前裝置" onClick={handleSignOut} isDanger />
      </div>
    </div>
  )
}

function ListItem({ icon, title, subtitle, onClick, isDanger }: { icon: string; title: string; subtitle: string; onClick: () => void; isDanger?: boolean }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-4 p-4 glass rounded-2xl active:scale-95 transition-all text-left">
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0" style={{ background: isDanger ? 'var(--red-dim)' : 'var(--bg-hover)' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm" style={{ color: isDanger ? 'var(--red)' : 'var(--t1)' }}>{title}</div>
        <div className="text-[10px] truncate" style={{ color: 'var(--t3)' }}>{subtitle}</div>
      </div>
      <div style={{ color: 'var(--t3)' }}>›</div>
    </button>
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
