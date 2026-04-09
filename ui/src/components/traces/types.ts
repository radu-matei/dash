import type { Span } from '../../api/client'

export interface TraceGroup {
  traceId: string
  rootName: string
  component: string
  /** All unique components that contributed spans to this trace. */
  components: Set<string>
  startMs: number
  endMs: number
  durationMs: number
  spanCount: number
  hasErrors: boolean
  spans: Span[]
  httpMethod?: string
  httpStatus?: string
  /** Request path extracted from root-span attrs (url.path / http.target / http.route). */
  httpPath?: string
}

export interface SpanNode { span: Span; children: SpanNode[]; depth: number }
