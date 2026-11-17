import { useEffect, useMemo, useRef, useState } from 'react'
import { gql, useMutation, useQuery } from '@apollo/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IconActivityHeartbeat, IconAddressBook, IconArrowsMaximize, IconArrowsMinimize, IconBell, IconChartBar, IconCreditCard, IconDeviceMobile, IconMail, IconPalette, IconSettings, IconShieldHalfFilled, IconSpeakerphone, IconToggleRight, IconTool, IconWebhook, IconWorldWww, type Icon } from '@tabler/icons-react'
import clsx from 'clsx'
import { APP_CONFIG, UPDATE_APP_CONFIG } from '@/lib/graphql/appConfig'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { notify } from '@/shared/services/notification'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Spinner } from '@/ui/components/Spinner'
import { strokeFor } from '@/ui/components/icons'
import { useForm } from '@/ui/form/useForm'
import { AppConfigurationBranding } from './AppConfigurationBranding'
import { AppConfigurationSection } from './AppConfigurationSection'
import { CONFIG_MENU, brandingInitialValues, brandingSchema, configRoles, errorMessage, tabVisible, text, type BrandingValues, type ConfigRecord, type ConfigTab } from './appConfigurationModel'
import styles from './AppConfigurationPage.module.css'

const UPDATE_WHITELABEL = gql`
  mutation UpdateWhitelabel($input: UpdateWhitelabelInput!) {
    updateWhitelabel(input: $input) { success message whitelabel { id } }
  }
`

const WHITELABEL_CURRENT = gql`
  query WhitelabelCurrent {
    whitelabelCurrent {
      id
      name
      domain
      logoUrl
      faviconUrl
      theme {
        primary
        success
        warning
        danger
        dark { bgPage textPrimary textSecondary border }
        light { bgPage textPrimary textSecondary border }
        bgPage
        textPrimary
        textSecondary
        border
      }
    }
  }
`

const GET_WHITELABEL_BY_ID = gql`
  query GetWhitelabel($id: ID!) {
    whitelabel(id: $id) {
      id
      name
      domain
      logoUrl
      faviconUrl
      theme {
        primary
        success
        warning
        danger
        dark { bgPage textPrimary textSecondary border }
        light { bgPage textPrimary textSecondary border }
        bgPage
        textPrimary
        textSecondary
        border
      }
    }
  }
`


const UPDATE_GUARDED_TABS: readonly ConfigTab[] = ['analytics', 'payments', 'webhooks', 'observability']
/** Each section's icon in the section panel and the line under its title. */
const SECTION_META: Record<ConfigTab, { icon: Icon; description: string }> = {
  branding: { icon: IconPalette, description: 'Logo, favicon, home-page banners and the colors of the user panel.' },
  general: { icon: IconSettings, description: 'The language, time zone and currency the platform starts from.' },
  contact: { icon: IconAddressBook, description: 'The support email and phone numbers players are shown.' },
  features: { icon: IconToggleRight, description: 'Turn whole product modules on or off for players.' },
  seo: { icon: IconWorldWww, description: 'The app name, search-engine text and social media links.' },
  news: { icon: IconSpeakerphone, description: 'The News messages that scroll under the user panel header.' },
  analytics: { icon: IconChartBar, description: 'Tag Manager, Analytics and pixel IDs used for tracking.' },
  webhooks: { icon: IconWebhook, description: 'Where platform events are sent and how they are signed.' },
  observability: { icon: IconActivityHeartbeat, description: 'Error reporting, the log level and metrics.' },
  payments: { icon: IconCreditCard, description: 'Deposit and withdrawal limits, fees, KYC and payout methods.' },
  risk: { icon: IconShieldHalfFilled, description: 'Default exposure and stake limits, and cash-out.' },
  notify: { icon: IconMail, description: 'The SMTP server for outgoing email and who gets alerts.' },
  'admin-notify': { icon: IconBell, description: 'Where admin notifications appear and which kinds show.' },
  maintenance: { icon: IconTool, description: 'Put the user site into maintenance and set what players read.' },
  pwa: { icon: IconDeviceMobile, description: 'The name and colors used when players install the app.' },
}
const EMPTY_RECORD: ConfigRecord = {}
interface LegacyFullscreenElement extends HTMLDivElement { webkitRequestFullscreen?: () => void; mozRequestFullScreen?: () => void; msRequestFullscreen?: () => void }
interface LegacyFullscreenDocument extends Document { webkitFullscreenElement?: Element; mozFullScreenElement?: Element; msFullscreenElement?: Element; webkitExitFullscreen?: () => void; mozCancelFullScreen?: () => void; msExitFullscreen?: () => void }

