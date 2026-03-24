# Unified UX Design — Spin Dashboard

**Date:** 2026-03-24
**Goal:** Ship-ready polish — make the dashboard look and feel like a finished product with consistent, professional UX across all pages.
**Direction:** Inverted Premium — Oxford Blue primary, seagreen accent, segment-control tabs, softer corners, Linear/Apple-inspired feel.

---

## 1. Color System

### Brand Colors (no changes to Tailwind config values)
| Token | Value | Role |
|-------|-------|------|
| `spin-oxfordblue` | `#0D203F` | **Primary** — buttons, focus rings, active text |
| `spin-navy` | `#162D50` | **Primary hover** |
| `spin-seagreen` | `#34E8BD` | **Accent** — primary button text, accent buttons, sidebar active |
| `spin-midgreen` | `#1FBCA0` | **Accent hover** |
| `spin-colablue` | `#0E8FDD` | **Info blue** — info badges, links |

### Semantic Status (standard Tailwind, no config changes)
| Status | Color | Tailwind |
|--------|-------|----------|
| Success | `#16a34a` | `green-600` |
| Warning | `#d97706` | `amber-600` |
| Error | `#dc2626` | `red-600` |
| Neutral | `#6b7280` | `gray-500` |

### Focus Ring
- **Old:** `ring-spin-seagreen`
- **New:** `ring-spin-oxfordblue/15` with `ring-2 ring-offset-1`
- Applied to: all buttons, inputs, tabs, interactive elements

---

## 2. Buttons

### Variants
| Class | Background | Text | Border | Shadow | Use |
|-------|-----------|------|--------|--------|-----|
| `btn-primary` | `spin-oxfordblue` | `spin-seagreen` | none | `sm` → `md` on hover | Primary actions |
| `btn-accent` | `spin-seagreen` | `spin-oxfordblue` | none | `sm` → `md` on hover | Special emphasis (new) |
| `btn-secondary` | `white` | `gray-700` | `gray-200` → `gray-300` | `sm` | Secondary actions |
| `btn-ghost` | `transparent` | `gray-500` | none | none | Inline/icon actions (new) |
| `btn-danger` | `red-50` | `red-600` | `red-200` | none | Destructive actions |

**Removed:** `btn-blue` — replaced by `btn-primary` (oxford blue) and `btn-accent` (seagreen).

### Migration Rule
When converting existing buttons:
- **Form submit / primary CTA buttons** → `btn-primary` (oxford blue). These are the main action on a page or dialog.
- **"Add New" / "Create" / emphasis CTAs** → `btn-accent` (seagreen bg). For actions that should stand out with brand color.
- **Old `btn-blue` (run tests, etc.)** → `btn-primary` (the new oxford blue replaces the old colablue)
- **Inline/icon-only buttons with ad-hoc hover styles** → `btn-ghost`
- **Cancel / secondary actions** → `btn-secondary` (unchanged)
- **Delete / destructive** → `btn-danger` (unchanged)

### Sizes
| Class | Padding | Radius | Font Size |
|-------|---------|--------|-----------|
| `btn-sm` | `py-1 px-3` | `rounded-lg` (8px) | `text-xs` (12px) |
| `btn-md` | `py-1.5 px-3.5` | `rounded-[10px]` | `text-[13px]` |
| `btn-lg` | `py-2 px-[18px]` | `rounded-[10px]` | `text-sm` (14px) |
| `btn-icon` | `p-1.5` | `rounded-lg` (8px) | — |
| `btn-icon-lg` | `p-2` | `rounded-[10px]` | — |

### States (all variants)
| State | Change |
|-------|--------|
| Default | Base styles |
| Hover | Primary: `bg-spin-navy`; Accent: `bg-spin-midgreen`; Secondary: `bg-gray-50 border-gray-300`; Ghost: `bg-gray-100 text-gray-700`; Danger: `bg-red-100` — all elevate shadow one step |
| Focus | `ring-2 ring-offset-1 ring-spin-oxfordblue/15` |
| Disabled | `opacity-50 cursor-not-allowed` |
| Active | `scale-[0.98]` (micro press) |

### Transition
All buttons: `transition-all duration-150`

---

## 3. Badges

### Shape
All badges are **pill-shaped**: `rounded-full` (was `rounded` / mixed).

### Sizes
| Size | Padding | Font |
|------|---------|------|
| Default | `px-2 py-0.5` | `text-[11px] font-medium` |
| Small | `px-1.5 py-px` | `text-[10px] font-medium` |

No other sizes. Eliminates the current `px-1 py-px` / `text-xs` variations.

### Color Variants
| Class | Background | Text |
|-------|-----------|------|
| `badge-green` | `green-100` | `green-800` |
| `badge-blue` | `blue-100` | `blue-800` |
| `badge-amber` | `amber-100` | `amber-800` |
| `badge-red` | `red-100` | `red-800` |
| `badge-gray` | `gray-100` | `gray-700` |
| `badge-purple` | `purple-100` | `purple-800` |
| `badge-brand` | `spin-oxfordblue/8` | `spin-oxfordblue` |

