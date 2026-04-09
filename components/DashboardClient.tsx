'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Transaction, UserSettings, Quote,
  DEFAULT_SETTINGS, fmtMoney,
} from '@/types'
import { 
  BarChart2, 
  ClipboardList, 
  Settings2, 
  Plus,
  LineChart,
  RefreshCw
} from 'lucide-react'
import { PortfolioProvider, usePortfolio } from './providers/PortfolioContext'
import HoldingsTab      from './HoldingsTab'
import TransactionsTab  from './TransactionsTab'
import SettingsTab      from './SettingsTab'
import AnalyticsTab     from './AnalyticsTab'
import AddDrawer        from './AddDrawer'

export interface AppUser { id: string; email: string; name: string; avatar: string }

type Tab = 'holdings' | 'analytics' | 'transactions' | 'settings'

const TABS: { id: Tab; icon: any; label: string }[] = [
  { id: 'holdings',     icon: BarChart2, label: '持股'  },
  { id: 'analytics',    icon: LineChart, label: '分析'  },
  { id: 'transactions', icon: ClipboardList, label: '紀錄'  },
  { id: 'settings',     icon: Settings2, label: '設定'  },
]


export default function DashboardClient({ user }: { user: AppUser }) {
  const [tab, setTab]             = useState<Tab>('holdings')
  const [txs, setTxs]             = useState<Transaction[]>([])
  const [quotes, setQuotes]       = useState<Record<string, Quote>>({})
  const [settings, setSettings]   = useState<UserSettings>(DEFAULT_SETTINGS)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading]     = useState(true)
  const router = useRouter()
  const supabase = createClient()

  const handleSaveSettings = async (updates: UserSettings) => {
    await fetch('/api/settings', { method: 'POST', body: JSON.stringify(updates) })
    setSettings(updates)
  }

  useEffect(() => {
    const t = settings.theme || 'dark'
    document.documentElement.setAttribute('data-theme', t)
    
    // 更新主題圖示 (Apple Touch Icon & Favicon)
    const iconLinks = document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="icon"]')
    let iconPath = '/icons/icon-192.svg'
    if (t === 'light') iconPath = '/icons/icon-192-light.svg'
    else if (t === 'blue') iconPath = '/icons/icon-blue.svg'
    else if (t === 'purple') iconPath = '/icons/icon-purple.svg'
    else if (t === 'rose') iconPath = '/icons/icon-rose.svg'
    else if (t === 'green') iconPath = '/icons/icon-green.svg'

    iconLinks.forEach(link => {
      link.setAttribute('href', iconPath)
    })
  }, [settings.theme])

  const refresh = useCallback(async () => {
    const [txRes, setRes] = await Promise.all([
      fetch('/api/transactions'), fetch('/api/settings'),
    ])
    const txData: Transaction[]  = txRes.ok  ? await txRes.json()  : []
    let setData: UserSettings  = setRes.ok ? await setRes.json() : DEFAULT_SETTINGS
    
    setTxs(txData)
    setSettings(setData)
    setLoading(false)
    
    const syms = Array.from(new Set(txData.map(t => t.symbol)))
    if (syms.length) {
      const qRes = await fetch(`/api/stocks?symbols=${syms.join(',')}`)
      if (qRes.ok) setQuotes(await qRes.json())
    }
  }, [])

  const refreshQuotesOnly = useCallback(async () => {
    const syms = Array.from(new Set(txs.map(t => t.symbol)))
    if (syms.length) {
      const qRes = await fetch(`/api/stocks?symbols=${syms.join(',')}`)
      if (qRes.ok) setQuotes(await qRes.json())
    }
  }, [txs])


  useEffect(() => {
    refresh()
    // 背景靜默更新股票名稱資料庫
    fetch('/api/stockname/refresh').catch(console.error)
  }, [refresh])


  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <PortfolioProvider transactions={txs} quotes={quotes} settings={settings}>
        <DashboardInner 
        user={user} tab={tab} setTab={setTab} 
        refresh={refresh} refreshQuotesOnly={refreshQuotesOnly} loading={loading} 
        drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen}
        settings={settings} setSettings={setSettings}
      />

    </PortfolioProvider>
  )
}

