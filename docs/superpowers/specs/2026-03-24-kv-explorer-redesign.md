# KV Explorer Redesign

**Date:** 2026-03-24
**Goal:** Redesign the KV Explorer for a phenomenal developer experience — better usability, richer editing, bulk operations, and full alignment with the unified UX design system.
**Direction:** Cloudflare-style full-width table with a bottom draggable detail panel. CodeMirror editor. Import/export. Bulk operations.

---

## 1. Layout

### Overall Structure
```
┌─────────────────────────────────────────────────────────┐
│  KV Explorer    [default] [cache] [sessions]    🔍 ⬆ ⬇ +│  ← Toolbar
├─────────────────────────────────────────────────────────┤
│  ☐  Key            Type    Size    Preview    Actions   │  ← Table header
│  ☐  user:123       JSON    1.2KB   {"name":…  View Del  │
│  ☑  config:app     JSON    340B    {"name":…  View Del  │  ← Selected row
│  ☐  session:abc    STR     64B     eyJhbGci…  View Del  │
│  ☐  cache:page/…   B64     8.4KB   PCFET0NU…  View Del  │
│  4 keys · 1 selected                  Delete Selected   │  ← Status bar
├──────────────────────── ═══ ────────────────────────────┤  ← Drag handle
│  config:app  [JSON] 340B    [Formatted] [Raw] [Edit]    │  ← Detail header
│  {                                                       │
│    "name": "my-app",                                     │  ← Value display
│    "version": "1.0.0",                                   │
│    "maxRetries": 3                                       │
│  }                                                       │
│                          Delete Key   Copy   Close  Save │  ← Detail footer
└─────────────────────────────────────────────────────────┘
```

### Toolbar
- Page title: "KV Explorer"
- Store selection: Segment-control tabs (`.tab-group`) — one tab per store
- Search: Input with search icon, filters keys client-side (real-time)
- Actions: Import (`.btn-secondary`), Export (`.btn-secondary`), + Add Key (`.btn-primary`)

### Table
- Full-width data table using `.data-table` class
- Columns: Checkbox | Key | Type | Size | Preview | Actions
- Sortable columns: Key (alphabetical), Size (numeric) — click header to toggle asc/desc
- Row hover: `bg-gray-50`
- Selected row: `bg-spin-oxfordblue/5` with bold key text
- Status bar: key count, selection count, bulk delete action when items selected

### Bottom Detail Panel
- Uses `ResizablePanel` component (vertical orientation, min-height 120px, max 70vh)
- Panel height persisted in localStorage
- **Collapsed state:** When no key is selected, panel shows drag handle + centered "Select a key to view its value" placeholder
- **Expanded state:** Detail header + content area + footer

---

## 2. Component Architecture

Break the current 529-line monolith (`KVExplorer.tsx`) into focused components:

| Component | Responsibility | Estimated Size |
|-----------|---------------|----------------|
| `KVExplorer.tsx` | Page orchestrator — state, data fetching, layout composition | ~150 lines |
| `KVToolbar.tsx` | Store tabs, search input, Import/Export/Add buttons | ~60 lines |
| `KVTable.tsx` | Data table with bulk selection, sorting, type detection | ~120 lines |
| `KVDetailPanel.tsx` | Bottom panel with Formatted/Raw/Edit tabs | ~100 lines |
| `KVCodeEditor.tsx` | CodeMirror 6 wrapper for the Edit tab | ~80 lines |
| `KVAddKeyDialog.tsx` | Modal dialog for creating new keys | ~70 lines |
| `KVImportExportDialog.tsx` | Modal dialogs for import/export operations | ~90 lines |

### File Organization
```
ui/src/components/kv/
├── KVExplorer.tsx          # Main page component
├── KVToolbar.tsx           # Toolbar with store tabs, search, actions
├── KVTable.tsx             # Data table with bulk selection
├── KVDetailPanel.tsx       # Bottom value viewer/editor panel
├── KVCodeEditor.tsx        # CodeMirror wrapper
├── KVAddKeyDialog.tsx      # Add key modal
├── KVImportExportDialog.tsx # Import/export modals
└── kvUtils.ts              # Shared utilities (type detection, formatting)
```

---

## 3. Key Metadata & Type Detection

### Type Detection (`kvUtils.ts`)
Auto-detect value type from the decoded content:

| Type | Detection | Badge |
|------|-----------|-------|
| JSON | Valid `JSON.parse()` | `badge-blue` "JSON" |
| String | Default for non-JSON text | `badge-gray` "STR" |
| Base64 | Existing `looksLikeBase64()` heuristic (length ≥ 8, matches regex) | `badge-purple` "B64" |

### Size Display
- Format value byte length: `340 B`, `1.2 KB`, `8.4 KB`
- Computed from the decoded value string length
- Shown in `badge-gray` or plain dim text

### Value Preview
- Truncated first ~40 chars of the decoded value
- Monospace, `text-gray-400`
- JSON values show the start of the formatted string

