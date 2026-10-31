import { IconBallFootball, IconBallTennis, IconCricket, IconTrophy } from '@tabler/icons-react'
import { useState } from 'react'
import { Checkbox } from '@/ui/components/Checkbox'
import type { Sport } from './types'
import styles from './Builder.module.css'
const images = import.meta.glob('@/assets/images/sports/*.{png,jpg,jpeg,svg,webp}', { eager: true, import: 'default' }) as Record<string, string>
const imageByName = new Map(Object.entries(images).map(([path, url]) => [path.split('/').pop()!.replace(/\.(png|jpg|jpeg|svg|webp)$/i, '').toLowerCase(), url]))
const fallbackIcons: Record<string, typeof IconTrophy> = { cricket: IconCricket, football: IconBallFootball, soccer: IconBallFootball, tennis: IconBallTennis }
/** Bundled asset URLs work in production too; failed images use a React icon, never innerHTML. */
export function SportImage({ name }: { name: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = imageByName.get(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  const SportIcon = fallbackIcons[name.trim().toLowerCase()] ?? IconTrophy
  return <span className={styles.sportImage}>{src && failed !== src ? <img src={src} alt="" onError={() => setFailed(src)} /> : <SportIcon size={20} stroke={1.75} aria-hidden="true" />}</span>
}
interface Props { sports: Sport[]; selectedKeys: string[]; onToggle: (key: string) => void | Promise<void> }
export function AutoSportSelector({ sports, selectedKeys, onToggle }: Props) {
  return <div className={styles.sportGrid}>{sports.map(sport => <div key={sport.key} className={styles.choice}>
    <SportImage name={sport.name} /><Checkbox label={sport.name} checked={selectedKeys.includes(sport.key)} onChange={() => { void onToggle(sport.key) }} />
  </div>)}</div>
}

