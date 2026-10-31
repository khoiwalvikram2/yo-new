import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { useMutation } from '@apollo/client'
import { IconPhoto, IconTrash, IconUpload } from '@tabler/icons-react'
import clsx from 'clsx'
import type { DocumentNode } from 'graphql'
import { UPDATE_APP_CONFIG } from '@/lib/graphql/appConfig'
import { compressImageToDataUrl } from '@/shared/utils/imageCompression'
import { notify } from '@/shared/services/notification'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { Spinner } from '@/ui/components/Spinner'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { strokeFor } from '@/ui/components/icons'
import type { FormApi } from '@/ui/form/useForm'
import { ConfigColorField, ConfigSaveBar } from './AppConfigurationSection'
import { DEFAULT_THEME_COLORS, errorMessage, text, type BrandingValues, type ConfigRecord } from './appConfigurationModel'
import styles from './AppConfigurationPage.module.css'

type AssetKind = 'logo' | 'favicon' | 'preLoginBanner' | 'postLoginBanner'
type ThemeMode = 'dark' | 'light'
interface BannerDraft { preview: string | null; value: string | null; changed: boolean }

const MODE_FIELDS = [['bgPage', 'Background'], ['textPrimary', 'Text Primary'], ['textSecondary', 'Text Secondary'], ['border', 'Border']] as const

/** One stored image as a tile: the current image is the tile (or an empty stage that takes a drop), with
 * Upload/Replace and Remove under it. The real file input keeps its action name ("Upload Logo"). */
function AssetTile({ label, hint, action, preview, uploading, kind, removeLabel, alt, unsaved, tabName, onUpload, onRemove }: { label: string; hint: string; action: string; preview: string | null; uploading: boolean; kind: 'logo' | 'favicon' | 'banner'; removeLabel: string; alt: string; unsaved: boolean; tabName?: string; onUpload: (file: File) => Promise<void>; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const [over, setOver] = useState(false)
  const carriesFiles = (event: DragEvent) => !event.dataTransfer?.types || Array.from(event.dataTransfer.types).includes('Files')
  return (
    <div
      className={clsx(styles.asset, over && styles.assetOver)} role="group" aria-labelledby={labelId} aria-busy={uploading || undefined}
      onDragOver={(event) => { if (!carriesFiles(event) || uploading) return; event.preventDefault(); setOver(true) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false) }}
      onDrop={(event) => { event.preventDefault(); setOver(false); const file = event.dataTransfer.files?.[0]; if (file && !uploading) void onUpload(file) }}
    >
      <div className={styles.assetHead}>
        <span className={styles.assetLabel} id={labelId}>{label}</span>
        {unsaved ? <span className={styles.assetBadge}>Not saved</span> : null}
        <span className={styles.assetHint}>{hint}</span>
      </div>
      <figure className={clsx(styles.stage, styles[`stage_${kind}`])}>
        {preview ? (
          kind === 'favicon' ? (
            <span className={styles.faviconPreview}>
              <img src={preview} alt={alt} className={styles.faviconLarge} />
              <span className={styles.faviconTab} aria-hidden="true"><img src={preview} alt="" />{tabName || 'Browser tab'}</span>
            </span>
          ) : <img src={preview} alt={alt} className={styles.stageImage} />
        ) : (
          <figcaption className={styles.stageEmpty}><IconPhoto size={22} stroke={strokeFor(22)} aria-hidden="true" /><span>No {kind === 'banner' ? 'banner' : label.toLowerCase()} yet</span><span className={styles.stageDrop}>Drop an image here</span></figcaption>
        )}
        {uploading ? <span className={styles.stageBusy}><Spinner size="sm" decorative /> Processing…</span> : null}
        {over ? <span className={styles.stageBusy} aria-hidden="true">Drop to {preview ? 'replace' : 'upload'}</span> : null}
      </figure>
      <div className={styles.assetActions}>
        <Button size="sm" icon={<IconUpload size={14} stroke={strokeFor(14)} />} disabled={uploading} onClick={() => input.current?.click()} aria-label={`${preview ? 'Replace' : 'Upload'} ${label}`}>{preview ? 'Replace' : 'Upload'}</Button>
        {preview ? <Button size="sm" variant="ghost" icon={<IconTrash size={14} stroke={strokeFor(14)} />} disabled={uploading} onClick={onRemove} aria-label={removeLabel}>Remove</Button> : null}
      </div>
      <input
        ref={input} type="file" accept="image/*" className={styles.fileInput} aria-label={action} tabIndex={-1} aria-hidden="true"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onUpload(file) }}
      />
    </div>
  )
}

