import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Globe,
  Key,
  Layers,
  MessageSquare,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { getApp, type AppInfo, type ComponentInfo, type TriggerInfo } from '../api/client'

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status, error }: { status: string; error: string }) {
  const cfg: Record<string, { cls: string; Icon: typeof CheckCircle2; label: string }> = {
    running:  { cls: 'badge-green',  Icon: CheckCircle2,  label: 'Running' },
    starting: { cls: 'badge-yellow', Icon: Clock,         label: 'Starting' },
    stopped:  { cls: 'badge-gray',   Icon: Clock,         label: 'Stopped' },
    error:    { cls: 'badge-red',    Icon: AlertCircle,   label: 'Error' },
  }
  const { cls, Icon, label } = cfg[status] ?? cfg.stopped
  return (
    <span className={cls + ' badge text-xs'} title={error || undefined}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// ─── Trigger type badge ───────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<string, typeof Globe> = {
  http:  Globe,
  redis: MessageSquare,
  mqtt:  MessageSquare,
  cron:  Clock,
}

function TriggerBadge({ type }: { type: string }) {
  const Icon = TRIGGER_ICONS[type] ?? Zap
  const cls =
    type === 'http' ? 'badge-green' :
    type === 'redis' || type === 'mqtt' ? 'badge-purple' :
    'badge-gray'
  return (
    <span className={`${cls} badge font-mono uppercase`}>
      <Icon className="w-3 h-3" />
      {type}
    </span>
  )
}

// ─── Store chips ──────────────────────────────────────────────────────────────

function StoreChips({ items, Icon, cls }: { items: string[]; Icon: typeof Database; cls: string }) {
  if (!items?.length) return <span className="text-gray-400 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(s => (
        <span key={s} className={`${cls} badge`}>
          <Icon className="w-3 h-3" />
          {s}
        </span>
      ))}
    </div>
  )
}

// ─── Component card ───────────────────────────────────────────────────────────

function ComponentRow({ comp }: { comp: ComponentInfo }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-fermyon-oxfordblue flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold uppercase">
                {comp.id.charAt(0)}
              </span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">{comp.id}</span>
          </div>
        </td>
        <td className="px-4 py-3 border-b border-gray-100">
          <div className="flex flex-wrap gap-1">
            {comp.triggers?.map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <TriggerBadge type={t.type} />
                {t.route && (
                  <code className="text-xs text-gray-600 font-mono">{t.route}</code>
                )}
                {t.channel && (
                  <code className="text-xs text-gray-600 font-mono">{t.channel}</code>
                )}
              </div>
            ))}
            {(!comp.triggers || comp.triggers.length === 0) && (
              <span className="text-gray-400 text-xs">No triggers</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 border-b border-gray-100">
          <StoreChips items={comp.keyValueStores ?? []} Icon={Key} cls="badge-purple" />
        </td>
        <td className="px-4 py-3 border-b border-gray-100">
          <StoreChips items={comp.sqliteDatabases ?? []} Icon={Database} cls="badge-blue" />
        </td>
        <td className="px-4 py-3 border-b border-gray-100 text-right">
          <button className="text-gray-400 hover:text-gray-700 transition-colors text-xs">
            {expanded ? '▲' : '▼'}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 pb-3 border-b border-gray-100 bg-gray-50">
            <div className="space-y-3 pt-2">
              {/* Source */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Source
                </p>
                <code className="text-xs font-mono text-gray-700 bg-white border border-gray-200 px-2 py-1 rounded">
                  {comp.source || '—'}
                </code>
              </div>

              {/* Allowed hosts */}
              {comp.allowedOutboundHosts && comp.allowedOutboundHosts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Allowed outbound hosts
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {comp.allowedOutboundHosts.map(h => (
                      <span key={h} className="badge badge-gray font-mono">
                        <ExternalLink className="w-3 h-3" />
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Variables */}
              {comp.variables && Object.keys(comp.variables).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Variables
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(comp.variables).map(([k, v]) => (
                      <span key={k} className="badge badge-gray font-mono text-xs">
                        {k}={v}
                      </span>
                    ))}
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

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  Icon,
  accent,
}: {
  label: string
  value: string | number
  Icon: typeof Layers
  accent?: boolean
}) {
  return (
    <div className={`card p-4 flex items-center gap-4 ${accent ? 'border-fermyon-seagreen/40' : ''}`}>
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          accent ? 'bg-fermyon-seagreen/15' : 'bg-gray-100'
        }`}
      >
        <Icon className={`w-5 h-5 ${accent ? 'text-fermyon-midgreen' : 'text-gray-500'}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ─── Triggers table ───────────────────────────────────────────────────────────

function TriggersTable({ triggers }: { triggers: TriggerInfo[] }) {
  if (!triggers?.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Zap className="w-4 h-4 text-fermyon-midgreen" />
          Triggers
        </h2>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Route / Channel</th>
            <th>Component</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((t, i) => (
            <tr key={i}>
              <td><TriggerBadge type={t.type} /></td>
              <td>
                <code className="font-mono text-xs text-gray-700">
                  {t.route ?? t.channel ?? t.address ?? '—'}
                </code>
              </td>
              <td>
                <span className="badge badge-gray font-mono">{t.component}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AppOverview() {
  const [app, setApp] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const data = await getApp()
      setApp(data)
      setError(null)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className="flex-1 p-6 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-4">
            <div className="skeleton h-5 w-48 mb-2" />
            <div className="skeleton h-4 w-64" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page header */}
      <div className="page-header sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-fermyon-oxfordblue flex items-center justify-center">
            <span className="text-white text-sm font-bold uppercase">
              {app?.name?.charAt(0) ?? 'S'}
            </span>
          </div>
          <div>
            <h1 className="page-title">{app?.name ?? 'Spin Application'}</h1>
            {app?.description && (
              <p className="text-xs text-gray-500 mt-0.5">{app.description}</p>
            )}
          </div>
          <StatusChip status={app?.status ?? 'starting'} error={app?.error ?? ''} />
        </div>
        <button
          onClick={load}
          className="btn-secondary text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="p-6 space-y-6">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Components"
            value={app?.components?.length ?? 0}
            Icon={Layers}
            accent
          />
          <StatCard
            label="Triggers"
            value={app?.triggers?.length ?? 0}
            Icon={Zap}
          />
          <StatCard
            label="Variables"
            value={app?.varCount ?? 0}
            Icon={Key}
          />
          <StatCard
            label="Status"
            value={app?.status ?? '—'}
            Icon={CheckCircle2}
          />
        </div>

        {/* Components table */}
        {app?.components && app.components.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-fermyon-midgreen" />
                Components
                <span className="badge badge-gray ml-1">{app.components.length}</span>
              </h2>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Component
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Triggers
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    KV Stores
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    SQLite DBs
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {app.components.map(comp => (
                  <ComponentRow key={comp.id} comp={comp} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Triggers table */}
        <TriggersTable triggers={app?.triggers ?? []} />
      </div>
    </div>
  )
}
