import { Checkbox } from '@/ui/components/Checkbox'
import { NumberField } from '@/ui/components/NumberField'
import { configNumber, configStrings, type JsonRecord } from './eventConfigModel'
import styles from './EventConfig.module.css'

export function ConfigNumbers({ fields, values, onChange, max, required = false }: { fields: readonly (readonly [string, string])[]; values: JsonRecord; onChange: (key: string, value: number | null) => void; max?: number; required?: boolean }) {
  return <div className={styles.grid}>{fields.map(([key, label]) => <NumberField key={key} label={label} value={configNumber(values[key])} onChange={value => onChange(key, value)} min={0} max={max} required={required} placeholder={required ? undefined : 'Auto / unset'} />)}</div>
}
export function ConfigChecks({ legend, choices, value, onChange }: { legend: string; choices: readonly (readonly [string, string])[]; value: unknown; onChange: (value: string[]) => void }) {
  const selected = configStrings(value)
  return <fieldset className={styles.checks}><legend>{legend}</legend>{choices.map(([key, label]) => <Checkbox key={key} label={label} checked={selected.includes(key)} onChange={checked => onChange(checked ? [...selected, key] : selected.filter(item => item !== key))} />)}</fieldset>
}
