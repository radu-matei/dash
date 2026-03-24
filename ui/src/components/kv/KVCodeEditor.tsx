import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'

interface Props {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  minHeight?: string
  language?: 'json' | 'text'
  onValidationChange?: (valid: boolean) => void
}

export default function KVCodeEditor({
  value,
  onChange,
  readOnly = false,
  minHeight = '200px',
  language = 'text',
  onValidationChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onValidRef = useRef(onValidationChange)
  // Track whether the last change originated from the editor (user typing)
  const internalChange = useRef(false)
  onChangeRef.current = onChange
  onValidRef.current = onValidationChange

  const validate = useCallback((doc: string) => {
    if (language !== 'json' || !onValidRef.current) return
    try {
      JSON.parse(doc)
      onValidRef.current(true)
    } catch {
      onValidRef.current(false)
    }
  }, [language])

  useEffect(() => {
    if (!containerRef.current) return

    const extensions = [
      basicSetup,
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { minHeight, height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: "'JetBrains Mono', monospace", overflow: 'auto' },
        '.cm-content': { padding: '12px 0' },
        '.cm-gutters': { backgroundColor: '#f9fafb', borderRight: '1px solid #e5e7eb' },
        '&.cm-focused': { outline: 'none' },
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          internalChange.current = true
          const doc = update.state.doc.toString()
          onChangeRef.current?.(doc)
          validate(doc)
        }
      }),
    ]

    if (language === 'json') extensions.push(json())
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
      extensions.push(EditorView.editable.of(false))
    }

    // Ctrl/Cmd+S prevention (let parent handle save)
    extensions.push(keymap.of([{
      key: 'Mod-s',
      run: () => true, // consume the event
    }]))

    const state = EditorState.create({ doc: value, extensions })
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    // Initial validation
    validate(value)

    return () => { view.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, minHeight])

  // Sync external value changes (e.g., switching keys) — skip if change came from editor
  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false
      return
    }
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className="overflow-hidden border border-gray-200 rounded-10 bg-white h-full"
    />
  )
}
