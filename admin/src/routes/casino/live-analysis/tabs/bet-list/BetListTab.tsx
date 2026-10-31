import { BetList } from './BetList'
interface Props { windowMins: number; didAnimate: boolean }
export function BetListTab({ windowMins }: Props) { return <BetList windowMins={windowMins} /> }

