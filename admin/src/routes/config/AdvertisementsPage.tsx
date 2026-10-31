import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconCircleCheck, IconDownload, IconGripVertical, IconPencil, IconPhoto, IconPlayerPause, IconPlus, IconRefresh,
  IconSpeakerphone, IconStar, IconTrash } from '@tabler/icons-react'
import { ADVERTISEMENTS, CREATE_ADVERTISEMENT, UPDATE_ADVERTISEMENT, DELETE_ADVERTISEMENT, REORDER_ADVERTISEMENTS } from '@/lib/graphql/advertisements'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useTableExport } from '@/shared/hooks/useTableExport'
import { compressImageToDataUrl } from '@/shared/utils/imageCompression'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { Table, THead, TBody, TR, TH, TD } from '@/ui/components/Table'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { Drawer } from '@/ui/components/Drawer'
import { FilterBar } from '@/ui/components/FilterBar'
import { Form } from '@/ui/components/Form'
import { TextField } from '@/ui/components/TextField'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { SearchField } from '@/ui/components/SearchField'
import { FileField } from '@/ui/components/FileField'
import { StatusPill } from '@/ui/components/StatusPill'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { confirm } from '@/ui/components/confirm'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import { AD_DEVICES, AD_TYPES, AD_EXPORT_COLUMNS, advertisementInput, advertisementSchema,
  advertisementValues, filterAdvertisements, reorderAdvertisements, sortAdvertisements,
  type Advertisement, type AdvertisementValues } from './advertisementsModel'
import styles from './AdvertisementsPage.module.css'

interface AdsData { advertisements: Advertisement[] }
interface MutationData { [key: string]: { success: boolean; message?: string } | undefined }

