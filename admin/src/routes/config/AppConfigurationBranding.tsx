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
import { StoredImage } from '@/ui/components/StoredImage'
import { strokeFor } from '@/ui/components/icons'
import type { FormApi } from '@/ui/form/useForm'
import { ConfigSaveBar } from './AppConfigurationSection'
import { SportsIconsCard, ThemeColorsCard } from './AppConfigurationTheme'
import { brandingSchema, brandingThemeInput, errorMessage, legacyThemeColors, storedThemeUnreadable, text, type BrandingValues, type ConfigRecord } from './appConfigurationModel'
import type { ThemeMode } from '../../../../shared/src/theme/playerTheme'
import styles from './AppConfigurationPage.module.css'

type AssetKind = 'logo' | 'favicon' | 'preLoginBanner' | 'postLoginBanner'
interface BannerDraft { preview: string | null; value: string | null; changed: boolean }

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
        {/* A stored image that will not load is a placeholder naming it, never a broken image (SYS-18). */}
        {preview ? (
          kind === 'favicon' ? (
            <span className={styles.faviconPreview}>
              <StoredImage src={preview} alt={alt} className={styles.faviconLarge} />
              <span className={styles.faviconTab} aria-hidden="true"><StoredImage src={preview} alt="" />{tabName || 'Browser tab'}</span>
            </span>
          ) : <StoredImage src={preview} alt={alt} className={styles.stageImage} />
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
        const invalidMode = brandingSchema.safeParse(form.values).error?.issues
          .map((issue) => issue.path[0])
          .find((path): path is ThemeMode => path === 'light' || path === 'dark')
        if (invalidMode) setThemeMode(invalidMode)
        setFocusRequest((request) => request + 1)
        return
      }
      setSaving(true); setSaveError(null)
      const values = form.values
      // Both writes name the managed whitelabel (see AppConfigurationPage), so logo and theme land on one tenant.
      // This save reports the outcome once; the notification link toasted each write's message on top of it.
      const context = { ...(targetId ? { targetWhitelabelId: targetId } : {}), skipNotification: true }
      const whitelabelResult = await updateWhitelabel({ variables: { input: { id: whitelabel.id, logoUrl: values.logoUrl || null, faviconUrl: values.faviconUrl || null } }, context })
      const input: ConfigRecord = { playerTheme: brandingThemeInput(values) }
      if (preLogin.changed) input.preLoginBannerUrl = preLogin.value ?? null
      if (postLogin.changed) input.postLoginBannerUrl = postLogin.value ?? null
      const configResult = await updateAppConfig({ variables: { input }, context })
      if (whitelabelResult.data?.updateWhitelabel?.success && configResult.data?.updateAppConfig?.success) {
        notify.success('Branding & theme settings saved successfully')
        await onSaveSuccess()
      } else {
        // The refusal's own words, which only the notification link used to show.
        const refused = [whitelabelResult.data?.updateWhitelabel, configResult.data?.updateAppConfig].find((result) => !result?.success)
        throw new Error(refused?.message || 'Failed to save some settings')
      }
    } catch (error) {
      const message = errorMessage(error, 'Failed to save branding settings'); setSaveError(message); notify.error(message)
    } finally { savingRef.current = false; setSaving(false) }
  }
  const anyUploading = Object.values(uploading).some(Boolean)
  const busy = saving || whitelabelLoading || appConfigLoading || anyUploading
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
        <Card title="User Panel Banners" sub="Shown as a popup on the user panel: one to visitors before they sign in, one right after a player signs in." headingLevel={3}>
          <div className={styles.assetGrid}>
            <AssetTile kind="banner" label="Pre-Login Banner" hint="Popup before sign-in" action="Upload Pre-Login Banner" alt="Pre-Login Banner preview" removeLabel="Remove Banner" preview={preLogin.preview} unsaved={preLogin.changed} uploading={uploading.preLoginBanner} onUpload={(file) => upload('preLoginBanner', file)} onRemove={() => setPreLogin({ preview: null, value: null, changed: true })} />
            <AssetTile kind="banner" label="Post-Login Banner" hint="Popup after sign-in" action="Upload Post-Login Banner" alt="Post-Login Banner preview" removeLabel="Remove Banner" preview={postLogin.preview} unsaved={postLogin.changed} uploading={uploading.postLoginBanner} onUpload={(file) => upload('postLoginBanner', file)} onRemove={() => setPostLogin({ preview: null, value: null, changed: true })} />
          </div>
        </Card>
        <ThemeColorsCard form={form} mode={themeMode} onModeChange={setThemeMode} appName={text(whitelabel.name)} legacy={legacyThemeColors(config.theme)} storedUnreadable={storedThemeUnreadable(config)} />
        <SportsIconsCard value={form.values.sportsIconStyle} onChange={(style) => form.setValue('sportsIconStyle', style)} />
      </fieldset>
      <ConfigSaveBar dirty={form.dirty || preLogin.changed || postLogin.changed} busy={busy} saving={saving || whitelabelLoading || appConfigLoading} saveDisabled={anyUploading} saveText="Save Branding & Theme" onDiscard={() => { form.reset(); resetBanners() }} />
    </Form>
  )
}
