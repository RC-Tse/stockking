'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Transaction, Holding, CalendarEntry, UserSettings, Quote,
  DEFAULT_SETTINGS, calcFee, calcTax, fmtMoney,
} from '@/types'
import { 
  BarChart2, 
  ClipboardList, 
  Settings2, 
  Plus,
  LineChart
} from 'lucide-react'
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

function buildHoldings(txs: Transaction[], quotes: Record<string, Quote>, settings: UserSettings): Holding[] {
  const inventory: Record<string, { shares: number; cost: number }[]> = {}
  const sorted = [...txs].sort((a, b) => {
    if (a.trade_date !== b.trade_date) return a.trade_date.localeCompare(b.trade_date)
    return a.id - b.id
  })
  for (const tx of sorted) {
    if (!inventory[tx.symbol]) inventory[tx.symbol] = []
    const lots = inventory[tx.symbol]
    if (tx.action === 'BUY' || tx.action === 'DCA') {
      lots.push({ shares: tx.shares, cost: Math.floor(tx.amount) + Math.floor(tx.fee) })
    } else if (tx.action === 'SELL') {
      let sellRemaining = tx.shares
      while (sellRemaining > 0 && lots.length > 0) {
        if (lots[0].shares <= sellRemaining) {
          sellRemaining -= lots[0].shares
          lots.shift()
        } else {
          const unitCost = lots[0].cost / lots[0].shares
          lots[0].shares -= sellRemaining
          lots[0].cost = lots[0].shares * unitCost
          sellRemaining = 0
        }
      }
    }
  }
  return Object.entries(inventory)
    .map(([sym, lots]) => {
      const netShares = lots.reduce((s, l) => s + l.shares, 0)
      if (netShares <= 0) return null
      const totalCost = lots.reduce((s, l) => s + l.cost, 0)
      const avgCost = totalCost / netShares
      const cp = quotes[sym]?.price || 0
      const mv = Math.round(cp * netShares)
      const fee = calcFee(mv, settings, true)
      const tax = calcTax(mv, sym, settings)
      const upnl = mv - fee - tax - totalCost
      return {
        symbol: sym,
        shares: netShares,
        avg_cost: Math.round(avgCost * 100) / 100,
        total_cost: Math.round(totalCost),
        current_price: cp,
        market_value: mv,
        unrealized_pnl: Math.round(upnl),
        pnl_pct: totalCost ? Math.round(upnl / totalCost * 10000) / 100 : 0,
      }
    })
    .filter((h): h is Holding => h !== null)
}

export default function DashboardClient({ user }: { user: AppUser }) {
  const [tab, setTab]             = useState<Tab>('holdings')
  const [txs, setTxs]             = useState<Transaction[]>([])
  const [quotes, setQuotes]       = useState<Record<string, Quote>>({})
  const [settings, setSettings]   = useState<UserSettings>(DEFAULT_SETTINGS)
  const [calEntries, setCalEntries] = useState<CalendarEntry[]>([])
  const [holdings, setHoldings]   = useState<Holding[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading]     = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const t = settings.theme || 'dark'
    document.documentElement.setAttribute('data-theme', t)
    const icon = document.querySelector('link[rel="apple-touch-icon"]')
    if (icon) {
      const isLightIcon = t === 'light' || t === 'rose'
      icon.setAttribute('href', isLightIcon ? '/icons/icon-192-light.svg' : '/icons/icon-192.svg')
    }
  }, [settings.theme])

  const refresh = useCallback(async () => {
    const [txRes, setRes] = await Promise.all([
      fetch('/api/transactions'), fetch('/api/settings'),
    ])
    const txData: Transaction[]  = txRes.ok  ? await txRes.json()  : []
    const setData: UserSettings  = setRes.ok ? await setRes.json() : DEFAULT_SETTINGS
    setTxs(txData)
    setSettings(setData)
    setLoading(false)
    const syms = Array.from(new Set(txData.map(t => t.symbol)))
    if (syms.length) {
      const qRes = await fetch(`/api/stocks?symbols=${syms.join(',')}`)
      if (qRes.ok) {
        const q: Record<string, Quote> = await qRes.json()
        setQuotes(q)
        setHoldings(buildHoldings(txData, q, setData))
      }
    } else {
      setHoldings([])
    }
  }, [])

  const refreshCal = useCallback(async (year: number, month: number) => {
    const r = await fetch(`/api/calendar?year=${year}&month=${month}`)
    if (r.ok) setCalEntries(await r.json())
  }, [])

  useEffect(() => {
    refresh()
    const now = new Date()
    refreshCal(now.getFullYear(), now.getMonth() + 1)
    
    // 背景靜默更新股票名稱資料庫
    fetch('/api/stockname/refresh').catch(console.error)
  }, [refresh, refreshCal])

  const { totalPnl, pnlPct, totalMV } = useMemo(() => {
    let buyTotal = 0, sellTotal = 0
    for (const t of txs) {
      if (t.action === 'BUY' || t.action === 'DCA') buyTotal += (t.amount + t.fee)
      if (t.action === 'SELL') sellTotal += t.net_amount
    }
    const currentMV = holdings.reduce((s, h) => s + h.market_value, 0)
    const tp = sellTotal + currentMV - buyTotal
    return { totalPnl: tp, totalMV: currentMV, pnlPct: buyTotal ? (tp / buyTotal) * 100 : 0 }
  }, [txs, holdings])

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
          <div className="flex-1 flex flex-col items-center">
            <span className="text-[18px] font-black text-[var(--t1)] leading-tight">{fmtMoney(totalMV)}</span>
            <span className={`text-[11px] font-bold ${totalPnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(totalPnl))} ({pnlPct.toFixed(1)}%)
            </span>
          </div>
          <button onClick={signOut}
            className="shrink-0 w-8 h-8 rounded-full border-2 border-[var(--accent-dim)] overflow-hidden bg-[var(--bg-surface)] flex items-center justify-center text-[10px] font-black text-accent">
            {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : user.name?.[0] || 'U'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-32">
        {loading ? <div className="p-10 text-center opacity-20 animate-pulse text-[var(--t1)]">載入中...</div> : (
          <>
            {tab === 'holdings' && <HoldingsTab holdings={holdings} quotes={quotes} settings={settings} transactions={txs} calEntries={calEntries} onRefresh={refresh} onRefreshCal={refreshCal} />}
            {tab === 'analytics' && <AnalyticsTab holdings={holdings} transactions={txs} settings={settings} quotes={quotes} />}
            {tab === 'transactions' && <TransactionsTab txs={txs} settings={settings} onRefresh={refresh} />}
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

      <nav className="fixed bottom-0 inset-x-0 md:max-w-[480px] md:mx-auto z-40 pb-safe bg-[var(--bg-base)]/95 backdrop-blur-2xl border-t border-[var(--accent-dim)]">
        <div className="flex h-16">
          {TABS.map(t => {
            const Icon = t.icon, active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 relative flex flex-col items-center justify-center gap-1 transition-all ${active ? 'text-accent' : 'text-[var(--t3)]'}`}>
                <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                <span className="font-bold text-[10px] uppercase tracking-wider">{t.label}</span>
                {active && <div className="absolute bottom-0 inset-x-8 h-0.5 bg-accent rounded-full" />}
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
