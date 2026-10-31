import { useEffect, useMemo, useState } from 'react'
import { IconArrowBackUp, IconDeviceFloppy, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Combobox } from '@/ui/components/Combobox'
import { Form, FormActions } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { PasswordField } from '@/ui/components/PasswordField'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { Textarea } from '@/ui/components/Textarea'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { useForm } from '@/ui/form/useForm'
import { CONFIG_DEFINITIONS, DEFAULT_THEME_COLORS, sectionInitialValues, sectionPayload, sectionSchema, text, type ConfigField, type ConfigRecord, type ConfigTab, type SectionValues } from './appConfigurationModel'
import styles from './AppConfigurationPage.module.css'

interface FieldProps {
  field: ConfigField
  value: SectionValues[string]
  onChange: (value: SectionValues[string]) => void
  onBlur: () => void
  id: string
  error?: string
}

/** A stored user-site color, not an admin UI style. The browser's native color editor sits in the field
 * as its swatch and supplements the text, so existing values (including values outside native #rrggbb)
 * are never rewritten. */
export function ConfigColorField({ label, value, onChange, name, error, onBlur, required = false }: { label: string; value: string; onChange: (value: string) => void; name: string; error?: string; onBlur?: () => void; required?: boolean }) {
  return (
    <TextField
      label={label} name={name} value={value} onChange={onChange} onBlur={onBlur} error={error} required={required}
      className={styles.colorField} inputClassName={styles.colorText}
      prefix={<input aria-label={`Choose ${label}`} className={styles.nativeColor} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_THEME_COLORS.primary} onChange={(event) => onChange(event.target.value)} />}
    />
  )
}

/** The form's foot: what is unsaved, Discard and Save. It sticks to the bottom of the view only while
 * there is something to save, so a clean form ends with a quiet bar instead of one floating over it. */
export function ConfigSaveBar({ dirty, busy, saving, saveText, saveDisabled, onDiscard }: { dirty: boolean; busy: boolean; saving: boolean; saveText: string; saveDisabled?: boolean; onDiscard: () => void }) {
  return (
    <FormActions className={clsx(styles.saveActions, dirty && styles.savePending)}>
      <span className={styles.saveHint}><span className={styles.saveDot} aria-hidden="true" />{dirty ? 'Unsaved changes' : 'Settings are up to date'}</span>
      <Button onClick={onDiscard} disabled={!dirty || busy} icon={<IconArrowBackUp size={16} stroke={strokeFor(16)} />}>Discard</Button>
      <Button variant="primary" type="submit" loading={saving} disabled={saveDisabled} icon={<IconDeviceFloppy size={16} stroke={strokeFor(16)} />}>{saveText}</Button>
    </FormActions>
  )
}

function RecipientField({ field, value, onChange, onBlur, id, error }: FieldProps) {
  const [draft, setDraft] = useState('')
  const recipients = Array.isArray(value) ? value : []
  const commit = (input: string) => {
    const additions = input.split(/[,\s]+/).filter(Boolean)
    if (additions.length) onChange([...new Set([...recipients, ...additions])])
    setDraft('')
  }
  return (
    <div className={clsx(styles.recipientField, styles.fullWidth)}>
      <TextField
        label={field.label} id={id} name={field.name} value={draft} placeholder={field.placeholder}
        error={error} help={field.help} onChange={(next) => { if (/[,\s]/.test(next)) commit(next); else setDraft(next) }}
        onBlur={() => { if (draft) commit(draft); onBlur() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); if (draft) commit(draft) }
          else if (event.key === 'Backspace' && !draft && recipients.length) onChange(recipients.slice(0, -1))
        }}
      />
      {recipients.length ? <ul className={styles.chips} aria-label="Selected alert recipients">{recipients.map((email) => <li className={styles.chip} key={email}><span>{email}</span><Button size="sm" variant="ghost" aria-label={`Remove ${email}`} icon={<IconX size={14} stroke={strokeFor(14)} />} onClick={() => onChange(recipients.filter((recipient) => recipient !== email))} /></li>)}</ul> : null}
    </div>
  )
}

/** A switch as a settings row: what it controls on the left, the switch on the right. The label is
 * tied to the switch, so the whole caption toggles it too. */