/** Dark or light ink, whichever reads on a stored hex fill (other color syntaxes keep white). */
function readableOn(fill: string) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill.trim())?.[1]
  if (!hex) return '#FFFFFF'
  const full = hex.length === 3 ? hex.split('').map((digit) => digit + digit).join('') : hex
  const [r, g, b] = [0, 2, 4].map((at) => { const channel = parseInt(full.slice(at, at + 2), 16) / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#FFFFFF'
}

/** A small mock of the user panel painted with the colors being edited. The colors are the stored
 * user-site values (not admin paint), so they are inline. */
function ThemePreview({ mode, values, logo, appName }: { mode: ThemeMode; values: BrandingValues; logo: string | null; appName: string }) {
  const surface = values[mode]
  const page = { background: surface.bgPage, color: surface.textPrimary, borderColor: surface.border }
  const line = { borderColor: surface.border }
  const muted = { color: surface.textSecondary }
  const dot = (color: string) => <i className={styles.previewDot} style={{ background: color }} />
  return (
    <figure className={styles.preview}>
      <div className={styles.previewFrame} style={page} role="img" aria-label={`User panel preview in the ${mode} theme`}>
        <div className={styles.previewBar} style={line}>
          {logo ? <img src={logo} alt="" className={styles.previewLogo} /> : <b>{appName || 'Your brand'}</b>}
          <span className={styles.previewButton} style={{ background: values.primary, color: readableOn(values.primary) }}>Deposit</span>
        </div>
        <div className={styles.previewBody}>
          <span className={styles.previewCaption} style={muted}>Main balance</span>
          <b className={styles.previewAmount}>₹12,500.00</b>
          <div className={styles.previewMarket} style={line}>
            <span><b>India v Australia</b><span style={muted}>Today · 19:30</span></span>
            <span className={styles.previewOdds} style={{ background: values.primary, color: readableOn(values.primary) }}>1.85</span>
          </div>
          <div className={styles.previewStates} style={muted}>
            <span>{dot(values.success)}Won</span><span>{dot(values.warning)}Pending</span><span>{dot(values.danger)}Lost</span>
          </div>
        </div>
      </div>
      <figcaption className={styles.previewNote}>Live preview · {mode === 'dark' ? 'Dark' : 'Light'} theme</figcaption>
    </figure>
  )
}

export function AppConfigurationBranding({ form, whitelabel, config, targetId, updateWhitelabelDocument, onSaveSuccess }: { form: FormApi<BrandingValues>; whitelabel: ConfigRecord; config: ConfigRecord; targetId: string | null; updateWhitelabelDocument: DocumentNode; onSaveSuccess: () => Promise<void> }) {
  const [updateWhitelabel, { loading: whitelabelLoading }] = useMutation(updateWhitelabelDocument)
  const [updateAppConfig, { loading: appConfigLoading }] = useMutation(UPDATE_APP_CONFIG)
  const [preLogin, setPreLogin] = useState<BannerDraft>({ preview: null, value: null, changed: false })
  const [postLogin, setPostLogin] = useState<BannerDraft>({ preview: null, value: null, changed: false })
  const [uploading, setUploading] = useState<Record<AssetKind, boolean>>({ logo: false, favicon: false, preLoginBanner: false, postLoginBanner: false })
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  useEffect(() => { if (focusRequest) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [focusRequest])
  // Keep the established banner behavior: config data initializes the previews; unchanged banners
  // never join the input. Explicit removal must send null (not an absent field).
  const resetBanners = useCallback(() => {
    setPreLogin({ preview: text(config.preLoginBannerUrl) || null, value: null, changed: false })
    setPostLogin({ preview: text(config.postLoginBannerUrl) || null, value: null, changed: false })
  }, [config])
  useEffect(() => { resetBanners() }, [resetBanners])
  const upload = async (kind: AssetKind, file: File) => {
    if (!file.type.startsWith('image/')) { notify.error('You can only upload image files!'); return }
    setUploading((previous) => ({ ...previous, [kind]: true }))
    try {
      const dataUri = await compressImageToDataUrl(file, kind === 'logo' || kind === 'favicon' ? kind : 'banner')
      if (kind === 'logo') form.setValue('logoUrl', dataUri)
      else if (kind === 'favicon') form.setValue('faviconUrl', dataUri)
      else if (kind === 'preLoginBanner') setPreLogin({ preview: dataUri, value: dataUri, changed: true })
      else setPostLogin({ preview: dataUri, value: dataUri, changed: true })
      notify.success(kind === 'logo' ? 'Logo ready to save' : kind === 'favicon' ? 'Favicon ready to save' : kind === 'preLoginBanner' ? 'Pre-login banner ready to save' : 'Post-login banner ready to save')
    } catch (error) {
      // A compression failure does not authorize removing an existing stored asset. Retain the
      // previous draft/preview, and let the operator retry (the old banner keys were unset).
      notify.error(errorMessage(error, kind === 'logo' ? 'Failed to process logo' : kind === 'favicon' ? 'Failed to process favicon' : 'Failed to process banner'))
    } finally { setUploading((previous) => ({ ...previous, [kind]: false })) }
  }
  const save = async () => {
    if (savingRef.current) return
    if (!whitelabel.id) { notify.error('Whitelabel information not available. Please refresh the page.'); return }
    savingRef.current = true
    try {
      if (!await form.validate()) {
        const missingMode = (['dark', 'light'] as const).find((mode) => Object.values(form.values[mode]).some((value) => !value))
        if (missingMode) setThemeMode(missingMode)
        setFocusRequest((request) => request + 1)
        return
      }
      setSaving(true); setSaveError(null)
      const values = form.values
      const context = { headers: targetId ? { 'x-whitelabel-id': targetId } : {} }
      const whitelabelResult = await updateWhitelabel({ variables: { input: { id: whitelabel.id, logoUrl: values.logoUrl || null, faviconUrl: values.faviconUrl || null } }, context })
      const input: ConfigRecord = { theme: { primary: values.primary, success: values.success, warning: values.warning, danger: values.danger, dark: values.dark, light: values.light } }
      if (preLogin.changed) input.preLoginBannerUrl = preLogin.value ?? null
      if (postLogin.changed) input.postLoginBannerUrl = postLogin.value ?? null
      const configResult = await updateAppConfig({ variables: { input }, context })
      if (whitelabelResult.data?.updateWhitelabel?.success && configResult.data?.updateAppConfig?.success) {
        notify.success('Branding & theme settings saved successfully')
        await onSaveSuccess()
      } else { throw new Error('Failed to save some settings') }
    } catch (error) {
      const message = errorMessage(error, 'Failed to save branding settings'); setSaveError(message); notify.error(message)
    } finally { savingRef.current = false; setSaving(false) }
  }
  const anyUploading = Object.values(uploading).some(Boolean)
  const busy = saving || whitelabelLoading || appConfigLoading || anyUploading
  const modeColors = form.values[themeMode]
  const storedLogo = text(whitelabel.logoUrl) || null
  const storedFavicon = text(whitelabel.faviconUrl) || null
  return (
    <Form ref={formRef} onSubmit={(event) => { event.preventDefault(); void save() }} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.sectionForm}>
      {saveError ? <Notice title="Branding not saved" tone="error">{saveError}</Notice> : null}
      <fieldset className={styles.fieldset} disabled={busy}>
        <Card title="Logo & Favicon" sub="The brand marks players see in the header and on the browser tab." headingLevel={3}>
          <div className={styles.assetGrid}>
            <AssetTile kind="logo" label="Logo" hint="Header and sign-in screen" action="Upload Logo" alt="Logo" removeLabel="Remove Logo" preview={form.values.logoUrl} unsaved={form.values.logoUrl !== storedLogo} uploading={uploading.logo} onUpload={(file) => upload('logo', file)} onRemove={() => form.setValue('logoUrl', null)} />
            <AssetTile kind="favicon" label="Favicon" hint="Browser tab icon" action="Upload Favicon" alt="Favicon" removeLabel="Remove Favicon" tabName={text(whitelabel.name)} preview={form.values.faviconUrl} unsaved={form.values.faviconUrl !== storedFavicon} uploading={uploading.favicon} onUpload={(file) => upload('favicon', file)} onRemove={() => form.setValue('faviconUrl', null)} />
          </div>
        </Card>
        <Card title="User Panel Banners" sub="Shown on the user panel's home page: one before players sign in, one after." headingLevel={3}>
          <div className={styles.assetGrid}>
            <AssetTile kind="banner" label="Pre-Login Banner" hint="Before sign-in" action="Upload Pre-Login Banner" alt="Pre-Login Banner preview" removeLabel="Remove Banner" preview={preLogin.preview} unsaved={preLogin.changed} uploading={uploading.preLoginBanner} onUpload={(file) => upload('preLoginBanner', file)} onRemove={() => setPreLogin({ preview: null, value: null, changed: true })} />
            <AssetTile kind="banner" label="Post-Login Banner" hint="After sign-in" action="Upload Post-Login Banner" alt="Post-Login Banner preview" removeLabel="Remove Banner" preview={postLogin.preview} unsaved={postLogin.changed} uploading={uploading.postLoginBanner} onUpload={(file) => upload('postLoginBanner', file)} onRemove={() => setPostLogin({ preview: null, value: null, changed: true })} />
          </div>
        </Card>
        <Card title="Theme Colors" sub="The user panel's colors. Action colors are shared; surface and text colors are set per theme." headingLevel={3} tools={<Button size="sm" onClick={() => { form.setValues(DEFAULT_THEME_COLORS); notify.success('Theme colors reset to default values') }}>Reset to Default</Button>}>
          <div className={styles.themeLayout}>
            <div className={styles.themeControls}>
              <section className={styles.colorGroup} aria-labelledby="config-action-colors">
                <h4 className={styles.colorGroupTitle} id="config-action-colors">Action colors <span>Both themes</span></h4>
                <div className={styles.colorGrid}>{(['primary', 'success', 'warning', 'danger'] as const).map((name) => <ConfigColorField key={name} label={`${name[0].toUpperCase()}${name.slice(1)}`} name={name} value={form.values[name]} onChange={(value) => form.setValue(name, value)} error={form.errors[name]} required />)}</div>
              </section>
              <section className={styles.colorGroup} aria-labelledby="config-surface-colors">
                <div className={styles.colorGroupHead}>
                  <h4 className={styles.colorGroupTitle} id="config-surface-colors">Surface & text</h4>
                  <Tabs size="sm" label="User panel theme colors" idPrefix="config-theme" value={themeMode} items={[{ value: 'dark', label: 'Dark Theme' }, { value: 'light', label: 'Light Theme' }]} onChange={setThemeMode} />
                </div>
                <div role="tabpanel" id={tabPanelId('config-theme', themeMode)} aria-labelledby={tabId('config-theme', themeMode)} className={styles.colorGrid}>
                  {MODE_FIELDS.map(([name, label]) => <ConfigColorField key={name} label={label} name={`${themeMode}.${name}`} value={modeColors[name] || ''} onChange={(value) => form.setValue(themeMode, { ...modeColors, [name]: value })} error={form.errors[`${themeMode}.${name}`]} required />)}
                </div>
              </section>
            </div>
            <ThemePreview mode={themeMode} values={form.values} logo={form.values.logoUrl} appName={text(whitelabel.name)} />
          </div>
        </Card>
      </fieldset>
      <ConfigSaveBar dirty={form.dirty || preLogin.changed || postLogin.changed} busy={busy} saving={saving || whitelabelLoading || appConfigLoading} saveDisabled={anyUploading} saveText="Save Branding & Theme" onDiscard={() => { form.reset(); resetBanners() }} />
    </Form>
  )
}
