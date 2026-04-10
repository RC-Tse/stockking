'use client'

import { useState, useEffect } from 'react'
import { UserSettings } from '@/types'
import { 
  Settings as SettingsIcon, 
  Layout, 
  Palette, 
  ChevronRight, 
  ChevronLeft,
  ChevronDown,
  LogOut
} from 'lucide-react'

import DatePicker from './DatePicker'

interface Props {
  settings: UserSettings
  onSignOut: () => Promise<void>
  onSave: (s: UserSettings) => Promise<void>
}

type View = 'MAIN' | 'CALC' | 'UI' | 'GOAL'

const THEMES = [
  { id: 'dark',   name: '深色主題', colors: ['#0A0C10', '#232429', '#D4AF37'] },
  { id: 'light',  name: '淺色主題', colors: ['#F2EFE9', '#E3DDD3', '#B3B492'] },
  { id: 'blue',   name: '藍色主題', colors: ['#F2EFE9', '#003366', '#4682B4'] },
  { id: 'green',  name: '綠色主題', colors: ['#080C07', '#1A2314', '#A4B494'] },
  { id: 'rose',   name: '玫瑰主題', colors: ['#0C0809', '#2D1F21', '#D0A9AF'] },
  { id: 'purple', name: '紫色主題', colors: ['#100818', '#3B2458', '#8B5CF6'] },
] as const

