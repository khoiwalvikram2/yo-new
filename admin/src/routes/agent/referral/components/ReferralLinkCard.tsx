import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconLink,
  IconQrcode,
  IconShare,
} from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Dialog } from '@/ui/components/Dialog'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { qrCodeUrl, referralQrFilename } from '../agentReferralModel'
import styles from '../AgentReferralLinkPage.module.css'

interface ReferralLinkCardProps {
  link: string
  code: string
  isActive: boolean
}

type CopyTarget = 'link' | 'code' | null

export default function ReferralLinkCard({ link, code, isActive }: ReferralLinkCardProps) {
  const fieldId = useId()
  const [copied, setCopied] = useState<CopyTarget>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const qrUrl = qrCodeUrl(link)

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const copyValue = async (value: string, target: Exclude<CopyTarget, null>) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API is unavailable')
      await navigator.clipboard.writeText(value)
      setCopied(target)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(null), 2000)
      toast({
        title: target === 'link' ? 'Link Copied' : 'Code Copied',
        message: target === 'link' ? 'Referral link copied to clipboard' : 'Referral code copied to clipboard',
        tone: 'ok',
        duration: 2000,
      })
    } catch {
      toast({
        title: 'Copy Failed',
        message: 'Unable to copy. Select the value and copy it manually.',
        tone: 'error',
        duration: 3000,
      })
    }
  }

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on this platform',
          text: 'Check out this amazing platform!',
          url: link,
        })
        return
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      }
    }
    await copyValue(link, 'link')
  }

  const fetchQrFile = async () => {
    const response = await fetch(qrUrl)
    if (!response.ok) throw new Error('QR request failed')
    return response.blob()
  }

  const downloadQr = async () => {
    try {
      setDownloading(true)
      const blob = await fetchQrFile()
      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = referralQrFilename(code)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(objectUrl)
      toast({
        title: 'QR Code Downloaded',
        message: 'QR code image saved successfully',
        tone: 'ok',
        duration: 2000,
      })
    } catch {
      toast({
        title: 'Download Failed',
        message: 'Failed to download QR code. Please try again.',
        tone: 'error',
        duration: 3000,
      })
    } finally {
      setDownloading(false)
    }
  }

  const shareQr = async () => {
    try {
      const blob = await fetchQrFile()
      const file = new File([blob], referralQrFilename(code), { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'My Referral QR Code',
          text: 'Scan this QR code to join!',
          files: [file],
        })
        return
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
    }
    await downloadQr()
  }

  return (
    <>
      <Card
        title="Your Referral Link"
        sub="Share one secure link or code with prospective players"
        tools={
          <StatusPill status={isActive ? 'active' : 'disabled'}>
            {isActive ? 'Active' : 'Inactive'}
          </StatusPill>
        }
        className={styles.linkCard}
      >
        <div className={styles.linkIntro}>
          <span className={styles.linkGlyph} aria-hidden="true">
            <IconLink size={20} stroke={strokeFor(20)} />
          </span>
          <p>Players who register with this link or code are automatically linked to your account.</p>
        </div>

        <div className={styles.fields}>
          <div className={styles.valueField}>
            <label htmlFor={`${fieldId}-link`}>Referral Link</label>
            <div className={styles.valueControl}>
              <input id={`${fieldId}-link`} value={link} readOnly spellCheck={false} />
              <Button
                variant="primary"
                icon={copied === 'link'
                  ? <IconCheck size={16} stroke={strokeFor(16)} />
                  : <IconCopy size={16} stroke={strokeFor(16)} />}
                onClick={() => void copyValue(link, 'link')}
              >
                {copied === 'link' ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
          </div>

          <div className={styles.valueField}>
            <label htmlFor={`${fieldId}-code`}>Referral Code</label>
            <div className={styles.valueControl}>
              <input
                id={`${fieldId}-code`}
                className={styles.codeInput}
                value={code}
                readOnly
                spellCheck={false}
              />
              <Button
                icon={copied === 'code'
                  ? <IconCheck size={16} stroke={strokeFor(16)} />
                  : <IconCopy size={16} stroke={strokeFor(16)} />}
                onClick={() => void copyValue(code, 'code')}
              >
                {copied === 'code' ? 'Copied!' : 'Copy Code'}
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.cardActions}>
          <Button
            variant="primary"
            icon={<IconShare size={16} stroke={strokeFor(16)} />}
            onClick={() => void shareLink()}
          >
            Share Link
          </Button>
          <Button
            icon={<IconQrcode size={16} stroke={strokeFor(16)} />}
            onClick={() => setQrOpen(true)}
          >
            View QR Code
          </Button>
        </div>
      </Card>

      <Dialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        title="QR Code"
        description="Scan this QR code to share your referral link"
        size="sm"
        footer={
          <div className={styles.dialogActions}>
            <Button
              variant="primary"
              icon={<IconDownload size={16} stroke={strokeFor(16)} />}
              loading={downloading}
              onClick={() => void downloadQr()}
            >
              Download QR Code
            </Button>
            <Button
              icon={<IconShare size={16} stroke={strokeFor(16)} />}
              onClick={() => void shareQr()}
            >
              Share QR Code
            </Button>
          </div>
        }
      >
        <div className={styles.qrFrame}>
          <img src={qrUrl} alt={`Referral QR code for ${code}`} />
        </div>
      </Dialog>
    </>
  )
}
