import { NextResponse } from 'next/server'
import { refreshAllNames } from '@/lib/stockname-sync'

export async function GET() {
  const success = await refreshAllNames()
  return NextResponse.json({ success, message: success ? 'Stock names refreshed successfully' : 'Failed to refresh stock names' })
}
