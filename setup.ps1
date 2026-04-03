# ============================================================
# 少年存股王 — 一鍵修復資料夾結構腳本
# 在 PowerShell 中執行：
#   cd C:\Users\User\Desktop\files
#   .\setup.ps1
# ============================================================

$root = Get-Location

Write-Host "📁 建立資料夾結構..." -ForegroundColor Cyan
$dirs = @(
  "app","app\login","app\dashboard","app\auth\callback",
  "app\api\stocks","app\api\transactions","app\api\settings","app\api\calendar",
  "components","lib\supabase","types","public\icons"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

Write-Host "📦 移動現有檔案..." -ForegroundColor Cyan

# components
foreach ($f in @("AddDrawer","CalendarTab","ConceptsTab","DashboardClient","HoldingsTab","SettingsTab","TransactionsTab")) {
  if (Test-Path "$f.tsx") { Move-Item -Force "$f.tsx" "components\$f.tsx" }
}

# lib/supabase
if (Test-Path "client.ts") { Move-Item -Force "client.ts" "lib\supabase\client.ts" }
if (Test-Path "server.ts") { Move-Item -Force "server.ts" "lib\supabase\server.ts" }

# types
if (Test-Path "index.ts") { Move-Item -Force "index.ts" "types\index.ts" }

# app root
if (Test-Path "globals.css") { Move-Item -Force "globals.css" "app\globals.css" }
if (Test-Path "layout.tsx")  { Move-Item -Force "layout.tsx"  "app\layout.tsx" }
if (Test-Path "manifest.json") { Move-Item -Force "manifest.json" "public\manifest.json" }

# page.tsx → app/page.tsx (redirect)
if (Test-Path "page.tsx") { Move-Item -Force "page.tsx" "app\page.tsx" }

# route.ts → auth callback (most likely)
if (Test-Path "route.ts") { Move-Item -Force "route.ts" "app\auth\callback\route.ts" }

Write-Host "✍️  建立缺少的頁面檔案..." -ForegroundColor Cyan

# ── app/login/page.tsx ─────────────────────────────────────────
@'
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function signIn() {
    setLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 relative overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201,165,100,0.07) 0%, transparent 65%)', filter: 'blur(50px)' }} />

      <div className="relative z-10 text-center mb-10">
        <div className="text-[72px] leading-none mb-5 select-none" style={{ filter: 'drop-shadow(0 4px 24px rgba(201,165,100,0.4))' }}>👑</div>
        <h1 className="text-gold text-4xl font-black tracking-tight" style={{ letterSpacing: '-0.02em' }}>少年存股王</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--t2)' }}>讓每一分錢都發光</p>
        <div className="mt-5 flex items-center gap-3 justify-center">
          <div className="h-px w-12" style={{ background: 'var(--border-bright)' }} />
          <span className="text-xs font-mono tracking-widest" style={{ color: 'var(--gold)' }}>台股投資追蹤系統</span>
          <div className="h-px w-12" style={{ background: 'var(--border-bright)' }} />
        </div>
      </div>

      <div className="glass relative z-10 w-full max-w-xs p-7" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <h2 className="font-bold text-base text-center mb-1" style={{ color: 'var(--t1)' }}>登入您的帳戶</h2>
        <p className="text-xs text-center mb-6" style={{ color: 'var(--t3)' }}>資料雲端同步，跨裝置即時存取</p>
        <button onClick={signIn} disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95"
          style={{ background: loading ? 'var(--bg-hover)' : 'var(--t1)', color: 'var(--bg-base)', boxShadow: loading ? 'none' : '0 4px 24px rgba(201,165,100,0.2)' }}>
          {loading ? '連線中…' : '使用 Google 帳號登入'}
        </button>
        <p className="text-xs text-center mt-4" style={{ color: 'var(--t3)' }}>登入即同意個人資料用於帳號管理</p>
      </div>

      <div className="relative z-10 flex flex-wrap gap-2 justify-center mt-7 max-w-xs">
        {['☁️ 雲端同步','📱 iOS PWA','📊 盈虧月曆','💼 持股追蹤','💡 概念股'].map(f => (
          <span key={f} className="text-xs px-2.5 py-1 rounded-full"
            style={{ background: 'var(--gold-dim)', color: 'var(--gold)', border: '1px solid var(--border-bright)' }}>{f}</span>
        ))}
      </div>
    </div>
  )
}
'@ | Set-Content -Encoding UTF8 "app\login\page.tsx"

# ── app/dashboard/page.tsx ─────────────────────────────────────
@'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from '@/components/DashboardClient'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <DashboardClient user={{
      id: user.id, email: user.email!,
      name: user.user_metadata?.full_name ?? '',
      avatar: user.user_metadata?.avatar_url ?? '',
    }} />
  )
}
'@ | Set-Content -Encoding UTF8 "app\dashboard\page.tsx"

