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