function DashboardInner({ user, tab, setTab, refresh, refreshQuotesOnly, loading, drawerOpen, setDrawerOpen, settings, setSettings }: any) {

  const { stats } = usePortfolio()
  const { totalPnl, pnlPct, totalNetMV: totalMV } = stats
  const router = useRouter()
  const supabase = createClient()
  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--bg-base)] md:max-w-[480px] md:mx-auto md:border-x md:border-white/5">
      <header className="sticky top-0 z-40 pt-safe bg-[var(--bg-base)]/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3 gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <path d="M2 19h20M3 9l4 4 5-8 5 8 4-4 1 10H2L3 9z"/>
            </svg>
          </div>
          <div className="flex-1 flex flex-col items-center pl-8">
            <span className="text-[18px] font-black text-[var(--t1)] leading-tight">{fmtMoney(totalMV)}</span>
            <span className={`text-[11px] font-bold ${totalPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(totalPnl))} ({pnlPct.toFixed(1)}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={refreshQuotesOnly}
              className="p-2 rounded-full bg-white/5 text-accent border border-white/10 active:scale-90 active:opacity-70 transition-all"
            >
              <RefreshCw size={14} />
            </button>

            <button onClick={signOut}
              className="shrink-0 w-8 h-8 rounded-full border-2 border-[var(--accent-dim)] overflow-hidden bg-[var(--bg-surface)] flex items-center justify-center text-[10px] font-black text-accent active:scale-90 transition-all">
              {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : user.name?.[0] || 'U'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-32">
        {loading ? <div className="p-10 text-center opacity-20 animate-pulse text-[var(--t1)]">載入中...</div> : (
          <>
            {tab === 'holdings' && <HoldingsTab onRefresh={refresh} />}
            {tab === 'analytics' && <AnalyticsTab onRefresh={refresh} />}
            {tab === 'transactions' && <TransactionsTab onRefresh={refresh} />}
            {tab === 'settings' && <SettingsTab settings={settings} onSignOut={signOut} onSave={async s => {
              await fetch('/api/settings', { method: 'POST', body: JSON.stringify(s) })
              setSettings(s)
            }} />}
          </>
        )}
      </main>

      {(tab === 'holdings' || tab === 'transactions') && (
        <button
          onClick={() => { setDrawerOpen(true); }}
          className="fixed bottom-[82px] right-4 z-30 w-14 h-14 rounded-full flex items-center justify-center text-[var(--bg-base)] shadow-[0_4px_20px_var(--accent-dim)] active:scale-90 transition-all border border-white/10"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-bright))' }}>
          <Plus size={28} strokeWidth={3} />
        </button>
      )}

      <nav className="fixed bottom-0 inset-x-0 md:max-w-[480px] md:mx-auto z-40 pb-safe bg-[var(--bg-surface)]/90 backdrop-blur-2xl border-t border-[var(--border-bright)] shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        <div className="flex h-20 items-center">
          {TABS.map(t => {
            const Icon = t.icon, active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 relative flex flex-col items-center justify-center gap-1.5 transition-all ${active ? 'text-[var(--accent)]' : 'text-[var(--t2)] opacity-40'}`}>
                <div className={`p-2 rounded-full transition-all duration-300 ${active ? 'ring-2 ring-[var(--accent)] shadow-[0_0_15px_var(--accent-dim)]' : 'ring-0'}`}>
                  <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                </div>
                <span className="font-black text-[9px] uppercase tracking-[0.15em]">{t.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <AddDrawer
        open={drawerOpen}
        settings={settings}
        onClose={() => { setDrawerOpen(false); }}
        onSave={async p => {
          await fetch('/api/transactions', { method: 'POST', body: JSON.stringify(p) })
          setDrawerOpen(false); refresh();
        }}
      />
    </div>
  )
}
