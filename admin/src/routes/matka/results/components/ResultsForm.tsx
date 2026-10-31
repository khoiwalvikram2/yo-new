import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import clsx from 'clsx'
import { IconCalendar, IconCircleCheck, IconLayoutGrid, IconTrophy } from '@tabler/icons-react'
import { useCreateMatkaResult, useMatkaResultExists } from '../../../../modules/matka/results'
import { useMatkas } from '../../../../modules/matka'
import { Combobox } from '@/ui/components/Combobox'
import { DateField } from '@/ui/components/DateField'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { Select } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { istToday } from '@/ui/components/istDate'
import {
  DECLARE_FIELD_ORDER,
  DECLARE_TYPE_OPTIONS,
  acceptDeclareDate,
  autoDeclareType,
  buildCreateMatkaResultInput,
  canSubmitDeclare,
  closeTypeNotice,
  declarePreviewText,
  initialDeclareValues,
  matkaListboxOptions,
  matkaOptionsFrom,
  sanitizeResultInput,
  validateDeclareResult,
  type DeclareResultField,
  type DeclareResultValues,
  type MatkaResultType,
} from '../matkaResultsModel'
import styles from '../MatkaResultsPage.module.css'

export interface MatkaResultSelection { matkaId: string; marketName: string; matkaType: string; date: string; type: MatkaResultType }
interface ResultsFormProps {
  initialSelection?: MatkaResultSelection
  onSuccess?: () => void
  onLoadingChange?: (loading: boolean) => void
  onCanSubmitChange?: (canSubmit: boolean) => void
  /** Id for the Close-type notice, so the drawer's Declare button can say why it is unavailable. */
  closeNoticeId?: string
}

export interface ResultsFormRef {
  submit: () => void
  reset: () => void
}

type SectionTone = 'neutral' | 'violet' | 'amber'

// The legacy blocks' icon discs: slate, purple and amber, on the decorative hue ramp.
const BLOCK_TONE_CLASS: Record<SectionTone, string> = {
  neutral: styles.blockIconNeutral,
  violet: styles.blockIconViolet,
  amber: styles.blockIconAmber,
}

/** One of the legacy form's three titled blocks; an h3 under the drawer's h2 title. */
function FormBlock({
  icon,
  tone,
  title,
  sub,
  children,
}: {
  icon: ReactNode
  tone: SectionTone
  title: string
  sub: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section className={styles.formBlock} aria-labelledby={titleId}>
      <header className={styles.blockHeader}>
        <span className={clsx(styles.blockIcon, BLOCK_TONE_CLASS[tone])} aria-hidden="true">
          {icon}
        </span>
        <div className={styles.blockHeading}>
          <h3 id={titleId} className={styles.blockTitle}>{title}</h3>
          <p className={styles.blockSub}>{sub}</p>
        </div>
      </header>
      <div className={styles.blockFields}>{children}</div>
    </section>
  )
}

