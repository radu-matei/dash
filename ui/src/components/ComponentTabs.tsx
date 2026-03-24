import { Cpu } from 'lucide-react'
import { componentTw, TW_PALETTE } from '../componentColors'

export { TW_PALETTE as COMPONENT_PALETTE, componentTw as componentPalette }

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
    <div className="flex items-center gap-2 px-4 py-2 shrink-0 overflow-x-auto scrollbar-hide">
      <div className="tab-group">
        {allTab && (
          <button
            onClick={() => onTabChange('all')}
            className={`tab ${activeTab === 'all' ? 'tab-active' : ''}`}
          >
            {allTab.label}
          </button>
        )}

        {componentIds.map((id) => {
          const p = componentTw(id)
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`tab ${isActive ? 'tab-active' : ''}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dot}`} />
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono">{id}</span>
            </button>
          )
        })}
      </div>

      {trailing && (
        <div className="ml-auto flex items-center text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {trailing}
        </div>
      )}
    </div>
  )
}
