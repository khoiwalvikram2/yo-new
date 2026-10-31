import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import type { Sport, AutoConfigRow } from './types'
import { AutoSportSelector, SportImage } from './AutoSportSelector'
import { AutoConfigsCard } from './AutoConfigsCard'
import { builderRequireSuccess } from './builderModel'
import { UPSERT_AUTO_CONFIG, RUN_AUTO_NOW } from '@/lib/graphql/sports'
import styles from './Builder.module.css'
interface Props {
  sports: Sport[]; autoSportKeys: string[]; setAutoSportKeys: (keys: string[]) => void
  leaguesOptionsBySport: Record<string, Array<{label: string; value: string}>>; leaguesLoadingBySportAuto: Record<string, boolean>
  autoLeagueCodesBySport: Record<string, string[]>; setAutoLeagueCodesBySport: (updater: (previous: Record<string, string[]>) => Record<string, string[]>) => void
  autoFrequencyBySport: Record<string, number>; setAutoFrequencyBySport: (updater: (previous: Record<string, number>) => Record<string, number>) => void
  autoActiveBySport: Record<string, boolean>; setAutoActiveBySport: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void
  sportIdByKey: Record<string, string>; keyBySportId: Record<string, string>; ensureLeaguesOptionsForSport: (key: string) => Promise<void> | void
  autoConfigsData?: {autoSportsConfigs?: AutoConfigRow[]}; refetchAutoConfigs: () => Promise<unknown>; availableFrequencies: number[]
}
export default function AutoBuilderPanel(props: Props) {
  const [upsertAutoConfig, { loading: saving }] = useMutation(UPSERT_AUTO_CONFIG)
  const [runAutoNow, { loading: running }] = useMutation(RUN_AUTO_NOW)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const perform = async (action: () => Promise<unknown>) => {
    if (busy.current) return
    busy.current = true; setError(null)
    try { await action(); await props.refetchAutoConfigs() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete auto-ingestion action') } finally { busy.current = false }
  }
  const ensureOptions = async (key: string) => {
    try { await props.ensureLeaguesOptionsForSport(key) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load leagues') }
  }
  return <div className={styles.stack}>
    {error && <Notice tone="error" title="Auto ingestion action failed">{error}</Notice>}
    <Card title="Configure Auto Ingestion" sub="Select sports and set up automated event ingestion" tools={<StatusPill tone="info">{props.autoSportKeys.length} selected</StatusPill>}>
      <div className={styles.stack}><AutoSportSelector sports={props.sports} selectedKeys={props.autoSportKeys} onToggle={async key => {
        if (props.autoSportKeys.includes(key)) props.setAutoSportKeys(props.autoSportKeys.filter(item => item !== key))
        else { props.setAutoSportKeys([...props.autoSportKeys, key]); await ensureOptions(key) }
      }} />
      <div className={styles.eventGrid}>{props.autoSportKeys.map(key => {
        const sport = props.sports.find(item => item.key === key); const name = sport?.name ?? key
        const leagueCodes = props.autoLeagueCodesBySport[key] ?? []; const frequencyHours = props.autoFrequencyBySport[key] ?? 6; const active = props.autoActiveBySport[key] ?? true
        const sportId = props.sportIdByKey[key]
        return <Card key={key} title={name} headingLevel={3} tools={<SportImage name={name} />}>
          <div className={styles.stack}>
            <MultiSelect label={`Leagues for ${name}`} options={props.leaguesOptionsBySport[key] ?? []} value={leagueCodes} loading={Boolean(props.leaguesLoadingBySportAuto[key])} maxTagCount={3}
              placeholder="Choose leagues to auto-ingest…" emptyText="No leagues available" onFocus={() => { void ensureOptions(key) }}
              onChange={values => props.setAutoLeagueCodesBySport(previous => ({ ...previous, [key]: values }))} />
            <Select label={`Frequency for ${name}`} layout="stacked" options={props.availableFrequencies.map(hours => ({ value: String(hours), label: `Every ${hours} hour${hours > 1 ? 's' : ''}` }))} value={String(frequencyHours)}
              onChange={value => props.setAutoFrequencyBySport(previous => ({ ...previous, [key]: Number(value) }))} />
            <Switch label={`Active auto ingestion for ${name}`} checked={active} onChange={value => props.setAutoActiveBySport(previous => ({ ...previous, [key]: value }))} />
            <div className={styles.actions}><StatusPill tone={active ? 'ok' : 'muted'}>{active ? 'Active' : 'Inactive'}</StatusPill>
              <Button loading={saving} disabled={running || !sportId} onClick={() => { void perform(async () => { builderRequireSuccess(await upsertAutoConfig({ variables: { sportId, leagueCodes, frequencyHours, active } }), 'upsertAutoSportsConfig') }) }}>Save</Button>
              <Button variant="primary" loading={running} disabled={saving || !sportId} onClick={() => { void perform(async () => { builderRequireSuccess(await runAutoNow({ variables: { sportId, leagueCodes } }), 'runAutoSportsIngestion') }) }}>Run Now</Button>
            </div>
          </div>
        </Card>
      })}</div></div>
    </Card>
    <AutoConfigsCard rows={props.autoConfigsData?.autoSportsConfigs ?? []} sports={props.sports} keyBySportId={props.keyBySportId} leaguesOptionsBySport={props.leaguesOptionsBySport} onRefresh={props.refetchAutoConfigs} />
  </div>
}
