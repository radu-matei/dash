import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Unique key for persisting width in localStorage. */
  storageKey: string
  /** Default width in pixels when no persisted value exists. */
  defaultWidth: number
  /** Minimum width in pixels. */
  minWidth?: number
  /** Maximum width in pixels. */
  maxWidth?: number
  /** Which side the panel sits on — determines handle placement. */
  side?: 'left' | 'right'
  /** The panel content. */
  panel: ReactNode
  /** The main (flex-1) content. */
  children: ReactNode
}

const STORAGE_PREFIX = 'spin-panel-'

export default function ResizablePanel({
  storageKey,
  defaultWidth,
  minWidth = 180,
  maxWidth = 600,
  side = 'left',
  panel,
  children,
}: Props) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + storageKey)
      if (stored) return Math.max(minWidth, Math.min(maxWidth, Number(stored)))
    } catch { /* */ }
    return defaultWidth
  })

  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = width
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }, [width])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = side === 'left'
        ? e.clientX - dragStartX.current
        : dragStartX.current - e.clientX
      setWidth(Math.max(minWidth, Math.min(maxWidth, dragStartW.current + delta)))
    }
    const onUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      try { localStorage.setItem(STORAGE_PREFIX + storageKey, String(width)) } catch { /* */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [minWidth, maxWidth, side, storageKey, width])

  const handle = (
    <div
      className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-spin-oxfordblue/20 active:bg-spin-oxfordblue/30 transition-colors duration-150 flex items-center justify-center group"
      onMouseDown={onMouseDown}
    >
      <div className="h-10 w-0.5 rounded-full bg-gray-300 group-hover:bg-spin-oxfordblue/40 transition-colors duration-150" />
    </div>
  )

  const panelDiv = (
    <div className="shrink-0 flex flex-col overflow-hidden bg-white" style={{ width }}>
      {panel}
    </div>
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {side === 'left' ? (
        <>
          {panelDiv}
          {handle}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
        </>
      ) : (
        <>
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
          {handle}
          {panelDiv}
        </>
      )}
    </div>
  )
}
