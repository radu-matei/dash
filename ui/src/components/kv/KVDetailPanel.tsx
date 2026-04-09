import { useEffect, useRef, useState } from 'react'
import { Copy, Download, Trash2, Upload } from 'lucide-react'
import type { KVKeyEntry } from './kvUtils'
import { formatSize, TYPE_BADGE_CLASS, TYPE_LABEL } from './kvUtils'
import KVCodeEditor from './KVCodeEditor'

type Tab = 'formatted' | 'raw' | 'edit'
type InputMode = 'text' | 'file'

interface Props {
  entry: KVKeyEntry
  isNew?: boolean
  onClose: () => void
  onSave: (key: string, value: string | ArrayBuffer) => void
  onDelete: (key: string) => void
}

function detectLang(value: string): 'json' | 'text' {
  try { JSON.parse(value); return 'json' } catch { return 'text' }
}

export default function KVDetailPanel({ entry, isNew, onClose, onSave, onDelete }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(isNew ? 'edit' : 'formatted')
  const [editValue, setEditValue] = useState('')
  const [editLang, setEditLang] = useState<'json' | 'text'>('json')
  const [dirty, setDirty] = useState(false)
  const [jsonValid, setJsonValid] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [inputMode, setInputMode] = useState<InputMode>('text')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset state when entry changes
  const prevKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (entry.key !== prevKeyRef.current) {
      prevKeyRef.current = entry.key
      if (isNew) {
        setActiveTab('edit')
        setEditValue('')
        setEditLang('json')
        setNewKeyName('')
        setDirty(false)
        setInputMode('text')
        setFileName(null)
        setFileBytes(null)
        setTimeout(() => keyInputRef.current?.focus(), 50)
      } else {
        setActiveTab('formatted')
        const v = entry.value ?? ''
        setEditValue(v)
        setEditLang(detectLang(v))
        setDirty(false)
        setInputMode('text')
        setFileName(null)
        setFileBytes(null)
      }
      setJsonValid(true)
    }
  }, [entry.key, entry.value, isNew])

  const value = entry.value ?? ''
  const isBinary = entry.type === 'binary'

  // Pretty-print JSON for formatted view
  let formattedValue = value
  if (entry.type === 'json') {
    try {
      formattedValue = JSON.stringify(JSON.parse(value), null, 2)
    } catch { /* use raw value */ }
  }

  function handleTabChange(tab: Tab) {
    if (isNew) return
    setActiveTab(tab)
    if (tab === 'edit') {
      if (isBinary) {
        setInputMode('file')
      } else {
        const v = entry.type === 'json' ? formattedValue : value
        setEditValue(v)
        setEditLang(detectLang(v))
        setInputMode('text')
      }
      setDirty(false)
      setFileName(null)
      setFileBytes(null)
    }
  }

  function handleEditChange(v: string) {
    setEditValue(v)
    setDirty(true)
  }

  function handleCopy() {
    navigator.clipboard.writeText(value)
  }

  function handleDownload() {
    // Use raw bytes if available for binary-safe download
    const data = entry.rawBytes ?? new TextEncoder().encode(value)
    const blob = new Blob([data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.key.replace(/\//g, '_')
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFileSelect(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = reader.result as ArrayBuffer
      setFileBytes(bytes)
      setFileName(file.name)
      setDirty(true)
    }
    reader.readAsArrayBuffer(file)
  }

  function handleSave() {
    const key = isNew ? newKeyName : entry.key
    if (!key) return
    if (inputMode === 'file' && fileBytes) {
      onSave(key, fileBytes)
    } else {
      onSave(key, editValue)
    }
  }

  const canSave = isNew
    ? (!!newKeyName && dirty)
    : dirty

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isNew ? (
            <input
              ref={keyInputRef}
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder="Enter key name…"
              className="input-mono text-xs w-52"
              autoFocus
            />
          ) : (
            <>
              <span className="font-mono text-xs text-gray-800 truncate font-semibold">{entry.key}</span>
              {entry.type && <span className={TYPE_BADGE_CLASS[entry.type]}>{TYPE_LABEL[entry.type]}</span>}
              {entry.size != null && <span className="text-[11px] text-gray-400 shrink-0">{formatSize(entry.size)}</span>}
            </>
          )}

          {!isNew && (
            <div className="tab-group ml-2">
              <button
                onClick={() => handleTabChange('formatted')}
                className={`tab ${activeTab === 'formatted' ? 'tab-active' : ''}`}
              >
                Formatted
              </button>
              <button
                onClick={() => handleTabChange('raw')}
                className={`tab ${activeTab === 'raw' ? 'tab-active' : ''}`}
              >
                Raw
              </button>
              <button
                onClick={() => handleTabChange('edit')}
                className={`tab ${activeTab === 'edit' ? 'tab-active' : ''}`}
              >
                Edit
                {activeTab === 'edit' && !jsonValid && editLang === 'json' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                )}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {!isNew && (
            <>
              <button onClick={handleDownload} className="btn btn-ghost btn-sm text-gray-400" title="Download">
                <Download className="w-3 h-3" />
              </button>
              {!isBinary && (
                <button onClick={handleCopy} className="btn btn-ghost btn-sm text-gray-400" title="Copy">
                  <Copy className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => onDelete(entry.key)}
                className="btn btn-ghost btn-sm text-gray-400 hover:text-red-600"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
          {activeTab === 'edit' && (
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="btn btn-primary btn-sm"
            >
              {isNew ? 'Create' : 'Save'}
            </button>
          )}
          <button
            className="text-gray-400 hover:text-gray-700 text-base px-1 leading-none shrink-0"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'formatted' && !isNew && (
        <div className="flex-1 min-h-0 flex flex-col p-3">
          {isBinary ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Binary data</p>
                <p className="text-xs text-gray-400 mt-1">{formatSize(entry.size ?? 0)} — use Download to save</p>
              </div>
            </div>
          ) : (
            <KVCodeEditor
              value={formattedValue}
              readOnly
              language={entry.type === 'json' ? 'json' : 'text'}
              minHeight="100px"
            />
          )}
        </div>
      )}

      {activeTab === 'raw' && !isNew && (
        <div className="flex-1 min-h-0 overflow-auto p-5 bg-gray-50">
          {isBinary ? (
            <div className="text-center text-gray-400 py-8">
              <p className="text-sm">Binary content cannot be displayed as text.</p>
              <p className="text-xs mt-1">Use Download to save the raw bytes.</p>
            </div>
          ) : (
            <pre className="text-sm font-mono text-gray-700 whitespace-pre-wrap break-all">{value}</pre>
          )}
        </div>
      )}

      {activeTab === 'edit' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
          {/* Input mode toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="tab-group">
              <button
                onClick={() => { setInputMode('text'); setFileName(null); setFileBytes(null) }}
                className={`tab ${inputMode === 'text' ? 'tab-active' : ''}`}
              >
                Text
              </button>
              <button
                onClick={() => setInputMode('file')}
                className={`tab ${inputMode === 'file' ? 'tab-active' : ''}`}
              >
                <Upload className="w-3 h-3" />
                File
              </button>
            </div>
            {inputMode === 'text' && (
              <div className="tab-group">
                <button
                  onClick={() => setEditLang('json')}
                  className={`tab ${editLang === 'json' ? 'tab-active' : ''}`}
                >
                  JSON
                </button>
                <button
                  onClick={() => setEditLang('text')}
                  className={`tab ${editLang === 'text' ? 'tab-active' : ''}`}
                >
                  Plain
                </button>
              </div>
            )}
          </div>

          {inputMode === 'text' ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <KVCodeEditor
                value={editValue}
                onChange={handleEditChange}
                language={editLang}
                minHeight="100px"
                onValidationChange={editLang === 'json' ? setJsonValid : undefined}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]) }}
                onDragOver={e => e.preventDefault()}
                className="border-2 border-dashed border-gray-200 rounded-14 p-8 text-center cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-colors w-full max-w-sm"
              >
                <Upload className="w-8 h-8 mx-auto text-gray-300 mb-3" />
                {fileName ? (
                  <>
                    <p className="text-sm font-medium text-gray-700 break-all px-2">{fileName}</p>
                    <p className="text-xs text-gray-400 mt-1">{formatSize(fileBytes?.byteLength ?? 0)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-600">Drop a file here</p>
                    <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]) }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
