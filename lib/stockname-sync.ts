import { createClient } from '@/lib/supabase/server'

const TWSE_API = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_API = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

export async function refreshAllNames() {
  const supabase = await createClient()
  const dataToUpsert: { symbol: string; name_zh: string; updated_at: string }[] = []

  try {
    // 1. 獲取上市
    const twseRes = await fetch(TWSE_API, { next: { revalidate: 0 } })
    if (twseRes.ok) {
      const list = await twseRes.json()
      list.forEach((item: any) => {
        dataToUpsert.push({
          symbol: `${item.Code}.TW`,
          name_zh: item.Name,
          updated_at: new Date().toISOString()
        })
      })
    }

    // 2. 獲取上櫃
    const tpexRes = await fetch(TPEX_API, { next: { revalidate: 0 } })
    if (tpexRes.ok) {
      const list = await tpexRes.json()
      list.forEach((item: any) => {
        dataToUpsert.push({
          symbol: `${item.SecuritiesCompanyCode}.TWO`,
          name_zh: item.CompanyName,
          updated_at: new Date().toISOString()
        })
      })
    }

    // 3. 分次存入 Supabase
    if (dataToUpsert.length > 0) {
      const chunkSize = 500
      for (let i = 0; i < dataToUpsert.length; i += chunkSize) {
        const chunk = dataToUpsert.slice(i, i + chunkSize)
        await supabase.from('stock_names').upsert(chunk)
      }
      return true
    }
  } catch (err) {
    console.error('Refresh names error:', err)
  }
  return false
}