---

## 4. Detail Panel

### Tabs (Segment Control)
Three tabs using `.tab-group`:

**Formatted** (default for JSON values):
- Syntax-highlighted JSON using the existing `highlightJSON()` function
- Displayed in a `<pre>` block with `font-mono`, `leading-relaxed`
- Non-JSON values: plain text display

**Raw:**
- Plain text display of the raw decoded value
- Base64 decode toggle (when `looksLikeBase64()` returns true) — same as current behavior
- Monospace, no syntax highlighting

**Edit:**
- CodeMirror 6 editor with:
  - JSON language mode (auto-detected)
  - Line numbers
  - Bracket matching
  - Syntax highlighting (matching the formatted view colors)
  - Basic keybindings (undo/redo, search)
  - Auto-indent
  - Min height matching the panel height
- JSON validation: Show inline error indicator if JSON is malformed (red badge in tab)

### Detail Header
- Key name (monospace, bold)
- Type badge
- Size
- Tab segment control

### Detail Footer
- Delete Key (`.btn-danger`, left-aligned)
- Copy Value (`.btn-secondary`)
- Close (`.btn-secondary`)
- Save (`.btn-primary`, right-aligned) — only enabled when in Edit tab with changes

---

## 5. Bulk Operations

### Selection
- Checkbox column in table
- Header checkbox: select all / deselect all (on current filtered view)
- Status bar shows selection count
- When items selected: "Delete Selected (N)" action appears in status bar

### Bulk Delete
- Click "Delete Selected" → confirmation dialog
- Dialog shows count and lists first 5 key names
- Uses sequential `deleteKVKey()` calls (existing API)
- Progress indicator during deletion

---

## 6. Import / Export

### Export
- Button in toolbar: "Export" (`.btn-secondary`)
- Exports all keys in the active store as a JSON file:
  ```json
  {
    "store": "default",
    "keys": [
      { "key": "user:123", "value": "..." },
      { "key": "config:app", "value": "..." }
    ]
  }
  ```
- File download as `{store}-export.json`
- Uses `Blob` + `URL.createObjectURL` for client-side download

### Import
- Button in toolbar: "Import" (`.btn-secondary`)
- Opens modal with file drop zone
- Accepts JSON file in the export format above
- Preview: shows key count and lists first 10 keys
- Confirm: sequentially calls `setKVKey()` for each entry
- Progress bar during import
- Conflict handling: overwrite existing keys (shown as warning in preview)

---

## 7. Add Key Dialog

Extracted from the current inline form into a proper modal dialog:

- Modal using `.modal` / `.modal-backdrop` classes
- Key input: `.input-mono`, disabled when editing existing key
- Value input: CodeMirror editor (same `KVCodeEditor` component)
- Buttons: Cancel (`.btn-secondary`) + Create (`.btn-primary`)
- Auto-focus key input on open

---

## 8. Sorting

- Clickable column headers for Key and Size columns
- Sort indicator: `▲` / `▼` icon next to column name
- Default: alphabetical ascending by key name
- Click toggles: ascending → descending → no sort
- Client-side sorting (all keys are already loaded)

---

## 9. Design System Alignment

All styles follow the unified UX spec (`2026-03-24-unified-ux-design.md`):

| Element | Class / Style |
|---------|---------------|
| Store tabs | `.tab-group` > `.tab` / `.tab-active` (segment control) |
| Detail tabs | `.tab-group` > `.tab` / `.tab-active` |
| Table | `.data-table` with standard th/td styles |
| Type badges | `.badge .badge-blue` (JSON), `.badge .badge-gray` (STR), `.badge .badge-purple` (B64) |
| Primary button | `.btn .btn-primary .btn-sm` (Add Key, Save) |
| Secondary button | `.btn .btn-secondary .btn-sm` (Import, Export, Copy, Close) |
| Danger button | `.btn .btn-danger .btn-sm` (Delete) |
| Ghost button | `.btn .btn-ghost .btn-icon` (sort icons) |
| Search input | `.input` with absolute-positioned search icon |
| Modal | `.modal-backdrop` + `.modal` |
| Cards | `rounded-14`, `shadow-card` |
| Focus rings | `ring-2 ring-offset-1 ring-spin-oxfordblue/15` |
| Transitions | `duration-150` for interactions, `duration-200` for panel |
| Drag handle | `bg-gray-200 hover:bg-spin-oxfordblue/20 active:bg-spin-oxfordblue/30` |
| Empty state | Centered icon (20px) + title (text-sm) + subtitle (text-xs text-gray-400) |

---

## 10. Dependencies

### New: CodeMirror 6
```
@codemirror/view
@codemirror/state
@codemirror/lang-json
@codemirror/basic-setup (includes line numbers, bracket matching, search, etc.)
```

CodeMirror 6 is modular and tree-shakeable. Only import the extensions needed. Estimated bundle addition: ~60KB gzipped.

