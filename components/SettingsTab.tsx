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
    try {
      await onSave(form)
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        setView('MAIN')
      }, 1000)
    } catch (err) {
      alert('儲存失敗，請檢查網路連線')
    } finally {
      setSaving(false)
    }
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
      <div className="p-4 space-y-6 slide-in">
        <button onClick={() => setView('MAIN')} className="text-xs text-gold flex items-center gap-1 font-black bg-gold/10 px-3 py-1.5 rounded-full active:scale-95 transition-all">
          ‹ 返回設定
        </button>
        <h2 className="text-2xl font-black text-white px-1">手續費設定</h2>
        
        <div className="space-y-4">
          <Section title="🏦 券商設定">
            <Field label="券商名稱">
              <input value={form.broker_name} onChange={e => set('broker_name', e.target.value)} className="input-base font-bold" />
            </Field>
            <Field label="最低手續費（元）">
              <input type="number" value={form.fee_min} min={1} onChange={e => set('fee_min', Number(e.target.value))} className="input-base font-black font-mono" />
            </Field>
          </Section>

          <Section title="📈 買入手續費">
            <div className="grid grid-cols-2 gap-3">
              <Field label="基礎費率">
                <input type="number" value={form.buy_fee_rate} step="0.000001" onChange={e => set('buy_fee_rate', Number(e.target.value))} className="input-base font-black font-mono" />
              </Field>
              <Field label="折扣">
                <input type="number" value={form.buy_discount} step="0.01" min="0.01" max="1" onChange={e => set('buy_discount', Number(e.target.value))} className="input-base font-black font-mono" />
              </Field>
            </div>
            <Rate label="實際買入費率" value={effBuy} />
          </Section>

          <Section title="📉 賣出手續費">
            <div className="grid grid-cols-2 gap-3">
              <Field label="基礎費率">
                <input type="number" value={form.sell_fee_rate} step="0.000001" onChange={e => set('sell_fee_rate', Number(e.target.value))} className="input-base font-black font-mono" />
              </Field>
              <Field label="折扣">
                <input type="number" value={form.sell_discount} step="0.01" min="0.01" max="1" onChange={e => set('sell_discount', Number(e.target.value))} className="input-base font-black font-mono" />
              </Field>
            </div>
            <Rate label="實際賣出費率" value={effSell} />
          </Section>

          <Section title="💰 交易稅">
            <div className="grid grid-cols-2 gap-3">
              <Field label="股票交易稅">
                <input type="number" value={form.tax_stock} step="0.0001" onChange={e => set('tax_stock', Number(e.target.value))} className="input-base font-black font-mono" />
              </Field>
              <Field label="ETF 交易稅">
                <input type="number" value={form.tax_etf} step="0.0001" onChange={e => set('tax_etf', Number(e.target.value))} className="input-base font-black font-mono" />
              </Field>
            </div>
          </Section>
        </div>

        <button onClick={submit} disabled={saving} className="btn-primary w-full py-4 rounded-2xl font-black text-lg active:scale-95 transition-all">
          {saving ? '處理中…' : saved ? '✅ 設定已更新' : '💾 儲存費率設定'}
        </button>
      </div>
    )
  }

  if (view === 'GOALS') {
    return (
      <div className="p-4 space-y-6 slide-in">
        <button onClick={() => setView('MAIN')} className="text-xs text-gold flex items-center gap-1 font-black bg-gold/10 px-3 py-1.5 rounded-full active:scale-95 transition-all">
          ‹ 返回設定
        </button>
        <h2 className="text-2xl font-black text-white px-1">目標設定</h2>
        
        <div className="space-y-4">
          <Section title="🎯 年度與總投資目標">
            <Field label="年獲利目標（元）">
              <input type="number" inputMode="numeric" value={form.year_goal || ''} onChange={e => set('year_goal', Number(e.target.value))} className="input-base font-black font-mono text-xl py-4" placeholder="例如：100000" />
              <p className="text-[10px] mt-2 text-white/20 font-bold tracking-wider">用於計算持股頁面的「今年損益達成率」</p>
            </Field>
            <Field label="總市值目標（元）">
              <input type="number" inputMode="numeric" value={form.total_goal || ''} onChange={e => set('total_goal', Number(e.target.value))} className="input-base font-black font-mono text-xl py-4" placeholder="例如：10000000" />
              <p className="text-[10px] mt-2 text-white/20 font-bold tracking-wider">用於計算持股頁面的「資產總目標達成率」</p>
            </Field>
          </Section>
        </div>

        <button onClick={submit} disabled={saving} className="btn-primary w-full py-4 rounded-2xl font-black text-lg active:scale-95 transition-all">
          {saving ? '處理中…' : saved ? '✅ 目標已更新' : '💾 儲存目標設定'}
        </button>
      </div>
    )
  }

  if (view === 'UI') {
    return (
      <div className="p-4 space-y-6 slide-in">
        <button onClick={() => setView('MAIN')} className="text-xs text-gold flex items-center gap-1 font-black bg-gold/10 px-3 py-1.5 rounded-full active:scale-95 transition-all">
          ‹ 返回設定
        </button>
        <h2 className="text-2xl font-black text-white px-1">介面設定</h2>
        
        <div className="flex flex-col items-center justify-center py-24 gap-4 glass rounded-[2.5rem] border border-white/5 bg-white/[0.02]">
          <div className="text-6xl animate-bounce">🛠️</div>
          <p className="text-white/40 text-sm font-black tracking-[0.2em]">
            COMING SOON
          </p>
        </div>
      </div>
    )
  }

  // MAIN VIEW
  return (
    <div className="p-4 space-y-4 pb-32">
      <h2 className="text-3xl font-black text-white px-1 mb-8">設定</h2>
      
      <div className="space-y-3">
        <ListItem icon="💰" title="手續費設定" subtitle="券商費率、折扣與交易稅" onClick={() => setView('FEES')} />
        <ListItem icon="🎯" title="目標設定" subtitle="自訂年度獲利與總市值目標" onClick={() => setView('GOALS')} />
        <ListItem icon="🎨" title="介面設定" subtitle="自訂應用程式視覺效果" onClick={() => setView('UI')} />
      </div>
      
      <div className="pt-8">
        <button onClick={handleSignOut} className="w-full flex items-center justify-between p-5 glass rounded-2xl border border-red-400/10 active:scale-95 transition-all text-left bg-red-400/[0.02]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl bg-red-400/10">👋</div>
            <div>
              <div className="font-black text-red-400 text-lg">登出帳號</div>
              <div className="text-red-400/40 text-[10px] font-bold tracking-widest uppercase">Sign out of account</div>
            </div>
          </div>
          <div className="text-red-400/20 text-xl">›</div>
        </button>
      </div>
    </div>
  )
}

function ListItem({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between p-5 glass rounded-2xl border border-white/5 active:scale-95 transition-all text-left group hover:border-white/10">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl bg-white/5 group-hover:bg-white/10 transition-colors">
          {icon}
        </div>
        <div>
          <div className="font-black text-white text-lg tracking-tight">{title}</div>
          <div className="text-white/30 text-[10px] font-bold tracking-wide">{subtitle}</div>
        </div>
      </div>
      <div className="text-white/10 group-hover:text-gold/40 text-xl transition-colors">›</div>
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-[2rem] p-6 space-y-5 border border-white/5 bg-white/[0.02]">
      <h3 className="font-black text-xs text-gold uppercase tracking-[0.3em] ml-1 opacity-80">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.15em] ml-1">{label}</label>
      {children}
    </div>
  )
}

function Rate({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-[10px] px-4 py-3 rounded-xl font-black bg-white/5 border border-white/5 flex justify-between items-center">
      <span className="text-white/30 uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-gold">{(value * 100).toFixed(5)}%</span>
        <span className="text-white/10 text-[8px] font-bold">({(1 / 0.001425 * value).toFixed(2)} 折)</span>
      </div>
    </div>
  )
}
