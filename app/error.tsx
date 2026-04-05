'use client'
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100dvh', gap:16, padding:24, background:'var(--bg-base)', color:'var(--t1)' }}>
      <div style={{ fontSize:32 }}>??</div>
      <div style={{ fontSize:16, fontWeight:700 }}>???誤</div>
      <div style={{ fontSize:13, color:'var(--t3)', textAlign:'center' }}>{error.message}</div>
      <button onClick={reset} style={{ background:'var(--accent)', color:'var(--bg-base)', border:'none', borderRadius:10, padding:'10px 24px', fontWeight:800, cursor:'pointer' }}>
        ?新載入
      </button>
    </div>
  )
}
