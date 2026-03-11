import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, CartesianGrid, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Activity, AlertCircle, BarChart2, Clock, RefreshCw, Zap,
} from 'lucide-react'
import {
  getTraces, getOtelMetrics,
  type Span, type MetricSeries,
} from '../api/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDuration = (ms: number) =>
  ms < 1 ? '<1ms' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return '' }
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, Icon, accent = false, warn = false,
}: { label: string; value: string; sub?: string; Icon: typeof Activity; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`card p-5 flex items-start gap-4 ${accent ? 'border-spin-seagreen/40' : warn ? 'border-amber-300' : ''}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accent ? 'bg-spin-seagreen/15' : warn ? 'bg-amber-50' : 'bg-gray-100'}`}>
        <Icon className={`w-5 h-5 ${accent ? 'text-spin-midgreen' : warn ? 'text-amber-600' : 'text-gray-500'}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        <p className="text-xs text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, sub }: { icon: typeof Activity; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-lg bg-spin-oxfordblue/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-spin-oxfordblue" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Chart tooltip styles ─────────────────────────────────────────────────────

const TT = { contentStyle: { fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }, labelStyle: { fontWeight: 600 } }

// ─── OTel metrics section ─────────────────────────────────────────────────────

function OtelSection({ series }: { series: Record<string, MetricSeries> }) {
  const entries = Object.values(series)
  if (!entries.length) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center h-36 text-gray-400 gap-2">
        <BarChart2 className="w-8 h-8 opacity-25" />
        <p className="text-sm">No OTel metrics received yet.</p>
        <p className="text-xs">Spin exports <code>spin.request_count</code>, <code>spin.component_cpu_time</code>, <code>spin.component_memory_used</code>, and more.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {entries.map(s => <MetricCard key={s.name} series={s} />)}
    </div>
  )
}

function MetricCard({ series }: { series: MetricSeries }) {
  const pts = series.points.slice(-60)

  // Group by component attr to show breakdown
  const byComponent = new Map<string, number>()
  for (const pt of series.points) {
    const comp = pt.attrs?.['component_id'] ?? pt.attrs?.['component'] ?? 'total'
    byComponent.set(comp, (byComponent.get(comp) ?? 0) + pt.value)
  }
  const compData = Array.from(byComponent.entries())
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)

  const chartData = pts.map(p => ({ time: fmtTime(p.timestamp), value: p.value }))

  const kindBadge = series.kind === 'counter' ? 'badge-blue' : series.kind === 'histogram' ? 'badge-purple' : 'badge-gray'
  const unitSuffix = series.unit === 'ms' ? 'ms' : series.unit === 's' ? 's' : ''

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 font-mono">{series.name}</p>
          {series.description && <p className="text-xs text-gray-400 mt-0.5">{series.description}</p>}
        </div>
        <span className={`badge ${kindBadge} ml-2 shrink-0`}>{series.kind}</span>
      </div>

      {/* Timeline chart */}
      {chartData.length > 1 && (
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={chartData} margin={{ top: 2, right: 2, left: -30, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${series.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" tick={{ fontSize: 8, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 8, fill: '#9ca3af' }} />
            <Tooltip {...TT} formatter={(v: number) => [`${v.toFixed(2)}${unitSuffix}`, series.name]} />
            <Area type="monotone" dataKey="value" stroke="#7c3aed" fill={`url(#grad-${series.name})`} strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Per-component breakdown */}
      {compData.length > 1 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 mb-2">By component</p>
          <div className="space-y-1.5">
            {compData.map(c => {
              const maxVal = compData[0].value
              return (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-gray-600 font-mono" title={c.name}>{c.name}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${maxVal > 0 ? (c.value / maxVal) * 100 : 0}%` }} />
                  </div>
                  <span className="w-16 text-right tabular-nums text-gray-700 font-mono">{c.value.toFixed(2)}{unitSuffix}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Trace-derived section ────────────────────────────────────────────────────

function TraceSection({ spans }: { spans: Span[] }) {
  const data = useMemo(() => {
    if (!spans.length) return null

    const byTrace = new Map<string, Span[]>()
    for (const s of spans) {
      const arr = byTrace.get(s.traceId) ?? []; arr.push(s); byTrace.set(s.traceId, arr)
    }
    const roots: Span[] = []
    for (const ss of byTrace.values()) {
      roots.push(ss.find(s => !s.parentId) ?? ss[0])
    }
    roots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

    const total = roots.length
    const errors = roots.filter(s => s.status === 'ERROR').length
    const durations = roots.map(s => s.durationMs).sort((a, b) => a - b)
    const p50 = percentile(durations, 50)
    const p95 = percentile(durations, 95)
    const p99 = percentile(durations, 99)
    const avg = durations.reduce((s, d) => s + d, 0) / total

    const BUCKET_MS = 60_000
    const buckets = new Map<number, { requests: number; errors: number }>()
    for (const r of roots) {
      const t = Math.floor(new Date(r.startTime).getTime() / BUCKET_MS) * BUCKET_MS
      const b = buckets.get(t) ?? { requests: 0, errors: 0 }
      b.requests++; if (r.status === 'ERROR') b.errors++
      buckets.set(t, b)
    }
    const timeline = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, v]) => ({
        time: new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        ...v,
      }))

    const HIST_EDGES = [0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity]
    const HIST_LABELS = ['<5ms','5ms','10ms','25ms','50ms','100ms','250ms','500ms','1s','2.5s','5s+']
    const hist = HIST_LABELS.map(l => ({ label: l, count: 0 }))
    for (const d of durations) {
      const i = HIST_EDGES.findIndex((b, idx) => d < b && idx > 0)
      if (i > 0) hist[i - 1].count++
    }

    return { total, errors, p50, p95, p99, avg, timeline, hist }
  }, [spans])

  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total requests" value={String(data.total)} Icon={Activity} accent />
        <StatCard label="Error rate" value={`${data.total > 0 ? ((data.errors / data.total) * 100).toFixed(1) : 0}%`} sub={`${data.errors} errors`} Icon={AlertCircle} warn={data.errors > 0} />
        <StatCard label="Avg latency" value={fmtDuration(data.avg)} sub={`p50 ${fmtDuration(data.p50)}`} Icon={Clock} />
        <StatCard label="p95 / p99" value={fmtDuration(data.p95)} sub={`p99 ${fmtDuration(data.p99)}`} Icon={Zap} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Timeline */}
        {data.timeline.length > 0 && (
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-600 mb-3">Requests per minute</p>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={data.timeline} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.15} /><stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#dc2626" stopOpacity={0.15} /><stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} allowDecimals={false} />
                <Tooltip {...TT} />
                <Area type="monotone" dataKey="requests" name="Requests" stroke="#0284c7" fill="url(#reqGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="errors" name="Errors" stroke="#dc2626" fill="url(#errGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Latency histogram */}
        <div className="card p-5">
          <p className="text-xs font-semibold text-gray-600 mb-3">Latency distribution</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.hist} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip {...TT} />
              <Bar dataKey="count" name="Spans" radius={[3,3,0,0]}>
                {data.hist.map((_, i) => (
                  <Cell key={i} fill={i < 4 ? '#34d399' : i < 7 ? '#0284c7' : '#dc2626'} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MetricsPage() {
  const [spans, setSpans] = useState<Span[]>([])
  const [otelMetrics, setOtelMetrics] = useState<Record<string, MetricSeries>>({})
  const [loading, setLoading] = useState(true)

  const wakeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Sequential polling — same rationale as TraceViewer: avoid canceling
    // in-flight requests when the payload is large.
    const ctrl = new AbortController()
    let active = true

    const run = async () => {
      while (active) {
        const sig = ctrl.signal
        const [s, o] = await Promise.allSettled([getTraces(sig), getOtelMetrics(sig)])
        if (!active || sig.aborted) break
        if (s.status === 'fulfilled') setSpans(s.value ?? [])
        if (o.status === 'fulfilled') setOtelMetrics(o.value ?? {})
        setLoading(false)
        await new Promise<void>(res => {
          const t = setTimeout(res, 3000)
          wakeRef.current = () => { clearTimeout(t); res() }
          sig.addEventListener('abort', () => { clearTimeout(t); res() })
        })
        wakeRef.current = null
      }
    }

    run()
    return () => { active = false; ctrl.abort() }
  }, [])

  if (loading) return (
    <div className="p-6 space-y-4">
      {[1,2,3].map(i => <div key={i} className="card p-4 h-24 skeleton" />)}
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      {/* Header */}
      <div className="page-header bg-white sticky top-0 z-10 shrink-0">
        <h1 className="page-title">Metrics</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">auto-refreshes every 3s</span>
          <button className="btn-secondary text-xs h-8 px-2.5" onClick={() => wakeRef.current?.()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* OTel metrics from Spin */}
        <section>
          <SectionHeader icon={BarChart2} title="OTel Metrics" sub="Metrics exported by Spin via OTLP (spin.request_count, spin.component_cpu_time, spin.component_memory_used, etc.)" />
          <OtelSection series={otelMetrics} />
        </section>

        {/* Trace-derived metrics */}
        {spans.length > 0 && (
          <section>
            <SectionHeader icon={Activity} title="Request Metrics" sub="Derived from collected OTel traces" />
            <TraceSection spans={spans} />
          </section>
        )}
      </div>
    </div>
  )
}
