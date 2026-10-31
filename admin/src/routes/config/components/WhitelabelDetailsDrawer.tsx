import { useState, type MutableRefObject } from 'react'
import { IconPalette, IconPercentage, IconPhoto, IconWorld } from '@tabler/icons-react'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Drawer } from '@/ui/components/Drawer'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  rateBand,
  themeSwatches,
  whitelabelStatusLabel,
  whitelabelStatusTone,
  type Whitelabel,
} from '../whitelabelsListModel'
import styles from '../WhitelabelsListPage.module.css'

interface WhitelabelDetailsDrawerProps {
  whitelabel: Whitelabel
  open: boolean
  onClose: () => void
  restoreFocusTo?: MutableRefObject<HTMLElement | null>
}

function AssetImage({
  src,
  alt,
  kind,
}: {
  src: string | null | undefined
  alt: string
  kind: 'logo' | 'favicon'
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className={styles.assetMissing}>Not uploaded</span>
  return (
    <span className={kind === 'logo' ? styles.logoFrame : styles.faviconFrame}>
      <img src={src} alt={alt} decoding="async" onError={() => setFailed(true)} />
    </span>
  )
}

function HeaderMark({ whitelabel }: { whitelabel: Whitelabel }) {
  const [failed, setFailed] = useState(false)
  if (!whitelabel.faviconUrl || failed) return <Avatar name={whitelabel.name} size={34} hue="auto" />
  return (
    <span className={styles.drawerFavicon}>
      <img
        src={whitelabel.faviconUrl}
        alt={`${whitelabel.name} favicon`}
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

function colorInputValue(value: string): string | null {
  if (/^#[\da-f]{6}$/i.test(value)) return value
  if (/^#[\da-f]{3}$/i.test(value)) {
    const [red, green, blue] = value.slice(1)
    return `#${red}${red}${green}${green}${blue}${blue}`
  }
  return null
}

export function WhitelabelDetailsDrawer({
  whitelabel,
  open,
  onClose,
  restoreFocusTo,
}: WhitelabelDetailsDrawerProps) {
  return (
    <Drawer
      title="Whitelabel Details"
      sub="Partner identity, revenue sharing and theme configuration"
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      size="md"
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <div className={styles.drawerFooter}>
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
    >
      <div className={styles.drawerBody}>
        <div className={styles.drawerIntro}>
          <HeaderMark key={whitelabel.faviconUrl || whitelabel.id} whitelabel={whitelabel} />
          <span className={styles.drawerIntroCopy}>
            <strong>{whitelabel.name}</strong>
            <span>{whitelabel.domain}</span>
          </span>
          <StatusPill tone={whitelabelStatusTone(whitelabel.status)}>
            {whitelabelStatusLabel(whitelabel.status)}
          </StatusPill>
        </div>

        <DescriptionList.Section title="Basic Information">
          <DescriptionList
            items={[
              { term: 'Whitelabel ID', value: <code className={styles.code}>{whitelabel.id}</code> },
              { term: 'Name', value: whitelabel.name },
              { term: 'Primary Domain', value: <code className={styles.code}>{whitelabel.domain}</code> },
            ]}
          />
        </DescriptionList.Section>

        <DescriptionList.Section title="Branding Assets">
          <div className={styles.assets}>
            <div className={styles.asset}>
              <span className={styles.assetLabel}>
                <IconPhoto size={14} stroke={strokeFor(14)} aria-hidden="true" /> Logo
              </span>
              <AssetImage src={whitelabel.logoUrl} alt={`${whitelabel.name} logo`} kind="logo" />
            </div>
            <div className={styles.asset}>
              <span className={styles.assetLabel}>
                <IconWorld size={14} stroke={strokeFor(14)} aria-hidden="true" /> Favicon
              </span>
              <AssetImage src={whitelabel.faviconUrl} alt={`${whitelabel.name} favicon`} kind="favicon" />
            </div>
          </div>
        </DescriptionList.Section>

        {whitelabel.sharingRates?.length ? (
          <DescriptionList.Section title="Revenue Share Configuration">
            <div className={styles.rateList}>
              {whitelabel.sharingRates.map((rate) => {
                const band = rateBand(rate.rate)
                return (
                  <div className={styles.rateRow} key={rate.domain}>
                    <span className={styles.rateIcon} aria-hidden="true">
                      <IconPercentage size={15} stroke={strokeFor(15)} />
                    </span>
                    <span className={styles.rateCopy}>
                      <span className={styles.rateTopline}>
                        <span>
                          <span className={styles.rateLabel}>{rate.domain} Share</span>
                          <strong>{rate.rate.toFixed(2)}%</strong>
                        </span>
                        <StatusPill tone={band.tone}>{band.label}</StatusPill>
                      </span>
                      <Meter value={rate.rate} tone={band.meterTone} />
                    </span>
                  </div>
                )
              })}
            </div>
          </DescriptionList.Section>
        ) : null}

        {whitelabel.theme ? (
          <DescriptionList.Section title="Theme Configuration">
            <div className={styles.swatches}>
              {themeSwatches(whitelabel.theme).map((item) => {
                const color = colorInputValue(item.value)
                return (
                  <div className={styles.swatch} key={item.label}>
                    <span className={styles.swatchInput} aria-hidden="true">
                      {color ? (
                        <input type="color" value={color} readOnly tabIndex={-1} />
                      ) : (
                        <IconPalette size={15} stroke={strokeFor(15)} />
                      )}
                    </span>
                    <span className={styles.swatchCopy}>
                      <strong>{item.label}</strong>
                      <code>{item.value}</code>
                    </span>
                  </div>
                )
              })}
            </div>
          </DescriptionList.Section>
        ) : (
          <div className={styles.themeEmpty}>
            <IconPalette size={16} stroke={strokeFor(16)} aria-hidden="true" />
            Theme configuration has not been provided.
          </div>
        )}
      </div>
    </Drawer>
  )
}
