import { useEffect, useState } from 'react'
import { AlertCircle, Key, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { deleteKV, getKVEntries, upsertKV, type KVEntry } from '../api/client'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

export default function KVExplorer() {
  const [entries, setEntries] = useState<KVEntry[]>([])
  const [storeFilter, setStoreFilter] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [form, setForm] = useState<KVEntry>({ store: 'default', key: '', value: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try { setEntries((await getKVEntries()) ?? []); setError(null) }
    catch (e: unknown) { setError((e as Error).message) }
  }

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])

  const stores = Array.from(new Set(entries.map(e => e.store))).sort()

  const filtered = entries.filter(e => {
    if (storeFilter && e.store !== storeFilter) return false
    if (search && !e.key.toLowerCase().includes(search.toLowerCase()) && !e.value.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleDelete = async (e: KVEntry) => {
    if (!confirm(`Delete "${e.key}" from store "${e.store}"?`)) return
    try { await deleteKV(e.store, e.key); await load() }
    catch (err: unknown) { setError((err as Error).message) }
  }

  const openEdit = (e: KVEntry) => { setForm({ ...e }); setModal('edit') }
  const openAdd = () => { setForm({ store: stores[0] ?? 'default', key: '', value: '' }); setModal('add') }

  const handleSave = async () => {
    if (!form.store || !form.key) return
    setSaving(true)
    try { await upsertKV(form); setModal(null); await load() }
    catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="page-header shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="page-title">KV Store</h1>
          {stores.length > 0 && (
            <select className="input text-xs py-1 h-8" value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
              <option value="">All stores</option>
              {stores.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input text-xs py-1 pl-8 h-8 w-48" placeholder="Search key or value…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} entries</span>
          <button className="btn-secondary text-xs h-8 px-2.5" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button className="btn-primary text-xs h-8" onClick={openAdd}>
            <Plus className="w-3.5 h-3.5" /> Add entry
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <Key className="w-8 h-8 opacity-25" />
            <p className="text-sm">{entries.length === 0 ? 'No KV entries yet.' : 'No entries match your filter.'}</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-32">Store</th>
                <th className="w-56">Key</th>
                <th>Value</th>
                <th className="w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="group">
                  <td><span className="badge badge-purple font-mono">{e.store}</span></td>
                  <td><code className="font-mono text-xs text-gray-800">{e.key}</code></td>
                  <td>
                    <code className="font-mono text-xs text-gray-600 max-w-sm truncate block" title={e.value}>
                      {e.value}
                    </code>
                  </td>
                  <td>
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="btn-secondary text-xs py-0.5 px-2 h-6" onClick={() => openEdit(e)}>
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button className="btn-danger text-xs py-0.5 px-2 h-6" onClick={() => handleDelete(e)}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <Modal title={modal === 'add' ? 'Add KV Entry' : 'Edit KV Entry'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Store</label>
              <input className="input w-full" value={form.store} onChange={e => setForm(f => ({ ...f, store: e.target.value }))} placeholder="default" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Key</label>
              <input className="input-mono w-full" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} placeholder="my-key" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Value</label>
              <textarea className="input-mono w-full h-24 resize-none" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="my-value" />
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
