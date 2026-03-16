import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
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
  Sparkles,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react'
import { Icon } from '@iconify/react'
import { type ComponentInfo, type TriggerInfo, type VarEntry, buildAndRestart, getVars, removeBinding, restartSpin } from '../api/client'
import { useAppStore } from '../store/appContext'
import AddComponentDialog from './AddComponentDialog'
import AddServiceBindingDialog from './AddServiceBindingDialog'
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
  const cfg: Record<string, { cls: string; Icon: typeof CheckCircle2; label: string; spin?: boolean }> = {
    running:    { cls: 'badge-green',  Icon: CheckCircle2, label: 'Running'      },
    starting:   { cls: 'badge-yellow', Icon: Clock,        label: 'Starting'     },
    building:   { cls: 'badge-blue',   Icon: Hammer,       label: 'Building…', spin: true },
    restarting: { cls: 'badge-yellow', Icon: Loader2,      label: 'Restarting…', spin: true },
    stopped:    { cls: 'badge-gray',   Icon: Clock,        label: 'Stopped'      },
    error:      { cls: 'badge-red',    Icon: AlertCircle,  label: 'Error'        },
  }
  const { cls, Icon, label, spin: spinning } = cfg[status] ?? cfg.stopped
  return (
    <span className={cls + ' badge text-xs'} title={error || undefined}>
      <Icon className={`w-3 h-3${spinning ? ' animate-spin' : ''}`} />
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

/** Build a clickable URL from a Spin listen address and a route pattern.
 *  Strips Spin's catch-all wildcard suffix (/...) before joining. */
function routeUrl(listenAddr: string | null | undefined, route: string | null | undefined): string | null {
  if (!listenAddr || !route) return null
  // /api/... → /api/   /... → /   ... → /
  const path = route.replace(/\/\.\.\.$/, '/').replace(/^\.\.\.$/, '/')
  return listenAddr.replace(/\/$/, '') + path
}

function InfoRow({
  Icon: RowIcon, main, sub, tag, tagColor = 'gray', onClick, href,
}: {
  Icon: React.FC<{ className?: string }>
  main: React.ReactNode
  sub?: string
  tag?: string
  tagColor?: 'gray' | 'green' | 'purple' | 'blue' | 'red' | 'orange' | 'teal'
  onClick?: () => void
  /** When provided, an external-link icon is rendered that opens this URL. */
  href?: string | null
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
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-gray-300 hover:text-spin-colablue transition-colors shrink-0"
          title={`Open ${href}`}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
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

/**
 * If the host string refers to an in-app component call (spin.internal /
 * spin.alt, with or without a component-id subdomain), returns the target
 * component ID or '*' for a wildcard. Returns null for external hosts.
 *
 * Examples:
 *   spin.internal              → '*'
 *   spin.alt                   → '*'
 *   controlplane.spin.internal → 'controlplane' (if found in componentIds)
 *   controlplane.spin.internal → '*' (fallback when id not in the app)
 */
function internalCallTarget(host: string, componentIds: ReadonlySet<string>): string | null {
  const bare = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase()
  if (bare === 'spin.internal' || bare === 'spin.alt') return '*'
  const m = bare.match(/^(.+)\.spin\.(internal|alt)$/)
  if (m) return componentIds.has(m[1]) ? m[1] : '*'
  return null
}

/** True when the host string contains a Mustache-style variable template. */
function isVariableTemplate(host: string): boolean {
  return /\{\{[^}]+\}\}/.test(host)
}

/** Short label for an outbound host node in the graph. */
function hostNodeLabel(host: string): string {
  if (host === '*' || host === 'https://*') return 'Any host'
  if (isVariableTemplate(host)) return host   // show the template as-is
  try {
    const url = host.startsWith('http') ? new URL(host) : new URL(`https://${host}`)
    return url.hostname
  } catch {
    return host
  }
}

// ─── localStorage-persisted boolean toggle ────────────────────────────────────

function useLocalStorage(key: string, defaultValue: boolean): [boolean, (v: boolean | ((p: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as boolean) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const setAndPersist = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* quota full etc. */ }
      return next
    })
  }, [key])

  return [value, setAndPersist]
}

// ─── Detail pane (component) ──────────────────────────────────────────────────

