import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Form } from '@/ui/components/Form'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { useForm } from '@/ui/form/useForm'
import type { Path } from '@/ui/form/paths'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { agentEditorSchema, agentEditorValues, type AgentRecord, type AgentEditorValues } from './agentEditorModel'
import BasicInfo from './components/BasicInfo'
import SchemeConfig from './components/SchemeConfig'
import Review from './components/Review'
import styles from './AgentEditor.module.css'

export function AgentEditor({ record, onSave }: { record?: AgentRecord; onSave: (values: AgentEditorValues) => Promise<void> }) {
  const navigate = useNavigate()
  const eyebrow = usePageEyebrow()
  const [step, setStep] = useState(0)
  const schema = useMemo(() => agentEditorSchema(Boolean(record)), [record])
  const form = useForm({ schema, initialValues: agentEditorValues(record), onSubmit: onSave })
  const formRef = useRef(form)
  formRef.current = form
  // The kit getter is recreated each render. Effects in these form panels need
  // a stable getter so seeding/availability checks do not restart on each edit.
  const getValue = useCallback(<P extends Path<AgentEditorValues>,>(name: P) => formRef.current.getValue(name), [])
  const panelForm = { ...form, getValue }
  async function next() {
    const fields: Path<AgentEditorValues>[] = step === 0 ? ['username', 'password', 'phone', 'schemeType', 'allowedDomains', 'status', 'currency', ...(form.values.schemeType === 'COMMISSION' ? [] : ['levelIndex' as const])] :
      ['levelIndex', 'creditLimit', 'openingChips', ...(form.values.schemeType === 'COMMISSION' ? ['tallyDomains' as const] : []), ...form.values.allowedDomains.map((domain) => `${form.values.schemeType === 'COMMISSION' ? 'commissionRates' : 'sharingRates'}.${domain}` as Path<AgentEditorValues>)]
    if (await form.validate(fields)) setStep((value) => Math.min(2, value + 1))
  }
  return <Page maxWidth="wide"><PageHeader title={record ? 'Edit Agent' : 'Create Agent'} eyebrow={eyebrow}
    sub={record ? 'Update agent account settings and configuration' : 'Set up a new agent account with commission or sharing scheme'} back={{ to: '/agents', label: 'Back to Agents' }} />
    <div className={styles.workspace}><ol className={styles.steps} aria-label="Agent setup steps">
      {['Basic Info', 'Scheme', 'Review'].map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}
    </ol><Form onSubmit={(event) => { if (step < 2) { event.preventDefault(); void next() } else form.handleSubmit(event) }}
      errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision}>
      <fieldset className={styles.fieldset} disabled={form.submitting}>
        {step === 0 ? <BasicInfo form={panelForm} isEdit={Boolean(record)} /> : step === 1 ? <SchemeConfig form={panelForm} isEdit={Boolean(record)} /> : <Review form={panelForm} />}
      </fieldset>
      {form.formError && <Notice tone="error">{form.formError}</Notice>}
      <div className={styles.footer}><span className={styles.secondary}>Step {step + 1} of 3</span><div className={styles.actions}>
        <Button aria-disabled={form.submitting} onClick={() => step > 0 ? setStep((value) => value - 1) : navigate('/agents')}>{step > 0 ? 'Previous' : 'Cancel'}</Button>
        {step < 2 ? <Button key="next" variant="primary" onClick={(event) => { event.preventDefault(); void next() }}>Next Step</Button> : <Button key="save" type="submit" variant="primary" loading={form.submitting}>{record ? 'Update Agent' : 'Create Agent'}</Button>}
      </div></div>
    </Form></div>
  </Page>
}
