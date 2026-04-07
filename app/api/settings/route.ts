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
  const payload = { ...body, user_id: user.id, updated_at: new Date().toISOString() }
  // year_goal_type 是前端新增欄位，實際 Supabase DB 蕪未建該欄，改用 localStorage 儲存
  // dca_fee_min / dca_fee_rate 是 DB 原有欄位，維持儲存到 Supabase
  delete payload.year_goal_type

  const { data, error } = await supabase.from('settings')
    .upsert(payload).select().single()
  
  if (error) {
    console.error('Settings save error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
