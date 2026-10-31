import { createContext, useContext } from 'react'

/* What a dashboard figure asks for when it is clicked: the list (kind), what narrows it (arg) and the
   modal's title, the figure's own label. See DrilldownDialog and Query.dashboardDrilldown. */
export interface DrillRequest {
  kind: string
  arg?: string
  title?: string
}

/** Opens the drill-down modal; null outside a DrilldownProvider, where figures stay plain text. */
export const DrilldownContext = createContext<((request: DrillRequest) => void) | null>(null)

export const useDrilldown = () => useContext(DrilldownContext)