function failure(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function AdvertisementsPage() {
  return (
    <RBACGuard required={[{ domain: 'config.advertisements', actions: ['view'] }]}>
      <AdvertisementsPageContent />
    </RBACGuard>
  )
}

function AdvertisementsPageContent() {
  const eyebrow = usePageEyebrow()
  const createRef = useRef<HTMLButtonElement>(null)
  const drawerOrigin = useRef<HTMLElement | null>(null)
  const [editor, setEditor] = useState<{ ad: Advertisement | null } | null>(null)
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [deviceType, setDeviceType] = useState('')
  const [query, setQuery] = useState('')
  const { data, loading, error, refetch } = useQuery<AdsData>(ADVERTISEMENTS, {
    variables: { status: status || undefined }, errorPolicy: 'all',
  })
  const [createAd] = useMutation<MutationData>(CREATE_ADVERTISEMENT)
  const [updateAd] = useMutation<MutationData>(UPDATE_ADVERTISEMENT)
  const [deleteAd] = useMutation<MutationData>(DELETE_ADVERTISEMENT)
  const [reorderAds] = useMutation<MutationData>(REORDER_ADVERTISEMENTS)
  const filtered = useMemo(() => filterAdvertisements(data?.advertisements || [], {
    type, deviceType, query,
  }), [data?.advertisements, type, deviceType, query])
  const { exporting, handleExport } = useTableExport({
    data: filtered, columns: AD_EXPORT_COLUMNS, filename: 'Advertisements',
    sheetName: 'Advertisements', title: `Advertisements — ${filtered.length} item(s)`,
  })

  function openEditor(ad: Advertisement | null) {
    drawerOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : createRef.current
    setEditor({ ad })
  }

  async function save(values: AdvertisementValues) {
    const input = advertisementInput(values)
    const response = editor?.ad
      ? await updateAd({ variables: { input: { id: editor.ad.id, ...input } } })
      : await createAd({ variables: { input } })
    const result = editor?.ad ? response.data?.updateAdvertisement : response.data?.createAdvertisement
    if (result?.success === false) throw new Error(result.message || 'Failed to save advertisement')
    toast({ tone: 'ok', message: editor?.ad ? 'Advertisement updated successfully' : 'Advertisement created successfully' })
    setEditor(null)
    void refetch()
  }

  async function toggle(id: string, nextStatus: 'ACTIVE' | 'INACTIVE') {
    try {
      const response = await updateAd({ variables: { input: { id, status: nextStatus } } })
      if (response.data?.updateAdvertisement?.success === false)
        throw new Error(response.data.updateAdvertisement.message || 'Failed to update status')
      toast({ tone: 'ok', message: `Advertisement ${nextStatus === 'ACTIVE' ? 'activated' : 'deactivated'} successfully` })
      void refetch()
    } catch (err) { toast({ tone: 'error', message: failure(err, 'Failed to update status') }) }
  }

  function remove(id: string) {
    void confirm({
      title: 'Delete advertisement?', description: 'This action cannot be undone.',
      confirmLabel: 'Yes', cancelLabel: 'No', tone: 'danger',
      onConfirm: async () => {
        try {
          const response = await deleteAd({ variables: { id } })
          if (response.data?.deleteAdvertisement?.success === false)
            throw new Error(response.data.deleteAdvertisement.message || 'Failed to delete advertisement')
          toast({ tone: 'ok', message: 'Advertisement deleted successfully' })
          void refetch()
        } catch (err) {
          toast({ tone: 'error', message: failure(err, 'Failed to delete advertisement') })
          throw err
        }
      },
    })
  }

  async function reorder(orders: { id: string; order: number }[]) {
    try {
      const response = await reorderAds({ variables: { orders } })
      if (response.data?.reorderAdvertisements?.success === false)
        throw new Error(response.data.reorderAdvertisements.message || 'Failed to reorder advertisement')
      toast({ tone: 'ok', message: 'Order updated' })
      void refetch()
    } catch (err) { toast({ tone: 'error', message: failure(err, 'Failed to reorder advertisement') }) }
  }

  return (
    <Page maxWidth="wide">
      <PageHeader title="Advertisements" eyebrow={eyebrow} sub="Manage promotional banners and advertisements"
        actions={<div className={styles.actions}>
          <Button icon={<IconDownload size={16} />} loading={exporting} aria-disabled={!filtered.length} onClick={handleExport}>Export Excel</Button>
          <Button icon={<IconRefresh size={16} />} onClick={() => void refetch()}>Refresh</Button>
          <Button ref={createRef} variant="primary" icon={<IconPlus size={16} />} onClick={() => openEditor(null)}>Create Advertisement</Button>
        </div>} />
      <div className={styles.workspace}>
        <AdvertisementStats />
        <FilterBar label="Advertisement filters" activeCount={[status, type, deviceType, query].filter(Boolean).length}
          onClearAll={() => { setStatus(''); setType(''); setDeviceType(''); setQuery(''); void refetch() }}
          search={<SearchField label="Search advertisements" size="sm" value={query} onChange={setQuery} placeholder="Search by title..." />}>
          <Select label="Status" size="sm" value={status} onChange={setStatus} options={[
            { value: '', label: 'All Status' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' },
          ]} />
          <Select label="Type" size="sm" value={type} onChange={setType} options={[{ value: '', label: 'All Types' }, ...AD_TYPES]} />
          <Select label="Device" size="sm" value={deviceType} onChange={setDeviceType} options={[{ value: '', label: 'All Devices' }, ...AD_DEVICES]} />
        </FilterBar>
        {error ? <Notice tone="error" action={<Button onClick={() => void refetch()}>Retry</Button>}>{error.message}</Notice> : null}
        <Card title="Advertisements" sub={`${filtered.length} ${filtered.length === 1 ? 'advertisement' : 'advertisements'}`} body="table">
          <AdvertisementTable ads={filtered} loading={loading} onEdit={openEditor} onDelete={remove} onToggle={toggle} onReorder={reorder} />
        </Card>
      </div>
      <Drawer open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null) }}
        title={editor?.ad ? 'Edit Advertisement' : 'Create Advertisement'}
        sub={editor?.ad ? 'Update advertisement configuration' : 'Configure a new promotional advertisement'}
        restoreFocusTo={drawerOrigin} themeFrom={drawerOrigin} size="md">
        {editor ? <AdvertisementEditor key={editor.ad?.id || 'new'} ad={editor.ad} onSave={save} onCancel={() => setEditor(null)} /> : null}
      </Drawer>
    </Page>
  )
}

