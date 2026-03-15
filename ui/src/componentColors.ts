/**
 * Stable, hash-based color assignment for component IDs.
 *
 * Every palette entry aligns: HEX_PALETTE[i] is the inline-style equivalent
 * of TW_PALETTE[i], so components get the same hue everywhere (traces bars,
 * metrics charts, component tabs, log tabs).
 */

// Hex values for inline styles (trace bars, chart lines, badges)
export const HEX_PALETTE = [
  '#0284c7', // blue
  '#7c3aed', // violet
  '#059669', // emerald
  '#d97706', // amber
  '#db2777', // pink
  '#0891b2', // teal
  '#65a30d', // lime
  '#ea580c', // orange
]

// Tailwind class sets for component tabs / log tabs
export const TW_PALETTE = [
  { dot: 'bg-blue-500',    text: 'text-blue-600',    active: 'border-b-2 border-blue-500'    },
  { dot: 'bg-violet-500',  text: 'text-violet-600',  active: 'border-b-2 border-violet-500'  },
  { dot: 'bg-emerald-500', text: 'text-emerald-600', active: 'border-b-2 border-emerald-500' },
  { dot: 'bg-amber-500',   text: 'text-amber-600',   active: 'border-b-2 border-amber-500'   },
  { dot: 'bg-pink-500',    text: 'text-pink-600',    active: 'border-b-2 border-pink-500'    },
  { dot: 'bg-teal-500',    text: 'text-teal-600',    active: 'border-b-2 border-teal-500'    },
  { dot: 'bg-orange-500',  text: 'text-orange-600',  active: 'border-b-2 border-orange-500'  },
  { dot: 'bg-indigo-500',  text: 'text-indigo-600',  active: 'border-b-2 border-indigo-500'  },
]

function stableHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Stable hex color for a component name (for inline styles). */
export function componentHex(name: string): string {
  return HEX_PALETTE[stableHash(name) % HEX_PALETTE.length]
}

/** Stable Tailwind class set for a component name (for tabs). */
export function componentTw(name: string): typeof TW_PALETTE[number] {
  return TW_PALETTE[stableHash(name) % TW_PALETTE.length]
}
