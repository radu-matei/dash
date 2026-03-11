import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileText, Loader2, X } from 'lucide-react'

interface Props {
  onClose: () => void
  onSaved: () => void
}

async function fetchToml(): Promise<string> {
  const res = await fetch('/api/spin-toml')
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json() as { content: string }
  return data.content
}

async function saveToml(content: string): Promise<string> {
  const res = await fetch('/api/spin-toml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const data = await res.json() as { message?: string; error?: string }
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data.message ?? 'Saved.'
}

export default function EditSpinTomlModal({ onClose, onSaved }: Props) {
  const [content, setContent]   = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [saved, setSaved]       = useState<string | null>(null)
  const textareaRef             = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetchToml()
      .then(c => { setContent(c); setOriginal(c) })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  // Focus textarea once loaded
  useEffect(() => {
    if (!loading) textareaRef.current?.focus()
  }, [loading])

  // Ctrl/Cmd+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const msg = await saveToml(content)
      setSaved(msg)
      setOriginal(content)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const dirty = content !== original

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/50 backdrop-blur-sm">
      <div className="flex flex-col w-full max-w-4xl mx-auto my-6 bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Edit spin.toml</h2>
              <p className="text-xs text-gray-500">
                Changes are validated for TOML syntax before saving · Spin restarts automatically
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-xs text-amber-600 font-medium px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full">
                Unsaved changes
              </span>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading spin.toml…
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="absolute inset-0 w-full h-full font-mono text-sm p-5 resize-none outline-none border-none bg-gray-950 text-gray-100 leading-relaxed"
              spellCheck={false}
              value={content}
              onChange={e => { setContent(e.target.value); setError(null); setSaved(null) }}
              disabled={saving}
              style={{ tabSize: 2 }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 px-6 py-3 flex items-center justify-between gap-3 bg-gray-50">
          <div className="flex-1 min-w-0">
            {error && (
              <div className="flex items-start gap-2 text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="font-mono">{error}</span>
              </div>
            )}
            {saved && !error && (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{saved}</span>
              </div>
            )}
            {!error && !saved && (
              <span className="text-xs text-gray-400">
                <kbd className="px-1 py-0.5 bg-gray-200 rounded text-gray-600 font-mono">⌘S</kbd> to save ·{' '}
                <kbd className="px-1 py-0.5 bg-gray-200 rounded text-gray-600 font-mono">Esc</kbd> to close
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-secondary text-xs" onClick={onClose}>
              Close
            </button>
            <button
              className="btn-primary text-xs"
              disabled={saving || loading || !dirty}
              onClick={handleSave}
            >
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                : 'Save & Restart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
