import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Code2,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  Hammer,
  Key,
  Layers,
  LayoutList,
  Loader2,
  MessageSquare,
  Network,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { Icon } from '@iconify/react'
import { type ComponentInfo, type TriggerInfo, removeBinding, restartSpin } from '../api/client'
import { useAppStore } from '../store/appContext'
import AddComponentDialog from './AddComponentDialog'
import AddBindingDialog from './AddBindingDialog'
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

const TRIGGER_ICONS: Record<string, typeof Globe> = {
  http:  Globe,
  redis: MessageSquare,
  mqtt:  MessageSquare,
  cron:  Clock,
}

function TriggerBadge({ type }: { type: string }) {
  const Icon = TRIGGER_ICONS[type] ?? Zap
  const cls = type === 'http' ? 'badge-green' : type === 'redis' || type === 'mqtt' ? 'badge-purple' : 'badge-gray'
  return (
    <span className={`${cls} badge font-mono uppercase`}>
      <Icon className="w-3 h-3" />{type}
    </span>
  )
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
  Icon: RowIcon, main, sub, tag, tagColor = 'gray',
}: {
  Icon: typeof Layers; main: React.ReactNode; sub?: string; tag?: string; tagColor?: 'gray' | 'green' | 'purple' | 'blue'
}) {
  const tagCls = {
    gray:   'bg-gray-100 text-gray-500',
    green:  'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
    blue:   'bg-blue-50 text-blue-700',
  }[tagColor]

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
      <RowIcon className="w-4 h-4 text-gray-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-800 font-mono truncate">{main}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {tag && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${tagCls}`}>{tag}</span>
      )}
    </div>
  )
}

function hostDescription(h: string): string {
  if (h === '*' || h === 'https://*' || h.includes('*:*')) return 'Wildcard allowing all hosts'
  if (h.includes('127.0.0.1') || h.includes('localhost')) return 'Local / loopback access'
  if (h.includes('*')) return 'Wildcard pattern'
  return 'Specific host'
}

function DetailPane({ component: c, onClose }: { component: ComponentInfo; onClose: () => void }) {
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
    <div className="w-96 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
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
              const TIcon = TRIGGER_ICONS[t.type] ?? Zap
              const route = t.route ?? t.channel ?? t.address ?? '—'
              return (
                <InfoRow key={i} Icon={TIcon} main={route} sub={`${t.type.toUpperCase()} trigger`} tag={t.type.toUpperCase()} tagColor="green" />
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
                    <InfoRow Icon={Key} main={s} sub="Key-value store" tag="KV Store" tagColor="purple" />
                  </div>
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
                    <InfoRow Icon={Database} main={s} sub="SQLite database" tag="SQLite" tagColor="blue" />
                  </div>
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
                </div>
              )
            })}
          </PaneSection>
        )}

        {/* Variables — wired to this component */}
        {c.variables && Object.keys(c.variables).length > 0 && (
          <PaneSection title="Variables" Icon={Layers} count={Object.keys(c.variables).length}>
            {Object.entries(c.variables).map(([k, v]) => (
              <InfoRow key={k} Icon={Layers} main={`${k} = ${v || '(empty)'}`} sub="Wired to component" tagColor="gray" />
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

interface Selection { kind: 'trigger' | 'component'; componentId: string; triggerIdx?: number }

// Hover target can be any node type, not just those that open the detail pane.
type ActiveTarget =
  | { kind: 'trigger';   componentId: string; triggerIdx: number }
  | { kind: 'component'; componentId: string }
  | { kind: 'resource';  resKind: 'kv' | 'sqlite'; resName: string }
  | { kind: 'variable';  varName: string }

function selectionToActive(s: Selection): ActiveTarget {
  if (s.kind === 'trigger') return { kind: 'trigger', componentId: s.componentId, triggerIdx: s.triggerIdx! }
  return { kind: 'component', componentId: s.componentId }
}

function TopologyGraph({
  components, triggers, selected, onSelect,
}: {
  components: ComponentInfo[]
  triggers: TriggerInfo[]
  selected: Selection | null
  onSelect: (s: Selection | null) => void
}) {
  const [hovered, setHovered] = useState<ActiveTarget | null>(null)

  // Hovered takes priority; otherwise fall back to the pinned selection.
  const active: ActiveTarget | null = hovered ?? (selected ? selectionToActive(selected) : null)

  // Sort triggers so they follow the component order — prevents all crossings.
  const sortedTriggers = components.flatMap(c => triggers.filter(t => t.component === c.id))
  const knownComponentIds = new Set(components.map(c => c.id))
  sortedTriggers.push(...triggers.filter(t => !knownComponentIds.has(t.component)))

  // Resources (KV + SQLite)
  const kvStores  = [...new Set(components.flatMap(c => c.keyValueStores  ?? []))]
  const sqliteDbs = [...new Set(components.flatMap(c => c.sqliteDatabases ?? []))]
  const resources = [
    ...kvStores.map(n  => ({ kind: 'kv'     as const, name: n })),
    ...sqliteDbs.map(n => ({ kind: 'sqlite' as const, name: n })),
  ]
  const hasResources = resources.length > 0

  const varNames = [...new Set(components.flatMap(c => Object.keys(c.variables ?? {})))]
  const hasVars  = varNames.length > 0

  // Canvas dimensions
  const rightmostX = hasVars ? VAR_X : hasResources ? RES_X : COMP_X
  const rightmostW = hasVars ? VAR_NODE_W : NODE_W
  const svgW   = rightmostX + rightmostW + PADDING
  const innerH = Math.max(
    colH(sortedTriggers.length),
    colH(components.length),
    colH(resources.length),
    varColH(varNames.length),
  )
  const totalH = innerH + PADDING * 2

  const tOff = colOff(sortedTriggers.length, totalH)
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

  const triggerEdgeActive = (compId: string, ti: number): boolean => {
    if (!active) return false
    if (active.kind === 'trigger')   return active.componentId === compId && active.triggerIdx === ti
    if (active.kind === 'component') return active.componentId === compId
    return false
  }

  const resourceEdgeActive = (compId: string, resKind: 'kv' | 'sqlite', resName: string): boolean => {
    if (!active) return false
    if (active.kind === 'component') return active.componentId === compId
    if (active.kind === 'trigger')   return active.componentId === compId
    if (active.kind === 'resource')  return active.resKind === resKind && active.resName === resName
    return false
  }

  const varEdgeActive = (compId: string, varName: string): boolean => {
    if (!active) return false
    if (active.kind === 'component') return active.componentId === compId
    if (active.kind === 'trigger')   return active.componentId === compId
    if (active.kind === 'variable')  return active.varName === varName
    return false
  }

  // ── Node highlight helpers ────────────────────────────────────────────────
  // Returns 'hi' (primary), 'sec' (secondary/related), 'lo' (dimmed), or 'normal'.

  type NodeState = 'hi' | 'sec' | 'lo' | 'normal'

  const triggerState = (compId: string, ti: number): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'trigger')   return active.componentId === compId && active.triggerIdx === ti ? 'hi' : 'lo'
    if (active.kind === 'component') return active.componentId === compId ? 'sec' : 'lo'
    if (active.kind === 'resource' || active.kind === 'variable') {
      // Dim triggers of unrelated components
      const relatedCompIds = active.kind === 'resource'
        ? components.filter(c => (active.resKind === 'kv' ? c.keyValueStores : c.sqliteDatabases ?? [])?.includes(active.resName)).map(c => c.id)
        : components.filter(c => Object.keys(c.variables ?? {}).includes(active.varName)).map(c => c.id)
      return relatedCompIds.includes(compId) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const compState = (compId: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'component') return active.componentId === compId ? 'hi' : 'lo'
    if (active.kind === 'trigger')   return active.componentId === compId ? 'sec' : 'lo'
    if (active.kind === 'resource') {
      const comp = components.find(c => c.id === compId)
      const uses = active.resKind === 'kv'
        ? (comp?.keyValueStores ?? []).includes(active.resName)
        : (comp?.sqliteDatabases ?? []).includes(active.resName)
      return uses ? 'sec' : 'lo'
    }
    if (active.kind === 'variable') {
      const comp = components.find(c => c.id === compId)
      return Object.keys(comp?.variables ?? {}).includes(active.varName) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const resourceState = (resKind: 'kv' | 'sqlite', resName: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'resource') return active.resKind === resKind && active.resName === resName ? 'hi' : 'lo'
    if (active.kind === 'component' || active.kind === 'trigger') {
      const compId = active.componentId
      const comp = components.find(c => c.id === compId)
      const uses = resKind === 'kv'
        ? (comp?.keyValueStores ?? []).includes(resName)
        : (comp?.sqliteDatabases ?? []).includes(resName)
      return uses ? 'sec' : 'lo'
    }
    return 'lo'
  }

  const varState = (varName: string): NodeState => {
    if (!active) return 'normal'
    if (active.kind === 'variable') return active.varName === varName ? 'hi' : 'lo'
    if (active.kind === 'component' || active.kind === 'trigger') {
      const compId = active.componentId
      const comp = components.find(c => c.id === compId)
      return Object.keys(comp?.variables ?? {}).includes(varName) ? 'sec' : 'lo'
    }
    return 'lo'
  }

  // ── Precompute edges ──────────────────────────────────────────────────────

  const triggerEdges = sortedTriggers.map((t, ti) => {
    const ci = components.findIndex(c => c.id === t.component)
    if (ci < 0) return null
    const on = triggerEdgeActive(t.component, ti)
    return {
      t, ti, ci, on,
      x1: PADDING,          y1: nodeY(tOff, ti) + NODE_H / 2,
      x2: COMP_X + PADDING, y2: nodeY(cOff, ci) + NODE_H / 2,
    }
  }).filter(Boolean) as { t: TriggerInfo; ti: number; ci: number; on: boolean; x1: number; y1: number; x2: number; y2: number }[]

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
    Object.keys(c.variables ?? {}).forEach(varName => {
      const vi = varNames.indexOf(varName)
      if (vi < 0) return
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

        {/* Trigger nodes */}
        {sortedTriggers.map((t, ti) => {
          const TIcon = TRIGGER_ICONS[t.type] ?? Zap
          const state = triggerState(t.component, ti)
          const route = t.route ?? t.channel ?? ''
          return (
            <div key={`t-${ti}`}
              className={`absolute flex items-center rounded-xl overflow-hidden cursor-pointer transition-all ${
                state === 'hi'
                  ? 'bg-green-50 border-2 border-green-400 shadow-md shadow-green-100'
                  : state === 'sec'
                  ? 'bg-green-50/60 border border-green-300 shadow-sm'
                  : 'bg-white border border-gray-200 shadow-sm hover:border-green-300 hover:shadow'
              }`}
              style={{
                left: PADDING, top: nodeY(tOff, ti), width: NODE_W, height: NODE_H,
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
              onClick={() => onSelect(
                selected?.kind === 'trigger' && selected.componentId === t.component && selected.triggerIdx === ti
                  ? null
                  : { kind: 'trigger', componentId: t.component, triggerIdx: ti }
              )}
              onMouseEnter={() => setHovered({ kind: 'trigger', componentId: t.component, triggerIdx: ti })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className={`w-10 h-full flex items-center justify-center shrink-0 border-r ${state === 'hi' ? 'bg-green-100 border-green-200' : 'bg-green-50 border-green-100'}`}>
                <TIcon className="w-4 h-4 text-green-600" />
              </div>
              <div className="px-3 min-w-0">
                <div className="text-xs font-bold text-green-700 uppercase tracking-wide">{t.type}</div>
                <div className="text-xs text-gray-500 font-mono truncate" title={route}>{route || '—'}</div>
              </div>
            </div>
          )
        })}

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
          const isKV  = r.kind === 'kv'
          const state = resourceState(r.kind, r.name)
          const usedBy = sharedCount(r.kind, r.name)
          return (
            <div key={`r-${ri}`}
              className={`absolute flex items-center bg-white rounded-xl shadow-sm overflow-hidden border cursor-pointer transition-all ${
                state === 'hi'
                  ? (isKV ? 'border-purple-400 shadow-purple-100 shadow-md' : 'border-blue-400 shadow-blue-100 shadow-md')
                  : state === 'sec'
                  ? (isKV ? 'border-purple-300' : 'border-blue-300')
                  : (isKV ? 'border-purple-200 hover:border-purple-300' : 'border-blue-200 hover:border-blue-300')
              }`}
              style={{
                left: RES_X + PADDING, top: nodeY(rOff, ri), width: NODE_W, height: NODE_H,
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
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
          const usedBy = components.filter(c => Object.keys(c.variables ?? {}).includes(varName))
          const state = varState(varName)
          return (
            <div key={`v-${vi}`}
              className={`absolute flex items-center bg-white rounded-lg shadow-sm overflow-hidden border cursor-pointer transition-all ${
                state === 'hi'
                  ? 'border-amber-400 shadow-amber-100 shadow-md'
                  : state === 'sec'
                  ? 'border-amber-300'
                  : 'border-amber-200 hover:border-amber-300'
              }`}
              style={{
                left: VAR_X + PADDING, top: varNodeY(vOff, vi), width: VAR_NODE_W, height: VAR_NODE_H,
                opacity: state === 'lo' ? 0.35 : 1,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={() => setHovered({ kind: 'variable', varName })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className={`w-8 h-full flex items-center justify-center shrink-0 border-r ${state === 'hi' ? 'bg-amber-100 border-amber-200' : 'bg-amber-50 border-amber-100'}`}>
                <Layers className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="px-2.5 min-w-0 flex-1">
                <div className="text-xs font-semibold text-gray-800 font-mono truncate">{varName}</div>
                {usedBy.length > 1 && <div className="text-[10px] text-amber-400 leading-tight">{usedBy.length} components</div>}
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

function ComponentRow({ comp }: { comp: ComponentInfo }) {
  const [expanded, setExpanded] = useState(false)
  const lang = detectLang(comp)
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setExpanded(e => !e)}>
        <td className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-spin-oxfordblue flex items-center justify-center shrink-0">
              <Icon
                icon={lang ? lang.iconName : 'simple-icons:webassembly'}
                width={14} height={14}
                className="text-white/80"
              /></div>
            <span className="font-semibold text-gray-900 text-sm">{comp.id}</span>
          </div>
        </td>
        <td className="px-4 py-3 border-b border-gray-100">
          <div className="flex flex-wrap gap-1">
            {comp.triggers?.map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <TriggerBadge type={t.type} />
                {(t.route || t.channel) && <code className="text-xs text-gray-600 font-mono">{t.route ?? t.channel}</code>}
              </div>
            ))}
            {(!comp.triggers || comp.triggers.length === 0) && <span className="text-gray-400 text-xs">No triggers</span>}
          </div>
        </td>
        <td className="px-4 py-3 border-b border-gray-100">
          {(comp.keyValueStores ?? []).length
            ? <div className="flex flex-wrap gap-1">{comp.keyValueStores!.map(s => <span key={s} className="badge badge-purple"><Key className="w-3 h-3" />{s}</span>)}</div>
            : <span className="text-gray-400 text-xs">—</span>}
        </td>
        <td className="px-4 py-3 border-b border-gray-100">
          {(comp.sqliteDatabases ?? []).length
            ? <div className="flex flex-wrap gap-1">{comp.sqliteDatabases!.map(s => <span key={s} className="badge badge-blue"><Database className="w-3 h-3" />{s}</span>)}</div>
            : <span className="text-gray-400 text-xs">—</span>}
        </td>
        <td className="px-4 py-3 border-b border-gray-100 text-right">
          <button className="text-gray-400 hover:text-gray-700 transition-colors text-xs">{expanded ? '▲' : '▼'}</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 pb-3 border-b border-gray-100 bg-gray-50">
            <div className="space-y-3 pt-2">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Source</p>
                <code className="text-xs font-mono text-gray-700 bg-white border border-gray-200 px-2 py-1 rounded">{comp.source || '—'}</code>
              </div>
              {comp.build?.command && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Build</p>
                  <code className="text-xs font-mono text-gray-700 bg-white border border-gray-200 px-2 py-1 rounded">{comp.build.command}</code>
                  {comp.build.workdir && <span className="ml-2 text-xs text-gray-400">(in {comp.build.workdir})</span>}
                </div>
              )}
              {comp.allowedOutboundHosts && comp.allowedOutboundHosts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Allowed outbound hosts</p>
                  <div className="flex flex-wrap gap-1">
                    {comp.allowedOutboundHosts.map(h => <span key={h} className="badge badge-gray font-mono"><ExternalLink className="w-3 h-3" />{h}</span>)}
                  </div>
                </div>
              )}
              {comp.variables && Object.keys(comp.variables).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Variables</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(comp.variables).map(([k, v]) => <span key={k} className="badge badge-gray font-mono text-xs">{k}={v}</span>)}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type ViewMode = 'graph' | 'list'

export default function AppOverview() {
  const { app, refresh }    = useAppStore()
  const [error]             = useState<string | null>(null)
  const loading             = app === null
  const [view, setView]     = useState<ViewMode>('graph')
  const [selected, setSelected] = useState<Selection | null>(null)

  const [showAddComp, setShowAddComp]       = useState(false)
  const [showAddBinding, setShowAddBinding] = useState(false)
  const [showEditToml, setShowEditToml]     = useState(false)
  const [restarting, setRestarting]         = useState(false)

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

  const components = app?.components ?? []
  const triggers   = app?.triggers   ?? []

  // Resolve selected component object for the detail pane
  const selectedComponent = selected
    ? components.find(c => c.id === selected.componentId) ?? null
    : null

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
          <button
            className="btn-secondary text-xs"
            onClick={() => setShowAddComp(true)}
            title="Add a new component via spin add"
          >
            <Package className="w-3.5 h-3.5" /> Add Component
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={() => setShowAddBinding(true)}
            title="Add a KV or SQLite binding to a component"
            disabled={(app?.components ?? []).length === 0}
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

          <button
            className="btn-secondary text-xs"
            onClick={() => setShowEditToml(true)}
            title="Open spin.toml in an editable text view"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit spin.toml
          </button>

          <div className="w-px h-5 bg-gray-200 mx-1" />

          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md font-medium transition-all ${view === 'graph' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setView('graph')}
            >
              <Network className="w-3.5 h-3.5" /> Graph
            </button>
            <button
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md font-medium transition-all ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setView('list')}
            >
              <LayoutList className="w-3.5 h-3.5" /> List
            </button>
          </div>
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

            {view === 'graph' ? (
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
                    selected={selected}
                    onSelect={setSelected}
                  />
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {components.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-spin-midgreen" />
                        Components
                        <span className="badge badge-gray ml-1">{components.length}</span>
                      </h2>
                    </div>
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {['Component', 'Triggers', 'KV Stores', 'SQLite DBs', ''].map(h => (
                            <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {components.map(comp => <ComponentRow key={comp.id} comp={comp} />)}
                      </tbody>
                    </table>
                  </div>
                )}
                {triggers.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-spin-midgreen" /> Triggers
                      </h2>
                    </div>
                    <table className="data-table">
                      <thead><tr><th>Type</th><th>Route / Channel</th><th>Component</th></tr></thead>
                      <tbody>
                        {triggers.map((t, i) => (
                          <tr key={i}>
                            <td><TriggerBadge type={t.type} /></td>
                            <td><code className="font-mono text-xs text-gray-700">{t.route ?? t.channel ?? t.address ?? '—'}</code></td>
                            <td><span className="badge badge-gray font-mono">{t.component}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Detail pane */}
        {selectedComponent && (
          <DetailPane component={selectedComponent} onClose={() => setSelected(null)} />
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
      {showEditToml && (
        <EditSpinTomlModal
          onClose={() => setShowEditToml(false)}
          onSaved={() => { refresh(); }}
        />
      )}
    </div>
  )
}
