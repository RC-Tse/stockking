'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Transaction, Holding, CalendarEntry, UserSettings, Quote, DCAPlan,
  DEFAULT_SETTINGS, calcFee, calcTax, fmtMoney,
} from '@/types'
import { 
  BarChart2, 
  ClipboardList, 
  Settings as SettingsIcon, 
  Plus 
} from 'lucide-react'
import HoldingsTab      from './HoldingsTab'
import ConceptsTab      from './ConceptsTab'
import TransactionsTab  from './TransactionsTab'
import SettingsTab      from './SettingsTab'
import AddDrawer        from './AddDrawer'

export interface AppUser { id: string; email: string; name: string; avatar: string }

type Tab = 'holdings' | 'transactions' | 'settings'

const TABS: { id: Tab; icon: any; label: string }[] = [
  { id: 'holdings',     icon: BarChart2, label: '持股'  },
  { id: 'transactions', icon: ClipboardList, label: '紀錄'  },
  { id: 'settings',     icon: SettingsIcon, label: '設定'  },
]

// ─── FIFO holdings computation ───────────────────────────────────────────────
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
      lots.push({ shares: tx.shares, cost: tx.amount + tx.fee })
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

// ─── component ───────────────────────────────────────────────────────────────
export default function DashboardClient({ user }: { user: AppUser }) {
  const [tab, setTab]             = useState<Tab>('holdings')
  const [txs, setTxs]             = useState<Transaction[]>([])
  const [quotes, setQuotes]       = useState<Record<string, Quote>>({})
  const [settings, setSettings]   = useState<UserSettings>(DEFAULT_SETTINGS)
  const [calEntries, setCalEntries] = useState<CalendarEntry[]>([])
  const [holdings, setHoldings]   = useState<Holding[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingDcaPlan, setEditingDcaPlan] = useState<DCAPlan | null>(null)
  const [loading, setLoading]     = useState(true)
  const autoCalSaved = useRef(false)
  const router = useRouter()
  const supabase = createClient()

  // Apply theme
  useEffect(() => {
    if (settings.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme)
    } else {
      document.documentElement.setAttribute('data-theme', 'luxury')
    }
  }, [settings.theme])

  // ── fetch transactions + settings ─────────────────────────────
  const refresh = useCallback(async () => {
    const [txRes, setRes] = await Promise.all([
      fetch('/api/transactions'), fetch('/api/settings'),
    ])
    const txData: Transaction[]  = txRes.ok  ? await txRes.json()  : []
    const setData: UserSettings  = setRes.ok ? await setRes.json() : DEFAULT_SETTINGS
    setTxs(txData)
    setSettings(setData)
    setLoading(false)

    const syms = Array.from(new Set(
      txData.filter(t => t.action === 'BUY' || t.action === 'DCA').map(t => t.symbol)
    ))
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
    fetch('/api/stockname/refresh').catch(() => {})
  }, [refresh, refreshCal])

  // ── Auto-save today's P&L to calendar at 2 PM ─────────────────
  useEffect(() => {
    if (autoCalSaved.current || holdings.length === 0) return
    const now = new Date()
    if (now.getHours() < 14) return
    const todayStr = now.toISOString().split('T')[0]
    if (calEntries.some(e => e.entry_date === todayStr)) return
    autoCalSaved.current = true
    const pnl = holdings.reduce((s, h) => s + h.unrealized_pnl, 0)
    const cost = holdings.reduce((s, h) => s + h.total_cost, 0)
    const pnlPctStr = cost ? `${pnl >= 0 ? '+' : ''}${(pnl / cost * 100).toFixed(2)}%` : ''
    fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_date: todayStr,
        pnl: Math.round(pnl),
        note: `自動更新・盈虧比 ${pnlPctStr}`,
      }),
    }).then(r => {
      if (r.ok) refreshCal(now.getFullYear(), now.getMonth() + 1)
    })
  }, [holdings, calEntries, refreshCal])

  // ── 統一損益計算邏輯 ──
  const { totalPnl, totalCost } = useMemo(() => {
    let buyTotal = 0
    let sellTotal = 0
    for (const t of txs) {
      if (t.action === 'BUY' || t.action === 'DCA') buyTotal += (t.amount + t.fee)
      if (t.action === 'SELL') sellTotal += t.net_amount
    }
    const currentMV = holdings.reduce((s, h) => s + h.market_value, 0)
    return {
      totalPnl: sellTotal + currentMV - buyTotal,
      totalCost: buyTotal
    }
  }, [txs, holdings])

  const pnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0
  const totalMV = holdings.reduce((s, h) => s + h.market_value, 0)

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh flex flex-col bg-base md:max-w-[480px] md:mx-auto md:border-x md:border-white/5">

      {/* ══ HEADER ══════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 pt-safe bg-[#0d1018e0] backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3 gap-2">

          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xl leading-none">👑</span>
            <span className="text-gold font-black text-sm tracking-tight hidden xs:block">少年存股王</span>
          </div>

          {/* Summary pill */}
          <div className="flex-1 flex justify-center">
            <div className="glass-sm flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono border border-white/5">
              <span className="opacity-50">損益</span>
              <span className={totalPnl >= 0 ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                {totalPnl >= 0 ? '+' : ''}{fmtMoney(Math.round(totalPnl))}
                <span className="ml-0.5 opacity-60 text-[10px]">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>
              </span>
            </div>
          </div>

          {/* Avatar → sign out */}
          <button onClick={signOut} title="登出"
            className="shrink-0 w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-black bg-gold-dim border border-white/10 text-gold">
            {user.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : (user.name?.[0] ?? user.email[0]).toUpperCase()}
          </button>
        </div>
      </header>

      {/* ══ CONTENT ═════════════════════════════════════════════ */}
      <main className="flex-1 overflow-y-auto pb-32 text-[15px] md:text-[16px]">
        {loading
          ? <LoadingSkeleton />
          : <>
              {tab === 'holdings'     && <HoldingsTab 
                holdings={holdings} 
                quotes={quotes} 
                settings={settings} 
                transactions={txs} 
                calEntries={calEntries}
                onRefresh={refresh} 
                onRefreshCal={refreshCal}
              />}

              {tab === 'transactions' && <TransactionsTab 
                txs={txs} 
                settings={settings} 
                onRefresh={refresh} 
                onEditDca={(plan) => {
                  setEditingDcaPlan(plan)
                  setDrawerOpen(true)
                }}
              />}
              {tab === 'settings'     && (
                <SettingsTab settings={settings} onSignOut={signOut} onSave={async (s) => {
                  const r = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(s),
                  })
                  if (r.ok) setSettings(s)
                }} />
              )}
            </>
        }
      </main>

      {/* ══ FAB ═════════════════════════════════════════════════ */}
      {(tab === 'holdings' || tab === 'transactions') && (
        <button
          onClick={() => {
            setEditingDcaPlan(null)
            setDrawerOpen(true)
          }}
          className="fixed bottom-[82px] right-4 z-30 w-[50px] h-[50px] rounded-full flex items-center justify-center text-white transition-all active:scale-90 border border-white/10 shadow-2xl"
          style={{ 
            background: 'var(--gold)',
            color: 'var(--bg-base)'
          }}>
          <Plus size={24} strokeWidth={3} />
        </button>
      )}

      {/* ══ BOTTOM NAV ══════════════════════════════════════════ */}
      <nav className="fixed bottom-0 inset-x-0 md:max-w-[480px] md:mx-auto z-40 pb-safe bg-[#0d1018f5] backdrop-blur-2xl border-t border-white/10">
        <div className="flex h-16">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 relative flex flex-col items-center justify-center gap-1 transition-all ${tab === t.id ? 'text-gold' : 'text-white/30'}`}>
                <Icon size={22} fill={tab === t.id ? "currentColor" : "none"} strokeWidth={tab === t.id ? 2.5 : 2} />
                <span className="font-bold text-[10px] tracking-wide uppercase">
                  {t.label}
                </span>
                {tab === t.id && <div className="absolute bottom-1 inset-x-6 h-1 bg-gold rounded-full" />}
              </button>
            )
          })}
        </div>
      </nav>

      {/* ══ ADD DRAWER ══════════════════════════════════════════ */}
      <AddDrawer
        open={drawerOpen}
        settings={settings}
        initialPlan={editingDcaPlan}
        onClose={() => {
          setDrawerOpen(false)
          setEditingDcaPlan(null)
        }}
        onSave={async (payload) => {
          await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          setDrawerOpen(false)
          refresh()
        }}
        onSavePlan={() => {
          refresh()
        }}
      />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="shimmer h-28 rounded-2xl" />
      {[0,1,2].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}
    </div>
  )
}