### Existing (reused)
- `ResizablePanel` component — adapted for vertical (top/bottom) orientation
- `highlightJSON()` function from current KVExplorer
- `looksLikeBase64()` / `decodeBase64Value()` utilities
- `AddServiceBindingDialog` — for the "no KV configured" empty state
- All KV API functions from `api/client.ts`

---

## 11. State Management

### Main State (KVExplorer.tsx)
```typescript
// Store & data
stores: string[]
activeStore: string | null
keys: KVKeyEntry[]         // enriched: { key, value, type, size }
selectedKeys: Set<string>  // for bulk selection
selectedKey: string | null // for detail panel

// UI state
filter: string
sortColumn: 'key' | 'size' | null
sortDirection: 'asc' | 'desc'
loading: boolean
error: string | null

// Dialog state
showAddDialog: boolean
showImportDialog: boolean
```

### KVKeyEntry Type
```typescript
interface KVKeyEntry {
  key: string
  value: string       // decoded value
  type: 'json' | 'string' | 'base64'
  size: number        // byte length
  rawValue: string    // original base64-encoded value from API
}
```

Note: Key values are fetched on-demand when a key is selected (not all upfront). The `keys` array from `getKVKeys()` only contains key names. Type/size/value are populated when the key is viewed.

For the table preview column: show "—" in the Preview, Type, and Size columns until the key's value is fetched. Values are loaded only when the key is clicked/selected in the detail panel. This keeps the initial load fast regardless of how many keys exist.

---

## 12. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Navigate key list |
| `Enter` | Open selected key in detail panel |
| `Escape` | Close detail panel |
| `Ctrl+E` / `⌘E` | Switch to Edit tab |
| `Ctrl+S` / `⌘S` | Save (when in Edit tab) |
| `Delete` / `Backspace` | Delete selected key (with confirmation) |
| `/` | Focus search input |

---

## 13. Empty States

### No KV Stores Configured
Keep existing empty state with guide link and "Add Store Binding" CTA. Updated to use unified design:
- Icon in `rounded-10` gray-100 box (40x40px)
- Title: `text-sm font-medium text-gray-700`
- Subtitle: `text-xs text-gray-400`
- CTA: `.btn .btn-accent .btn-sm`

### Store Has No Keys
- Centered in table area
- Icon: Key icon
- Title: "No keys in this store"
- Subtitle: "Add a key-value pair to get started"
- CTA: "Add Key" button

### No Keys Match Filter
- Same layout as "no keys" but:
- Title: "No matching keys"
- Subtitle: "Try a different search term"
- No CTA button

### No Key Selected (Detail Panel)
- Panel collapsed to drag handle height
- Subtle centered text: "Select a key to view its value"

---

## 14. ResizablePanel Adaptation

The existing `ResizablePanel` component handles left/right splits. For the bottom panel, we need vertical (top/bottom) split support. Two approaches:

Extend `ResizablePanel` with a `direction` prop:
- `direction="horizontal"` (default, current behavior)
- `direction="vertical"` (new, for KV detail panel)
- The drag handle orientation flips (horizontal bar instead of vertical)
- `minHeight` / `maxHeight` instead of `minWidth` / `maxWidth`

---

## 15. Migration Path

The redesign replaces the current `KVExplorer.tsx` entirely. No backward compatibility needed since it's a self-contained page component.

**What's preserved:**
- All API integration (`getKVStores`, `getKVKeys`, `getKVKey`, `setKVKey`, `deleteKVKey`)
- Base64 detection and decoding logic
- JSON syntax highlighting
- Store binding empty state flow
- `AddServiceBindingDialog` integration

**What's removed:**
- Inline add/edit form (replaced by modal dialog)
- Left-panel key list layout (replaced by full-width table)
- Current `ResizablePanel` usage (replaced by vertical bottom panel)

---

## 16. Verification

1. **Visual inspection** — run `spin build --up` and navigate to `/kv`:
   - Verify store tabs render as segment controls
   - Verify table columns display correctly with metadata
   - Click a key → bottom panel appears with value
   - Drag handle resizes the panel, height persists on refresh
   - Edit tab shows CodeMirror with JSON mode

2. **Functionality check:**
   - Add a new key via dialog → appears in table
   - Edit a key value in CodeMirror → save → verify updated
   - Delete a single key via detail panel
   - Select multiple keys → bulk delete
   - Export store → verify JSON file downloads correctly
   - Import a JSON file → verify keys are created
   - Sort by key name and size
   - Filter keys with search input

3. **Design consistency:**
   - Compare button styles against unified UX spec
   - Verify focus rings on all interactive elements
   - Check badge pill shapes and colors
   - Verify transitions (`duration-150` on buttons, `duration-200` on panel)
   - Keyboard navigation through table and shortcuts

4. **Edge cases:**
   - Empty store (no keys)
   - Large JSON values (100+ lines) in editor
   - Binary/base64 values display correctly
   - Many keys (50+) — table scrolls, performance OK
   - Store with special characters in key names
