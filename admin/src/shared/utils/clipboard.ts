import { toast } from '@/ui/components/toast'

/**
 * Copy text to clipboard and show success/error notification.
 * Use for all copy operations so feedback is consistent and errors are handled.
 */
export async function copyToClipboard(
  text: string,
  successMessage: string = 'Copied to clipboard'
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast({ message: successMessage, tone: 'ok', duration: 2000 })
    return true
  } catch (err) {
    const description = err instanceof Error ? err.message : 'Clipboard access denied'
    toast({ title: 'Copy failed', message: description, tone: 'error', duration: 4500 })
    return false
  }
}
