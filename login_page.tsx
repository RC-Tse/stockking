'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function signIn() {
    setLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Ambient orb */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(201,165,100,0.07) 0%, transparent 65%)',
          filter: 'blur(50px)',
        }}
      />

      {/* Hero */}
      <div className="relative z-10 text-center mb-10">
        <div
          className="text-[72px] leading-none mb-5 select-none"
          style={{ filter: 'drop-shadow(0 4px 24px rgba(201,165,100,0.4))' }}
        >
          👑
        </div>
        <h1
          className="text-gold text-4xl font-black tracking-tight"
          style={{ letterSpacing: '-0.02em' }}
        >
          少年存股王
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--t2)' }}>
          讓每一分錢都發光
        </p>
        <div className="mt-5 flex items-center gap-3 justify-center">
          <div className="h-px w-12" style={{ background: 'var(--border-bright)' }} />
          <span
            className="text-xs font-mono tracking-widest"
            style={{ color: 'var(--gold)' }}
          >
            台股投資追蹤系統
          </span>
          <div className="h-px w-12" style={{ background: 'var(--border-bright)' }} />
        </div>
      </div>

      {/* Card */}
      <div
        className="glass relative z-10 w-full max-w-xs p-7"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)' }}
      >
        <h2 className="font-bold text-base text-center mb-1" style={{ color: 'var(--t1)' }}>
          登入您的帳戶
        </h2>
        <p className="text-xs text-center mb-6" style={{ color: 'var(--t3)' }}>
          資料雲端同步，跨裝置即時存取
        </p>

        <button
          onClick={signIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95"
          style={{
            background: loading ? 'var(--bg-hover)' : 'var(--t1)',
            color: 'var(--bg-base)',
            boxShadow: loading ? 'none' : '0 4px 24px rgba(201,165,100,0.2)',
          }}
        >
          {loading ? (
            <>
              <span
                className="w-4 h-4 rounded-full border-2 animate-spin inline-block"
                style={{ borderColor: 'rgba(0,0,0,0.2)', borderTopColor: 'var(--bg-base)' }}
              />
              連線中…
            </>
          ) : (
            <>
              <GoogleIcon />
              使用 Google 帳號登入
            </>
          )}
        </button>

        <p className="text-xs text-center mt-4" style={{ color: 'var(--t3)' }}>
          登入即同意個人資料用於帳號管理
        </p>
      </div>

      {/* Feature pills */}
      <div className="relative z-10 flex flex-wrap gap-2 justify-center mt-7 max-w-xs">
        {['☁️ 雲端同步', '📱 iOS PWA', '📊 盈虧月曆', '💼 持股追蹤', '💡 概念股'].map((f) => (
          <span
            key={f}
            className="text-xs px-2.5 py-1 rounded-full"
            style={{
              background: 'var(--gold-dim)',
              color: 'var(--gold)',
              border: '1px solid var(--border-bright)',
            }}
          >
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.18 17.64 11.87 17.64 9.2z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}
