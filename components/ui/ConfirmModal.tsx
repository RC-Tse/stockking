'use client'

import { AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  title?: string
  message?: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  confirmColor?: string
}

export default function ConfirmModal({ 
  open, 
  title = "確認刪除", 
  message = "此操作無法復原，確定要刪除紀錄？", 
  onConfirm, 
  onCancel,
  confirmText = "確認刪除",
  confirmColor = "bg-red-500"
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm glass p-6 rounded-3xl border border-[var(--t3)] space-y-6 animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-2">
            <AlertTriangle size={24} />
          </div>
          <h3 className="font-black text-xl text-[var(--t1)] tracking-tight">{title}</h3>
          <p className="text-sm text-[var(--t2)] leading-relaxed">{message}</p>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={onCancel}
            className="w-full py-4 rounded-2xl font-black text-base bg-white/5 text-[var(--t2)] hover:bg-white/10 active:scale-[0.98] transition-all"
          >
            取消
          </button>
          <button 
            onClick={onConfirm}
            className={`w-full py-4 rounded-2xl font-black text-base text-white ${confirmColor} active:scale-[0.98] transition-all shadow-lg`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
