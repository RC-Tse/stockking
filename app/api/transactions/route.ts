import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcFee, calcTax, DEFAULT_SETTINGS, UserSettings } from '@/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { data: txs, error } = await supabase.from('transactions').select('*').eq('user_id', user.id)
    .order('trade_date', { ascending: false }).order('created_at', { ascending: false })
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!txs || txs.length === 0) return NextResponse.json([])

  // Fetch Chinese names for these symbols
  const syms = Array.from(new Set(txs.map(t => t.symbol)))
  const { data: names } = await supabase
    .from('stock_names')
    .select('symbol, name_zh')
    .in('symbol', syms)

  const nameMap = Object.fromEntries(names?.map(n => [n.symbol, n.name_zh]) ?? [])
  const enriched = txs.map(t => ({ ...t, name_zh: nameMap[t.symbol] }))

  return NextResponse.json(enriched)
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
  const fee = calcFee(amount, s, action === 'SELL', action === 'DCA')
  const tax = action === 'SELL' ? calcTax(amount, sym, s) : 0
  
  // 交易原則：Math.floor(成交價 * 股數 +/- 手續費 +/- 交易稅)
  const net_amount = (action === 'BUY' || action === 'DCA') 
    ? -Math.floor(amount + fee) 
    : Math.floor(amount - fee - tax)
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
  const { id, trade_date, shares, price, note = '', action: newAction } = body

  // Fetch current to keep action/symbol for recalculation
  const { data: current } = await supabase.from('transactions').select('*').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (current.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: sr } = await supabase.from('settings').select('*').eq('user_id', user.id).single()
  const s: UserSettings = sr ?? DEFAULT_SETTINGS

  const sym = current.symbol
  // Allow switching between BUY and DCA, otherwise keep current.action
  const action = (newAction === 'BUY' || newAction === 'DCA') && (current.action === 'BUY' || current.action === 'DCA') 
    ? newAction 
    : current.action
  const amount = Number(shares) * Number(price)
  const fee = calcFee(amount, s, action === 'SELL', action === 'DCA')
  const tax = action === 'SELL' ? calcTax(amount, sym, s) : 0
  
  // 交易原則：Math.floor(成交價 * 股數 +/- 手續費 +/- 交易稅)
  const net_amount = (action === 'BUY' || action === 'DCA') 
    ? -Math.floor(amount + fee) 
    : Math.floor(amount - fee - tax)

  const { data, error } = await supabase.from('transactions').update({
    trade_date, action, shares: Number(shares), price: Number(price), amount, fee, tax, net_amount, note
  }).eq('id', id).eq('user_id', user.id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
