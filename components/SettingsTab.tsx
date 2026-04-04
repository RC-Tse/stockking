'use client'

import { useState } from 'react'
import { UserSettings } from '@/types'

interface Props {
  settings: UserSettings
  onSignOut: () => Promise<void>
  onSave: (s: UserSettings) => Promise<void>
}

type View = 'MAIN' | 'CALC'

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

  return (
    <div className="p-4 space-y-6 pb-32">
      {view === 'MAIN' && (
        <>
          <section className="space-y-4">
            <h3 className="text-[15px] md:text-[13px] font-black text-white/30 uppercase tracking-[0.2em] px-1">目標設定</h3>
            <div className="glass p-5 space-y-6 border border-white/5">
              <div className="space-y-2">
                <Label>年度損益目標 (TWD)</Label>
                <input 
                  type="number" inputMode="numeric"
                  value={localSettings.year_goal || ''} 
                  onChange={e => handleSave({ year_goal: Number(e.target.value) })}
                  className="input-base text-lg md:text-sm font-black font-mono"
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
                  className="input-base text-lg md:text-sm font-black font-mono"
                  placeholder="例如: 1000000"
                />
                <p className="text-[14px] md:text-[12px] text-white/20 font-medium leading-relaxed">
                  設定您長期的總資產市值目標。
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-[15px] md:text-[13px] font-black text-white/30 uppercase tracking-[0.2em] px-1">交易手續費</h3>
            <div className="glass p-5 border border-white/5 space-y-4">
              <button 
                onClick={() => setView('CALC')}
                className="w-full flex items-center justify-between group py-1"
              >
                <div className="text-left">
                  <div className="text-[15px] md:text-[13px] font-black text-white group-active:text-gold transition-colors">調整計算參數</div>
                  <div className="text-[14px] md:text-[12px] text-white/20 mt-1">目前折數: {(localSettings.buy_discount * 10).toFixed(1)} 折 / {(localSettings.sell_discount * 10).toFixed(1)} 折</div>
                </div>
                <span className="text-gold opacity-40 group-active:opacity-100 transition-opacity">❯</span>
              </button>
            </div>
          </section>

          <section className="pt-4">
            <button 
              onClick={onSignOut}
              className="w-full py-4 rounded-2xl font-black text-[15px] text-red-400 bg-red-400/5 border border-red-400/10 active:bg-red-400/10 active:scale-[0.98] transition-all"
            >
              登出帳號
            </button>
            <p className="text-center text-[13px] md:text-[11px] text-white/10 mt-6 font-mono tracking-tighter">
              STOCK KING v0.1.0 · PWA READY
            </p>
          </section>
        </>
      )}

      {view === 'CALC' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-4 px-1">
            <button onClick={() => setView('MAIN')} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-gold active:bg-white/10 transition-colors">❮</button>
            <h3 className="text-[15px] md:text-[13px] font-black text-white/30 uppercase tracking-[0.2em]">計算參數詳情</h3>
          </div>

          <div className="glass p-5 space-y-8 border border-white/5">
            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-gold/50 uppercase tracking-widest border-b border-gold/10 pb-2">買入手續費</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>費率</Label>
                  <input type="number" step="0.000001" value={localSettings.buy_fee_rate} onChange={e => handleSave({ buy_fee_rate: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>折數 (0.1 = 1折)</Label>
                  <input type="number" step="0.05" value={localSettings.buy_discount} onChange={e => handleSave({ buy_discount: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-[11px] font-black text-gold/50 uppercase tracking-widest border-b border-gold/10 pb-2">賣出手續費 & 稅</h4>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>費率</Label>
                  <input type="number" step="0.000001" value={localSettings.sell_fee_rate} onChange={e => handleSave({ sell_fee_rate: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>折數</Label>
                  <input type="number" step="0.05" value={localSettings.sell_discount} onChange={e => handleSave({ sell_discount: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>股票交易稅</Label>
                  <input type="number" step="0.001" value={localSettings.tax_stock} onChange={e => handleSave({ tax_stock: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>ETF 交易稅</Label>
                  <input type="number" step="0.001" value={localSettings.tax_etf} onChange={e => handleSave({ tax_etf: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Label>最低收費 (TWD)</Label>
              <input type="number" value={localSettings.fee_min} onChange={e => handleSave({ fee_min: Number(e.target.value) })} className="input-base font-mono text-lg md:text-sm" />
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
