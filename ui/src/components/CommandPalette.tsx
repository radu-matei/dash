import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Activity, ArrowRight, Database, ExternalLink, FlaskConical, Globe,
  Hammer, Key, LayoutDashboard, Package, Plus, RefreshCw, ScrollText,
  Search, Sparkles, Trash2, TrendingUp, Zap,
} from 'lucide-react'
import { useAppStore } from '../store/appContext'
import { useLogStore } from '../store/logContext'
import { restartSpin, buildAndRestart } from '../api/client'

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = 'page' | 'action' | 'component' | 'variable' | 'service'

interface PaletteItem {
  id: string
  category: Category
  label: string
  description?: string
  Icon: React.FC<{ className?: string }>
  shortcut?: string
  onSelect: () => void
}

// ─── Context (so Layout can open the palette programmatically) ────────────────

interface CommandPaletteContextValue {
  open: () => void
}

const CommandPaletteCtx = createContext<CommandPaletteContextValue>({ open: () => {} })
export const useCommandPalette = () => useContext(CommandPaletteCtx)

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  return (
    <CommandPaletteCtx.Provider value={{ open }}>
      {children}
      <CommandPaletteInner isOpen={isOpen} onClose={() => setIsOpen(false)} onOpen={open} />
    </CommandPaletteCtx.Provider>
  )
}

// ─── Category labels ─────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<Category, string> = {
  page: 'Pages',
  action: 'Actions',
  component: 'Components',
  variable: 'Variables',
  service: 'Services',
}

const CATEGORY_ORDER: Category[] = ['page', 'action', 'component', 'variable', 'service']

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-spin-seagreen/25 text-inherit rounded-sm px-px">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
const modKey = isMac ? '⌘' : 'Ctrl+'

// ─── Inner component ─────────────────────────────────────────────────────────

