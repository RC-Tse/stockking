'use client'

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="h-[280px] w-full bg-[var(--bg-card)] rounded-[40px] border border-[var(--border-bright)] border-dashed flex flex-col items-center justify-center p-8 text-center animate-slide-up">
          <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center mb-4">
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <h4 className="text-[14px] font-black text-[var(--t1)] uppercase tracking-wider mb-2">圖表引擎載入異常</h4>
          <p className="text-[11px] text-[var(--t3)] leading-relaxed max-w-[200px] mb-6 font-bold uppercase tracking-tight">
            目前無法處理部分歷史股價資料，請重新整理頁面。
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black text-[var(--t2)] uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
          >
            <RefreshCw size={14} /> 重新整理
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