export const ResultsForm = forwardRef<ResultsFormRef, ResultsFormProps>(
  ({ onSuccess, onLoadingChange, onCanSubmitChange, closeNoticeId, initialSelection }, ref) => {
  const [createResult, { loading }] = useCreateMatkaResult()
  const { data: matkasData } = useMatkas({ page: 1, limit: 1000 }, { skip: !!initialSelection })
  const defaults = () => ({ ...initialDeclareValues(istToday()), ...(initialSelection ? { matkaId: initialSelection.matkaId, date: initialSelection.date, type: initialSelection.type } : {}) })
  const [values, setValues] = useState<DeclareResultValues>(defaults)
  // The last day picked: clearing the date field leaves the existence check and the preview on it (legacy).
  const [selectedDate, setSelectedDate] = useState<string>(() => initialSelection?.date || istToday())
  const [typeManuallyChanged, setTypeManuallyChanged] = useState(!!initialSelection)
  const [failure, setFailure] = useState('')
  // A field shows its error once it has changed or a submit was tried (antd validated on change).
  const [checked, setChecked] = useState<Partial<Record<DeclareResultField, boolean>>>({})
  const marketRef = useRef<HTMLInputElement | null>(null)
  const dateRef = useRef<HTMLInputElement | null>(null)
  const typeRef = useRef<HTMLSelectElement | null>(null)
  const resultRef = useRef<HTMLInputElement | null>(null)
  const declarationRequest = useRef({ signature: '', key: '' })
  const maxDay = istToday()

  const selectedMatkaId = values.matkaId || undefined
  const selectedType = values.type
  const selectedMarket = (matkasData?.matkas?.items || []).find((market: {id:string}) => market.id === values.matkaId)
  const kind = initialSelection?.matkaType || selectedMarket?.settings?.matkaType || 'worli'
  const doubleDigit = kind === 'jackpot' || kind === 'sattaMatka'
  const needsOpen = kind === 'worli'
  const allowedTypes = kind === 'starline' ? DECLARE_TYPE_OPTIONS.filter(item => item.value === 'open') : doubleDigit ? DECLARE_TYPE_OPTIONS.filter(item => item.value === 'close') : DECLARE_TYPE_OPTIONS
  const validateResult = (input: DeclareResultValues) => {
    const errors = validateDeclareResult(input)
    if (input.result && (doubleDigit ? !/^\d{2}$/.test(input.result) : !/^\d{3}$/.test(input.result) || [...input.result].some((digit, index) => index > 0 && '1234567890'.indexOf(digit) < '1234567890'.indexOf(input.result[index - 1])))) errors.result = doubleDigit ? 'Enter exactly two digits (00-99)' : 'Enter a three-digit Pana in 1-9,0 order'
    return errors
  }

  // Check if open result exists for the selected date/matka (independent of selected type)
  const { data: existsData, refetch: refetchExists, loading: existsLoading } = useMatkaResultExists(
    selectedMatkaId,
    selectedDate,
    'open'
  )
  const openResultExists = Boolean(existsData?.matkaResultExists)

  const markChecked = (field: DeclareResultField) => setChecked((current) => ({ ...current, [field]: true }))

  const handleSubmit = async (submitted: DeclareResultValues) => {
    setFailure('')
    try {
      const signature = JSON.stringify(buildCreateMatkaResultInput(submitted))
      if (declarationRequest.current.signature !== signature) declarationRequest.current = { signature, key: crypto.randomUUID() }
      const result = await createResult({
        variables: {
          input: buildCreateMatkaResultInput(submitted),
          idempotencyKey: declarationRequest.current.key,
        },
        context: { uiToast: 'notification' },
      })

      if (result.data?.createMatkaResult?.success) {
        // Notification is automatically shown by Apollo notificationLink
        setValues((current) => ({ ...current, result: '' }))
        setChecked((current) => ({ ...current, result: false }))
        onSuccess?.()
      } else {
        setFailure(result.data?.createMatkaResult?.message || result.errors?.[0]?.message || 'Result could not be declared. Please retry.')
      }
      // Error notifications are also automatically shown by Apollo notificationLink
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Result could not be declared. Please retry.')
    }
  }

  // Expose form methods to parent
  useImperativeHandle(ref, () => ({
    submit: () => {
      const errors = validateResult(values)
      if (loading || !canSubmitDeclare(selectedType, !needsOpen || openResultExists)) return
      setChecked({ matkaId: true, date: true, type: true, result: true })
      const firstInvalid = DECLARE_FIELD_ORDER.find((field) => errors[field])
      if (firstInvalid) {
        const target = { matkaId: marketRef, date: dateRef, type: typeRef, result: resultRef }[firstInvalid]
        target.current?.focus()
        return
      }
      void handleSubmit(values)
    },
    reset: () => {
      setValues(defaults())
      setSelectedDate(initialSelection?.date || istToday())
      setFailure('')
      setChecked({})
      setTypeManuallyChanged(!!initialSelection)
    },
  }))

  // Notify parent of loading state
  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  // Notify parent of can submit state
  useEffect(() => {
    onCanSubmitChange?.(canSubmitDeclare(selectedType, !needsOpen || openResultExists))
  }, [selectedType, openResultExists, needsOpen, onCanSubmitChange])

  // Once the check for the chosen market/date has answered, the type follows it unless chosen by hand.
  useEffect(() => {
    if (!needsOpen) { const next = doubleDigit ? 'close' : 'open'; if (values.type !== next) setValues(current => ({ ...current, type: next })); return }
    const next = autoDeclareType({
      hasOpen: openResultExists,
      type: selectedType,
      matkaId: selectedMatkaId,
      date: selectedDate,
      existsLoading,
      existsKnown: existsData !== undefined,
      typeManuallyChanged,
    })
    if (next) setValues((current) => ({ ...current, type: next }))
  }, [openResultExists, selectedType, selectedMatkaId, selectedDate, existsLoading, existsData, typeManuallyChanged, needsOpen, doubleDigit, values.type])

  const handleMatkaChange = async (value: string) => {
    // A new market clears the hand-picked type (legacy effect on market/date).
    if (value !== values.matkaId) setTypeManuallyChanged(false)
    setValues((current) => ({ ...current, matkaId: value }))
    markChecked('matkaId')
    if (selectedType === 'close' && selectedDate) {
      await refetchExists?.()
    }
  }

  const handleDateChange = async (date: string) => {
    if (!acceptDeclareDate(date, maxDay)) return
    setValues((current) => ({ ...current, date }))
    markChecked('date')
    if (date) {
      if (date !== selectedDate) setTypeManuallyChanged(false)
      setSelectedDate(date)
      if (selectedType === 'close' && selectedMatkaId) {
        await refetchExists?.()
      }
    }
  }

  const handleTypeChange = async (value: MatkaResultType) => {
    setValues((current) => ({ ...current, type: value }))
    markChecked('type')
    setTypeManuallyChanged(true) // Mark as manually changed
    if (value === 'close' && selectedMatkaId && selectedDate) {
      await refetchExists?.()
    }
  }

  const handleResultChange = (text: string) => {
    setValues((current) => ({ ...current, result: sanitizeResultInput(text) })) // Only digits
    markChecked('result')
  }

  const matkaOptions = useMemo(
    () => initialSelection ? [{ value: initialSelection.matkaId, label: initialSelection.marketName }] : matkaListboxOptions(matkaOptionsFrom(matkasData?.matkas?.items)),
    [matkasData, initialSelection],
  )
  const errorFor = (field: DeclareResultField) => (checked[field] ? validateResult(values)[field] : undefined)
  const resultValue = values.result
  const notice = closeTypeNotice(openResultExists, existsLoading)

  return (
    <Form
      className={styles.declareForm}
      aria-label="Declare Matka Result"
      onSubmit={(event) => event.preventDefault()}
    >
      <FormBlock
        icon={<IconLayoutGrid size={14} stroke={strokeFor(14)} />}
        tone="neutral"
        title="Market & Date"
        sub="Select the Matka market and result date"
      >
        <Combobox
          ref={marketRef}
          label="Market"
          required
          disabled={!!initialSelection}
          placeholder="Select market"
          options={matkaOptions}
          value={values.matkaId || null}
          error={errorFor('matkaId')}
          onChange={(value) => void handleMatkaChange(value ?? '')}
        />
        <DateField
          ref={dateRef}
          label="Date"
          required
          disabled={!!initialSelection}
          max={maxDay}
          value={values.date}
          error={errorFor('date')}
          onChange={(date) => void handleDateChange(date)}
        />
      </FormBlock>

      <FormBlock
        icon={<IconCalendar size={14} stroke={strokeFor(14)} />}
        tone="violet"
        title="Result Type"
        sub="Choose open or close result"
      >
        <Select
          ref={typeRef}
          label="Type"
          layout="stacked"
          required
          disabled={!!initialSelection}
          value={values.type}
          options={allowedTypes}
          error={errorFor('type')}
          onChange={(value) => void handleTypeChange(value as MatkaResultType)}
        />

        {selectedType === 'close' && needsOpen ? (
          <Notice id={closeNoticeId} tone={notice.tone} title={notice.title} live="polite">
            {notice.body}
          </Notice>
        ) : null}
      </FormBlock>

      {failure && <Notice tone="error" live="assertive">{failure}</Notice>}
      <FormBlock
        icon={<IconTrophy size={14} stroke={strokeFor(14)} />}
        tone="amber"
        title="Result Value"
        sub="Enter the winning result number"
      >
        <TextField
          ref={resultRef}
          label="Result"
          required
          placeholder={doubleDigit ? "e.g., 05" : "e.g., 267"}
          maxLength={doubleDigit ? 2 : 3}
          inputMode="numeric"
          autoComplete="off"
          value={resultValue}
          error={errorFor('result')}
          onChange={handleResultChange}
          disabled={needsOpen && selectedType === 'close' && !openResultExists}
        />

        {resultValue.length === 2 || resultValue.length === 3 ? (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>
              <IconCircleCheck size={14} stroke={strokeFor(14)} aria-hidden="true" />
              Live Preview
            </p>
            <p className={styles.previewLine}>
              Result: <strong>{resultValue}</strong>
            </p>
            <p className={styles.previewNote}>{declarePreviewText(selectedType, selectedDate)}</p>
          </div>
        ) : null}
      </FormBlock>
    </Form>
  )
})