**Removed:** `badge-yellow` (merged into `badge-amber`), `badge-orange` (use `badge-amber`), `badge-teal` (use `badge-blue`), `badge-seagreen` (use `badge-brand`).

---

## 4. Tabs — Segment Control

**One pattern everywhere.** Replaces:
- Bottom-border tabs (LogViewer, TraceViewer, ComponentTabs)
- Pill-bg tabs (KVExplorer store tabs)
- Toggle buttons (MetricsPage group-by filters)

### Container
```
bg-gray-100 rounded-[10px] p-[3px] inline-flex gap-0.5
```

### Tab Item
| State | Styles |
|-------|--------|
| Inactive | `px-3.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-600 transition-all duration-150` |
| Active | `px-3.5 py-1.5 rounded-lg text-xs font-semibold text-spin-oxfordblue bg-white shadow-sm` |

### Component Tabs with Color Dots
Same segment-control container. Each tab includes a 6px color dot from `componentColors.ts`. The dot is always visible (no opacity change on inactive — the tab bg/text state is sufficient).

### Filter Toggles
Same segment-control pattern. Active filter state may include a colored dot (e.g., red dot for "Errors Only").

---

## 5. Inputs

### Standard Input
```
bg-white border border-gray-200 rounded-[10px] px-3 py-1.5 text-sm text-gray-900
placeholder-gray-400 shadow-sm
focus:border-spin-oxfordblue focus:ring-2 focus:ring-spin-oxfordblue/10 focus:ring-offset-0
transition-all duration-150
```

### Mono Input
Same as standard + `font-mono`

### Textarea
Same styles + `resize-y`

**Change from current:** Focus ring color from `spin-seagreen` → `spin-oxfordblue/10`. Border radius from `rounded-lg` (8px) → `rounded-[10px]`.

---

## 6. Cards & Containers

### Standard Card
```
bg-white border border-gray-200 rounded-[14px] shadow-card p-5
```

### Interactive Card
```
card + transition-all duration-200 hover:shadow-card-hover hover:border-gray-300 cursor-pointer
```

### Accent Card (stat cards, highlights)
```
card + border-l-[3px] border-l-spin-oxfordblue
```

### Compact Card (list items, dense data views)
```
card + p-4
```
Use for: trace list items, KV key rows, log entries, and any data-dense repeating items where tighter spacing improves scannability.

**Changes:**
- Standard card padding: `p-5` (20px). Compact card: `p-4` (16px) for dense lists.
- No more `p-6` anywhere.
- Border radius increased from `rounded-xl` (12px) → `rounded-[14px]`.

---

## 7. Modals & Dialogs

### Backdrop
```
fixed inset-0 z-50 bg-spin-oxfordblue/40 backdrop-blur-sm
```
Standardized across all dialogs (was mixed `bg-black/40`, `bg-black/50`, `bg-spin-oxfordblue/40`).

### Modal Container
```
bg-white rounded-[16px] shadow-xl max-w-lg w-full mx-auto p-6
max-h-[85vh] overflow-y-auto
```
- Border radius: `rounded-[16px]` (slightly larger than cards for visual hierarchy)
- Padding: `p-6` (24px) — modals are the one exception to p-5, as they need breathing room
- Max width: `max-w-lg` (32rem) for standard dialogs, `max-w-2xl` for editors (EditSpinTomlModal)

### Modal Header
```
text-base font-semibold text-gray-900 mb-4
```

### Modal Footer (actions)
```
flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100
```
Primary action on the right. Cancel (btn-secondary) before confirm (btn-primary).

### Select / Dropdown
```
Same styles as .input: rounded-[10px], border-gray-200, shadow-sm
focus:border-spin-oxfordblue focus:ring-2 focus:ring-spin-oxfordblue/10
appearance: auto (native select arrow)
```

### ResizablePanel Drag Handle
```
h-1.5 cursor-row-resize rounded-full
bg-gray-200 hover:bg-spin-oxfordblue/20 active:bg-spin-oxfordblue/30
transition-colors duration-150
```
Replaces current `bg-blue-200/300/400` with brand-aligned colors.

---

## 8. Motion & Transitions

| Category | Duration | Elements |
|----------|----------|----------|
| Micro | `duration-150` | Buttons, inputs, badges, tabs, toggles |
| Surface | `duration-200` | Cards, panels, sidebars, tooltips |
| Overlay | `duration-300` | Modals, command palette, dialogs |

All use `ease` timing. No mixing of durations within a single element.

---

## 9. Status Indicators

### Status Dots
- **Size:** `w-2 h-2` (8px) — standardized everywhere
- **Shape:** `rounded-full`
- **Colors:** green-500 (running), amber-500 (warning), red-500 (error), gray-400 (idle)
- **Live indicator:** Static dot + `animate-pulse` with `shadow-[0_0_0_3px_rgba(color,0.2)]`

No more `w-1.5 h-1.5` or inconsistent opacity modifiers.

