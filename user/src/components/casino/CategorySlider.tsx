import type { CasinoCardItem } from '@/types'
import LobbyTile from './LobbyTile'

type Props = { items: CasinoCardItem[]; catId: string }

/** One category row: up to 20 tiles side by side, flush under the category bar. The bar's arrows
 *  scroll it by id (`slider-<catId>`); the full list opens with See All. */
export default function CategorySlider({ items, catId }: Props) {
  return <div id={`slider-${catId}`} className="nova-ex-strip-track nova-lobby-track">
    {items.slice(0, 20).map((item, index) => <LobbyTile key={`${catId}-${item.gameId ?? item.title}-${index}`} item={item} />)}
  </div>
}