function AdvertisementStats() {
  const { data } = useQuery<AdsData>(ADVERTISEMENTS, { errorPolicy: 'all' })
  const ads = data?.advertisements || []
  return (
    <div className={styles.stats}>
      <Stat label="Active" value={ads.filter((ad) => ad.status === 'ACTIVE').length} icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />} hue="grn" />
      <Stat label="Inactive" value={ads.filter((ad) => ad.status === 'INACTIVE').length} icon={<IconPlayerPause size={18} stroke={strokeFor(18)} />} hue="amb" />
      <Stat label="Banners" value={ads.filter((ad) => ad.type === 'BANNER').length} icon={<IconPhoto size={18} stroke={strokeFor(18)} />} hue="blu" />
      <Stat label="Promotional" value={ads.filter((ad) => ad.type === 'PROMOTIONAL').length} icon={<IconSpeakerphone size={18} stroke={strokeFor(18)} />} hue="vio" />
      <Stat label="Featured" value={ads.filter((ad) => ad.type === 'FEATURED').length} icon={<IconStar size={18} stroke={strokeFor(18)} />} hue="ind" />
    </div>
  )
}

function AdvertisementTable({ ads, loading, onEdit, onDelete, onToggle, onReorder }: {
  ads: Advertisement[]
  loading: boolean
  onEdit: (ad: Advertisement) => void
  onDelete: (id: string) => void
  onToggle: (id: string, status: 'ACTIVE' | 'INACTIVE') => Promise<void>
  onReorder: (orders: { id: string; order: number }[]) => Promise<void>
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const sorted = sortAdvertisements(ads)
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    const orders = reorderAdvertisements(ads, String(active.id), String(over.id))
    if (orders) void onReorder(orders)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <Table caption="Advertisements" width="wide">
        <THead><TR>{['Order', 'Image', 'Title', 'Type', 'Status', 'Device', 'Created', 'Actions'].map((label) =>
          <TH key={label} align={label === 'Actions' ? 'right' : 'left'}>{label}</TH>)}</TR></THead>
        <TBody>
          {loading ? <TR><TD colSpan={8}><LoadingState label="Loading advertisements" /></TD></TR> :
            sorted.length === 0 ? <TR><TD colSpan={8}><EmptyState title="No advertisements found" /></TD></TR> :
              <SortableContext items={sorted.map((ad) => ad.id)} strategy={verticalListSortingStrategy}>
                {sorted.map((ad) => <AdvertisementRow key={ad.id} ad={ad} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} />)}
              </SortableContext>}
        </TBody>
      </Table>
    </DndContext>
  )
}

function AdvertisementRow({ ad, onEdit, onDelete, onToggle }: {
  ad: Advertisement
  onEdit: (ad: Advertisement) => void
  onDelete: (id: string) => void
  onToggle: (id: string, status: 'ACTIVE' | 'INACTIVE') => Promise<void>
}) {
  const { formatDate, formatTime } = useFormatDate()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: ad.id })
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <TR ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? styles.dragging : undefined}>
      <TD><span className={styles.order}>
        <IconButton {...attributes} {...listeners} ref={setActivatorNodeRef} className={styles.sortHandle}
          label={`Drag to reorder ${ad.title}`} icon={<IconGripVertical size={16} />} />
        {ad.order ?? '—'}
      </span></TD>
      <TD>{ad.imageUrl && !imageFailed ?
        <img src={ad.imageUrl} alt={ad.title} className={styles.thumbnail} onError={() => setImageFailed(true)} /> :
        <span className={styles.imageFallback}>{imageFailed ? 'Failed' : 'No image'}</span>}</TD>
      <TD><div className={styles.identity}>
        <div className={styles.title}>{ad.title}</div>
        {ad.subtitle ? <div className={styles.sub}>{ad.subtitle}</div> : null}
      </div></TD>
      <TD><StatusPill>{ad.type}</StatusPill></TD>
      <TD><Switch label={`Active: ${ad.title}`} checked={ad.status.toUpperCase() === 'ACTIVE'}
        onChange={(active) => void onToggle(ad.id, active ? 'ACTIVE' : 'INACTIVE')} hideLabel size="sm" /></TD>
      <TD><StatusPill>{ad.deviceType || 'BOTH'}</StatusPill></TD>
      <TD><div>{ad.createdAt ? formatDate(ad.createdAt, 'dd MMM yyyy') : '—'}</div>
        <div className={styles.sub}>{ad.createdAt ? formatTime(ad.createdAt, 'HH:mm') : ''}</div></TD>
      <TD align="right"><div className={styles.actions}>
        <IconButton label={`Edit ${ad.title}`} icon={<IconPencil size={16} />} onClick={() => onEdit(ad)} />
        <IconButton label={`Delete ${ad.title}`} icon={<IconTrash size={16} />} onClick={() => onDelete(ad.id)} />
      </div></TD>
    </TR>
  )
}

