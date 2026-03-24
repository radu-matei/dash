import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Unique key for persisting size in localStorage. */
  storageKey: string
  /** Layout direction. Horizontal = left/right split. Vertical = top/bottom split. */
  direction?: 'horizontal' | 'vertical'
  /** Default width in pixels (horizontal mode). */
  defaultWidth?: number
  /** Minimum width in pixels (horizontal mode). */
  minWidth?: number
  /** Maximum width in pixels (horizontal mode). */
  maxWidth?: number
  /** Default height in pixels (vertical mode). */
  defaultHeight?: number
  /** Minimum height in pixels (vertical mode). */
  minHeight?: number
  /** Maximum height in pixels (vertical mode). */
  maxHeight?: number
  /** Which side the panel sits on — determines handle placement. */
  side?: 'left' | 'right' | 'bottom'
  /** The panel content. */
  panel: ReactNode
  /** The main (flex-1) content. */
  children: ReactNode
}

const STORAGE_PREFIX = 'spin-panel-'

export default function ResizablePanel({
  storageKey,
  direction = 'horizontal',
  defaultWidth = 288,
  minWidth = 180,
  maxWidth = 600,
  defaultHeight = 300,
  minHeight = 120,
  maxHeight = 600,
  side = direction === 'vertical' ? 'bottom' : 'left',
  panel,
  children,
}: Props) {
  const isVertical = direction === 'vertical'
  const defaultSize = isVertical ? defaultHeight : defaultWidth
  const minSize = isVertical ? minHeight : minWidth
  const maxSize = isVertical ? maxHeight : maxWidth

  const [size, setSize] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + storageKey)
      if (stored) return Math.max(minSize, Math.min(maxSize, Number(stored)))
    } catch { /* */ }
    return defaultSize
  })

  const isDragging = useRef(false)
  const dragStart = useRef(0)
  const dragStartSize = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStart.current = isVertical ? e.clientY : e.clientX
    dragStartSize.current = size
    document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize'
    e.preventDefault()
  }, [size, isVertical])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const pos = isVertical ? e.clientY : e.clientX
      // For bottom panel: dragging up = larger panel (negative delta)
      // For left panel: dragging right = larger panel (positive delta)
      const delta = side === 'left'
        ? pos - dragStart.current
        : dragStart.current - pos
      setSize(Math.max(minSize, Math.min(maxSize, dragStartSize.current + delta)))
    }
    const onUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      try { localStorage.setItem(STORAGE_PREFIX + storageKey, String(size)) } catch { /* */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [minSize, maxSize, side, storageKey, size, isVertical])

  // ── Vertical (top/bottom) layout ──────────────────────────────────────────

  if (isVertical) {
    const handle = (
      <div
        className="h-[7px] shrink-0 cursor-row-resize bg-white border-t border-gray-200 hover:bg-spin-oxfordblue/5 active:bg-spin-oxfordblue/10 transition-colors duration-150 flex items-center justify-center group"
        onMouseDown={onMouseDown}
      >
        <div className="w-10 h-[3px] rounded-full bg-gray-300 group-hover:bg-spin-oxfordblue/40 transition-colors duration-150" />
      </div>
    )

    const panelDiv = (
      <div className="shrink-0 flex flex-col overflow-hidden bg-white" style={{ height: size }}>
        {panel}
      </div>
    )

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</div>
        {handle}
        {panelDiv}
      </div>
    )
  }

  // ── Horizontal (left/right) layout ────────────────────────────────────────

  const handle = (
    <div
      className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-spin-oxfordblue/20 active:bg-spin-oxfordblue/30 transition-colors duration-150 flex items-center justify-center group"
      onMouseDown={onMouseDown}
    >
      <div className="h-10 w-0.5 rounded-full bg-gray-300 group-hover:bg-spin-oxfordblue/40 transition-colors duration-150" />
    </div>
  )

  const panelDiv = (
    <div className="shrink-0 flex flex-col overflow-hidden bg-white" style={{ width: size }}>
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