---

## 10. Empty & Loading States

### Empty State Pattern
```
centered container:
  icon (20px) in rounded-[10px] gray-100 box (40×40px)
  title: text-sm font-medium text-gray-700
  subtitle: text-xs text-gray-400
  optional: CTA button (btn-secondary btn-sm)
```

### Skeleton Loading
Existing `.skeleton` class — no changes needed.

---

## 11. Page Header

```
flex items-center justify-between px-6 h-14 bg-white border-b border-gray-200
```
No changes — current implementation is consistent.

---

## 12. Navigation (Sidebar)

Keep current dark sidebar styles. Changes:
- Add focus ring to nav items (currently missing): `focus:ring-2 focus:ring-spin-seagreen/20 focus:ring-offset-0` (stays seagreen in dark context — oxford blue wouldn't be visible)

## 13. Tables

No changes to `.data-table` styles. Current implementation is already consistent.

## 14. Component Colors (`componentColors.ts`)

No changes needed. The 8-color palette (`#0284c7`, `#7c3aed`, `#059669`, `#d97706`, `#db2777`, `#0891b2`, `#65a30d`, `#ea580c`) and stable hash assignment work well with both the old and new design direction. These colors are used for dots in segment-control tabs and chart series — they don't conflict with the brand system.

## 15. Tailwind Config Changes

Add to `tailwind.config.js`:
```js
borderRadius: {
  '10': '10px',
  '14': '14px',
  '16': '16px',
}
```
This avoids `rounded-[10px]` / `rounded-[14px]` magic numbers everywhere.

Also add `4.5` to spacing (for `px-[18px]` in btn-lg):
```js
spacing: {
  '4.5': '18px',
}
```

---

## Files to Modify

### Core Design System
- `ui/src/index.css` — Update all component classes (buttons, badges, tabs, inputs, cards, focus)
- `ui/tailwind.config.js` — Add shadow for status-dot pulse, update rounded values if needed

### Components (inline style cleanup)
- `ui/src/components/ComponentTabs.tsx` — Convert to segment-control pattern
- `ui/src/components/LogViewer.tsx` — Tabs, badge sizes, status indicators
- `ui/src/components/MetricsPage.tsx` — Tabs, stat cards (p-5, accent card), filter toggles
- `ui/src/components/KVExplorer.tsx` — Store tabs, button variants, card padding
- `ui/src/components/http-testing/index.tsx` — Tabs, button variants, badges
- `ui/src/components/http-testing/TestFileSidebar.tsx` — Button styles
- `ui/src/components/http-testing/TestDashboard.tsx` — Badge sizes, card padding
- `ui/src/components/http-testing/RunOutput.tsx` — Badge variants
- `ui/src/components/http-testing/HurlEditor.tsx` — Button variants
- `ui/src/components/http-testing/NewTestBuilder.tsx` — Input styles, button variants
- `ui/src/components/traces/TraceViewer.tsx` — Tabs, filter toggles, badges
- `ui/src/components/traces/TraceList.tsx` — Badge sizes, status dots
- `ui/src/components/traces/Waterfall.tsx` — Status indicators
- `ui/src/components/traces/SpanDetail.tsx` — Badge variants, card padding
- `ui/src/components/traces/TraceComparison.tsx` — Badge variants
- `ui/src/components/traces/DurationChart.tsx` — Card styles
- `ui/src/components/traces/RelatedLogs.tsx` — Badge/status styles
- `ui/src/components/AppOverview.tsx` — Button variants, card padding, badge sizes, status dots
- `ui/src/components/CommandPalette.tsx` — Input focus ring, badge variants
- `ui/src/components/Layout.tsx` — Nav focus ring
- `ui/src/components/AddComponentDialog.tsx` — Button/input styles
- `ui/src/components/AddVariableDialog.tsx` — Button/input styles
- `ui/src/components/AddServiceBindingDialog.tsx` — Button/input styles
- `ui/src/components/AddBindingDialog.tsx` — Button/input styles
- `ui/src/components/EditSpinTomlModal.tsx` — Button/input styles
- `ui/src/components/VarInspector.tsx` — Badge variants
- `ui/src/components/ResizablePanel.tsx` — Drag handle colors (blue → brand-aligned)

---

## Verification

1. **Visual inspection:** Run the app (`spin build --up`) and check each page:
   - `/app` — Cards, badges, status dots, buttons in overview
   - `/logs` — Component tabs (segment control), level badges, status indicators
   - `/traces` — Tabs, filter toggles, trace list badges, waterfall status
   - `/metrics` — Stat cards (accent border), filter toggles, chart containers
   - `/kv` — Store tabs, key list, add/edit forms, buttons
   - `/tests` — Test file tabs, run button, result badges, editor actions
2. **Interaction check:** Verify hover, focus, disabled states on every button variant
3. **Tab navigation:** Keyboard-navigate through segment controls on each page
4. **Command palette:** Check focus ring and input styling
5. **Responsive:** Verify segment-control tabs scroll properly when many components exist
