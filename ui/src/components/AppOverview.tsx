import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Globe,
  Hammer,
  Key,
  Layers,
  Loader2,
  Lock,
  Network,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { Icon } from '@iconify/react'
import { type ComponentInfo, type TriggerInfo, type VarEntry, getVars, removeBinding, restartSpin } from '../api/client'
import { useAppStore } from '../store/appContext'
import AddComponentDialog from './AddComponentDialog'
import AddBindingDialog from './AddBindingDialog'
import AddVariableDialog from './AddVariableDialog'
import EditSpinTomlModal from './EditSpinTomlModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

interface LangTag { label: string; iconName: string }

function detectLang(comp: ComponentInfo): LangTag | null {
  const src = comp.source ?? ''
  const cmd = comp.build?.command ?? ''
  const watch = (comp.build?.watch ?? []).join(' ')

  if (/spin.static.fs|spin.fileserver|fileserver/i.test(src))
    return { label: 'Static Files', iconName: 'simple-icons:files' }

  if (/\bnpm\b|\byarn\b|\bpnpm\b|\bbun\b/.test(cmd)) {
    const isTS = /\.tsx?|typescript/i.test(watch)
    return isTS
      ? { label: 'TypeScript', iconName: 'simple-icons:typescript' }
      : { label: 'JavaScript', iconName: 'simple-icons:javascript' }
  }

  if (/\bcargo\b/.test(cmd))
    return { label: 'Rust', iconName: 'simple-icons:rust' }
  if (/\btinygo\b/.test(cmd) || /\bgo build\b|\bgo run\b/.test(cmd))
    return { label: 'Go', iconName: 'simple-icons:go' }
  if (/\bcomponentize-py\b|\bpython\b|\bpip\b/.test(cmd))
    return { label: 'Python', iconName: 'simple-icons:python' }
  if (/\bdotnet\b/.test(cmd))
    return { label: 'C# / .NET', iconName: 'simple-icons:dotnet' }
  if (/\bjava\b|\bmvn\b|\bgradle\b/.test(cmd))
    return { label: 'Java', iconName: 'simple-icons:openjdk' }

  return null
}

function LangIcon({ comp, size = 16 }: { comp: ComponentInfo; size?: number }) {
  const lang = detectLang(comp)
  if (!lang) return null
  return (
    <span title={lang.label} className="shrink-0 flex items-center">
      <Icon icon={lang.iconName} width={size} height={size} className="text-gray-500" />
    </span>
  )
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status, error }: { status: string; error: string }) {
  const cfg: Record<string, { cls: string; Icon: typeof CheckCircle2; label: string }> = {
    running:  { cls: 'badge-green',  Icon: CheckCircle2, label: 'Running'  },
    starting: { cls: 'badge-yellow', Icon: Clock,        label: 'Starting' },
    stopped:  { cls: 'badge-gray',   Icon: Clock,        label: 'Stopped'  },
    error:    { cls: 'badge-red',    Icon: AlertCircle,  label: 'Error'    },
  }
  const { cls, Icon, label } = cfg[status] ?? cfg.stopped
  return (
    <span className={cls + ' badge text-xs'} title={error || undefined}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// ─── Trigger type utils ───────────────────────────────────────────────────────

// Wrap an Iconify icon name into a component with the same (className) API as
// a Lucide component so both can be stored in the same map and rendered the
// same way: <SomeIcon className="w-4 h-4 text-red-500" />
function iconifyIcon(name: string): React.FC<{ className?: string }> {
  const C = ({ className }: { className?: string }) => (
    <Icon icon={name} className={className} />
  )
  C.displayName = name
  return C
}

interface TriggerMeta {
  /** Icon component — accepts className, works like a Lucide icon. */
  icon: React.FC<{ className?: string }>
  /** Short human-readable label (shown in graph nodes and badges). */
  label: string
  /** Tailwind color family used for the topology node and badge. */
  color: 'green' | 'red' | 'orange' | 'purple' | 'teal' | 'blue' | 'gray'
}

const TRIGGER_META: Record<string, TriggerMeta> = {
  http:    { icon: Globe,                                        label: 'HTTP',    color: 'green'  },
  redis:   { icon: iconifyIcon('simple-icons:redis'),            label: 'Redis',   color: 'red'    },
  valkey:  { icon: iconifyIcon('simple-icons:valkey'),           label: 'Valkey',  color: 'red'    },
  mqtt:    { icon: iconifyIcon('simple-icons:mqtt'),             label: 'MQTT',    color: 'teal'   },
  amqp:    { icon: iconifyIcon('simple-icons:rabbitmq'),         label: 'AMQP',    color: 'orange' },
  command: { icon: Terminal,                                     label: 'Command', color: 'blue'   },
  cron:    { icon: Clock,                                        label: 'Cron',    color: 'purple' },
}

function getTriggerMeta(type: string): TriggerMeta {
  return TRIGGER_META[type] ?? { icon: Zap, label: type.toUpperCase(), color: 'gray' }
}

/** Per-color-family Tailwind classes for trigger topology nodes. */
const TRIGGER_NODE_COLORS: Record<TriggerMeta['color'], {
  hi: string; sec: string; def: string
  iconBgHi: string; iconBgDef: string; iconColor: string; labelColor: string
}> = {
  green:  { hi: 'bg-green-50 border-2 border-green-400 shadow-md shadow-green-100',    sec: 'bg-green-50/60 border border-green-300 shadow-sm',    def: 'bg-white border border-gray-200 shadow-sm hover:border-green-300 hover:shadow',   iconBgHi: 'bg-green-100 border-green-200',   iconBgDef: 'bg-green-50 border-green-100',   iconColor: 'text-green-600',  labelColor: 'text-green-700'  },
  red:    { hi: 'bg-red-50 border-2 border-red-400 shadow-md shadow-red-100',          sec: 'bg-red-50/60 border border-red-300 shadow-sm',        def: 'bg-white border border-gray-200 shadow-sm hover:border-red-300 hover:shadow',     iconBgHi: 'bg-red-100 border-red-200',       iconBgDef: 'bg-red-50 border-red-100',       iconColor: 'text-red-600',    labelColor: 'text-red-700'    },
  orange: { hi: 'bg-orange-50 border-2 border-orange-400 shadow-md shadow-orange-100', sec: 'bg-orange-50/60 border border-orange-300 shadow-sm',  def: 'bg-white border border-gray-200 shadow-sm hover:border-orange-300 hover:shadow', iconBgHi: 'bg-orange-100 border-orange-200', iconBgDef: 'bg-orange-50 border-orange-100', iconColor: 'text-orange-600', labelColor: 'text-orange-700' },
  purple: { hi: 'bg-purple-50 border-2 border-purple-400 shadow-md shadow-purple-100', sec: 'bg-purple-50/60 border border-purple-300 shadow-sm',  def: 'bg-white border border-gray-200 shadow-sm hover:border-purple-300 hover:shadow', iconBgHi: 'bg-purple-100 border-purple-200', iconBgDef: 'bg-purple-50 border-purple-100', iconColor: 'text-purple-600', labelColor: 'text-purple-700' },
  teal:   { hi: 'bg-teal-50 border-2 border-teal-400 shadow-md shadow-teal-100',       sec: 'bg-teal-50/60 border border-teal-300 shadow-sm',      def: 'bg-white border border-gray-200 shadow-sm hover:border-teal-300 hover:shadow',   iconBgHi: 'bg-teal-100 border-teal-200',     iconBgDef: 'bg-teal-50 border-teal-100',     iconColor: 'text-teal-600',   labelColor: 'text-teal-700'   },
  blue:   { hi: 'bg-blue-50 border-2 border-blue-400 shadow-md shadow-blue-100',       sec: 'bg-blue-50/60 border border-blue-300 shadow-sm',      def: 'bg-white border border-gray-200 shadow-sm hover:border-blue-300 hover:shadow',   iconBgHi: 'bg-blue-100 border-blue-200',     iconBgDef: 'bg-blue-50 border-blue-100',     iconColor: 'text-blue-600',   labelColor: 'text-blue-700'   },
  gray:   { hi: 'bg-gray-100 border-2 border-gray-400 shadow-md',                      sec: 'bg-gray-50/60 border border-gray-300 shadow-sm',      def: 'bg-white border border-gray-200 shadow-sm hover:border-gray-400 hover:shadow',   iconBgHi: 'bg-gray-200 border-gray-300',     iconBgDef: 'bg-gray-100 border-gray-200',    iconColor: 'text-gray-500',   labelColor: 'text-gray-600'   },
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, Icon, accent }: {
  label: string; value: string | number; Icon: typeof Layers; accent?: boolean
}) {
  return (
    <div className={`card p-4 flex items-center gap-4 ${accent ? 'border-spin-seagreen/40' : ''}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accent ? 'bg-spin-seagreen/15' : 'bg-gray-100'}`}>
        <Icon className={`w-5 h-5 ${accent ? 'text-spin-midgreen' : 'text-gray-500'}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ─── Detail pane ──────────────────────────────────────────────────────────────

function PaneSection({
  title, Icon, count, children,
}: {
  title: string; Icon: typeof Layers; count?: number; children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        {count !== undefined && (
          <span className="text-xs text-gray-400 font-normal">{count} {count === 1 ? 'item' : 'items'}</span>
        )}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function InfoRow({
  Icon: RowIcon, main, sub, tag, tagColor = 'gray', onClick,
}: {
  Icon: React.FC<{ className?: string }>
  main: React.ReactNode
  sub?: string
  tag?: string
  tagColor?: 'gray' | 'green' | 'purple' | 'blue' | 'red' | 'orange' | 'teal'
  onClick?: () => void
}) {
  const tagCls = ({
    gray:   'bg-gray-100 text-gray-500',
    green:  'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
    blue:   'bg-blue-50 text-blue-700',
    red:    'bg-red-50 text-red-700',
    orange: 'bg-orange-50 text-orange-700',
    teal:   'bg-teal-50 text-teal-700',
  } as Record<string, string>)[tagColor] ?? 'bg-gray-100 text-gray-500'

  const inner = (
    <>
      <RowIcon className="w-4 h-4 text-gray-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-800 font-mono truncate">{main}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {tag && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${tagCls}`}>{tag}</span>
      )}
      {onClick && (
        <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 -mr-0.5" />
      )}
    </>
  )

  if (onClick) {
    return (
      <button
        className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors group"
        onClick={onClick}
      >
        {inner}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
      {inner}
    </div>
  )
}