function CommandPaletteInner({
  isOpen, onClose, onOpen,
}: {
  isOpen: boolean
  onClose: () => void
  onOpen: () => void
}) {
  const navigate = useNavigate()
  const { app, notifyRestart, notifyBuilding } = useAppStore()
  const { clear: clearLogs } = useLogStore()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null!)
  const listRef = useRef<HTMLDivElement>(null!)

  // ── Reset state on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // ── Global keyboard shortcut ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        isOpen ? onClose() : onOpen()
      }
      // Global action shortcuts (only when palette is NOT open)
      if (!isOpen && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault()
          restartSpin().catch(() => {}); notifyRestart()
        }
        if (e.key === 'b' || e.key === 'B') {
          e.preventDefault()
          buildAndRestart().catch(() => {}); notifyBuilding()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose, onOpen, notifyRestart, notifyBuilding])

  // ── Build result items ─────────────────────────────────────────────────────

  const exec = useCallback((fn: () => void) => {
    onClose()
    fn()
  }, [onClose])

  const items = useMemo((): PaletteItem[] => {
    const q = query.toLowerCase().trim()
    const out: PaletteItem[] = []

    // ── Pages ──────────────────────────────────────────────────────────────
    const pages: PaletteItem[] = [
      { id: 'p-overview', category: 'page', label: 'Overview', Icon: LayoutDashboard, onSelect: () => exec(() => navigate('/app')) },
      { id: 'p-logs', category: 'page', label: 'Logs', Icon: ScrollText, onSelect: () => exec(() => navigate('/logs')) },
      { id: 'p-traces', category: 'page', label: 'Traces', Icon: Activity, onSelect: () => exec(() => navigate('/traces')) },
      { id: 'p-metrics', category: 'page', label: 'Metrics', Icon: TrendingUp, onSelect: () => exec(() => navigate('/metrics')) },
      { id: 'p-kv', category: 'page', label: 'KV Explorer', Icon: Database, onSelect: () => exec(() => navigate('/kv')) },
      { id: 'p-tests', category: 'page', label: 'HTTP Tests', Icon: FlaskConical, onSelect: () => exec(() => navigate('/tests')) },
    ]
    if (!q) {
      out.push(...pages)
    } else {
      out.push(...pages.filter(p => p.label.toLowerCase().includes(q)))
    }

    // ── Actions ────────────────────────────────────────────────────────────
    const actions: PaletteItem[] = [
      { id: 'a-restart', category: 'action', label: 'Restart Spin', description: 'Restart the Spin process', Icon: RefreshCw, shortcut: `${modKey}⇧R`, onSelect: () => exec(() => { restartSpin().catch(() => {}); notifyRestart() }) },
      { id: 'a-build', category: 'action', label: 'Build & Restart', description: 'Run spin build, then restart', Icon: Hammer, shortcut: `${modKey}⇧B`, onSelect: () => exec(() => { buildAndRestart().catch(() => {}); notifyBuilding() }) },
      { id: 'a-clear-logs', category: 'action', label: 'Clear Logs', description: 'Clear all log output', Icon: Trash2, onSelect: () => exec(clearLogs) },
      { id: 'a-error-traces', category: 'action', label: 'Show Error Traces', description: 'View traces with errors', Icon: Zap, onSelect: () => exec(() => navigate('/traces?errors=1')) },
    ]
    if (app?.listenAddr) {
      actions.push({
        id: 'a-open-app', category: 'action', label: 'Open App', description: app.listenAddr.replace(/^https?:\/\//, ''),
        Icon: ExternalLink, onSelect: () => exec(() => window.open(app.listenAddr!, '_blank')),
      })
    }
    if (app?.allowMutations) {
      actions.push(
        { id: 'a-add-component', category: 'action', label: 'Add Component', description: 'Add a new component from a template', Icon: Plus, onSelect: () => exec(() => navigate('/app?dialog=add-component')) },
        { id: 'a-add-variable', category: 'action', label: 'Add Variable', description: 'Add a new application variable', Icon: Key, onSelect: () => exec(() => navigate('/app?dialog=add-variable')) },
        { id: 'a-add-service', category: 'action', label: 'Add Service Binding', description: 'Add a KV, SQLite, AI, or outbound host binding', Icon: Database, onSelect: () => exec(() => navigate('/app?dialog=add-service')) },
      )
    }
    if (!q) {
      out.push(...actions)
    } else {
      out.push(...actions.filter(a =>
        a.label.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q),
      ))
    }

    // ── Components ─────────────────────────────────────────────────────────
    if (app?.components.length) {
      const compItems: PaletteItem[] = []
      for (const c of app.components) {
        const trigger = app.triggers.find(t => t.component === c.id)
        const desc = trigger ? `${trigger.type.toUpperCase()} ${trigger.route ?? trigger.channel ?? ''}`.trim() : c.source
        compItems.push({
          id: `c-${c.id}`, category: 'component' as Category, label: c.id,
          description: desc, Icon: Package,
          onSelect: () => exec(() => navigate(`/app?component=${encodeURIComponent(c.id)}`)),
        })
        compItems.push({
          id: `c-${c.id}-logs`, category: 'component' as Category,
          label: `${c.id} logs`,
          description: `View logs for ${c.id}`, Icon: ScrollText,
          onSelect: () => exec(() => navigate(`/logs?component=${encodeURIComponent(c.id)}`)),
        })
        compItems.push({
          id: `c-${c.id}-traces`, category: 'component' as Category,
          label: `${c.id} traces`,
          description: `View traces for ${c.id}`, Icon: Activity,
          onSelect: () => exec(() => navigate(`/traces?component=${encodeURIComponent(c.id)}`)),
        })
      }
      if (q) {
        out.push(...compItems.filter(c =>
          c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
        ))
      }
    }

    // ── Variables ───────────────────────────────────────────────────────────
    if (app?.variableKeys.length) {
      const vars: PaletteItem[] = app.variableKeys.map(k => ({
        id: `v-${k}`, category: 'variable' as Category, label: k,
        description: 'Application variable', Icon: Key,
        onSelect: () => exec(() => navigate(`/app?select=variable:${encodeURIComponent(k)}`)),
      }))
      if (q) {
        out.push(...vars.filter(v => v.label.toLowerCase().includes(q)))
      }
    }

    // ── Services (KV, SQLite, AI models, outbound hosts) ────────────────────
    if (app?.components.length && q) {
      const seen = new Set<string>()

      for (const c of app.components) {
        for (const store of c.keyValueStores ?? []) {
          const id = `s-kv-${store}`
          if (seen.has(id)) continue
          seen.add(id)
          const searchable = `${store} key value kv`.toLowerCase()
          if (!searchable.includes(q)) continue
          out.push({
            id, category: 'service', label: store,
            description: `Key-Value store · used by ${c.id}`, Icon: Database,
            onSelect: () => exec(() => navigate(`/app?select=kv:${encodeURIComponent(store)}`)),
          })
        }

        for (const db of c.sqliteDatabases ?? []) {
          const id = `s-sql-${db}`
          if (seen.has(id)) continue
          seen.add(id)
          const searchable = `${db} sqlite database`.toLowerCase()
          if (!searchable.includes(q)) continue
          out.push({
            id, category: 'service', label: db,
            description: `SQLite database · used by ${c.id}`, Icon: Database,
            onSelect: () => exec(() => navigate(`/app?select=sqlite:${encodeURIComponent(db)}`)),
          })
        }

        for (const model of c.aiModels ?? []) {
          const id = `s-ai-${model}`
          if (seen.has(id)) continue
          seen.add(id)
          const searchable = `${model} ai model llm`.toLowerCase()
          if (!searchable.includes(q)) continue
          out.push({
            id, category: 'service', label: model,
            description: `AI model · used by ${c.id}`, Icon: Sparkles,
            onSelect: () => exec(() => navigate(`/app?select=ai:${encodeURIComponent(model)}`)),
          })
        }

        for (const host of c.allowedOutboundHosts ?? []) {
          const id = `s-host-${host}`
          if (seen.has(id)) continue
          seen.add(id)
          const searchable = `${host} outbound host network`.toLowerCase()
          if (!searchable.includes(q)) continue
          out.push({
            id, category: 'service', label: host,
            description: `Outbound host · allowed by ${c.id}`, Icon: Globe,
            onSelect: () => exec(() => navigate(`/app?select=host:${encodeURIComponent(host)}`)),
          })
        }
      }
    }

    return out
  }, [query, app, navigate, exec, clearLogs])

  // ── Group items by category ────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<Category, PaletteItem[]>()
    for (const item of items) {
      const arr = map.get(item.category) ?? []
      arr.push(item)
      map.set(item.category, arr)
    }
    return CATEGORY_ORDER.filter(c => map.has(c)).map(c => ({
      category: c,
      label: CATEGORY_LABELS[c],
      items: map.get(c)!,
    }))
  }, [items])

  // ── Clamp selection ────────────────────────────────────────────────────────
  useEffect(() => {
    setSelectedIndex(idx => Math.min(idx, Math.max(0, items.length - 1)))
  }, [items.length])

  // ── Scroll selected item into view ─────────────────────────────────────────
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // ── Keyboard navigation inside the palette ─────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % (items.length || 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + (items.length || 1)) % (items.length || 1))
        break
      case 'Enter':
        e.preventDefault()
        items[selectedIndex]?.onSelect()
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  if (!isOpen) return null

  let flatIdx = 0

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-spin-oxfordblue/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
        style={{ maxHeight: '60vh' }}
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
            placeholder="Search pages, actions, components, services…"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono text-gray-400">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain py-1">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
              <Search className="w-6 h-6 opacity-30" />
              <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            grouped.map(group => {
              return (
                <div key={group.category}>
                  <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    {group.label}
                  </p>
                  {group.items.map(item => {
                    const idx = flatIdx++
                    const isSelected = idx === selectedIndex
                    return (
                      <button
                        key={item.id}
                        data-selected={isSelected}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-spin-seagreen/10 text-spin-oxfordblue'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                        onClick={item.onSelect}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <item.Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-spin-midgreen' : 'text-gray-400'}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${item.category === 'service' ? 'font-mono text-xs' : 'font-medium'}`}>
                            {highlightMatch(item.label, query)}
                          </div>
                          {item.description && (
                            <div className="text-xs text-gray-400 truncate mt-0.5">
                              {highlightMatch(item.description, query)}
                            </div>
                          )}
                        </div>
                        {item.shortcut && (
                          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono text-gray-400 shrink-0">
                            {item.shortcut}
                          </kbd>
                        )}
                        <ArrowRight className={`w-3 h-3 shrink-0 ${isSelected ? 'text-spin-midgreen' : 'text-transparent'}`} />
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-px rounded border border-gray-200 bg-white font-mono">↑</kbd>
            <kbd className="px-1 py-px rounded border border-gray-200 bg-white font-mono">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-px rounded border border-gray-200 bg-white font-mono">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-px rounded border border-gray-200 bg-white font-mono">esc</kbd>
            close
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="px-1 py-px rounded border border-gray-200 bg-white font-mono">{modKey}K</kbd>
            toggle
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
