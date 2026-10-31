import { ComparisonView } from './ComparisonView'
import type { CasinoDashboard } from '../../casinoLiveModel'
interface Props { dashboard: CasinoDashboard | null; dataHistory: unknown[]; didAnimate: boolean }
export function ComparisonTab({ dashboard, dataHistory }: Props) { return <ComparisonView kpis={dashboard?.kpis} breakdown={dashboard?.breakdown} history={dataHistory} /> }

