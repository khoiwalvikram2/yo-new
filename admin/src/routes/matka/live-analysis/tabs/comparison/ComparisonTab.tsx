import type { MatkaDashboard, MatkaKpis } from '../../liveUiModel'
import { ComparisonView } from './ComparisonView'
interface Props { dashboard: MatkaDashboard | null; dataHistory: MatkaKpis[]; didAnimate: boolean }
export function ComparisonTab({ dashboard, dataHistory }: Props) { return <ComparisonView kpis={dashboard?.kpis} breakdown={dashboard?.breakdown} history={dataHistory} /> }
