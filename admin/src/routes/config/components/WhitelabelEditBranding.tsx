import { useState } from 'react'
import { IconPhoto } from '@tabler/icons-react'
import { compressImageToDataUrl } from '@/shared/utils/imageCompression'
import { notify } from '@/shared/services/notification'
import { Card } from '@/ui/components/Card'
import { FileField } from '@/ui/components/FileField'
import { Notice } from '@/ui/components/Notice'
import { strokeFor } from '@/ui/components/icons'
import type { FormApi } from '@/ui/form/useForm'
import { isImageFile, type WhitelabelWizardValues } from '../whitelabelWizardModel'
import styles from '../WhitelabelWizardPage.module.css'

interface WhitelabelEditBrandingProps {
  form: FormApi<WhitelabelWizardValues>
}

type AssetKind = 'logo' | 'favicon'

export default function WhitelabelEditBranding({ form }: WhitelabelEditBrandingProps) {
  const [processing, setProcessing] = useState<AssetKind | null>(null)

  const processFile = async (kind: AssetKind, file: File) => {
    if (!isImageFile(file)) {
      notify.error('You can only upload image files!')
      return
    }

    try {
      setProcessing(kind)
      const dataUri = await compressImageToDataUrl(file, kind)
      form.setValue(kind === 'logo' ? 'logoUrl' : 'faviconUrl', dataUri)
      notify.success(kind === 'logo' ? 'Logo ready to save' : 'Favicon ready to save')
    } catch (error: unknown) {
      const message = error instanceof Error && error.message
        ? error.message
        : kind === 'logo'
          ? 'Failed to process logo'
          : 'Failed to process favicon'
      // Keep the previously selected asset. The legacy preview vanished after a failed replacement
      // while its old value was still submitted, which made the review misleading.
      notify.error(message)
    } finally {
      setProcessing(null)
    }
  }

  // FileField clears its input after every pick, so choosing the same file again still reports a change.
  const onFiles = (kind: AssetKind) => ([file]: File[]) => {
    if (file) void processFile(kind, file)
  }

  const logo = form.values.logoUrl
  const favicon = form.values.faviconUrl
  const logoBusy = processing === 'logo'
  const faviconBusy = processing === 'favicon'

  return (
    <Card
      title="Branding Assets"
      sub="Add a logo and browser icon. Both assets are compressed before they are saved."
    >
      <div className={styles.brandingGrid}>
        <FileField
          label="Logo Upload"
          inputLabel="Choose logo image"
          accept="image/*"
          help="Upload the whitelabel logo image. Upload logo image (PNG, JPG, SVG)."
          busy={logoBusy}
          busyLabel="Processing..."
          fit="contain"
          files={logo ? [{
            id: 'logo',
            name: 'Logo',
            meta: '✓ Ready to save',
            src: logo,
            alt: 'Logo preview',
            zoomable: true,
            dialogTitle: 'Logo preview',
            removeLabel: 'Remove',
            onRemove: () => form.setValue('logoUrl', null),
          }] : []}
          onFiles={onFiles('logo')}
        />

        <FileField
          label="Favicon Upload"
          inputLabel="Choose favicon image"
          accept="image/*"
          help="Upload the whitelabel favicon image. Upload favicon image (ICO, PNG)."
          busy={faviconBusy}
          busyLabel="Processing..."
          fit="contain"
          files={favicon ? [{
            id: 'favicon',
            name: 'Favicon',
            meta: '✓ Ready to save',
            src: favicon,
            alt: 'Favicon preview',
            zoomable: true,
            dialogTitle: 'Favicon preview',
            removeLabel: 'Remove',
            onRemove: () => form.setValue('faviconUrl', null),
          }] : []}
          onFiles={onFiles('favicon')}
        />
      </div>

      <Notice
        className={styles.uploadGuidelines}
        tone="neutral"
        icon={<IconPhoto size={18} stroke={strokeFor(18)} />}
        title="Upload Guidelines"
      >
        <span className={styles.noticeLines}>
          <span>• Logo: PNG, JPG, or SVG format</span>
          <span>• Recommended logo size: 200x60px or similar aspect ratio</span>
          <span>• Favicon: ICO, PNG format</span>
          <span>• Images are automatically compressed and stored securely</span>
        </span>
      </Notice>
    </Card>
  )
}