function ToggleRow({ field, value, onChange, onBlur, id }: FieldProps) {
  const on = Boolean(value)
  const helpId = field.help ? `${id}-help` : undefined
  return (
    <li className={styles.toggleRow}>
      <span className={styles.toggleText}>
        <label className={styles.toggleLabel} htmlFor={id}>{field.label}</label>
        {field.help ? <span className={styles.help} id={helpId}>{field.help}</span> : null}
      </span>
      <Switch id={id} label={field.label} hideLabel name={field.name} checked={on} onChange={onChange} onBlur={onBlur} aria-describedby={helpId} />
    </li>
  )
}

function ConfigControl(props: FieldProps) {
  const { field, value, onChange, onBlur, id, error } = props
  const common = { label: field.label, name: field.name, id, error, help: field.help, onBlur, placeholder: field.placeholder, required: field.required }
  switch (field.kind) {
    case 'number': return <NumberField {...common} value={typeof value === 'number' ? value : null} onChange={onChange} min={field.min} max={field.max} step={field.step} precision={field.precision} />
    case 'textarea': return <Textarea {...common} value={text(value)} onChange={onChange} rows={3} maxLength={field.maxLength} showCount={field.maxLength !== undefined} className={styles.fullWidth} />
    case 'password': return <PasswordField {...common} value={text(value)} onChange={onChange} autoComplete="new-password" />
    case 'select': return <Select {...common} layout="stacked" value={text(value)} options={field.options || []} onChange={onChange} />
    case 'search-select': return <Combobox {...common} value={text(value) || null} options={field.options || []} onChange={(next) => onChange(next || undefined)} />
    case 'color': return <ConfigColorField label={field.label} name={field.name} value={text(value)} onChange={onChange} onBlur={onBlur} error={error} />
    case 'recipients': return <RecipientField {...props} />
    default: return <TextField {...common} value={text(value)} onChange={onChange} clearable={field.name === 'appName'} />
  }
}

/** Consecutive switches form one row list and consecutive inputs one field grid, in the section's order. */
function runs(fields: readonly ConfigField[]) {
  const result: { toggles: boolean; fields: ConfigField[] }[] = []
  for (const field of fields) {
    const toggles = field.kind === 'switch'
    const last = result.at(-1)
    if (last && last.toggles === toggles) last.fields.push(field)
    else result.push({ toggles, fields: [field] })
  }
  return result
}

export function AppConfigurationSection({ tab, config, whitelabel, onSave, onSaveAppName }: { tab: Exclude<ConfigTab, 'branding'>; config: ConfigRecord; whitelabel: ConfigRecord; onSave: (values: ConfigRecord) => Promise<void>; onSaveAppName: (name: string) => Promise<void> }) {
  const definition = CONFIG_DEFINITIONS[tab]
  const initialValues = useMemo(() => sectionInitialValues(tab, config, whitelabel), [tab, config, whitelabel])
  const schema = useMemo(() => sectionSchema(tab), [tab])
  const form = useForm<SectionValues>({
    schema, initialValues,
    onSubmit: async (values) => {
      if (tab === 'seo') await onSaveAppName(text(values.appName).trim())
      await onSave(sectionPayload(tab, values))
    },
  })
  const { reset } = form
  useEffect(() => { reset(initialValues) }, [initialValues, reset])
  return (
    <Form onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.sectionForm}>
      {form.formError ? <Notice tone="error" title="Settings not saved">{form.formError}</Notice> : null}
      <fieldset disabled={form.submitting} className={styles.fieldset}>
        {definition.sections.map((section) => (
          <Card key={section.title} title={section.title} sub={section.sub} headingLevel={3}>
            <div className={styles.sectionBody}>
              {runs(section.fields).map((run) => run.toggles ? (
                <ul key={run.fields[0].name} className={styles.toggles}>
                  {run.fields.map((field) => { const binding = form.field(field.name); return <ToggleRow key={field.name} field={field} value={binding.value} onChange={binding.onChange} onBlur={binding.onBlur} id={binding.id} /> })}
                </ul>
              ) : (
                <div key={run.fields[0].name} className={styles.fields}>
                  {run.fields.map((field) => { const binding = form.field(field.name); return <ConfigControl key={field.name} field={field} value={binding.value} onChange={binding.onChange} onBlur={binding.onBlur} id={binding.id} error={binding.error} /> })}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </fieldset>
      <ConfigSaveBar dirty={form.dirty} busy={form.submitting} saving={form.submitting} saveText={definition.saveText} onDiscard={() => form.reset()} />
    </Form>
  )
}
