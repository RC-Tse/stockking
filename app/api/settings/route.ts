import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SETTINGS } from '@/types'

// All known columns in the Supabase 'settings' table
const DB_COLUMNS = [
  'user_id', 'updated_at',
  'broker_name',
  'buy_fee_rate', 'buy_discount',
  'sell_fee_rate', 'sell_discount',
  'fee_min',
  'dca_fee_min', 'dca_fee_rate',
  'tax_stock', 'tax_etf',
  'max_holdings', 'font_size',
  'year_goal', 'year_goals', 'total_goal', 'total_goal_start_date',
  'theme',
  'year_goal_type',
  'chart_default_range',
] as const

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

  // Only pass columns that exist in the DB schema
  const payload: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  }
  for (const col of DB_COLUMNS) {
    if (col in body) payload[col] = body[col]
  }

  const { data, error } = await supabase.from('settings')
    .upsert(payload).select().single()

  if (error) {
    console.error('Settings save error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
