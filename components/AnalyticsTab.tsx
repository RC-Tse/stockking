'use client'

import { LineChart as LineChartIcon } from 'lucide-react'

export default function AnalyticsTab() {
  return (
    <div className="p-4 space-y-6 animate-slide-up">
      <div className="flex items-center gap-3 px-1 mb-2">
        <LineChartIcon className="text-accent" size={24} />
        <h2 className="text-xl font-black text-[var(--t1)] tracking-tight">分析</h2>
      </div>

      <div className="glass p-10 flex flex-col items-center justify-center text-center space-y-4 border border-white/10 shadow-2xl">
        <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center text-accent mb-2">
          <LineChartIcon size={40} />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-black text-[var(--t1)]">進階分析功能</h3>
          <p className="text-sm text-[var(--t2)] leading-relaxed max-w-[240px]">
            目標折線圖與各股趨勢圖 — 即將推出，敬請期待。
          </p>
        </div>
      </div>
    </div>
  )
}
