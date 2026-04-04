'use client'
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100dvh', gap:16, padding:24, background:'#0a0c10', color:'#f0ece4' }}>
      <div style={{ fontSize:32 }}>⚠️</div>
      <div style={{ fontSize:16, fontWeight:700 }}>發生錯誤</div>
      <div style={{ fontSize:13, color:'#6a6050', textAlign:'center' }}>{error.message}</div>
      <button onClick={reset} style={{ background:'#d4af37', color:'#0a0c10', border:'none', borderRadius:10, padding:'10px 24px', fontWeight:800, cursor:'pointer' }}>
        重新載入
      </button>
    </div>
  )
}
