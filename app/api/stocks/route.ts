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
  const syms=(req.nextUrl.searchParams.get('symbols')??'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)
  if(!syms.length)return NextResponse.json({},{status:400})
  const r:Record<string,ReturnType<typeof quote>>={};for(const s of syms)r[s]=quote(s)
  return NextResponse.json(r,{headers:{'Cache-Control':'public,s-maxage=60'}})
}