export default function SettingsTab({ settings, onSignOut, onSave }: Props) {
  const [view, setView] = useState<View>('MAIN')
  const [localSettings, setLocalSettings] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [showGoalTypeInfo, setShowGoalTypeInfo] = useState(false)

  // Sync with parent settings when they update (e.g. after localStorage load)
  useEffect(() => { setLocalSettings(settings) }, [settings])

  const handleSave = async (updates: Partial<UserSettings>) => {
    const next = { ...localSettings, ...updates }
    setLocalSettings(next)
    setSaving(true)
    await onSave(next)
    setSaving(false)
  }

  const updateYearGoal = (year: string, goal: number) => {
    const goals = { ...(localSettings.year_goals || {}) }
    goals[year] = goal
    const updates: Partial<UserSettings> = { year_goals: goals }
    if (year === new Date().getFullYear().toString()) {
      updates.year_goal = goal
    }
    handleSave(updates)
  }

  const fmtMoney = (val: number) => val.toLocaleString()

  const handleThemeChange = async (themeId: UserSettings['theme']) => {
    document.documentElement.setAttribute('data-theme', themeId)
    const icon = document.querySelector('link[rel="apple-touch-icon"]')
    if (icon) {
      const isLightIcon = themeId === 'light' || themeId === 'rose'
      icon.setAttribute('href', isLightIcon ? '/icons/icon-192-light.svg' : '/icons/icon-192.svg')
    }
    await handleSave({ theme: themeId })
  }

  const renderSaveButton = () => (
    <button 
      onClick={async () => {
        setSaving(true)
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify(localSettings)
          })
          if (!res.ok) throw new Error()
          setSaveStatus('✅ 已儲存')
          setTimeout(() => setSaveStatus(null), 2000)
          await onSave(localSettings)
        } catch (e) {
          setSaveStatus('❌ 儲存失敗')
          setTimeout(() => setSaveStatus(null), 2000)
        } finally {
          setSaving(false)
        }
      }}
      disabled={saving}
      className="w-full mt-4 py-4 rounded-2xl bg-accent text-[var(--bg-base)] font-extrabold text-[15px] active:scale-[0.98] transition-all shadow-lg shadow-accent/10 disabled:opacity-50"
    >
      {saving ? '儲存中...' : (saveStatus || '儲存設定')}
    </button>
  )

  const availableYears = ['2023', '2024', '2025', '2026', '2027']

  return (
    <div className="p-4 space-y-6 pb-32">
      {view === 'MAIN' && (
        <>
          <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl overflow-hidden shadow-2xl">
            <button 
              onClick={() => setView('GOAL')}
              className="w-full flex items-center justify-between group p-6 border-b border-white/5 active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-4">
                <SettingsIcon size={20} className="text-accent" />
                <div className="text-left">
                  <div className="text-[15px] font-black text-[var(--t1)]">目標設定</div>
                  <div className="text-[12px] text-[var(--t2)] opacity-60 mt-1 uppercase tracking-wide">設定年度與資產目標</div>
                </div>
              </div>
              <ChevronRight size={18} className="text-[var(--t2)] opacity-30 group-active:text-accent transition-colors" />
            </button>

            <button 
              onClick={() => setView('UI')}
              className="w-full flex items-center justify-between group p-6 border-b border-white/5 active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-4">
                <Palette size={20} className="text-accent" />
                <div className="text-left">
                  <div className="text-[15px] font-black text-[var(--t1)]">介面主題</div>
                  <div className="text-[12px] text-[var(--t2)] opacity-60 mt-1 uppercase tracking-wide">目前: {THEMES.find(t => t.id === localSettings.theme)?.name || '預設'}</div>
                </div>
              </div>
              <ChevronRight size={18} className="text-[var(--t2)] opacity-30 group-active:text-accent transition-colors" />
            </button>

            <button 
              onClick={() => setView('CALC')}
              className="w-full flex items-center justify-between group p-6 active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-4">
                <Layout size={20} className="text-accent" />
                <div className="text-left">
                  <div className="text-[15px] font-black text-[var(--t1)]">手續費設定</div>
                  <div className="text-[12px] text-[var(--t2)] opacity-60 mt-1 uppercase tracking-wide">調整手續費與稅率</div>
                </div>
              </div>
              <ChevronRight size={18} className="text-[var(--t2)] opacity-30 group-active:text-accent transition-colors" />
            </button>
          </div>

          <section className="pt-4">
            <button 
              onClick={onSignOut}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-[15px] text-red-400 bg-red-400/5 border border-red-400/10 active:bg-red-400/10 active:scale-[0.98] transition-all"
            >
              <LogOut size={18} />
              登出帳號
            </button>
            <p className="text-center text-[13px] md:text-[11px] text-[var(--t3)] mt-6 font-mono tracking-tighter">
              STOCK KING v0.1.0 · PWA READY
            </p>
          </section>
        </>
      )}

      {view === 'GOAL' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <button onClick={() => setView('MAIN')} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-accent active:bg-white/10 transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-[13px] font-black text-[var(--t2)] uppercase tracking-[0.2em]">投資目標設定</h3>
          </div>

          <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-6 space-y-8 shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>年度損益目標 (TWD)</Label>
                <select 
                  value={editingYear}
                  onChange={e => setEditingYear(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1 text-[12px] font-black text-accent outline-none"
                >
                  {availableYears.map(y => <option key={y} value={y}>{y} 年</option>)}
                </select>
              </div>
              
              <input 
                type="number" inputMode="numeric"
                value={localSettings.year_goals?.[editingYear] || ''} 
                onChange={e => updateYearGoal(editingYear, Number(e.target.value))}
                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-4 text-[17px] font-black font-mono text-[var(--t1)] outline-none focus:border-accent transition-all"
                placeholder={`設定 ${editingYear} 年度目標`}
              />
              <p className="text-[12px] text-[#EAD8B1] opacity-50 font-medium leading-relaxed">
                正在設定 <span className="text-accent font-bold">{editingYear}</span> 年度的投資獲利目標。
              </p>

              {/* History Section */}
              <div className="pt-2">
                <button 
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-2 text-[11px] font-black text-[var(--t3)] hover:text-accent transition-colors uppercase tracking-widest"
                >
                  {showHistory ? <ChevronDown size={14} className="rotate-0 transition-transform" /> : <ChevronRight size={14} className="rotate-0 transition-transform" />} 歷年目標紀錄
                </button>
                
                {showHistory && (
                  <div className="mt-3 space-y-2 pl-2 border-l-2 border-white/5 animate-in fade-in slide-in-from-top-2">
                     {Object.entries(localSettings.year_goals || {}).sort((a,b) => b[0].localeCompare(a[0])).map(([y, g]) => (
                       <div key={y} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                         <span className="text-[12px] font-bold text-[var(--t2)]">{y} 年</span>
                         <span className="text-[13px] font-mono font-black text-accent">{fmtMoney(g)}</span>
                       </div>
                     ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-white/5">
              <Label>總損益目標 (TWD)</Label>
              <input 
                type="number" inputMode="numeric"
                value={localSettings.total_goal || ''} 
                onChange={e => handleSave({ total_goal: Number(e.target.value) })}
                className="input-base text-[16px] md:text-sm font-black font-mono"
                placeholder="例如: 1000000"
              />
              <p className="text-[12px] text-[#EAD8B1] opacity-50 font-medium leading-relaxed">
                設定您長期的總累積損益目標。
              </p>
            </div>
            <div className="space-y-3">
              <Label>總目標起始日</Label>
              <DatePicker 
                value={localSettings.total_goal_start_date} 
                onChange={val => handleSave({ total_goal_start_date: val })} 
              />
              <p className="text-[12px] text-[#EAD8B1] opacity-50 font-medium leading-relaxed">
                設定總損益目標的計算起點。
              </p>
            </div>
          </div>
          {renderSaveButton()}
        </div>
      )}

      {view === 'UI' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <h3 className="text-[13px] font-black text-[var(--t2)] uppercase tracking-[0.2em]">介面主題設定</h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {THEMES.map(theme => (
              <button
                key={theme.id}
                onClick={() => handleThemeChange(theme.id)}
                className={`flex flex-col text-left bg-[var(--bg-card)] p-5 rounded-2xl border-2 transition-all active:scale-95 shadow-xl ${localSettings.theme === theme.id ? 'border-accent shadow-[0_0_20px_var(--accent-dim)]' : 'border-transparent'}`}
              >
                <div className="flex gap-2 mb-4">
                  {theme.colors.map((c, idx) => (
                    <div key={idx} className="w-5 h-5 rounded-full border border-white/10" style={{ background: c }} />
                  ))}
                </div>
                <span className={`text-[13px] font-black tracking-wide ${localSettings.theme === theme.id ? 'text-accent' : 'text-[var(--t2)] opacity-80'}`}>{theme.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'CALC' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <h3 className="text-[13px] font-black text-[var(--t2)] uppercase tracking-[0.2em]">手續費設定</h3>
          </div>

          <div className="bg-[var(--bg-card)] border-[0.5px] border-[var(--border-bright)] rounded-2xl p-6 space-y-10 shadow-2xl">
            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-accent/50 uppercase tracking-widest border-b border-accent/10 pb-2">買入手續費</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>買入手續費費率</Label>
                  <input type="number" step="0.000001" value={localSettings.buy_fee_rate} onChange={e => setLocalSettings(p => ({ ...p, buy_fee_rate: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>買入折扣</Label>
                  <input type="number" step="0.05" value={localSettings.buy_discount} onChange={e => setLocalSettings(p => ({ ...p, buy_discount: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-accent/50 uppercase tracking-widest border-b border-accent/10 pb-2">賣出手續費 & 稅</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>賣出手續費費率</Label>
                  <input type="number" step="0.000001" value={localSettings.sell_fee_rate} onChange={e => setLocalSettings(p => ({ ...p, sell_fee_rate: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>賣出折扣</Label>
                  <input type="number" step="0.05" value={localSettings.sell_discount} onChange={e => setLocalSettings(p => ({ ...p, sell_discount: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>股票交易稅</Label>
                  <input type="number" step="0.001" value={localSettings.tax_stock} onChange={e => setLocalSettings(p => ({ ...p, tax_stock: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>ETF 交易稅</Label>
                  <input type="number" step="0.001" value={localSettings.tax_etf} onChange={e => setLocalSettings(p => ({ ...p, tax_etf: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[11px] font-black text-accent/50 uppercase tracking-widest border-b border-accent/10 pb-2">定期定額</h4>
              <div className="space-y-2">
                <Label>定期定額手續費 (每筆 TWD)</Label>
                <input type="number" inputMode="decimal" value={localSettings.dca_fee_min ?? ''} onChange={e => setLocalSettings(p => ({ ...p, dca_fee_min: Number(e.target.value) }))} className="input-base font-mono text-[16px] md:text-sm" />
              </div>
            </div>
          </div>

          {renderSaveButton()}
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] font-black mb-2 block text-[#EAD8B1] opacity-60 uppercase tracking-[0.15em] ml-1">{children}</label>
}
