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
  try {
    const { id } = await req.json()
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
    const id = req.nextUrl.searchParams.get('id')
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { id, trade_date, shares, price, note = '' } = body

  // Fetch current to keep action/symbol for recalculation
  const { data: current } = await supabase.from('transactions').select('*').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (current.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: sr } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  const s: UserSettings = sr ?? DEFAULT_SETTINGS

  const sym = current.symbol
  const action = current.action
  const amount = Number(shares) * Number(price)
  const fee = calcFee(amount, s, action === 'SELL')
  const tax = action === 'SELL' ? calcTax(amount, sym, s) : 0
  const net_amount = (action === 'BUY' || action === 'DCA') ? -(amount + fee) : (amount - fee - tax)

  const { data, error } = await supabase.from('transactions').update({
    trade_date, shares: Number(shares), price: Number(price), amount, fee, tax, net_amount, note
  }).eq('id', id).eq('user_id', user.id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