# ── app/api/stocks/route.ts ────────────────────────────────────
@'
import { NextRequest, NextResponse } from 'next/server'
const BASE: Record<string,number> = {
  '2330.TW':960,'2454.TW':1180,'2382.TW':315,'2356.TW':90,'3711.TW':182,
  '2308.TW':388,'6669.TW':1040,'3034.TW':242,'2301.TW':76,'2317.TW':220,
  '3324.TW':388,'3019.TW':54,'6230.TW':238,'6278.TW':182,'1626.TW':66,
  '2891.TW':31,'2882.TW':61,'2881.TW':87,'2886.TW':38,'2884.TW':28,
  '2892.TW':22,'2880.TW':20,'0050.TW':178,'0056.TW':37,'006208.TW':112,
  '00878.TW':21,'00929.TW':18,'00713.TW':46,'1513.TW':244,'1519.TW':430,
  '2207.TW':382,'6244.TW':28,'2353.TW':44,'3231.TW':66,'2603.TW':162,
  '2609.TW':88,'2615.TW':55,'2610.TW':22,'2618.TW':32,'4746.TW':95,
}
function rng(s:number){const x=Math.sin(s+1)*10000;return x-Math.floor(x)}
function ss(sym:string){return sym.split('').reduce((a,c)=>a*31+c.charCodeAt(0),0)}
function quote(sym:string){
  const base=BASE[sym]??100
  const now=new Date()
  const ds=now.getFullYear()*10000+(now.getMonth()+1)*100+now.getDate()
  const s=(ds^ss(sym))>>>0
  const cp=(rng(s)*12-6)/100
  const price=Math.round(base*(1+cp)*100)/100
  const change=Math.round((price-base)*100)/100
  const open=Math.round(base*(1+(rng(s+1)*4-2)/100)*100)/100
  const high=Math.round(Math.max(price,open)*(1+rng(s+2)*0.008)*100)/100
  const low=Math.round(Math.min(price,open)*(1-rng(s+3)*0.008)*100)/100
  return {symbol:sym,price,prev:base,open,high,low,change,change_pct:Math.round(cp*10000)/100,volume:Math.floor(rng(s+4)*80000+500)}
}
export async function GET(req:NextRequest){
  const syms=(req.nextUrl.searchParams.get('symbols')??\'\').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)
  if(!syms.length)return NextResponse.json({},{status:400})
  const r:Record<string,ReturnType<typeof quote>>={};for(const s of syms)r[s]=quote(s)
  return NextResponse.json(r,{headers:{'Cache-Control':'public,s-maxage=60'}})
}
'@ | Set-Content -Encoding UTF8 "app\api\stocks\route.ts"

# ── app/api/transactions/route.ts ──────────────────────────────
@'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcFee, calcTax, DEFAULT_SETTINGS, UserSettings } from '@/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('transactions').select('*').eq('user_id', user.id)
    .order('trade_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { symbol, action, trade_date, shares, price, trade_type = 'FULL', note = '' } = body
  const { data: sr } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  const s: UserSettings = sr ?? DEFAULT_SETTINGS
  const sym = symbol.trim().toUpperCase()
  const amount = Number(shares) * Number(price)
  const fee = calcFee(amount, s, action === 'SELL')
  const tax = action === 'SELL' ? calcTax(amount, sym, s) : 0
  const net_amount = (action === 'BUY' || action === 'DCA') ? -(amount + fee) : (amount - fee - tax)
  const { data, error } = await supabase.from('transactions')
    .insert({ user_id: user.id, symbol: sym, action, trade_date, shares: Number(shares), price: Number(price), amount, fee, tax, net_amount, trade_type, note })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
'@ | Set-Content -Encoding UTF8 "app\api\transactions\route.ts"

# ── app/api/settings/route.ts ──────────────────────────────────
@'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SETTINGS } from '@/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  return NextResponse.json(data ?? { ...DEFAULT_SETTINGS, user_id: user.id })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { data, error } = await supabase.from('settings')
    .upsert({ ...body, user_id: user.id, updated_at: new Date().toISOString() }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
'@ | Set-Content -Encoding UTF8 "app\api\settings\route.ts"

# ── app/api/calendar/route.ts ──────────────────────────────────
@'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const year = req.nextUrl.searchParams.get('year')
  const month = req.nextUrl.searchParams.get('month')
  let query = supabase.from('calendar_entries').select('*').eq('user_id', user.id)
  if (year && month) {
    const m = String(month).padStart(2,'0')
    const lastDay = new Date(Number(year), Number(month), 0).getDate()
    query = query.gte('entry_date',`${year}-${m}-01`).lte('entry_date',`${year}-${m}-${lastDay}`)
  }
  const { data, error } = await query.order('entry_date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { entry_date, pnl, note = '' } = await req.json()
  const { data, error } = await supabase.from('calendar_entries')
    .upsert({ user_id: user.id, entry_date, pnl: Number(pnl), note }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await supabase.from('calendar_entries').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
'@ | Set-Content -Encoding UTF8 "app\api\calendar\route.ts"

# ── app/auth/callback/route.ts (overwrite with correct content) ─
@'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
'@ | Set-Content -Encoding UTF8 "app\auth\callback\route.ts"

Write-Host ""
Write-Host "✅ 結構修復完成！現在執行：" -ForegroundColor Green
Write-Host "   npm run dev" -ForegroundColor Yellow