export default function AppConfigurationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const targetId = searchParams.get('whitelabelId')
  const { roles } = useAuthStore()
  const roleState = useMemo(() => configRoles(roles), [roles])
  // Every read and write here names the whitelabel it manages, so the link runs it in that whitelabel's
  // mode (shared/core/api.ts); a Super Admin in core mode otherwise read and saved the default tenant. For
  // a Super Admin that is another tenant's config, kept out of the cache, where the shell and other pages
  // read the current tenant's (a Whitelabel Admin's target is its own tenant, and the link ignores it).
  // Apollo merges identical in-flight queries by document and variables, whatever their context: a targeted
  // read is never merged into an untargeted copy of the same query (which would answer with the current
  // tenant's config under this whitelabel's banner).
  const targetContext = useMemo(() => (targetId ? { targetWhitelabelId: targetId, queryDeduplication: false } : {}), [targetId])
  // Each save reports its own outcome below, so the global notification link stays quiet for it (it toasted
  // the same message again: one Save showed "Configuration updated" twice).
  const writeContext = useMemo(() => ({ ...targetContext, skipNotification: true }), [targetContext])
  const foreignTarget = Boolean(targetId && roleState.isSuperAdmin)
  const { data: configData, loading, error: configError, refetch } = useQuery(APP_CONFIG, { errorPolicy: 'all', context: targetContext, ...(foreignTarget ? { fetchPolicy: 'no-cache' as const } : {}) })
  const { data: whitelabelData, loading: whitelabelLoading, error: whitelabelError, refetch: refetchWhitelabel } = useQuery(targetId ? GET_WHITELABEL_BY_ID : WHITELABEL_CURRENT, { variables: targetId ? { id: targetId } : undefined, errorPolicy: 'all', context: targetContext })
  const { data: currentWhitelabelData } = useQuery(WHITELABEL_CURRENT, { errorPolicy: 'all', skip: !roleState.isWhitelabelAdmin })
  const [updateAppConfig] = useMutation(UPDATE_APP_CONFIG)
  const [updateWhitelabelName] = useMutation(UPDATE_WHITELABEL)
  const [activeKey, setActiveKey] = useState<ConfigTab>('branding')
  const [fullscreen, setFullscreen] = useState(false)
  const containerRef = useRef<LegacyFullscreenElement>(null)
  const sectionHeadRef = useRef<HTMLElement>(null)
  const lastWhitelabelId = useRef<string | null>(null)
  const config: ConfigRecord = configData?.appConfig || EMPTY_RECORD
  const whitelabel: ConfigRecord = (targetId ? whitelabelData?.whitelabel : whitelabelData?.whitelabelCurrent) || EMPTY_RECORD
  const brandingForm = useForm<BrandingValues>({ schema: brandingSchema, initialValues: brandingInitialValues(EMPTY_RECORD, EMPTY_RECORD), onSubmit: () => undefined })
  const { reset: resetBranding } = brandingForm

  useEffect(() => {
    if (whitelabel.id && whitelabel.id !== lastWhitelabelId.current) {
      lastWhitelabelId.current = text(whitelabel.id)
      resetBranding(brandingInitialValues(whitelabel, config))
    }
  }, [whitelabel, config, resetBranding])
  useEffect(() => {
    if (roleState.isWhitelabelAdmin && currentWhitelabelData?.whitelabelCurrent?.id && targetId && targetId !== currentWhitelabelData.whitelabelCurrent.id) {
      notify.error('Access Denied: You can only manage your own whitelabel configuration.')
      navigate('/config/app-configuration', { replace: true })
    }
  }, [targetId, roleState.isWhitelabelAdmin, currentWhitelabelData, navigate])
  useEffect(() => { if (!tabVisible(activeKey, roleState)) setActiveKey('branding') }, [activeKey, roleState])
  useEffect(() => {
    const legacyDocument = document as LegacyFullscreenDocument
    const change = () => setFullscreen((document.fullscreenElement || legacyDocument.webkitFullscreenElement || legacyDocument.mozFullScreenElement || legacyDocument.msFullscreenElement) === containerRef.current)
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
    events.forEach((event) => document.addEventListener(event, change))
    return () => events.forEach((event) => document.removeEventListener(event, change))
  }, [])
  const toggleFullscreen = async () => {
    const element = containerRef.current
    const legacyDocument = document as LegacyFullscreenDocument
    try {
      if (fullscreen) {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (legacyDocument.webkitExitFullscreen) legacyDocument.webkitExitFullscreen()
        else if (legacyDocument.mozCancelFullScreen) legacyDocument.mozCancelFullScreen()
        else legacyDocument.msExitFullscreen?.()
        setFullscreen(false)
      } else if (element) {
        if (element.requestFullscreen) await element.requestFullscreen()
        else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen()
        else if (element.mozRequestFullScreen) element.mozRequestFullScreen()
        else if (element.msRequestFullscreen) element.msRequestFullscreen()
        else { notify.info('Fullscreen is not supported in this browser.'); return }
        setFullscreen(true)
      }
    } catch (error) { notify.error(errorMessage(error, 'Unable to change fullscreen mode')) }
  }
  const saveConfig = async (values: ConfigRecord) => {
    try {
      const result = await updateAppConfig({ variables: { input: values }, context: writeContext })
      if (!result.data?.updateAppConfig?.success) throw new Error(result.data?.updateAppConfig?.message || 'Failed to save settings')
      notify.success(result.data.updateAppConfig.message || 'Settings saved successfully')
      await refetch()
    } catch (error) { const message = errorMessage(error, 'Failed to save settings'); notify.error(message); throw new Error(message) }
  }
  const saveAppName = async (name: string) => {
    if (!whitelabel.id) { const message = 'Whitelabel not loaded yet'; notify.error(message); throw new Error(message) }
    try {
      const result = await updateWhitelabelName({ variables: { input: { id: whitelabel.id, name } }, context: writeContext })
      if (!result.data?.updateWhitelabel?.success) throw new Error(result.data?.updateWhitelabel?.message || 'Failed to save app name')
      notify.success('App name saved successfully')
      await refetchWhitelabel()
    } catch (error) { const message = errorMessage(error, 'Failed to save app name'); notify.error(message); throw new Error(message) }
  }
  const visibleGroups = CONFIG_MENU.map((group) => ({ ...group, items: group.items.filter((item) => tabVisible(item.key, roleState)) })).filter((group) => group.items.length)
  const activeGroup = visibleGroups.find((group) => group.items.some((item) => item.key === activeKey))
  const activeItem = activeGroup?.items.find((item) => item.key === activeKey)
  const sectionCount = visibleGroups.reduce((count, group) => count + group.items.length, 0)
  const selectSection = (key: ConfigTab, button: HTMLElement) => {
    setActiveKey(key)
    // the strip (narrow layout) brings the chosen chip into view; a section picked further down the
    // page starts at its title, not part-way through the new form
    button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    const head = sectionHeadRef.current
    if (head && head.getBoundingClientRect().top < 0) head.scrollIntoView?.({ block: 'start' })
  }
  const content = activeKey === 'branding' ? (
    <AppConfigurationBranding form={brandingForm} whitelabel={whitelabel} config={config} targetId={targetId} updateWhitelabelDocument={UPDATE_WHITELABEL} onSaveSuccess={async () => { await refetchWhitelabel() }} />
  ) : <AppConfigurationSection key={activeKey} tab={activeKey} config={config} whitelabel={whitelabel} onSave={saveConfig} onSaveAppName={saveAppName} />
  if (loading || whitelabelLoading) return <Page><PageHeader title="App Configuration" sub="Manage branding, modules, integrations and platform settings" /><Card><div className={styles.loading} role="status"><Spinner /> Loading configuration…</div></Card></Page>
  return (
    <div ref={containerRef} className={fullscreen ? styles.fullscreen : styles.page}>
      <Page>
        <PageHeader title="App Configuration" sub="Manage branding, modules, integrations and platform settings" actions={<Button aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} icon={fullscreen ? <IconArrowsMinimize size={16} stroke={strokeFor(16)} /> : <IconArrowsMaximize size={16} stroke={strokeFor(16)} />} onClick={() => void toggleFullscreen()} />} />
        {targetId && whitelabel.name && whitelabel.domain ? <Notice tone="info" title={`Managing: ${text(whitelabel.name)}`} className={styles.target} action={roleState.isSuperAdmin ? <Button onClick={() => navigate('/config/whitelabels')}>Back to Whitelabels</Button> : undefined}>{text(whitelabel.domain)}</Notice> : null}
        {configError || whitelabelError ? <Notice tone="error" title="Configuration could not be loaded" action={<Button onClick={() => { void refetch(); void refetchWhitelabel() }}>Retry</Button>}>{configError?.message || whitelabelError?.message}</Notice> : null}
        <div className={styles.workspace}>
          <aside className={styles.menuPanel} aria-labelledby="app-config-menu-title">
            <div className={styles.menuHead} data-ui-radius="panel-head">
              <h2 className={styles.menuTitle} id="app-config-menu-title">Settings</h2>
              <p className={styles.menuSub}>{sectionCount} sections</p>
            </div>
            <nav className={styles.menu} aria-label="App configuration sections">
              {visibleGroups.map((group) => (
                <div key={group.group} className={styles.menuGroup}>
                  <p className={styles.groupLabel}>{group.group}</p>
                  <ul className={styles.menuList}>
                    {group.items.map((item) => {
                      const ItemIcon = SECTION_META[item.key].icon
                      const current = activeKey === item.key
                      return (
                        <li key={item.key}>
                          <button type="button" className={clsx(styles.menuItem, current && styles.active)} data-current={current || undefined} aria-current={current ? 'true' : undefined} onClick={(event) => selectSection(item.key, event.currentTarget)}>
                            <ItemIcon className={styles.menuIcon} size={16} stroke={strokeFor(16)} aria-hidden="true" />
                            <span>{item.label}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
          <div className={styles.content}>
            <header className={styles.sectionHead} ref={sectionHeadRef}>
              {activeGroup ? <p className={styles.sectionEyebrow}>{activeGroup.group}</p> : null}
              <h2 className={styles.sectionTitle}>{activeItem?.label}</h2>
              <p className={styles.sectionSub}>{SECTION_META[activeKey].description}</p>
            </header>
            {UPDATE_GUARDED_TABS.includes(activeKey) ? <RBACGuard required={[{ domain: 'config.app', actions: ['update'] }]} fallback={<Notice tone="warn" title="You can't change these settings">Changing {activeItem?.label} needs the Update permission on application settings. Ask a Super Admin to add it to your role.</Notice>}>{content}</RBACGuard> : content}
          </div>
        </div>
      </Page>
    </div>
  )
}
