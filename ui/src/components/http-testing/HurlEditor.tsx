import { Fragment, useMemo, useRef, type ReactNode } from 'react'

// ─── Hurl file icon ─────────────────────────────────────────────────────────

export function HurlIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Hurl file">
      <path d="M3,4 H15 V2 L21,7 L15,12 V10 H3 Z" fill="#ff0288" />
      <path d="M21,14 H9 V12 L3,17 L9,22 V20 H21 Z" fill="#ff0288" />
    </svg>
  )
}

// ─── Hurl syntax highlighting ───────────────────────────────────────────────

const HURL_SECTIONS = new Set([
  'QueryStringParams', 'Query', 'FormParams', 'Form', 'MultipartFormData',
  'Multipart', 'Cookies', 'Captures', 'Asserts', 'Options', 'BasicAuth',
])

const ASSERT_KW = new Set([
  'jsonpath', 'xpath', 'header', 'cookie', 'body', 'bytes', 'sha256', 'md5',
  'status', 'url', 'duration', 'certificate', 'ip', 'variable', 'regex',
])

function renderWithTemplates(text: string, baseCls: string): ReactNode {
  if (!text) return null
  const parts = text.split(/(\{\{.*?\}\}|"[^"]*")/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('{{') && part.endsWith('}}'))
          return <span key={i} className="text-orange-600">{part}</span>
        if (part.startsWith('"') && part.endsWith('"'))
          return <span key={i} className="text-amber-700">{part}</span>
        return <span key={i} className={baseCls}>{part}</span>
      })}
    </>
  )
}

function renderAssertRest(text: string): ReactNode {
  const parts = text.split(
    /(\{\{.*?\}\}|"[^"]*"|\b(?:==|!=|>=|<=|>|<|contains|includes|startsWith|endsWith|matches|exists|isInteger|isFloat|isBoolean|isString|isCollection|not exists|not|count)\b)/g
  )
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('{{') && part.endsWith('}}'))
          return <span key={i} className="text-orange-600">{part}</span>
        if (part.startsWith('"') && part.endsWith('"'))
          return <span key={i} className="text-amber-700">{part}</span>
        if (/^(==|!=|>=|<=|>|<|contains|includes|startsWith|endsWith|matches|exists|isInteger|isFloat|isBoolean|isString|isCollection|not exists|not|count)$/.test(part))
          return <span key={i} className="text-pink-600 font-semibold">{part}</span>
        if (/^\s*\d+(\.\d+)?\s*$/.test(part))
          return <span key={i} className="text-purple-600">{part}</span>
        return <span key={i} className="text-gray-500">{part}</span>
      })}
    </>
  )
}

export function highlightHurlLine(line: string): ReactNode {
  if (!line) return ' '

  if (/^\s*#/.test(line))
    return <span className="text-gray-400 italic">{line}</span>

  const methodMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\b(.*)/)
  if (methodMatch) {
    return (
      <>
        <span className="text-emerald-600 font-bold">{methodMatch[1]}</span>
        {renderWithTemplates(methodMatch[2], 'text-blue-600')}
      </>
    )
  }

  const httpMatch = line.match(/^(HTTP(?:\/[\d.]+)?)\s+(\*|\d{3})(.*)/)
  if (httpMatch) {
    const code = httpMatch[2] === '*' ? 0 : parseInt(httpMatch[2])
    const statusCls =
      code >= 500 ? 'text-red-600 font-bold' :
      code >= 400 ? 'text-amber-600 font-bold' :
      code >= 300 ? 'text-yellow-600 font-bold' :
      code === 0  ? 'text-gray-500 font-bold' :
      'text-emerald-600 font-bold'
    return (
      <>
        <span className="text-purple-600 font-bold">{httpMatch[1]}</span>
        <span className="text-gray-400"> </span>
        <span className={statusCls}>{httpMatch[2]}</span>
        {httpMatch[3] && <span className="text-gray-500">{httpMatch[3]}</span>}
      </>
    )
  }

  const sectionMatch = line.match(/^(\[)(\w+)(\])(.*)/)
  if (sectionMatch && HURL_SECTIONS.has(sectionMatch[2])) {
    return (
      <>
        <span className="text-purple-500">{sectionMatch[1]}</span>
        <span className="text-purple-600 font-bold">{sectionMatch[2]}</span>
        <span className="text-purple-500">{sectionMatch[3]}</span>
        {sectionMatch[4] && <span className="text-gray-500">{sectionMatch[4]}</span>}
      </>
    )
  }

  const headerMatch = line.match(/^([A-Za-z][\w-]*)(\s*:\s*)(.*)$/)
  if (headerMatch) {
    return (
      <>
        <span className="text-teal-600">{headerMatch[1]}</span>
        <span className="text-gray-400">{headerMatch[2]}</span>
        {renderWithTemplates(headerMatch[3], 'text-gray-700')}
      </>
    )
  }

  const trimmed = line.trimStart()
  const indent = line.slice(0, line.length - trimmed.length)
  const firstWord = trimmed.split(/\s/)[0]
  if (ASSERT_KW.has(firstWord)) {
    return (
      <>
        {indent && <span>{indent}</span>}
        <span className="text-cyan-700 font-medium">{firstWord}</span>
        {renderAssertRest(trimmed.slice(firstWord.length))}
      </>
    )
  }

  return renderWithTemplates(line, 'text-gray-800')
}

// ─── Editor component ───────────────────────────────────────────────────────

const EDITOR_STYLE: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  fontSize: '12px',
  lineHeight: '20px',
  padding: '16px',
  margin: 0,
  border: 'none',
  outline: 'none',
  tabSize: 2,
  letterSpacing: 'normal',
  wordSpacing: 'normal',
}

export default function HurlEditor({ value, onChange, readOnly, placeholder }: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
  placeholder?: string
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const highlighted = useMemo(() => {
    if (!value && placeholder)
      return <span className="text-gray-400 italic">{placeholder}</span>
    const lines = value.split('\n')
    return lines.map((line, i) => (
      <Fragment key={i}>
        {i > 0 && '\n'}
        {highlightHurlLine(line)}
      </Fragment>
    ))
  }, [value, placeholder])

  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = value.slice(0, start) + '  ' + value.slice(end)
      onChange(next)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  if (readOnly) {
    return (
      <pre
        className="flex-1 overflow-auto m-0 whitespace-pre bg-gray-50"
        style={EDITOR_STYLE}
      >
        {highlighted}
        {'\n'}
      </pre>
    )
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-white">
      <pre
        ref={preRef}
        className="absolute inset-0 m-0 overflow-hidden whitespace-pre pointer-events-none select-none"
        style={EDITOR_STYLE}
        aria-hidden="true"
      >
        {highlighted}
        {'\n'}
      </pre>
      <textarea
        ref={taRef}
        className="absolute inset-0 w-full h-full m-0 whitespace-pre bg-transparent resize-none"
        style={{ ...EDITOR_STYLE, color: 'transparent', caretColor: '#1f2937' }}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        wrap="off"
      />
    </div>
  )
}
