import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { IconCheck, IconRefresh } from '@tabler/icons-react'
import { compressImageToDataUrl } from '@/shared/utils/imageCompression'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { FileField } from '@/ui/components/FileField'
import { Form, FormActions, FormField, FormSection } from '@/ui/components/Form'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import {
  CATEGORY_TYPE_OPTIONS,
  MAIN_CATEGORY_OPTIONS,
  MESSAGE_DURATION_MS,
  autoSlugEnabled,
  categoryFormInitialValues,
  categoryFormSchema,
  categorySubmitValues,
  drawerHint,
  drawerTitle,
  iconErrorMessage,
  initialIconState,
  isImageType,
  slugify,
  submitLabel,
  type CategoryDrawerInitial,
  type CategoryFormValues,
  type CategorySubmitValues,
  type DrawerMode,
  type MainCategory,
} from '../categoriesManagementModel'
import styles from '../CategoriesManagementPage.module.css'

export interface CategoryFormDrawerProps {
  open: boolean
  mode: DrawerMode
  initial?: CategoryDrawerInitial
  onClose: () => void
  onSubmit: (values: CategorySubmitValues) => Promise<void> | void
}

type FieldErrors = Partial<Record<keyof CategoryFormValues, string>>

export default function CategoryFormDrawer({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: CategoryFormDrawerProps) {
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<CategoryFormValues>(() => categoryFormInitialValues(initial))
  const [iconPreview, setIconPreview] = useState<string | null>(() => initialIconState(initial?.iconData).preview)
  const [iconValue, setIconValue] = useState<string | null>(() => initialIconState(initial?.iconData).value)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [errorRevision, setErrorRevision] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const shouldAutoSlug = autoSlugEnabled(initial)

  const reset = () => {
    const nextValues = categoryFormInitialValues(initial)
    const nextIcon = initialIconState(initial?.iconData)
    setValues(nextValues)
    setIconPreview(nextIcon.preview)
    setIconValue(nextIcon.value)
    setErrors({})
  }

  useEffect(() => {
    if (open) reset()
    // Each opening intentionally resets from the latest category, matching the legacy Form setFieldsValue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const setValue = <K extends keyof CategoryFormValues>(key: K, value: CategoryFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const handleNameChange = (name: string) => {
    setValues((current) => ({
      ...current,
      name,
      slug: shouldAutoSlug ? slugify(name) : current.slug,
    }))
    setErrors((current) => ({ ...current, name: undefined, slug: undefined }))
  }

  // FileField clears its input after every pick, so choosing the same file again still reports a change.
  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!isImageType(file.type)) {
      toast({ message: 'Please upload an image file', tone: 'error', duration: MESSAGE_DURATION_MS })
      return
    }

    setUploading(true)
    try {
      const dataUri = await compressImageToDataUrl(file, 'casinoIcon')
      setIconValue(dataUri)
      setIconPreview(dataUri)
      setValue('iconData', dataUri)
      toast({ message: 'Icon ready to save', tone: 'ok', duration: MESSAGE_DURATION_MS })
    } catch (error) {
      toast({ message: iconErrorMessage(error), tone: 'error', duration: MESSAGE_DURATION_MS })
    } finally {
      setUploading(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || uploading) return

    const parsed = categoryFormSchema.safeParse(values)
    if (!parsed.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof CategoryFormValues | undefined
        if (field && !nextErrors[field]) nextErrors[field] = issue.message
      }
      setErrors(nextErrors)
      setErrorRevision((value) => value + 1)
      return
    }

    setSaving(true)
    try {
      await onSubmit(categorySubmitValues(parsed.data, iconValue))
    } catch {
      // The page owns mutation feedback; keep the drawer open so the input can be retried.
    } finally {
      setSaving(false)
    }
  }

  const errorCount = Object.values(errors).filter(Boolean).length
  const footer = (
    <FormActions className={styles.drawerActions} data-ui-radius="square">
      <p className={styles.drawerHint}>{drawerHint(mode)}</p>
      <div className={styles.drawerButtons}>
        <Button
          size="sm"
          icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
          disabled={saving || uploading}
          onClick={reset}
        >
          Reset
        </Button>
        <Button size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          form={formId}
          type="submit"
          variant="primary"
          size="sm"
          loading={saving}
          aria-disabled={uploading || undefined}
          icon={<IconCheck size={15} stroke={strokeFor(15)} />}
        >
          {submitLabel(mode)}
        </Button>
      </div>
    </FormActions>
  )

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onClose()
      }}
      title={drawerTitle(mode, initial)}
      sub={drawerHint(mode)}
      size="md"
      dismissible={!saving}
      initialFocus={nameRef}
      footer={footer}
    >
      <Form
        id={formId}
        onSubmit={(event) => void submit(event)}
        errorAnnouncement={errorCount ? `${errorCount} ${errorCount === 1 ? 'field needs' : 'fields need'} attention` : undefined}
        errorAnnouncementRevision={errorRevision}
        className={styles.drawerForm}
      >
        <FormField
          label="Main Category"
          required
          help="Choose the main category type"
          error={errors.mainCategory}
        >
          <SegmentedControl<MainCategory>
            label="Main category"
            value={values.mainCategory as MainCategory}
            options={MAIN_CATEGORY_OPTIONS}
            onChange={(value) => setValue('mainCategory', value)}
            stretch="phone"
          />
        </FormField>

        <FormSection
          title="Category Details"
          description="Basic information and identification"
          cols={{ base: 1 }}
        >
          <Select
            label="Category Type"
            value={values.type}
            options={CATEGORY_TYPE_OPTIONS}
            onChange={(value) => setValue('type', value)}
            help="Choose how the category is featured"
            error={errors.type}
            required
            layout="stacked"
          />
          <TextField
            ref={nameRef}
            label="Name"
            value={values.name}
            onChange={handleNameChange}
            placeholder="Category name"
            help="Display name for the category"
            error={errors.name}
            required
          />
          <TextField
            label="Slug"
            value={values.slug}
            onChange={(value) => setValue('slug', value)}
            placeholder="unique-slug"
            help="URL-friendly identifier (auto-generated from name)"
            error={errors.slug}
            required
          />
          <TextField
            label="Subtitle"
            value={values.subtitle}
            onChange={(value) => setValue('subtitle', value)}
            placeholder="Optional subtitle (max 200 chars)"
            help="Optional description or subtitle"
            maxLength={200}
            showCount
          />
        </FormSection>

        <FormSection
          title="Icon & Appearance"
          description="Upload an icon to represent this category"
          cols={{ base: 1 }}
        >
          <FileField
            label="Category icon"
            accept="image/*"
            help="Recommended size: 64 × 64px."
            busy={uploading}
            fit="contain"
            files={iconPreview ? [{
              id: 'icon',
              name: 'Category icon',
              meta: iconValue ? 'Ready to save' : undefined,
              src: iconPreview,
              alt: 'Category icon preview',
            }] : []}
            onFiles={([file]) => void handleFile(file)}
          />
        </FormSection>

        <FormSection
          title="Status"
          description="Enable or disable the category"
          cols={{ base: 1 }}
        >
          <Switch
            checked={values.isActive}
            onChange={(value) => setValue('isActive', value)}
            label={values.isActive ? 'Active' : 'Inactive'}
          />
          <p className={styles.fieldHelp}>Active categories are visible to users.</p>
        </FormSection>
      </Form>
    </Drawer>
  )
}
