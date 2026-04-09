import { useMemo, useState } from 'react'
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { TraceGroup } from './types'
import { fmtDuration } from './traceUtils'

const BUCKET_COUNT = 10

interface Bucket {
  from: number
  to: number
  count: number
}

export default function DurationChart({ traces }: { traces: TraceGroup[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const buckets = useMemo<Bucket[]>(() => {
    if (traces.length === 0) return []
    const durations = traces.map(t => t.durationMs)
    const min = Math.min(...durations)
    const max = Math.max(...durations)
    if (min === max) return [{ from: min, to: max, count: traces.length }]

    const step = (max - min) / BUCKET_COUNT
    const b: Bucket[] = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      from: min + i * step,
      to: min + (i + 1) * step,
      count: 0,
    }))
    for (const d of durations) {
      const idx = Math.min(Math.floor((d - min) / step), BUCKET_COUNT - 1)
      b[idx].count++
    }
    return b
  }, [traces])

  if (buckets.length <= 1) return null

  return (
    <div className="flex items-center" title="Duration distribution">
      <ResponsiveContainer width={100} height={24}>
        <BarChart data={buckets} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const b = payload[0].payload as Bucket
              return (
                <div className="bg-gray-900 text-white text-[10px] font-mono px-2 py-1 rounded shadow-lg">
                  {fmtDuration(b.from)}–{fmtDuration(b.to)}: {b.count}
                </div>
              )
            }}
          />
          <Bar dataKey="count" radius={[1, 1, 0, 0]}>
            {buckets.map((_, i) => (
              <Cell
                key={i}
                fill={hoveredIdx === i ? '#0284c7' : '#94a3b8'}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