function hostDescription(h: string): string {
  if (h === '*' || h === 'https://*' || h.includes('*:*')) return 'Wildcard allowing all hosts'
  if (h.includes('127.0.0.1') || h.includes('localhost')) return 'Local / loopback access'
  if (h.includes('*')) return 'Wildcard pattern'
  return 'Specific host'
}

// ─── Shared drag-to-resize hook ───────────────────────────────────────────────

function usePaneResize(
  paneWidth: number,
  onPaneWidthChange: (w: number) => void,
) {
  const isDragging  = useRef(false)
  const dragStartX  = useRef(0)
  const dragStartW  = useRef(0)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = dragStartX.current - e.clientX
      onPaneWidthChange(Math.max(260, Math.min(700, dragStartW.current + delta)))
    }
    const onUp = () => { isDragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = paneWidth
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }

  return handleMouseDown
}

// ─── Detail pane (component) ──────────────────────────────────────────────────

function DetailPane({
  component: c, onClose, onSelect, canMutate, paneWidth, onPaneWidthChange,
}: {
  component: ComponentInfo
  onClose: () => void
  onSelect: (s: Selection) => void
  canMutate: boolean
  paneWidth: number
  onPaneWidthChange: (w: number) => void
}) {
  const { refresh } = useAppStore()
  const handleDragMouseDown = usePaneResize(paneWidth, onPaneWidthChange)

  const [deletingBinding, setDeletingBinding] = useState<{ type: 'kv' | 'sqlite'; name: string } | null>(null)

  async function handleRemoveBinding(type: 'kv' | 'sqlite', name: string) {
    setDeletingBinding({ type, name })
    try {
      await removeBinding(c.id, type, name)
      refresh()
    } catch {
      // error is transient; just unblock the UI
    } finally {
      setDeletingBinding(null)
    }
  }
  const lang     = detectLang(c)
  const size     = c.sourceSize ? fmtBytes(c.sourceSize) : null
  const digest   = c.sourceDigest   // e.g. "sha256:abc123..."
  const isRemote = c.source?.startsWith('http')

  const buildItems = [
    ...(c.build?.workdir  ? [{ kind: 'workdir',  value: c.build.workdir  }] : []),
    ...(c.build?.command  ? [{ kind: 'command',  value: c.build.command  }] : []),
    ...(c.build?.watch?.length ? [{ kind: 'watch', value: c.build.watch.join(', ') }] : []),
  ]

  return (
    <div
      className="shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden relative"
      style={{ width: paneWidth }}
    >
      {/* Drag handle — left edge */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-blue-300/60 active:bg-blue-400/70 transition-colors"
        onMouseDown={handleDragMouseDown}
      />
      {/* ── Header ── */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 bg-white border-b border-gray-100 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-gray-900">{c.id}</span>
            {lang && <LangIcon comp={c} size={18} />}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Wasm</span>
            {digest && (
              <code className="text-xs text-gray-400 font-mono" title={digest}>
                @{digest.slice(0, 19)}…
              </code>
            )}
            {!digest && size && (
              <span className="text-xs text-gray-400">{size}</span>
            )}
            {!digest && !size && isRemote && (
              <code className="text-xs text-gray-400 font-mono truncate max-w-[200px]" title={c.source}>{c.source}</code>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors shrink-0 ml-3 mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Triggers */}
        {c.triggers && c.triggers.length > 0 && (
          <PaneSection title="Triggers" Icon={Zap} count={c.triggers.length}>
            {c.triggers.map((t, i) => {
              const meta  = getTriggerMeta(t.type)
              if (t.private) {
                return (
                  <InfoRow key={i} Icon={Lock}
                    main="Private endpoint"
                    sub="Internal only · reachable via local service chaining"
                    tag="Private" tagColor="gray"
                    onClick={() => onSelect({ kind: 'trigger-group', triggerType: t.type })}
                  />
                )
              }
              const route = t.route ?? t.channel ?? t.address ?? '—'
              return (
                <InfoRow key={i} Icon={meta.icon} main={route}
                  sub={`${meta.label} trigger`}
                  tag={meta.label.toUpperCase()}
                  tagColor={meta.color as 'green' | 'red' | 'orange' | 'teal' | 'purple' | 'blue' | 'gray'}
                  onClick={() => onSelect({ kind: 'trigger-group', triggerType: t.type })}
                />
              )
            })}
          </PaneSection>
        )}

        {/* Build Configuration */}
        {buildItems.length > 0 && (
          <PaneSection title="Build Configuration" Icon={Hammer} count={buildItems.length}>
            {buildItems.map((item, i) => {
              const cfg = {
                workdir: { Icon: FolderOpen, sub: 'Working directory',  tag: 'Directory' },
                command: { Icon: Code2,      sub: 'Build command',       tag: 'Command'   },
                watch:   { Icon: RefreshCw,  sub: 'Watch patterns',      tag: 'Watch'     },
              }[item.kind]!
              return <InfoRow key={i} Icon={cfg.Icon} main={item.value} sub={cfg.sub} tag={cfg.tag} />
            })}
          </PaneSection>
        )}

        {/* Network Access */}
        {c.allowedOutboundHosts && c.allowedOutboundHosts.length > 0 && (
          <PaneSection title="Network Access" Icon={Globe} count={c.allowedOutboundHosts.length}>
            {c.allowedOutboundHosts.map(h => (
              <InfoRow key={h} Icon={ExternalLink} main={h} sub={hostDescription(h)} tag="✓ Allowed" tagColor="green" />
            ))}
          </PaneSection>
        )}

        {/* Files */}
        {c.files && c.files.length > 0 && (
          <PaneSection title="Mounted Files" Icon={FolderOpen} count={c.files.length}>
            {c.files.map((f, i) => (
              <InfoRow key={i} Icon={FileText}
                main={f.source}
                sub={f.destination ? `→ ${f.destination}` : undefined}
                tag="Files"
              />
            ))}
          </PaneSection>
        )}

        {/* KV Stores */}
        {c.keyValueStores && c.keyValueStores.length > 0 && (
          <PaneSection title="Key-Value Stores" Icon={Key} count={c.keyValueStores.length}>
            {c.keyValueStores.map(s => {
              const isDeleting = deletingBinding?.type === 'kv' && deletingBinding.name === s
              return (
                <div key={s} className="flex items-center gap-1 group">
                  <div className="flex-1 min-w-0">
                    <InfoRow Icon={Key} main={s} sub="Key-value store" tag="KV Store" tagColor="purple"
                      onClick={() => onSelect({ kind: 'resource', resKind: 'kv', resName: s })}
                    />
                  </div>
                  {canMutate && (
                    <button
                      className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title={`Remove "${s}" binding`}
                      disabled={!!deletingBinding}
                      onClick={() => handleRemoveBinding('kv', s)}
                    >
                      {isDeleting
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              )
            })}
          </PaneSection>
        )}

        {/* SQLite */}
        {c.sqliteDatabases && c.sqliteDatabases.length > 0 && (
          <PaneSection title="SQLite Databases" Icon={Database} count={c.sqliteDatabases.length}>
            {c.sqliteDatabases.map(s => {
              const isDeleting = deletingBinding?.type === 'sqlite' && deletingBinding.name === s
              return (
                <div key={s} className="flex items-center gap-1 group">
                  <div className="flex-1 min-w-0">
                    <InfoRow Icon={Database} main={s} sub="SQLite database" tag="SQLite" tagColor="blue"
                      onClick={() => onSelect({ kind: 'resource', resKind: 'sqlite', resName: s })}
                    />
                  </div>
                  {canMutate && (
                    <button
                      className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title={`Remove "${s}" database`}
                      disabled={!!deletingBinding}
                      onClick={() => handleRemoveBinding('sqlite', s)}
                    >
                      {isDeleting
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              )
            })}
          </PaneSection>
        )}

        {/* Variables — wired to this component */}
        {c.variables && Object.keys(c.variables).length > 0 && (
          <PaneSection title="Variables" Icon={Key} count={Object.keys(c.variables).length}>
            {Object.entries(c.variables).map(([k, v]) => (
              <InfoRow key={k} Icon={Key}
                main={k}
                sub={v || '(empty)'}
                tagColor="gray"
                onClick={() => onSelect({ kind: 'variable', varName: k })}
              />
            ))}
          </PaneSection>
        )}

        {/* Source (always last, for reference) */}
        {!isRemote && c.source && (
          <PaneSection title="Source" Icon={Code2}>
            <InfoRow Icon={Code2} main={c.source} sub={size ? `${size} on disk` : 'Local file'} tag="Local" />
          </PaneSection>
        )}
      </div>
    </div>
  )
}

// ─── Topology graph ───────────────────────────────────────────────────────────
// Column layout: Triggers → Components → Resources → Variables
// Service bindings will slot in as a new column between Resources and Variables.

// Standard node dimensions (triggers, components, resources)
const NODE_H  = 56
const NODE_W  = 210
const GAP     = 14
const COL_GAP = 100
const COMP_X  = NODE_W + COL_GAP
const RES_X   = COMP_X + NODE_W + COL_GAP
const PADDING = 24

// Variable nodes are more compact so a long list doesn't tower over the rest.
// The column sits further right to give the sweeping variable-binding arcs
// enough room — variable edges always originate from the *component* right
// edge and sweep past the resource column, so the curves need visual space.
const VAR_NODE_H  = 40
const VAR_NODE_W  = 190
const VAR_GAP     = 6
const VAR_COL_GAP = 120
const VAR_X       = RES_X + NODE_W + VAR_COL_GAP

// Compound bezier with adjustable control-point bias.
// bias=0.5 gives a symmetric S-curve; bias<0.5 pushes the bend towards x1.
function bezBiased(x1: number, y1: number, x2: number, y2: number, bias = 0.5) {
  const cx1 = x1 + (x2 - x1) * bias
  const cx2 = x1 + (x2 - x1) * (1 - bias)
  return `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`
}

function colH(n: number) { return n * NODE_H + Math.max(0, n - 1) * GAP }
function nodeY(off: number, i: number) { return off + i * (NODE_H + GAP) }
function colOff(n: number, total: number) {
  return PADDING + Math.max(0, (total - PADDING * 2 - colH(n)) / 2)
}
function varColH(n: number) { return n * VAR_NODE_H + Math.max(0, n - 1) * VAR_GAP }
function varNodeY(off: number, i: number) { return off + i * (VAR_NODE_H + VAR_GAP) }
function varColOff(n: number, total: number) {
  return PADDING + Math.max(0, (total - PADDING * 2 - varColH(n)) / 2)
}
function bez(x1: number, y1: number, x2: number, y2: number) {
  const cx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`
}

// Clicking a component opens its detail pane.
// Clicking a trigger-group opens the trigger pane.
// Clicking a variable node opens the variable pane.
// Clicking a resource (KV/SQLite) opens the resource pane.
type Selection =
  | { kind: 'component';     componentId: string }
  | { kind: 'trigger-group'; triggerType: string }
  | { kind: 'variable';      varName: string }
  | { kind: 'resource';      resKind: 'kv' | 'sqlite'; resName: string }

// Hover target — any node type.
type ActiveTarget =
  | { kind: 'trigger-group'; triggerType: string }
  | { kind: 'component';     componentId: string }
  | { kind: 'resource';      resKind: 'kv' | 'sqlite'; resName: string }
  | { kind: 'variable';      varName: string }

function selectionToActive(s: Selection): ActiveTarget {
  if (s.kind === 'trigger-group') return { kind: 'trigger-group', triggerType: s.triggerType }
  if (s.kind === 'variable')      return { kind: 'variable', varName: s.varName }
  if (s.kind === 'resource')      return { kind: 'resource', resKind: s.resKind, resName: s.resName }
  return { kind: 'component', componentId: s.componentId }
}

/**
 * Returns true if a component "uses" an app-level variable — either by having
 * it as a direct binding key OR by referencing it inside a composite value like
 *   redis_url = "redis://{{ redis_password }}@{{ redis_address }}"
 */
function componentUsesVar(c: ComponentInfo, varName: string): boolean {
  const vars = c.variables ?? {}
  if (varName in vars) return true
  // Check mustache references in values: {{ varName }} (with optional spaces)
  const pattern = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`)
  return Object.values(vars).some(v => pattern.test(v))
}

function TopologyGraph({
  components, triggers, variableKeys, selected, onSelect,
}: {
  components: ComponentInfo[]
  triggers: TriggerInfo[]
  /** App-level variable names declared in [variables]. */
  variableKeys: string[]
  selected: Selection | null
  onSelect: (s: Selection | null) => void
}) {
  const [hovered, setHovered] = useState<ActiveTarget | null>(null)

  // Hovered takes priority; otherwise fall back to the pinned selection.
  const active: ActiveTarget | null = hovered ?? (selected ? selectionToActive(selected) : null)

  // ── Trigger groups ────────────────────────────────────────────────────────
  // Group triggers by type so we render ONE node per type with multiple arrows.
  // We preserve insertion order: the first component that uses each type
  // determines the group's position in the list (minimises edge crossings).
  const sortedTriggers = components.flatMap(c => triggers.filter(t => t.component === c.id))
  const knownComponentIds = new Set(components.map(c => c.id))
  sortedTriggers.push(...triggers.filter(t => !knownComponentIds.has(t.component)))

  interface TriggerGroup { type: string; triggers: TriggerInfo[] }
  const triggerGroups: TriggerGroup[] = []
  for (const t of sortedTriggers) {
    const existing = triggerGroups.find(g => g.type === t.type)
    if (existing) existing.triggers.push(t)
    else triggerGroups.push({ type: t.type, triggers: [t] })
  }

  // Resources (KV + SQLite)
  const kvStores  = [...new Set(components.flatMap(c => c.keyValueStores  ?? []))]
  const sqliteDbs = [...new Set(components.flatMap(c => c.sqliteDatabases ?? []))]
  const resources = [
    ...kvStores.map(n  => ({ kind: 'kv'     as const, name: n })),
    ...sqliteDbs.map(n => ({ kind: 'sqlite' as const, name: n })),
  ]
  const hasResources = resources.length > 0

  // Use app-level declared variables as nodes. Edges are drawn only to
  // components that have the variable wired in [component.id.variables].
  const varNames = variableKeys
  const hasVars  = varNames.length > 0

  // Canvas dimensions — groups replace individual triggers in the height calc.
  const rightmostX = hasVars ? VAR_X : hasResources ? RES_X : COMP_X
  const rightmostW = hasVars ? VAR_NODE_W : NODE_W
  const svgW   = rightmostX + rightmostW + PADDING
  const innerH = Math.max(
    colH(triggerGroups.length),
    colH(components.length),
    colH(resources.length),
    varColH(varNames.length),
  )
  const totalH = innerH + PADDING * 2

  const tOff = colOff(triggerGroups.length, totalH)
  const cOff = colOff(components.length, totalH)
  const rOff = colOff(resources.length, totalH)
  const vOff = varColOff(varNames.length, totalH)

  const sharedCount = (kind: string, name: string) =>
    components.filter(c =>
      kind === 'kv'
        ? (c.keyValueStores  ?? []).includes(name)
        : (c.sqliteDatabases ?? []).includes(name)
    ).length

  // ── Edge visibility helpers ───────────────────────────────────────────────

  // An edge from a trigger group is lit when:
  //  • that trigger group is active (all its edges light up)
  //  • the target component is active (only the edge to it lights up)
  const triggerEdgeActive = (triggerType: string, compId: string): boolean => {
    if (!active) return false
    if (active.kind === 'trigger-group') return active.triggerType === triggerType
    if (active.kind === 'component')     return active.componentId === compId
    return false
  }

  const resourceEdgeActive = (compId: string, resKind: 'kv' | 'sqlite', resName: string): boolean => {
    if (!active) return false
    if (active.kind === 'component')     return active.componentId === compId
    if (active.kind === 'trigger-group') return triggers.some(t => t.component === compId && t.type === active.triggerType)
    if (active.kind === 'resource')      return active.resKind === resKind && active.resName === resName
    return false
  }

  const varEdgeActive = (compId: string, varName: string): boolean => {
    if (!active) return false
    if (active.kind === 'component')     return active.componentId === compId
    if (active.kind === 'trigger-group') return triggers.some(t => t.component === compId && t.type === active.triggerType)
    if (active.kind === 'variable')      return active.varName === varName
    return false
  }

  // ── Node highlight helpers ────────────────────────────────────────────────
  // Returns 'hi' (primary), 'sec' (secondary/related), 'lo' (dimmed), or 'normal'.

  type NodeState = 'hi' | 'sec' | 'lo' | 'normal'

  // Returns the component IDs connected to a trigger group.
  const groupCompIds = (type: string) =>
    triggers.filter(t => t.type === type).map(t => t.component)

  const triggerGroupState = (type: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'trigger-group') return active.triggerType === type ? 'hi' : 'lo'
    if (active.kind === 'component') {
      return groupCompIds(type).includes(active.componentId) ? 'sec' : 'lo'
    }
    if (active.kind === 'resource' || active.kind === 'variable') {
      const relatedCompIds = active.kind === 'resource'
        ? components.filter(c => (active.resKind === 'kv' ? c.keyValueStores : c.sqliteDatabases ?? [])?.includes(active.resName)).map(c => c.id)
        : components.filter(c => componentUsesVar(c, active.varName)).map(c => c.id)
      return groupCompIds(type).some(id => relatedCompIds.includes(id)) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const compState = (compId: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'component')     return active.componentId === compId ? 'hi' : 'lo'
    if (active.kind === 'trigger-group') return groupCompIds(active.triggerType).includes(compId) ? 'sec' : 'lo'
    if (active.kind === 'resource') {
      const comp = components.find(c => c.id === compId)
      const uses = active.resKind === 'kv'
        ? (comp?.keyValueStores ?? []).includes(active.resName)
        : (comp?.sqliteDatabases ?? []).includes(active.resName)
      return uses ? 'sec' : 'lo'
    }
    if (active.kind === 'variable') {
      const comp = components.find(c => c.id === compId)
      return comp && componentUsesVar(comp, active.varName) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const resourceState = (resKind: 'kv' | 'sqlite', resName: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'resource') return active.resKind === resKind && active.resName === resName ? 'hi' : 'lo'
    if (active.kind === 'component') {
      const comp = components.find(c => c.id === active.componentId)
      const uses = resKind === 'kv'
        ? (comp?.keyValueStores ?? []).includes(resName)
        : (comp?.sqliteDatabases ?? []).includes(resName)
      return uses ? 'sec' : 'lo'
    }
    if (active.kind === 'trigger-group') {
      const compIds = groupCompIds(active.triggerType)
      return compIds.some(id => {
        const comp = components.find(c => c.id === id)
        return resKind === 'kv'
          ? (comp?.keyValueStores ?? []).includes(resName)
          : (comp?.sqliteDatabases ?? []).includes(resName)
      }) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const varState = (varName: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'variable') return active.varName === varName ? 'hi' : 'lo'
    if (active.kind === 'component') {
      const comp = components.find(c => c.id === active.componentId)
      return comp && componentUsesVar(comp, varName) ? 'sec' : 'lo'
    }
    if (active.kind === 'trigger-group') {
      const compIds = groupCompIds(active.triggerType)
      return compIds.some(id => {
        const comp = components.find(c => c.id === id)
        return comp && componentUsesVar(comp, varName)
      }) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  // ── Precompute edges ──────────────────────────────────────────────────────

  // One edge per individual trigger, but the source x1/y1 now comes from the
  // group node position.  Each edge also carries a label (route / channel).
  const triggerEdges = triggerGroups.flatMap((group, gi) =>
    group.triggers.map(t => {
      const ci = components.findIndex(c => c.id === t.component)
      if (ci < 0) return null
      const on = triggerEdgeActive(group.type, t.component)
      // Label: route for HTTP/private, channel for Redis/MQTT, etc.
      const label = t.private
        ? 'private'
        : (t.route ?? t.channel ?? t.address ?? '').replace(/^\//, '/').slice(0, 22) || ''
      return {
        t, gi, ci, on, label,
        x1: PADDING,          y1: nodeY(tOff, gi) + NODE_H / 2,
        x2: COMP_X + PADDING, y2: nodeY(cOff, ci) + NODE_H / 2,
      }
    }).filter(Boolean)
  ) as { t: TriggerInfo; gi: number; ci: number; on: boolean; label: string; x1: number; y1: number; x2: number; y2: number }[]

  const resourceEdges: { x1: number; y1: number; x2: number; y2: number; shared: boolean; on: boolean }[] = []
  components.forEach((c, ci) => {
    ;(c.keyValueStores ?? []).forEach(kv => {
      const ri = resources.findIndex(r => r.kind === 'kv' && r.name === kv)
      if (ri >= 0) resourceEdges.push({
        x1: COMP_X + PADDING + NODE_W, y1: nodeY(cOff, ci) + NODE_H / 2,
        x2: RES_X  + PADDING,          y2: nodeY(rOff, ri) + NODE_H / 2,
        shared: sharedCount('kv', kv) > 1, on: resourceEdgeActive(c.id, 'kv', kv),
      })
    })
    ;(c.sqliteDatabases ?? []).forEach(db => {
      const ri = resources.findIndex(r => r.kind === 'sqlite' && r.name === db)
      if (ri >= 0) resourceEdges.push({
        x1: COMP_X + PADDING + NODE_W, y1: nodeY(cOff, ci) + NODE_H / 2,
        x2: RES_X  + PADDING,          y2: nodeY(rOff, ri) + NODE_H / 2,
        shared: sharedCount('sqlite', db) > 1, on: resourceEdgeActive(c.id, 'sqlite', db),
      })
    })
  })

  const VAR_EDGE_X1 = COMP_X + PADDING + NODE_W
  const varEdges: { x1: number; y1: number; x2: number; y2: number; on: boolean }[] = []
  components.forEach((c, ci) => {
    // Iterate declared app-level vars; draw an edge wherever the component
    // uses the var (direct key binding OR mustache reference in a value).
    varNames.forEach((varName, vi) => {
      if (!componentUsesVar(c, varName)) return
      varEdges.push({
        x1: VAR_EDGE_X1,     y1: nodeY(cOff, ci)    + NODE_H     / 2,
        x2: VAR_X + PADDING, y2: varNodeY(vOff, vi) + VAR_NODE_H / 2,
        on: varEdgeActive(c.id, varName),
      })
    })
  })

  const anyActive = active !== null

  return (
    <div className="overflow-x-auto">
      {/* Column headers */}
      <div className="flex text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3" style={{ paddingLeft: PADDING }}>
        <div style={{ width: NODE_W + COL_GAP }}>Triggers</div>
        <div style={{ width: NODE_W + (hasResources || hasVars ? COL_GAP : 0) }}>Components</div>
        {hasResources && <div style={{ width: NODE_W + (hasVars ? VAR_COL_GAP : 0) }}>Resources</div>}
        {hasVars && <div style={{ width: VAR_NODE_W }}>Variables</div>}
      </div>

      <div className="relative" style={{ width: svgW, height: totalH }}>
        {/* SVG edges — hidden by default, revealed on hover / selection */}
        <svg className="absolute inset-0 pointer-events-none" width={svgW} height={totalH}>
          {triggerEdges.map((e, i) => (
            <g key={`te-${i}`} style={{ transition: 'opacity 0.15s' }} opacity={!anyActive ? 0 : e.on ? 1 : 0}>
              <path
                d={bez(e.x1 + NODE_W, e.y1, e.x2, e.y2)}
                fill="none"
                stroke="#10b981"
                strokeWidth={2}
              />
              <polygon
                points={`${e.x2},${e.y2} ${e.x2 - 7},${e.y2 - 4} ${e.x2 - 7},${e.y2 + 4}`}
                fill="#10b981"
              />
            </g>
          ))}
          {hasResources && resourceEdges.map((e, i) => (
            <path key={`re-${i}`}
              d={bez(e.x1, e.y1, e.x2, e.y2)}
              fill="none"
              stroke={e.shared ? '#8b5cf6' : '#6b7280'}
              strokeWidth={1.5}
              strokeDasharray={e.shared ? '5 3' : undefined}
              style={{ transition: 'opacity 0.15s' }}
              opacity={!anyActive ? 0 : e.on ? 0.85 : 0}
            />
          ))}
          {hasVars && varEdges.map((e, i) => (
            <path key={`ve-${i}`}
              d={bezBiased(e.x1, e.y1, e.x2, e.y2, 0.35)}
              fill="none"
              stroke="#d97706"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              style={{ transition: 'opacity 0.15s' }}
              opacity={!anyActive ? 0 : e.on ? 0.85 : 0}
            />
          ))}
        </svg>

        {/* Trigger group nodes — one per type */}
        {triggerGroups.map((group, gi) => {
          const meta   = getTriggerMeta(group.type)
          const TIcon  = meta.icon
          const state  = triggerGroupState(group.type)
          const colors = TRIGGER_NODE_COLORS[meta.color]
          const iconBg = state === 'hi' ? colors.iconBgHi : colors.iconBgDef

          // Sub-label: single route when there's only one trigger, otherwise count.
          const singleT = group.triggers.length === 1 ? group.triggers[0] : null
          const subLabel = singleT
            ? (singleT.private ? 'private' : (singleT.route ?? singleT.channel ?? singleT.address ?? '—'))
            : `${group.triggers.length} routes`

          return (
            <div key={`tg-${gi}`}
              className={`absolute flex items-center rounded-xl overflow-hidden cursor-pointer transition-all ${
                state === 'hi' ? colors.hi : state === 'sec' ? colors.sec : colors.def
              }`}
              style={{
                left: PADDING, top: nodeY(tOff, gi), width: NODE_W, height: NODE_H,
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
              onClick={() => onSelect(
                selected?.kind === 'trigger-group' && selected.triggerType === group.type
                  ? null
                  : { kind: 'trigger-group', triggerType: group.type }
              )}
              onMouseEnter={() => setHovered({ kind: 'trigger-group', triggerType: group.type })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className={`w-10 h-full flex items-center justify-center shrink-0 border-r ${iconBg}`}>
                <TIcon className={`w-4 h-4 ${colors.iconColor}`} />
              </div>
              <div className="px-3 min-w-0 flex-1">
                <div className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${colors.labelColor}`}>
                  {meta.label}
                  {group.triggers.length > 1 && (
                    <span className="text-[9px] font-normal px-1.5 py-0.5 rounded-full bg-black/10 tabular-nums">
                      ×{group.triggers.length}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 font-mono truncate" title={subLabel}>
                  {subLabel}
                </div>
              </div>
            </div>
          )
        })}

        {/* Edge labels — small route/channel pills just before the target component */}
        {triggerEdges.filter(e => e.label).map((e, i) => (
          <div key={`el-${i}`}
            className="absolute pointer-events-none transition-opacity"
            style={{
              // Right-align just before the component column.
              right: svgW - (COMP_X + PADDING) + 6,
              top:   e.y2 - 8,
              opacity: e.on ? 1 : (!active ? 0.55 : 0.15),
              transition: 'opacity 0.15s',
            }}
          >
            <span className="text-[9px] font-mono bg-white border border-gray-200 px-1 py-0.5 rounded text-gray-500 whitespace-nowrap shadow-sm">
              {e.label}
            </span>
          </div>
        ))}

        {/* Component nodes */}
        {components.map((c, ci) => {
          const state = compState(c.id)
          const src   = c.source?.split('/').pop() ?? c.source ?? ''
          const lang  = detectLang(c)
          return (
            <div key={`c-${ci}`}
              className={`absolute flex items-center rounded-xl overflow-hidden cursor-pointer transition-all ${
                state === 'hi'
                  ? 'border-2 border-spin-seagreen shadow-lg shadow-blue-200 scale-[1.02]'
                  : state === 'sec'
                  ? 'border border-spin-seagreen/60 shadow-md'
                  : 'shadow-md hover:shadow-lg hover:scale-[1.01]'
              }`}
              style={{
                left: COMP_X + PADDING, top: nodeY(cOff, ci), width: NODE_W, height: NODE_H,
                background: state === 'hi' ? '#1e3a5f' : '#0f2744',
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.15s',
              }}
              onClick={() => onSelect(
                selected?.kind === 'component' && selected.componentId === c.id
                  ? null
                  : { kind: 'component', componentId: c.id }
              )}
              onMouseEnter={() => setHovered({ kind: 'component', componentId: c.id })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="w-10 h-full bg-black/25 flex items-center justify-center shrink-0">
                <Icon
                  icon={lang ? lang.iconName : 'simple-icons:webassembly'}
                  width={18} height={18}
                  className="text-white/80"
                />
              </div>
              <div className="px-3 min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">{c.id}</div>
                <div className="text-xs text-blue-200/60 font-mono truncate" title={c.source ?? ''}>
                  {src.length > 26 ? src.slice(0, 26) + '…' : src}
                </div>
              </div>
            </div>
          )
        })}

        {/* Resource nodes */}
        {hasResources && resources.map((r, ri) => {
          const isKV   = r.kind === 'kv'
          const state  = resourceState(r.kind, r.name)
          const usedBy = sharedCount(r.kind, r.name)
          const isPinned = selected?.kind === 'resource' && selected.resKind === r.kind && selected.resName === r.name
          return (
            <div key={`r-${ri}`}
              className={`absolute flex items-center bg-white rounded-xl shadow-sm overflow-hidden border cursor-pointer transition-all ${
                state === 'hi'
                  ? (isKV ? 'border-purple-400 shadow-purple-100 shadow-md ring-2 ring-purple-300/60' : 'border-blue-400 shadow-blue-100 shadow-md ring-2 ring-blue-300/60')
                  : state === 'sec'
                  ? (isKV ? 'border-purple-300' : 'border-blue-300')
                  : (isKV ? 'border-purple-200 hover:border-purple-300 hover:shadow' : 'border-blue-200 hover:border-blue-300 hover:shadow')
              }`}
              style={{
                left: RES_X + PADDING, top: nodeY(rOff, ri), width: NODE_W, height: NODE_H,
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
              onClick={() => onSelect(isPinned ? null : { kind: 'resource', resKind: r.kind, resName: r.name })}
              onMouseEnter={() => setHovered({ kind: 'resource', resKind: r.kind, resName: r.name })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className={`w-10 h-full flex items-center justify-center shrink-0 border-r ${isKV ? 'bg-purple-50 border-purple-100' : 'bg-blue-50 border-blue-100'}`}>
                {isKV ? <Key className="w-4 h-4 text-purple-500" /> : <Database className="w-4 h-4 text-blue-500" />}
              </div>
              <div className="px-3 min-w-0 flex-1">
                <div className="text-xs font-bold text-gray-800 truncate">{r.name}</div>
                <div className={`text-xs ${isKV ? 'text-purple-400' : 'text-blue-400'}`}>
                  {isKV ? 'Key-Value' : 'SQLite'}
                  {usedBy > 1 && <span className="ml-1.5 text-gray-400">· {usedBy} components</span>}
                </div>
              </div>
            </div>
          )
        })}

        {/* Variable nodes */}
        {hasVars && varNames.map((varName, vi) => {
          const usedBy = components.filter(c => componentUsesVar(c, varName))
          const state  = varState(varName)
          const isPinned = selected?.kind === 'variable' && selected.varName === varName
          return (
            <div key={`v-${vi}`}
              className={`absolute flex items-center bg-white rounded-lg overflow-hidden border cursor-pointer transition-all ${
                state === 'hi'
                  ? 'border-amber-400 shadow-amber-100 shadow-md ring-2 ring-amber-300/60'
                  : state === 'sec'
                  ? 'border-amber-300 shadow-sm'
                  : 'border-amber-200 shadow-sm hover:border-amber-300 hover:shadow'
              }`}
              style={{
                left: VAR_X + PADDING, top: varNodeY(vOff, vi), width: VAR_NODE_W, height: VAR_NODE_H,
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
              onClick={() => onSelect(isPinned ? null : { kind: 'variable', varName })}
              onMouseEnter={() => setHovered({ kind: 'variable', varName })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className={`w-8 h-full flex items-center justify-center shrink-0 border-r ${state === 'hi' || isPinned ? 'bg-amber-100 border-amber-200' : 'bg-amber-50 border-amber-100'}`}>
                <Key className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="px-2.5 min-w-0 flex-1">
                <div className="text-xs font-semibold text-gray-800 font-mono truncate">{varName}</div>
                {usedBy.length > 0 && (
                  <div className="text-[10px] text-amber-400 leading-tight">
                    {usedBy.length === 1 ? usedBy[0].id : `${usedBy.length} components`}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-6 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <svg width="24" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="#10b981" strokeWidth="1.5" /><polygon points="18,5 11,2 11,8" fill="#10b981" /></svg>
          Trigger route
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#6b7280" strokeWidth="1.5" /></svg>
          Resource access
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
          Shared resource
        </div>
        {hasVars && (
          <div className="flex items-center gap-1.5">
            <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#d97706" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
            Variable binding
          </div>
        )}
        <div className="flex items-center gap-1.5 text-gray-300">
          · Hover any node to trace connections
        </div>
      </div>
    </div>
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

// ─── Variable pane ────────────────────────────────────────────────────────────

const SOURCE_BADGE: Record<string, string> = {
  'spin.toml':    'badge-blue',
  '.env':         'badge-yellow',
  'SPIN_VARIABLE':'badge-orange',
  '--variable':   'badge-green',
}
const SOURCE_LABEL: Record<string, string> = {
  'spin.toml':    'spin.toml default',
  '.env':         '.env file',
  'SPIN_VARIABLE':'Environment variable',
  '--variable':   'CLI flag',
}

function VariablePane({
  varName, vars, components, onClose, onSelect, onAddVar, canMutate, paneWidth, onPaneWidthChange,
}: {
  varName: string
  vars: VarEntry[]
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
  onAddVar: () => void
  canMutate: boolean
  paneWidth: number
  onPaneWidthChange: (w: number) => void
}) {
  const entry = vars.find(v => v.key === varName)
  const [revealed, setRevealed] = useState(false)

  // Reset reveal state whenever a different variable is selected.
  useEffect(() => { setRevealed(false) }, [varName])

  const handleDragMouseDown = usePaneResize(paneWidth, onPaneWidthChange)

  const usedBy = components.filter(c => {
    const vars = c.variables ?? {}
    if (varName in vars) return true
    const re = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`)
    return Object.values(vars).some(v => re.test(v))
  })

  return (
    <div
      className="shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden relative"
      style={{ width: paneWidth }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-amber-300/60 active:bg-amber-400/70 transition-colors"
        onMouseDown={handleDragMouseDown}
      />

      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 bg-white border-b border-gray-100 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Key className="w-4 h-4 text-amber-500 shrink-0" />
            <code className="text-base font-bold text-gray-900">{varName}</code>
            {entry?.secret && <span className="badge badge-gray text-xs">secret</span>}
          </div>
          {entry && (
            <span className={`mt-1.5 inline-flex items-center gap-1 ${SOURCE_BADGE[entry.source]} badge text-xs`}>
              {SOURCE_LABEL[entry.source]}
            </span>
          )}
          {!entry && vars.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">Value not yet resolved</p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors shrink-0 ml-3 mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Value */}
        {entry && (
          <PaneSection title="Value" Icon={Key}>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
              {entry.secret ? (
                <>
                  <code className="font-mono text-xs text-gray-700 flex-1 select-all">
                    {revealed
                      ? (entry.value || <span className="text-gray-400 italic">empty</span>)
                      : '••••••••'}
                  </code>
                  <button
                    className="text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                    onClick={() => setRevealed(r => !r)}
                    title={revealed ? 'Hide value' : 'Reveal value'}
                  >
                    {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </>
              ) : (
                <code className="font-mono text-xs text-gray-700 select-all break-all">
                  {entry.value || <span className="text-gray-400 italic">empty</span>}
                </code>
              )}
            </div>
          </PaneSection>
        )}

        {/* Used by */}
        {usedBy.length > 0 && (
          <PaneSection title="Used by" Icon={Package} count={usedBy.length}>
            {usedBy.map(c => {
              const binding    = c.variables?.[varName] ?? ''
              const isIndirect = binding && binding !== `{{ ${varName} }}`
              return (
                <button
                  key={c.id}
                  className="w-full flex items-start gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors"
                  onClick={() => onSelect({ kind: 'component', componentId: c.id })}
                >
                  <Package className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <code className="text-xs font-mono text-gray-800">{c.id}</code>
                    {binding && (
                      <code className={`block text-[10px] font-mono mt-0.5 truncate ${isIndirect ? 'text-amber-500' : 'text-gray-400'}`}>
                        {binding}
                      </code>
                    )}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
                </button>
              )
            })}
          </PaneSection>
        )}

        {usedBy.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-400 italic">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Not wired to any component yet.
          </div>
        )}

        {/* Add variable shortcut */}
        {canMutate && (
          <button
            className="w-full btn-secondary text-xs justify-center"
            onClick={onAddVar}
          >
            <Plus className="w-3.5 h-3.5" /> Add another variable
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Resource pane (KV store / SQLite) ────────────────────────────────────────

function ResourcePane({
  resKind, resName, components, onClose, onSelect, paneWidth, onPaneWidthChange,
}: {
  resKind: 'kv' | 'sqlite'
  resName: string
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
  paneWidth: number
  onPaneWidthChange: (w: number) => void
}) {
  const handleDragMouseDown = usePaneResize(paneWidth, onPaneWidthChange)
  const isKV = resKind === 'kv'

  const usedBy = components.filter(c =>
    isKV
      ? (c.keyValueStores ?? []).includes(resName)
      : (c.sqliteDatabases ?? []).includes(resName),
  )

  return (
    <div
      className="shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden relative"
      style={{ width: paneWidth }}
    >
      {/* Drag handle */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 transition-colors ${isKV ? 'hover:bg-purple-300/60' : 'hover:bg-blue-300/60'}`}
        onMouseDown={handleDragMouseDown}
      />

      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isKV ? 'bg-purple-100' : 'bg-blue-100'}`}>
            {isKV
              ? <Key className="w-4 h-4 text-purple-600" />
              : <Database className="w-4 h-4 text-blue-600" />}
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-gray-900 font-mono">{resName}</div>
            <div className={`text-xs mt-0.5 font-medium ${isKV ? 'text-purple-500' : 'text-blue-500'}`}>
              {isKV ? 'Key-Value Store' : 'SQLite Database'}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors shrink-0 ml-3 mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Used by */}
        <PaneSection title="Components using this store" Icon={Package} count={usedBy.length}>
          {usedBy.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No components bound yet.</p>
          ) : usedBy.map(c => (
            <button
              key={c.id}
              className="w-full flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-left hover:border-gray-300 hover:bg-gray-50 transition-colors"
              onClick={() => onSelect({ kind: 'component', componentId: c.id })}
            >
              <Package className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <code className="text-xs font-mono text-gray-800 flex-1">{c.id}</code>
              {(() => { const lang = detectLang(c); return lang ? <LangIcon comp={c} size={14} /> : null })()}
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
            </button>
          ))}
        </PaneSection>

        {/* Info box */}
        <div className={`border rounded-xl p-3 space-y-1.5 text-xs ${isKV ? 'bg-purple-50 border-purple-100' : 'bg-blue-50 border-blue-100'}`}>
          {isKV ? (
            <>
              <p className="font-semibold text-purple-800">About key-value stores</p>
              <p className="text-purple-700">
                The label <code className="font-mono bg-purple-100 px-1 rounded">default</code> refers to Spin's
                built-in store. Custom store labels can be mapped to external providers (e.g. Redis, Azure Blob)
                via Spin runtime config.
              </p>
              <a
                href="https://spinframework.dev/v3/kv-store-api-guide"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-purple-600 hover:text-purple-800 underline"
              >
                Key Value Store docs <ExternalLink className="w-3 h-3" />
              </a>
            </>
          ) : (
            <>
              <p className="font-semibold text-blue-800">About SQLite databases</p>
              <p className="text-blue-700">
                The label <code className="font-mono bg-blue-100 px-1 rounded">default</code> refers to Spin's
                built-in SQLite instance. Custom database labels can be mapped to persistent files or LibSQL/Turso
                via runtime config.
              </p>
              <a
                href="https://spinframework.dev/v3/sqlite-api-guide"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline"
              >
                SQLite Storage docs <ExternalLink className="w-3 h-3" />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Trigger pane ─────────────────────────────────────────────────────────────

function TriggerPane({
  triggerType, triggers, components, onClose, onSelect, paneWidth, onPaneWidthChange,
}: {
  triggerType: string
  triggers: TriggerInfo[]
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
  paneWidth: number
  onPaneWidthChange: (w: number) => void
}) {
  const handleDragMouseDown = usePaneResize(paneWidth, onPaneWidthChange)
  const meta = getTriggerMeta(triggerType)
  const TIcon = meta.icon
  const colors = TRIGGER_NODE_COLORS[meta.color]

  return (
    <div
      className="shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden relative"
      style={{ width: paneWidth }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 transition-colors"
        style={{ background: 'transparent' }}
        onMouseDown={handleDragMouseDown}
      />

      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colors.iconBgHi}`}>
            <TIcon className={`w-4 h-4 ${colors.iconColor}`} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-gray-900">{meta.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {triggers.length === 1 ? '1 trigger' : `${triggers.length} triggers`}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors shrink-0 ml-3 mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {triggers.map((t, i) => {
          const comp = components.find(c => c.id === t.component)
          const routeLabel = t.private ? null : (t.route ?? t.channel ?? t.address ?? null)

          return (
            <div key={i} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Route / channel */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                {t.private ? (
                  <span className="flex items-center gap-1.5 text-xs text-violet-600 font-medium">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Private endpoint
                  </span>
                ) : routeLabel ? (
                  <code className="text-xs font-mono text-gray-800 font-semibold break-all">{routeLabel}</code>
                ) : (
                  <span className="text-xs text-gray-400 italic">No route</span>
                )}
              </div>

              {/* Component — clickable to open detail pane */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                onClick={() => onSelect({ kind: 'component', componentId: t.component })}
              >
                <Package className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <code className="text-xs font-mono text-gray-700 flex-1">{t.component}</code>
                {comp && (() => {
                  const lang = detectLang(comp)
                  return lang ? <LangIcon comp={comp} size={14} /> : null
                })()}
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────


export default function AppOverview() {
  const { app, refresh }    = useAppStore()
  const [error]             = useState<string | null>(null)
  const loading             = app === null
  const [selected, setSelected] = useState<Selection | null>(null)

  const [showAddComp, setShowAddComp]       = useState(false)
  const [showAddBinding, setShowAddBinding] = useState(false)
  const [showAddVar, setShowAddVar]         = useState(false)
  const [showEditToml, setShowEditToml]     = useState(false)
  const [restarting, setRestarting]         = useState(false)

  // Shared pane width — remembered across all pane types and open/close cycles.
  const [paneWidth, setPaneWidth] = useState(384)

  // Vars are fetched once and refreshed whenever the app reloads.
  const [vars, setVars] = useState<VarEntry[]>([])
  useEffect(() => {
    getVars().then(v => setVars(v ?? [])).catch(() => {})
  }, [app])

  if (loading) return (
    <div className="flex-1 p-6 space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="card p-4">
          <div className="skeleton h-5 w-48 mb-2" />
          <div className="skeleton h-4 w-64" />
        </div>
      ))}
    </div>
  )

  const components  = app?.components    ?? []
  const triggers    = app?.triggers      ?? []
  const canMutate   = app?.allowMutations ?? false

  // Resolve selected component object for the detail pane.
  // Trigger-group selections highlight components but don't open the pane.
  const selectedComponent = selected?.kind === 'component'
    ? components.find(c => c.id === selected.componentId) ?? null
    : null

  const selectedVarName     = selected?.kind === 'variable'      ? selected.varName     : null
  const selectedTriggerType = selected?.kind === 'trigger-group' ? selected.triggerType : null
  const selectedResource    = selected?.kind === 'resource'      ? selected             : null

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Page header */}
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-spin-oxfordblue flex items-center justify-center">
            <span className="text-white text-sm font-bold uppercase">{app?.name?.charAt(0) ?? 'S'}</span>
          </div>
          <div>
            <h1 className="page-title">{app?.name ?? 'Spin Application'}</h1>
            {app?.description && <p className="text-xs text-gray-500 mt-0.5">{app.description}</p>}
          </div>
          <StatusChip status={app?.status ?? 'starting'} error={app?.error ?? ''} />
        </div>
        <div className="flex items-center gap-2">
          {/* Mutation action buttons */}
          {!canMutate && (
            <span
              className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5"
              title="Restart with --allow-edits to enable editing"
            >
              <Lock className="w-3 h-3 shrink-0" />
              Read-only — pass <code className="font-mono">--allow-edits</code> to edit
            </span>
          )}
          <button
            className="btn-secondary text-xs"
            onClick={() => setShowAddComp(true)}
            disabled={!canMutate}
            title={canMutate ? 'Add a new component via spin add' : 'Requires --allow-edits'}
          >
            <Package className="w-3.5 h-3.5" /> Add Component
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={() => setShowAddVar(true)}
            disabled={!canMutate}
            title={canMutate ? 'Add a new application variable' : 'Requires --allow-edits'}
          >
            <Settings className="w-3.5 h-3.5" /> Add Variable
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={() => setShowAddBinding(true)}
            disabled={!canMutate || components.length === 0}
            title={canMutate ? 'Add a KV or SQLite binding to a component' : 'Requires --allow-edits'}
          >
            <Plus className="w-3.5 h-3.5" /> Add Binding
          </button>
          <button
            className="btn-secondary text-xs"
            disabled={restarting}
            onClick={async () => {
              setRestarting(true)
              try { await restartSpin() } catch { /* ignore */ }
              setTimeout(() => { setRestarting(false); refresh() }, 2000)
            }}
            title="Restart the Spin process"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${restarting ? 'animate-spin' : ''}`} />
            {restarting ? 'Restarting…' : 'Restart'}
          </button>

        </div>
      </div>

      {/* Body: main content + optional detail pane */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Components" value={components.length} Icon={Layers} accent />
              <StatCard label="Triggers"   value={triggers.length}   Icon={Zap} />
              <StatCard label="Variables"  value={app?.varCount ?? 0} Icon={Key} />
              <StatCard label="Status"     value={app?.status ?? '—'} Icon={CheckCircle2} />
            </div>

            <div className="card p-6">
              {components.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
                  <Network className="w-8 h-8 opacity-25" />
                  <p className="text-sm">No components found.</p>
                </div>
              ) : (
                <TopologyGraph
                  components={components}
                  triggers={triggers}
                  variableKeys={app?.variableKeys ?? []}
                  selected={selected}
                  onSelect={setSelected}
                />
              )}
            </div>
          </div>
        </div>

        {/* Detail pane — component */}
        {selectedComponent && (
          <DetailPane
            component={selectedComponent}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            canMutate={canMutate}
            paneWidth={paneWidth}
            onPaneWidthChange={setPaneWidth}
          />
        )}

        {/* Detail pane — variable */}
        {selectedVarName && (
          <VariablePane
            varName={selectedVarName}
            vars={vars}
            components={components}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            onAddVar={() => setShowAddVar(true)}
            canMutate={canMutate}
            paneWidth={paneWidth}
            onPaneWidthChange={setPaneWidth}
          />
        )}

        {/* Detail pane — trigger group */}
        {selectedTriggerType && (
          <TriggerPane
            triggerType={selectedTriggerType}
            triggers={triggers.filter(t => t.type === selectedTriggerType)}
            components={components}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            paneWidth={paneWidth}
            onPaneWidthChange={setPaneWidth}
          />
        )}

        {/* Detail pane — resource (KV / SQLite) */}
        {selectedResource && (
          <ResourcePane
            resKind={selectedResource.resKind}
            resName={selectedResource.resName}
            components={components}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            paneWidth={paneWidth}
            onPaneWidthChange={setPaneWidth}
          />
        )}
      </div>

      {/* Dialogs */}
      {showAddComp && (
        <AddComponentDialog
          onClose={() => setShowAddComp(false)}
          onSuccess={() => { refresh(); setShowAddComp(false) }}
        />
      )}
      {showAddBinding && (
        <AddBindingDialog
          components={components}
          onClose={() => setShowAddBinding(false)}
          onSuccess={() => { refresh(); setShowAddBinding(false) }}
        />
      )}
      {showAddVar && (
        <AddVariableDialog
          onClose={() => setShowAddVar(false)}
          onSuccess={() => {
            refresh()
            getVars().then(v => setVars(v ?? [])).catch(() => {})
            setShowAddVar(false)
          }}
        />
      )}
      {showEditToml && (
        <EditSpinTomlModal
          onClose={() => setShowEditToml(false)}
          onSaved={() => { refresh(); }}
        />
      )}
    </div>
  )
}