function AdvertisementEditor({ ad, onSave, onCancel }: {
  ad: Advertisement | null
  onSave: (values: AdvertisementValues) => Promise<void>
  onCancel: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const uploadRevision = useRef(0)
  useEffect(() => () => { uploadRevision.current += 1 }, [])
  const form = useForm({
    schema: advertisementSchema, initialValues: advertisementValues(ad),
    onSubmit: async (values) => {
      try { await onSave(values) }
      catch (error) {
        toast({ tone: 'error', message: failure(error, 'Failed to save advertisement') })
        throw error
      }
    },
  })

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) {
      toast({ tone: 'error', message: 'You can only upload image files!' })
      return
    }
    const revision = ++uploadRevision.current
    setUploading(true)
    try {
      const dataUri = await compressImageToDataUrl(file, 'advertisement')
      if (revision !== uploadRevision.current) return
      form.setValue('imageUrl', dataUri)
      toast({ tone: 'ok', message: 'Image ready to save' })
    } catch (error) {
      if (revision !== uploadRevision.current) return
      toast({ tone: 'error', message: failure(error, 'Failed to process image') })
    } finally {
      if (revision === uploadRevision.current) setUploading(false)
    }
  }

  return (
    <Form className={styles.form} onSubmit={(event) => {
      if (uploading) { event.preventDefault(); return }
      form.handleSubmit(event)
    }}
      errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision}>
      <Card title="Basic Information" sub="Title, subtitle, and content details">
        <div className={styles.fields}>
          <TextField label="Title" {...form.field('title')} required placeholder="Advertisement title" />
          <TextField label="Subtitle" {...form.field('subtitle')} placeholder="Optional subtitle" maxLength={512} />
        </div>
      </Card>
      <Card title="Advertisement Image" sub="Upload banner or promotional image (automatically compressed)">
        {/* the zone itself shows the upload and the current image's row stays put, so the form does not move */}
        <FileField label="Upload Image" name="imageUrl" accept="image/*" fit="contain"
          busy={uploading} disabled={form.submitting} error={form.errors.imageUrl}
          files={form.values.imageUrl ? [{ id: 'image', name: 'Advertisement image', src: form.values.imageUrl, alt: 'Preview', zoomable: true }] : []}
          onFiles={([file]) => { if (file) void upload(file) }} />
      </Card>
      <Card title="Configuration" sub="Type, URL, order, and display settings">
        <div className={styles.form}>
          <div className={styles.fields}>
            <Select label="Type" {...form.field('type')} layout="stacked" options={AD_TYPES} required />
            <Select label="Device Type" {...form.field('deviceType')} layout="stacked" options={AD_DEVICES} required />
          </div>
          <TextField label="URL" {...form.field('url')} placeholder="https://example.com or /page (optional)"
            help="Optional: Link to redirect when advertisement is clicked" />
          <div className={styles.fields}>
            <NumberField label="Order" {...form.field('order')} min={0} placeholder="Auto"
              help="Lower numbers appear first. Leave empty for auto-increment" />
            <Switch label="Status: Active" checked={form.values.status} onChange={(active) => form.setValue('status', active)} />
          </div>
        </div>
      </Card>
      {form.formError ? <Notice tone="error">{form.formError}</Notice> : null}
      <div className={styles.footer}>
        <Button onClick={() => { uploadRevision.current += 1; setUploading(false); form.reset(advertisementValues(ad)) }}>Reset</Button>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={form.submitting} aria-disabled={uploading}>
          {ad ? 'Save Changes' : 'Create'}
        </Button>
      </div>
    </Form>
  )
}
