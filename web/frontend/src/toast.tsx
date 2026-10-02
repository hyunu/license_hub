import { useRef, useState } from 'react'

export interface Toast {
  id: number
  kind: 'ok' | 'bad'
  text: string
}

// 자동으로 사라지는 토스트 메시지.
// ok(성공) / bad(실패) 메시지를 쌓고 일정 시간 후 제거한다.
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)

  const push = (kind: 'ok' | 'bad', text: string, ms = 4200) => {
    const id = ++next.current
    setToasts((t) => [...t, { id, kind, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms)
  }

  const ok = (text: string) => push('ok', text)
  const bad = (text: string) => push('bad', text)

  return { toasts, ok, bad }
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}