function DetailPane({
  component: c, onClose, onSelect, canMutate, listenAddr,
}: {
  component: ComponentInfo
  onClose: () => void
  onSelect: (s: Selection) => void
  canMutate: boolean
  listenAddr?: string | null
}) {
  const { refresh } = useAppStore()

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
    <div className="flex-1 border-t border-gray-200 bg-gray-50 flex flex-col overflow-hidden min-h-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900">{c.id}</span>
          {lang && <LangIcon comp={c} size={16} />}
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
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
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
              const url = t.type === 'http' ? routeUrl(listenAddr, t.route) : null
              return (
                <InfoRow key={i} Icon={meta.icon} main={route}
                  sub={`${meta.label} trigger`}
                  tag={meta.label.toUpperCase()}
                  tagColor={meta.color as 'green' | 'red' | 'orange' | 'teal' | 'purple' | 'blue' | 'gray'}
                  href={url}
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
// Column layout: Triggers → Components → Resources (KV / SQLite / Outbound hosts) → Variables
// Internal component calls (spin.internal / spin.alt) are rendered as looping
// arcs on the right edge of the component column, not as separate nodes.

// Standard node dimensions (triggers, components, resources)
const NODE_H  = 56
const NODE_W  = 210
const GAP     = 14
const COL_GAP = 100
const COMP_X  = NODE_W + COL_GAP
const RES_X   = COMP_X + NODE_W + COL_GAP
const PADDING = 24

// How far (px) the internal-call arc bulges rightward past the component column.
// Must stay within COL_GAP (100) to avoid overlapping the resource column.
const INTERNAL_CALL_OFFSET = 44

// Variable nodes are more compact so a long list doesn't tower over the rest.
// The column sits further right to give the sweeping variable-binding arcs
// enough room — variable edges always originate from the *component* right
// edge and sweep past the resource column, so the curves need visual space.
const VAR_NODE_H  = 40
const VAR_NODE_W  = 190
const VAR_GAP     = 6
const VAR_COL_GAP = 120
// Column X positions are computed dynamically inside TopologyGraph so columns
// spread right into freed space when adjacent columns are toggled off.

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
  | { kind: 'outbound-host'; hostPattern: string }
  | { kind: 'ai-model';      modelName: string }

// Hover target — any node type.
type ActiveTarget =
  | { kind: 'trigger-group'; triggerType: string }
  | { kind: 'component';     componentId: string }
  | { kind: 'resource';      resKind: 'kv' | 'sqlite'; resName: string }
  | { kind: 'variable';      varName: string }
  | { kind: 'outbound-host'; hostPattern: string }
  | { kind: 'ai-model';      modelName: string }

function selectionToActive(s: Selection): ActiveTarget {
  if (s.kind === 'trigger-group')  return { kind: 'trigger-group', triggerType: s.triggerType }
  if (s.kind === 'variable')       return { kind: 'variable', varName: s.varName }
  if (s.kind === 'resource')       return { kind: 'resource', resKind: s.resKind, resName: s.resName }
  if (s.kind === 'outbound-host')  return { kind: 'outbound-host', hostPattern: s.hostPattern }
  if (s.kind === 'ai-model')       return { kind: 'ai-model', modelName: s.modelName }
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

// Small pill button used in column headers to show/hide a column.
function TogglePill({
  icon, label, active, color, onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  color: 'teal' | 'amber'
  onClick: () => void
}) {
  const colors = color === 'teal'
    ? 'hover:border-teal-300 hover:text-teal-600'
    : 'hover:border-amber-300 hover:text-amber-600'
  return (
    <button
      className={`normal-case font-normal text-[10px] px-1.5 py-0.5 rounded-md border border-gray-200 transition-colors flex items-center gap-1 ${colors} ${active ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
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

  // Resources (KV + SQLite + external outbound hosts)
  const kvStores  = [...new Set(components.flatMap(c => c.keyValueStores  ?? []))]
  const sqliteDbs = [...new Set(components.flatMap(c => c.sqliteDatabases ?? []))]

  const componentIds = new Set(components.map(c => c.id))

  // Classify every allowed_outbound_hosts entry across all components:
  //  • spin.internal / spin.alt (bare or with a {id}. subdomain) → internal edge
  //  • everything else → external host node
  // De-duplicate internal edges using a string-keyed Set.
  type InternalEdge = { fromId: string; toId: string }
  const internalEdgeSet = new Set<string>()
  const internalEdgeList: InternalEdge[] = []
  const extHostSet = new Set<string>()

  for (const c of components) {
    for (const host of (c.allowedOutboundHosts ?? [])) {
      const target = internalCallTarget(host, componentIds)
      if (target !== null) {
        // Internal call: '*' = can reach all other components; else specific ID.
        const targets = target === '*'
          ? components.filter(o => o.id !== c.id).map(o => o.id)
          : [target]
        for (const toId of targets) {
          const key = `${c.id}:${toId}`
          if (!internalEdgeSet.has(key)) {
            internalEdgeSet.add(key)
            internalEdgeList.push({ fromId: c.id, toId })
          }
        }
      } else {
        extHostSet.add(host)
      }
    }
  }
  const extHostPatterns = [...extHostSet]
  const hasInternalCalls = internalEdgeList.length > 0

  // Visibility toggles — persisted so the user's preference survives page reloads.
  const [showServices, setShowServices] = useLocalStorage('graph:show-services', true)
  const [showVars,     setShowVars]     = useLocalStorage('graph:show-vars',     false)

  // All unique AI model names across all components.
  const allAiModels    = [...new Set(components.flatMap(c => c.aiModels ?? []))]
  const hasOutboundHosts = extHostPatterns.length > 0
  const hasAiModels      = allAiModels.length > 0

  type Resource =
    | { kind: 'kv';     name: string }
    | { kind: 'sqlite'; name: string }
    | { kind: 'ai';     name: string }
    | { kind: 'host';   name: string }

  // Full services list — visible only when the toggle is on.
  const allServiceNodes: Resource[] = [
    ...kvStores.map(n     => ({ kind: 'kv'     as const, name: n })),
    ...sqliteDbs.map(n    => ({ kind: 'sqlite' as const, name: n })),
    ...allAiModels.map(n  => ({ kind: 'ai'     as const, name: n })),
    ...extHostPatterns.map(n => ({ kind: 'host' as const, name: n })),
  ]
  const hasAnyServices = allServiceNodes.length > 0
  const resources: Resource[] = showServices ? allServiceNodes : []
  const hasResources   = resources.length > 0

  // Use app-level declared variables as nodes. Edges are drawn only to
  // components that have the variable wired in [component.id.variables].
  const varNames    = variableKeys
  const hasVars     = varNames.length > 0
  // showVarsCol drives layout: false collapses the entire Variables column.
  const showVarsCol = hasVars && showVars

  // Services column is visible when services are toggled on and there are any.
  const showServicesColumn = hasAnyServices && showServices
  // Alias used in layout calculations.
  const showResourcesColumn = showServicesColumn

  // varX: Variables column stays at its natural far-right position at all times.
  const varX = RES_X + NODE_W + VAR_COL_GAP

  // resX: When Variables are hidden, Services slides right to fill the freed space,
  // matching the breathing room that the Variables column would have occupied.
  const resX = showVarsCol
    ? RES_X                          // Variables visible: Services at standard position
    : RES_X + NODE_W + VAR_COL_GAP  // Variables hidden: Services shifts to VAR_X

  // Canvas dimensions — groups replace individual triggers in the height calc.
  const rightmostX = showVarsCol ? varX : showResourcesColumn ? resX : COMP_X
  const rightmostW = showVarsCol ? VAR_NODE_W : NODE_W
  // When there are no resource / variable columns, the internal-call arcs
  // protrude past the component column right edge — widen the canvas to fit.
  const internalCallExtra = (hasInternalCalls && !showResourcesColumn && !showVarsCol)
    ? INTERNAL_CALL_OFFSET + PADDING * 2
    : 0
  const svgW = rightmostX + rightmostW + PADDING + internalCallExtra
  const innerH = Math.max(
    colH(triggerGroups.length),
    colH(components.length),
    colH(resources.length),
    showVarsCol ? varColH(varNames.length) : 0,
  )
  const totalH = innerH + PADDING * 2

  const tOff = colOff(triggerGroups.length, totalH)
  const cOff = colOff(components.length, totalH)
  const rOff = colOff(resources.length, totalH)
  const vOff = varColOff(varNames.length, totalH)

  const sharedCount = (kind: string, name: string) =>
    components.filter(c => {
      if (kind === 'kv')     return (c.keyValueStores     ?? []).includes(name)
      if (kind === 'sqlite') return (c.sqliteDatabases    ?? []).includes(name)
      if (kind === 'ai')     return (c.aiModels           ?? []).includes(name)
      return (c.allowedOutboundHosts ?? []).includes(name)
    }).length

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

  // An internal-call arc between two components is lit when either endpoint is active.
  const internalCallEdgeActive = (fromId: string, toId: string): boolean => {
    if (!active) return false
    if (active.kind === 'component')
      return active.componentId === fromId || active.componentId === toId
    return false
  }

  // A host edge is lit when the source component or the host node itself is active.
  const hostEdgeActive = (compId: string, hostPattern: string): boolean => {
    if (!active) return false
    if (active.kind === 'component')     return active.componentId === compId
    if (active.kind === 'trigger-group') return triggers.some(t => t.component === compId && t.type === active.triggerType)
    if (active.kind === 'outbound-host') return active.hostPattern === hostPattern
    return false
  }

  const aiEdgeActive = (compId: string, modelName: string): boolean => {
    if (!active) return false
    if (active.kind === 'component')     return active.componentId === compId
    if (active.kind === 'trigger-group') return triggers.some(t => t.component === compId && t.type === active.triggerType)
    if (active.kind === 'ai-model')      return active.modelName === modelName
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
    if (active.kind === 'outbound-host') {
      const relatedCompIds = components
        .filter(c => (c.allowedOutboundHosts ?? []).includes(active.hostPattern))
        .map(c => c.id)
      return groupCompIds(type).some(id => relatedCompIds.includes(id)) ? 'sec' : 'lo'
    }
    if (active.kind === 'ai-model') {
      const relatedCompIds = components
        .filter(c => (c.aiModels ?? []).includes(active.modelName))
        .map(c => c.id)
      return groupCompIds(type).some(id => relatedCompIds.includes(id)) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const compState = (compId: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'component') {
      if (active.componentId === compId) return 'hi'
      // Highlight components that the active component calls, or that call it.
      const linked = internalEdgeList.some(
        e => (e.fromId === active.componentId && e.toId === compId)
          || (e.fromId === compId && e.toId === active.componentId)
      )
      return linked ? 'sec' : 'lo'
    }
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
    if (active.kind === 'outbound-host') {
      const comp = components.find(c => c.id === compId)
      return (comp?.allowedOutboundHosts ?? []).includes(active.hostPattern) ? 'sec' : 'lo'
    }
    if (active.kind === 'ai-model') {
      const comp = components.find(c => c.id === compId)
      return (comp?.aiModels ?? []).includes(active.modelName) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const hostNodeState = (hostPattern: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'outbound-host') return active.hostPattern === hostPattern ? 'hi' : 'lo'
    if (active.kind === 'component') {
      const comp = components.find(c => c.id === active.componentId)
      return (comp?.allowedOutboundHosts ?? []).includes(hostPattern) ? 'sec' : 'lo'
    }
    if (active.kind === 'trigger-group') {
      const compIds = groupCompIds(active.triggerType)
      return compIds.some(id => {
        const comp = components.find(c => c.id === id)
        return (comp?.allowedOutboundHosts ?? []).includes(hostPattern)
      }) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const aiModelState = (modelName: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'ai-model')  return active.modelName === modelName ? 'hi' : 'lo'
    if (active.kind === 'component') {
      const comp = components.find(c => c.id === active.componentId)
      return (comp?.aiModels ?? []).includes(modelName) ? 'sec' : 'lo'
    }
    if (active.kind === 'trigger-group') {
      const compIds = groupCompIds(active.triggerType)
      return compIds.some(id => {
        const comp = components.find(c => c.id === id)
        return (comp?.aiModels ?? []).includes(modelName)
      }) ? 'sec' : 'lo'
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
        x2: resX  + PADDING,          y2: nodeY(rOff, ri) + NODE_H / 2,
        shared: sharedCount('kv', kv) > 1, on: resourceEdgeActive(c.id, 'kv', kv),
      })
    })
    ;(c.sqliteDatabases ?? []).forEach(db => {
      const ri = resources.findIndex(r => r.kind === 'sqlite' && r.name === db)
      if (ri >= 0) resourceEdges.push({
        x1: COMP_X + PADDING + NODE_W, y1: nodeY(cOff, ci) + NODE_H / 2,
        x2: resX  + PADDING,          y2: nodeY(rOff, ri) + NODE_H / 2,
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
        x2: varX + PADDING, y2: varNodeY(vOff, vi) + VAR_NODE_H / 2,
        on: varEdgeActive(c.id, varName),
      })
    })
  })

  // Internal-call arcs: component → component via spin.internal / spin.alt.
  // Arcs bulge rightward by INTERNAL_CALL_OFFSET px and loop back — they stay
  // within COL_GAP so they never overlap the resource column.
  const COMP_RIGHT = COMP_X + PADDING + NODE_W
  const internalCallEdges = internalEdgeList.flatMap(({ fromId, toId }) => {
    const fromCi = components.findIndex(c => c.id === fromId)
    const toCi   = components.findIndex(c => c.id === toId)
    if (fromCi < 0 || toCi < 0) return []
    return [{
      fromCi, toCi,
      x1: COMP_RIGHT, y1: nodeY(cOff, fromCi) + NODE_H / 2,
      x2: COMP_RIGHT, y2: nodeY(cOff, toCi)   + NODE_H / 2,
      on: internalCallEdgeActive(fromId, toId),
    }]
  })

  // Edges from components to service nodes (only when services are visible).
  const hostEdges: { x1: number; y1: number; x2: number; y2: number; on: boolean }[] = []
  const aiEdges:   { x1: number; y1: number; x2: number; y2: number; on: boolean }[] = []
  if (showServices) {
    components.forEach((c, ci) => {
      (c.allowedOutboundHosts ?? []).forEach(host => {
        if (internalCallTarget(host, componentIds) !== null) return
        const ri = resources.findIndex(r => r.kind === 'host' && r.name === host)
        if (ri < 0) return
        hostEdges.push({
          x1: COMP_X + PADDING + NODE_W, y1: nodeY(cOff, ci) + NODE_H / 2,
          x2: resX  + PADDING,          y2: nodeY(rOff, ri) + NODE_H / 2,
          on: hostEdgeActive(c.id, host),
        })
      })
      ;(c.aiModels ?? []).forEach(model => {
        const ri = resources.findIndex(r => r.kind === 'ai' && r.name === model)
        if (ri < 0) return
        aiEdges.push({
          x1: COMP_X + PADDING + NODE_W, y1: nodeY(cOff, ci) + NODE_H / 2,
          x2: resX  + PADDING,          y2: nodeY(rOff, ri) + NODE_H / 2,
          on: aiEdgeActive(c.id, model),
        })
      })
    })
  }

  const anyActive = active !== null

  return (
    <div className="overflow-x-auto">
      {/* Visibility toggle pill bar — always in the same place regardless of column layout */}
      {(hasAnyServices || hasVars) && (
        <div className="flex items-center gap-2 mb-2.5" style={{ paddingLeft: PADDING }}>
          {hasAnyServices && (
            <TogglePill
              icon={<Sparkles className="w-2.5 h-2.5" />}
              label={showServices ? 'Services' : `${allServiceNodes.length} services`}
              active={showServices}
              color="teal"
              onClick={() => setShowServices(s => !s)}
            />
          )}
          {hasVars && (
            <TogglePill
              icon={<Key className="w-2.5 h-2.5" />}
              label={showVars ? 'Variables' : `${varNames.length} vars`}
              active={showVars}
              color="amber"
              onClick={() => setShowVars(v => !v)}
            />
          )}
        </div>
      )}

      {/* Column headers — absolutely positioned to stay aligned with their nodes
          even as columns shift position when toggled on or off. */}
      <div className="relative mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider"
           style={{ height: 16, width: svgW }}>
        <span className="absolute" style={{ left: PADDING }}>Triggers</span>
        <span className="absolute" style={{ left: COMP_X + PADDING }}>Components</span>
        {showServicesColumn && (
          <span className="absolute" style={{ left: resX + PADDING }}>Services</span>
        )}
        {showVarsCol && (
          <span className="absolute" style={{ left: varX + PADDING }}>Variables</span>
        )}
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
          {showVarsCol && varEdges.map((e, i) => (
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

          {/* Internal-call arcs — looping curves on the right of the component column */}
          {hasInternalCalls && internalCallEdges.map((e, i) => {
            const path = `M ${e.x1} ${e.y1} C ${e.x1 + INTERNAL_CALL_OFFSET} ${e.y1} ${e.x2 + INTERNAL_CALL_OFFSET} ${e.y2} ${e.x2} ${e.y2}`
            return (
              <g key={`ic-${i}`} style={{ transition: 'opacity 0.15s' }} opacity={!anyActive ? 0 : e.on ? 0.9 : 0}>
                <path
                  d={path}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                {/* Arrow tip pointing left — arrives at (x2, y2) from the right */}
                <polygon
                  points={`${e.x2},${e.y2} ${e.x2 + 7},${e.y2 - 4} ${e.x2 + 7},${e.y2 + 4}`}
                  fill="#06b6d4"
                />
              </g>
            )
          })}

          {/* Outbound host edges — component → external host node */}
          {hostEdges.map((e, i) => (
            <path key={`he-${i}`}
              d={bez(e.x1, e.y1, e.x2, e.y2)}
              fill="none"
              stroke="#14b8a6"
              strokeWidth={1.5}
              style={{ transition: 'opacity 0.15s' }}
              opacity={!anyActive ? 0 : e.on ? 0.85 : 0}
            />
          ))}

          {/* AI model edges — component → AI model node */}
          {aiEdges.map((e, i) => (
            <path key={`ae-${i}`}
              d={bez(e.x1, e.y1, e.x2, e.y2)}
              fill="none"
              stroke="#6366f1"
              strokeWidth={1.5}
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

        {/* Resource nodes — KV stores and SQLite databases */}
        {hasResources && resources.map((r, ri) => {
          if (r.kind === 'ai') {
            // ── AI / LLM model node ───────────────────────────────────────
            const state    = aiModelState(r.name)
            const usedBy   = sharedCount('ai', r.name)
            const isPinned = selected?.kind === 'ai-model' && selected.modelName === r.name
            return (
              <div key={`r-${ri}`}
                className={`absolute flex items-center bg-white rounded-xl shadow-sm overflow-hidden border cursor-pointer transition-all ${
                  state === 'hi'
                    ? 'border-indigo-400 shadow-indigo-100 shadow-md ring-2 ring-indigo-300/60'
                    : state === 'sec'
                    ? 'border-indigo-300'
                    : 'border-indigo-200 hover:border-indigo-300 hover:shadow'
                }`}
                style={{
                  left: resX + PADDING, top: nodeY(rOff, ri), width: NODE_W, height: NODE_H,
                  opacity: state === 'lo' ? 0.35 : 1,
                  transition: 'opacity 0.15s, box-shadow 0.15s',
                }}
                onClick={() => onSelect(isPinned ? null : { kind: 'ai-model', modelName: r.name })}
                onMouseEnter={() => setHovered({ kind: 'ai-model', modelName: r.name })}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="w-10 h-full flex items-center justify-center shrink-0 border-r bg-indigo-50 border-indigo-100">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="px-3 min-w-0 flex-1">
                  <div className="text-xs font-bold text-gray-800 font-mono truncate" title={r.name}>
                    {r.name}
                  </div>
                  <div className="text-xs text-indigo-400">
                    AI Model
                    {usedBy > 1 && <span className="ml-1.5 text-gray-400">· {usedBy} components</span>}
                  </div>
                </div>
              </div>
            )
          }

          if (r.kind === 'host') {
            // ── External outbound host node ────────────────────────────────
            const isTemplate = isVariableTemplate(r.name)
            const state    = hostNodeState(r.name)
            const usedBy   = sharedCount('host', r.name)
            const isPinned = selected?.kind === 'outbound-host' && selected.hostPattern === r.name
            // Variable-template hosts use amber styling to match the variable theme.
            const borderDef  = isTemplate ? 'border-amber-200 hover:border-amber-300 hover:shadow' : 'border-teal-200 hover:border-teal-300 hover:shadow'
            const borderHi   = isTemplate ? 'border-amber-400 shadow-amber-100 shadow-md ring-2 ring-amber-300/60' : 'border-teal-400 shadow-teal-100 shadow-md ring-2 ring-teal-300/60'
            const borderSec  = isTemplate ? 'border-amber-300' : 'border-teal-300'
            const iconBgCls  = isTemplate ? 'bg-amber-50 border-amber-100' : 'bg-teal-50 border-teal-100'
            const iconColor  = isTemplate ? 'text-amber-500' : 'text-teal-500'
            const labelColor = isTemplate ? 'text-amber-400' : 'text-teal-400'
            return (
              <div key={`r-${ri}`}
                className={`absolute flex items-center bg-white rounded-xl shadow-sm overflow-hidden border cursor-pointer transition-all ${
                  state === 'hi' ? borderHi : state === 'sec' ? borderSec : borderDef
                }`}
                style={{
                  left: resX + PADDING, top: nodeY(rOff, ri), width: NODE_W, height: NODE_H,
                  opacity: state === 'lo' ? 0.35 : 1,
                  transition: 'opacity 0.15s, box-shadow 0.15s',
                }}
                onClick={() => onSelect(isPinned ? null : { kind: 'outbound-host', hostPattern: r.name })}
                onMouseEnter={() => setHovered({ kind: 'outbound-host', hostPattern: r.name })}
                onMouseLeave={() => setHovered(null)}
              >
                <div className={`w-10 h-full flex items-center justify-center shrink-0 border-r ${iconBgCls}`}>
                  <Globe className={`w-4 h-4 ${iconColor}`} />
                </div>
                <div className="px-3 min-w-0 flex-1">
                  <div className="text-xs font-bold text-gray-800 font-mono truncate" title={r.name}>
                    {hostNodeLabel(r.name)}
                  </div>
                  <div className={`text-xs ${labelColor}`}>
                    {isTemplate ? 'Variable URL' : 'Outbound host'}
                    {usedBy > 1 && <span className="ml-1.5 text-gray-400">· {usedBy} components</span>}
                  </div>
                </div>
              </div>
            )
          }

          // ── KV / SQLite node ─────────────────────────────────────────────
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
                left: resX + PADDING, top: nodeY(rOff, ri), width: NODE_W, height: NODE_H,
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
        {showVarsCol && varNames.map((varName, vi) => {
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
                left: varX + PADDING, top: varNodeY(vOff, vi), width: VAR_NODE_W, height: VAR_NODE_H,
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
      <div className="flex flex-wrap items-center gap-5 mt-6 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <svg width="24" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="#10b981" strokeWidth="1.5" /><polygon points="18,5 11,2 11,8" fill="#10b981" /></svg>
          Trigger route
        </div>
        {showServicesColumn && (
          <div className="flex items-center gap-1.5">
            <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#6b7280" strokeWidth="1.5" /></svg>
            Service access
          </div>
        )}
        {showServicesColumn && (
          <div className="flex items-center gap-1.5">
            <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
            Shared service
          </div>
        )}
        {showVarsCol && (
          <div className="flex items-center gap-1.5">
            <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#d97706" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
            Variable binding
          </div>
        )}
        {hasOutboundHosts && showServicesColumn && (
          <div className="flex items-center gap-1.5">
            <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#14b8a6" strokeWidth="1.5" /></svg>
            Outbound host
          </div>
        )}
        {hasAiModels && showServicesColumn && (
          <div className="flex items-center gap-1.5">
            <svg width="24" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#6366f1" strokeWidth="1.5" /></svg>
            AI model
          </div>
        )}
        {hasInternalCalls && (
          <div className="flex items-center gap-1.5">
            <svg width="30" height="10">
              <line x1="0" y1="5" x2="23" y2="5" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="4 3" />
              <polygon points="23,5 16,2 16,8" fill="#06b6d4" />
            </svg>
            Internal call
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
  varName, vars, components, onClose, onSelect, onAddVar, canMutate,
}: {
  varName: string
  vars: VarEntry[]
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
  onAddVar: () => void
  canMutate: boolean
}) {
  const entry = vars.find(v => v.key === varName)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => { setRevealed(false) }, [varName])

  const usedBy = components.filter(c => {
    const vars = c.variables ?? {}
    if (varName in vars) return true
    const re = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`)
    return Object.values(vars).some(v => re.test(v))
  })

  return (
    <div className="flex-1 border-t border-gray-200 bg-gray-50 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Key className="w-4 h-4 text-amber-500 shrink-0" />
          <code className="text-sm font-semibold text-gray-900">{varName}</code>
          {entry?.secret && <span className="badge badge-gray text-xs">secret</span>}
          {entry && (
            <span className={`inline-flex items-center gap-1 ${SOURCE_BADGE[entry.source]} badge text-xs`}>
              {SOURCE_LABEL[entry.source]}
            </span>
          )}
          {!entry && vars.length > 0 && (
            <span className="text-xs text-gray-400">Value not yet resolved</span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
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
  resKind, resName, components, onClose, onSelect,
}: {
  resKind: 'kv' | 'sqlite'
  resName: string
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
}) {
  const isKV = resKind === 'kv'

  const usedBy = components.filter(c =>
    isKV
      ? (c.keyValueStores ?? []).includes(resName)
      : (c.sqliteDatabases ?? []).includes(resName),
  )

  return (
    <div className="flex-1 border-t border-gray-200 bg-gray-50 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${isKV ? 'bg-purple-100' : 'bg-blue-100'}`}>
            {isKV
              ? <Key className="w-3.5 h-3.5 text-purple-600" />
              : <Database className="w-3.5 h-3.5 text-blue-600" />}
          </div>
          <span className="text-sm font-semibold text-gray-900 font-mono">{resName}</span>
          <span className={`text-xs font-medium ${isKV ? 'text-purple-500' : 'text-blue-500'}`}>
            {isKV ? 'Key-Value Store' : 'SQLite Database'}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
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

// ─── Service pane (AI model / outbound host) ──────────────────────────────────

function ServicePane({
  kind, name, components, onClose, onSelect,
}: {
  kind: 'ai-model' | 'outbound-host'
  name: string
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
}) {
  const isAI       = kind === 'ai-model'
  const isTemplate = !isAI && isVariableTemplate(name)

  const usedBy = components.filter(c =>
    isAI
      ? (c.aiModels           ?? []).includes(name)
      : (c.allowedOutboundHosts ?? []).includes(name)
  )

  // Colour theme
  const accent = isAI ? 'indigo' : isTemplate ? 'amber' : 'teal'
  const iconBg      = `bg-${accent}-100`
  const iconColor   = `text-${accent}-600`
  const infoBox     = `bg-${accent}-50 border-${accent}-100`
  const infoTitle   = `text-${accent}-800`
  const infoText    = `text-${accent}-700`
  const infoLink    = `text-${accent}-600 hover:text-${accent}-800`

  return (
    <div className="flex-1 border-t border-gray-200 bg-gray-50 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            {isAI
              ? <Sparkles className={`w-3.5 h-3.5 ${iconColor}`} />
              : <Globe    className={`w-3.5 h-3.5 ${iconColor}`} />}
          </div>
          <span className="text-sm font-semibold text-gray-900 font-mono truncate" title={name}>
            {isAI ? name : hostNodeLabel(name)}
          </span>
          <span className={`text-xs font-medium text-${accent}-500`}>
            {isAI ? 'AI / LLM Model' : isTemplate ? 'Variable URL' : hostDescription(name)}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Full pattern (outbound host only, when the label was shortened) */}
        {!isAI && hostNodeLabel(name) !== name && (
          <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">Full pattern</p>
            <code className="text-xs font-mono text-gray-700 break-all">{name}</code>
          </div>
        )}

        {/* Components using this service */}
        <PaneSection
          title={isAI ? 'Components using this model' : 'Components allowed to call this host'}
          Icon={Package}
          count={usedBy.length}
        >
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
        <div className={`border rounded-xl p-3 space-y-1.5 text-xs ${infoBox}`}>
          {isAI ? (
            <>
              <p className={`font-semibold ${infoTitle}`}>About AI / LLM models</p>
              <p className={infoText}>
                The <code className={`font-mono bg-${accent}-100 px-1 rounded`}>ai_models</code> field
                grants a component access to Spin's built-in LLM inferencing API. The label must match
                a model available on the Spin runtime (e.g. <code className={`font-mono bg-${accent}-100 px-1 rounded`}>llama2-chat</code>).
              </p>
              <a
                href="https://spinframework.dev/v3/ai-sentiment-analysis-api-tutorial"
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1 underline ${infoLink}`}
              >
                LLM API docs <ExternalLink className="w-3 h-3" />
              </a>
            </>
          ) : isTemplate ? (
            <>
              <p className={`font-semibold ${infoTitle}`}>Variable-substituted URL</p>
              <p className={infoText}>
                This host pattern contains a variable reference resolved at runtime.
                Make sure the variable is set to a valid URL so Spin can allow the outbound connection.
              </p>
            </>
          ) : (
            <>
              <p className={`font-semibold ${infoTitle}`}>About allowed outbound hosts</p>
              <p className={infoText}>
                Spin enforces an outbound network allowlist. Only URLs matching a declared
                pattern are reachable from the component. Use <code className={`font-mono bg-${accent}-100 px-1 rounded`}>*</code> to
                allow all hosts, or scope to a specific domain.
              </p>
              <a
                href="https://spinframework.dev/v3/writing-apps#granting-networking-permissions-to-components"
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1 underline ${infoLink}`}
              >
                Networking docs <ExternalLink className="w-3 h-3" />
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
  triggerType, triggers, components, onClose, onSelect, listenAddr,
}: {
  triggerType: string
  triggers: TriggerInfo[]
  components: ComponentInfo[]
  onClose: () => void
  onSelect: (s: Selection) => void
  listenAddr?: string | null
}) {
  const meta = getTriggerMeta(triggerType)
  const TIcon = meta.icon
  const colors = TRIGGER_NODE_COLORS[meta.color]

  return (
    <div className="flex-1 border-t border-gray-200 bg-gray-50 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${colors.iconBgHi}`}>
            <TIcon className={`w-3.5 h-3.5 ${colors.iconColor}`} />
          </div>
          <span className="text-sm font-semibold text-gray-900">{meta.label}</span>
          <span className="text-xs text-gray-400">
            {triggers.length === 1 ? '1 trigger' : `${triggers.length} triggers`}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0">✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {triggers.map((t, i) => {
          const comp = components.find(c => c.id === t.component)
          const routeLabel = t.private ? null : (t.route ?? t.channel ?? t.address ?? null)
          const routeHref = (!t.private && triggerType === 'http') ? routeUrl(listenAddr, t.route) : null

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
                  <code className="text-xs font-mono text-gray-800 font-semibold break-all flex-1">{routeLabel}</code>
                ) : (
                  <span className="text-xs text-gray-400 italic flex-1">No route</span>
                )}
                {routeHref && (
                  <a
                    href={routeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-300 hover:text-spin-colablue transition-colors shrink-0"
                    title={`Open ${routeHref}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
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
  const { app, refresh, notifyRestart, notifyBuilding } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [error]             = useState<string | null>(null)
  const loading             = app === null
  const [selected, setSelected] = useState<Selection | null>(null)

  useEffect(() => {
    if (!app) return
    const compParam = searchParams.get('component')
    const selectParam = searchParams.get('select')

    let sel: Selection | null = null

    if (compParam && app.components.some(c => c.id === compParam)) {
      sel = { kind: 'component', componentId: compParam }
    } else if (selectParam) {
      const [kind, ...rest] = selectParam.split(':')
      const value = rest.join(':')
      if (kind === 'variable' && value) sel = { kind: 'variable', varName: value }
      else if (kind === 'kv' && value) sel = { kind: 'resource', resKind: 'kv', resName: value }
      else if (kind === 'sqlite' && value) sel = { kind: 'resource', resKind: 'sqlite', resName: value }
      else if (kind === 'ai' && value) sel = { kind: 'ai-model', modelName: value }
      else if (kind === 'host' && value) sel = { kind: 'outbound-host', hostPattern: value }
    }

    if (sel) {
      setSelected(sel)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, app, setSearchParams])

  const [showAddComp, setShowAddComp]       = useState(false)
  const [showAddBinding, setShowAddBinding] = useState(false)
  const [showAddVar, setShowAddVar]         = useState(false)

  useEffect(() => {
    const dialog = searchParams.get('dialog')
    if (!dialog) return
    if (dialog === 'add-component') setShowAddComp(true)
    else if (dialog === 'add-variable') setShowAddVar(true)
    else if (dialog === 'add-service') setShowAddBinding(true)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])
  const [showEditToml, setShowEditToml]     = useState(false)
  const [restarting, setRestarting]           = useState(false)
  const [restartMenuOpen, setRestartMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen]         = useState(false)
  const restartMenuRef = useRef<HTMLDivElement>(null)
  const addMenuRef     = useRef<HTMLDivElement>(null)

  // Graph area height when a detail pane is open (top/bottom split).
  const [graphHeight, setGraphHeight] = useState(300)
  const isDragging  = useRef(false)
  const dragStartY  = useRef(0)
  const dragStartH  = useRef(0)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - dragStartY.current
      setGraphHeight(Math.max(100, Math.min(600, dragStartH.current + delta)))
    }
    const onUp = () => { isDragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // Vars are fetched once and refreshed whenever the app reloads.
  const [vars, setVars] = useState<VarEntry[]>([])
  useEffect(() => {
    getVars().then(v => setVars(v ?? [])).catch(() => {})
  }, [app])

  // Close the restart dropdown when the user clicks outside it.
  useEffect(() => {
    if (!restartMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (restartMenuRef.current && !restartMenuRef.current.contains(e.target as Node)) {
        setRestartMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [restartMenuOpen])

  // Close the add dropdown when the user clicks outside it.
  useEffect(() => {
    if (!addMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addMenuOpen])

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
  const selectedAiModel     = selected?.kind === 'ai-model'      ? selected.modelName   : null
  const selectedHostPattern  = selected?.kind === 'outbound-host' ? selected.hostPattern : null

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
          {/* Add dropdown menu */}
          <div className="relative" ref={addMenuRef}>
            <button
              className="btn-secondary text-xs"
              disabled={!canMutate}
              onClick={() => setAddMenuOpen(o => !o)}
              title={canMutate ? 'Add a component, variable, or service binding' : 'Requires --allow-edits'}
              aria-haspopup="true"
              aria-expanded={addMenuOpen}
            >
              <Plus className="w-3.5 h-3.5" />
              Add
              <ChevronDown className="w-3 h-3 ml-0.5" />
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                <button
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50"
                  onClick={() => { setAddMenuOpen(false); setShowAddComp(true) }}
                >
                  <Package className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                  Component
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50"
                  onClick={() => { setAddMenuOpen(false); setShowAddVar(true) }}
                >
                  <Settings className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                  Variable
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={components.length === 0}
                  title={components.length === 0 ? 'Add a component first' : undefined}
                  onClick={() => { setAddMenuOpen(false); setShowAddBinding(true) }}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                  Service Binding
                </button>
              </div>
            )}
          </div>
          {/* Split restart button: main = restart, chevron = build & restart */}
          <div className="relative flex" ref={restartMenuRef}>
            <button
              className="btn-secondary text-xs rounded-r-none border-r border-r-gray-300"
              disabled={restarting}
              onClick={async () => {
                setRestarting(true)
                try { await restartSpin() } catch { /* ignore */ }
                notifyRestart()
                setTimeout(() => setRestarting(false), 2000)
              }}
              title="Restart the Spin process"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${restarting ? 'animate-spin' : ''}`} />
              {restarting ? 'Restarting…' : 'Restart'}
            </button>
            <button
              className="btn-secondary text-xs rounded-l-none px-1.5"
              disabled={restarting}
              onClick={() => setRestartMenuOpen(o => !o)}
              title="More restart options"
              aria-haspopup="true"
              aria-expanded={restartMenuOpen}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            {restartMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                <button
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50"
                  disabled={restarting}
                  onClick={async () => {
                    setRestartMenuOpen(false)
                    setRestarting(true)
                    try { await buildAndRestart() } catch { /* ignore */ }
                    notifyBuilding()
                    setTimeout(() => setRestarting(false), 2000)
                  }}
                >
                  <Hammer className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                  Build &amp; Restart
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Body: graph (top) + optional detail pane (bottom) */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div
          className={`overflow-y-auto ${selected ? 'shrink-0' : 'flex-1'}`}
          style={selected ? { height: graphHeight } : undefined}
        >
          <div className="p-6 space-y-6">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}

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

        {/* ── Resize handle ──────────────────────────────────── */}
        {selected && (
          <div
            className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200 active:bg-blue-300 transition-colors flex items-center justify-center group"
            onMouseDown={e => {
              isDragging.current = true
              dragStartY.current = e.clientY
              dragStartH.current = graphHeight
              document.body.style.cursor = 'row-resize'
              e.preventDefault()
            }}
          >
            <div className="w-10 h-0.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors" />
          </div>
        )}

        {/* Detail pane — component */}
        {selectedComponent && (
          <DetailPane
            component={selectedComponent}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
            canMutate={canMutate}
            listenAddr={app?.listenAddr}
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
            listenAddr={app?.listenAddr}
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
          />
        )}

        {/* Detail pane — AI model or outbound host */}
        {(selectedAiModel !== null || selectedHostPattern !== null) && (
          <ServicePane
            kind={selectedAiModel !== null ? 'ai-model' : 'outbound-host'}
            name={(selectedAiModel ?? selectedHostPattern)!}
            components={components}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
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
        <AddServiceBindingDialog
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
