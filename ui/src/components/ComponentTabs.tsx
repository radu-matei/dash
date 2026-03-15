import { Cpu } from 'lucide-react'

const PALETTE = [
  { dot: 'bg-blue-500',    text: 'text-blue-600',    active: 'border-b-2 border-blue-500'    },
  { dot: 'bg-violet-500',  text: 'text-violet-600',  active: 'border-b-2 border-violet-500'  },
  { dot: 'bg-emerald-500', text: 'text-emerald-600', active: 'border-b-2 border-emerald-500' },
  { dot: 'bg-amber-500',   text: 'text-amber-600',   active: 'border-b-2 border-amber-500'   },
  { dot: 'bg-pink-500',    text: 'text-pink-600',    active: 'border-b-2 border-pink-500'    },
  { dot: 'bg-teal-500',    text: 'text-teal-600',    active: 'border-b-2 border-teal-500'    },
  { dot: 'bg-orange-500',  text: 'text-orange-600',  active: 'border-b-2 border-orange-500'  },
  { dot: 'bg-indigo-500',  text: 'text-indigo-600',  active: 'border-b-2 border-indigo-500'  },
]

function pal(idx: number) { return PALETTE[idx % PALETTE.length] }

export { PALETTE as COMPONENT_PALETTE, pal as componentPalette }

interface Props {
  componentIds: string[]
  activeTab: string
  onTabChange: (tab: string) => void
  /** Label and value for the "all" tab shown before component tabs. Omit to skip. */
  allTab?: { label: string }
  /** Optional trailing content (e.g. count badge) */
  trailing?: React.ReactNode
}

export default function ComponentTabs({ componentIds, activeTab, onTabChange, allTab, trailing }: Props) {
  return (
    <div className="flex items-stretch gap-0 border-b border-gray-200 bg-gray-50 px-4 shrink-0 overflow-x-auto">
      {allTab && (
        <button
          onClick={() => onTabChange('all')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors mr-1
            ${activeTab === 'all'
              ? 'border-b-2 border-spin-oxfordblue text-spin-oxfordblue bg-white -mb-px'
              : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          {allTab.label}
        </button>
      )}

      {componentIds.map((id, idx) => {
        const p = pal(idx)
        const isActive = activeTab === id
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors
              ${isActive
                ? `bg-white -mb-px ${p.active} ${p.text}`
                : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono">{id}</span>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dot} ${isActive ? '' : 'opacity-30'}`} />
          </button>
        )
      })}

      {trailing && (
        <div className="ml-auto flex items-center pl-4 pr-1 text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {trailing}
        </div>
      )}
    </div>
  )
}
