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
