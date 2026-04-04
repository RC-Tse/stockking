'use client'

import { useState, useMemo } from 'react'
import { UserSettings } from '@/types'
import { 
  Settings as SettingsIcon, 
  Layout, 
  Palette, 
  ChevronRight, 
  ChevronLeft,
  LogOut
} from 'lucide-react'

interface Props {
  settings: UserSettings
  onSignOut: () => Promise<void>
  onSave: (s: UserSettings) => Promise<void>
}

type View = 'MAIN' | 'CALC' | 'UI' | 'GOAL'

const THEMES = [
  { id: 'luxury', name: '深色奢華', colors: ['#080a0e', '#161c28', '#d4af37'] },
  { id: 'minimal', name: '極簡現代', colors: ['#111214', '#202124', '#a0a8b8'] },
  { id: 'tech', name: '科技感', colors: ['#050d14', '#0c1e30', '#00c8b4'] },
  { id: 'morandi', name: '溫潤質感', colors: ['#0d1018', '#1a2030', '#c9a564'] },
]

export default function SettingsTab({ settings, onSignOut, onSave }: Props) {
  const [view, setView] = useState<View>('MAIN')
  const [localSettings, setLocalSettings] = useState(settings)
  const [saving, setSaving] = useState(false)

  const handleSave = async (updates: Partial<UserSettings>) => {
    const next = { ...localSettings, ...updates }
    setLocalSettings(next)
    setSaving(true)
    await onSave(next)
    setSaving(false)
  }

  const handleThemeChange = (themeId: any) => {
    handleSave({ theme: themeId })
  }

  return (
    <div className="p-4 space-y-6 pb-32">
      {view === 'MAIN' && (
        <>
          <div className="glass overflow-hidden border border-white/5">
            <button 
              onClick={() => setView('GOAL')}
              className="w-full flex items-center justify-between group p-5 border-b border-white/5 active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <SettingsIcon size={18} className="text-gold" />
                <div className="text-left">
                  <div className="text-[15px] md:text-[13px] font-black text-white">目標設定</div>
                  <div className="text-[14px] md:text-[12px] text-white/20 mt-0.5">設定年度與資產目標</div>
                </div>
              </div>
              <ChevronRight size={18} className="text-white/20 group-active:text-gold transition-colors" />
            </button>

            <button 
              onClick={() => setView('UI')}
              className="w-full flex items-center justify-between group p-5 border-b border-white/5 active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Palette size={18} className="text-gold" />
                <div className="text-left">
                  <div className="text-[15px] md:text-[13px] font-black text-white">介面主題</div>
                  <div className="text-[14px] md:text-[12px] text-white/20 mt-0.5">目前: {THEMES.find(t => t.id === localSettings.theme)?.name || '預設'}</div>
                </div>
              </div>
              <ChevronRight size={18} className="text-white/20 group-active:text-gold transition-colors" />
            </button>

            <button 
              onClick={() => setView('CALC')}
              className="w-full flex items-center justify-between group p-5 active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Layout size={18} className="text-gold" />
                <div className="text-left">
                  <div className="text-[15px] md:text-[13px] font-black text-white">交易計算參數</div>
                  <div className="text-[14px] md:text-[12px] text-white/20 mt-0.5">調整手續費與稅率</div>
                </div>
              </div>
              <ChevronRight size={18} className="text-white/20 group-active:text-gold transition-colors" />
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
            <p className="text-center text-[13px] md:text-[11px] text-white/10 mt-6 font-mono tracking-tighter">
              STOCK KING v0.1.0 · PWA READY
            </p>
          </section>
        </>
      )}

      {view === 'GOAL' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <button onClick={() => setView('MAIN')} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-gold active:bg-white/10 transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-[15px] md:text-[13px] font-black text-white/30 uppercase tracking-[0.2em]">投資目標設定</h3>
          </div>

          <div className="glass p-5 space-y-6 border border-white/5">
            <div className="space-y-2">
              <Label>年度損益目標 (TWD)</Label>
              <input 
                type="number" inputMode="numeric"
                value={localSettings.year_goal || ''} 
                onChange={e => handleSave({ year_goal: Number(e.target.value) })}
                className="input-base text-[16px] md:text-sm font-black font-mono"
                placeholder="例如: 100000"
              />
              <p className="text-[14px] md:text-[12px] text-white/20 font-medium leading-relaxed">
                設定您今年的投資獲利目標，包含已實現與未實現損益。
              </p>
            </div>
            <div className="space-y-2">
              <Label>總資產市值目標 (TWD)</Label>
              <input 
                type="number" inputMode="numeric"
                value={localSettings.total_goal || ''} 
                onChange={e => handleSave({ total_goal: Number(e.target.value) })}
                className="input-base text-[16px] md:text-sm font-black font-mono"
                placeholder="例如: 1000000"
              />
              <p className="text-[14px] md:text-[12px] text-white/20 font-medium leading-relaxed">
                設定您長期的總資產市值目標。
              </p>
            </div>
          </div>
        </div>
      )}

      {view === 'UI' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <button onClick={() => setView('MAIN')} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-gold active:bg-white/10 transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-[15px] md:text-[13px] font-black text-white/30 uppercase tracking-[0.2em]">介面主題設定</h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {THEMES.map(theme => (
              <button
                key={theme.id}
                onClick={() => handleThemeChange(theme.id)}
                className={`flex flex-col text-left glass p-4 border-2 transition-all active:scale-95 ${localSettings.theme === theme.id ? 'border-gold shadow-[0_0_20px_rgba(212,175,55,0.1)]' : 'border-transparent'}`}
              >
                <div className="flex gap-1 mb-3">
                  {theme.colors.map((c, idx) => (
                    <div key={idx} className="w-4 h-4 rounded-full border border-white/10" style={{ background: c }} />
                  ))}
                </div>
                <span className={`text-sm font-black ${localSettings.theme === theme.id ? 'text-gold' : 'text-white/60'}`}>{theme.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'CALC' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <button onClick={() => setView('MAIN')} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-gold active:bg-white/10 transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-[15px] md:text-[13px] font-black text-white/30 uppercase tracking-[0.2em]">計算參數詳情</h3>
          </div>

          <div className="glass p-5 space-y-8 border border-white/5">
            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-gold/50 uppercase tracking-widest border-b border-gold/10 pb-2">買入手續費</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>費率</Label>
                  <input type="number" step="0.000001" value={localSettings.buy_fee_rate} onChange={e => handleSave({ buy_fee_rate: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>折數 (0.1 = 1折)</Label>
                  <input type="number" step="0.05" value={localSettings.buy_discount} onChange={e => handleSave({ buy_discount: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-gold/50 uppercase tracking-widest border-b border-gold/10 pb-2">賣出手續費 & 稅</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>費率</Label>
                  <input type="number" step="0.000001" value={localSettings.sell_fee_rate} onChange={e => handleSave({ sell_fee_rate: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>折數</Label>
                  <input type="number" step="0.05" value={localSettings.sell_discount} onChange={e => handleSave({ sell_discount: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>股票交易稅</Label>
                  <input type="number" step="0.001" value={localSettings.tax_stock} onChange={e => handleSave({ tax_stock: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>ETF 交易稅</Label>
                  <input type="number" step="0.001" value={localSettings.tax_etf} onChange={e => handleSave({ tax_etf: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-gold/50 uppercase tracking-widest border-b border-gold/10 pb-2">定期定額手續費</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>費率</Label>
                  <input type="number" step="0.000001" value={localSettings.dca_fee_rate} onChange={e => handleSave({ dca_fee_rate: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>最低收費 (TWD)</Label>
                  <input type="number" value={localSettings.dca_fee_min} onChange={e => handleSave({ dca_fee_min: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Label>一般交易最低收費 (TWD)</Label>
              <input type="number" value={localSettings.fee_min} onChange={e => handleSave({ fee_min: Number(e.target.value) })} className="input-base font-mono text-[16px] md:text-sm" />
            </div>
          </div>
          
          <div className="p-4 bg-gold/5 border border-gold/10 rounded-2xl">
            <p className="text-[14px] md:text-[12px] text-gold/60 leading-relaxed font-medium">
              💡 提示：台灣證券商規定的標準費率為 0.001425。若您的券商提供 2.8 折優惠，請在折數欄位輸入 0.285。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[15px] md:text-[13px] mb-1.5 block font-black text-white/40 uppercase tracking-wider ml-1">{children}</label>
}
