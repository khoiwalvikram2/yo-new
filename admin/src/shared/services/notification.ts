import { toast } from '@/ui/components/toast'
import type { NotificationConfig } from '../core/interfaces'

/* Every toast in the app comes through here, and since page migration C (W0) they are the kit's, not
 * antd's. The exports and their signatures are unchanged, so the 36 files and 172 call sites that use
 * them did not have to change.
 *
 * Named behaviour changes, all from the mockup's own toast (M:1225-1241, M:2845-2871):
 *   - they appear bottom-centre, not top-right;
 *   - at most three show at once, the oldest dropping when a fourth arrives;
 *   - a failure is announced assertively, everything else politely;
 *   - the timer pauses while the pointer or the keyboard is in the stack.
 *
 * antd measured durations in seconds and defaulted to 3 for a message and 4.5 for a notification; the
 * kit measures milliseconds, so the conversions below keep the old timings exactly. `duration: 0` kept
 * its meaning: stay until dismissed.
 *
 * The confirm dialogs moved to ./confirmation so this file no longer imports antd. */

const MESSAGE_DEFAULT_SECONDS = 3
const NOTIFICATION_DEFAULT_SECONDS = 4.5

/** antd took seconds; 0 means "until dismissed", which the kit spells as duration 0. */
const ms = (seconds: number | undefined, fallback: number): number =>
  seconds === undefined ? fallback * 1000 : seconds * 1000

// Message Service
export const messageService = {
  success: (content: string, duration?: number) => {
    toast({ message: content, tone: 'ok', duration: ms(duration, MESSAGE_DEFAULT_SECONDS) })
  },

  error: (content: string, duration?: number) => {
    toast({ message: content, tone: 'error', duration: ms(duration, MESSAGE_DEFAULT_SECONDS) })
  },

  warning: (content: string, duration?: number) => {
    toast({ message: content, tone: 'warn', duration: ms(duration, MESSAGE_DEFAULT_SECONDS) })
  },

  info: (content: string, duration?: number) => {
    toast({ message: content, tone: 'info', duration: ms(duration, MESSAGE_DEFAULT_SECONDS) })
  },

  loading: (content: string, duration?: number) => {
    /* antd's message.loading stayed until it was replaced when no duration was given; `busy` does the
       same and shows the kit spinner in the glyph slot. */
    toast({ message: content, busy: true, duration: duration === undefined ? 0 : duration * 1000 })
  },
}

// Notification Service
export const notificationService = {
  success: (config: Omit<NotificationConfig, 'type'>) => {
    toast({
      title: config.title,
      message: config.message,
      tone: 'ok',
      duration: ms(config.duration, NOTIFICATION_DEFAULT_SECONDS),
    })
  },

  error: (config: Omit<NotificationConfig, 'type'>) => {
    toast({
      title: config.title,
      message: config.message,
      tone: 'error',
      duration: ms(config.duration, NOTIFICATION_DEFAULT_SECONDS),
    })
  },

  warning: (config: Omit<NotificationConfig, 'type'>) => {
    toast({
      title: config.title,
      message: config.message,
      tone: 'warn',
      duration: ms(config.duration, NOTIFICATION_DEFAULT_SECONDS),
    })
  },

  info: (config: Omit<NotificationConfig, 'type'>) => {
    toast({
      title: config.title,
      message: config.message,
      tone: 'info',
      duration: ms(config.duration, NOTIFICATION_DEFAULT_SECONDS),
    })
  },
}

// Toast Service (alias for message service)
export const toastService = messageService

// Unified notifier for easy global reuse in features
export const notify = {
  success: (description: string, title: string = 'Success') =>
    notificationService.success({ title, message: description }),
  error: (description: string, title: string = 'Error') =>
    notificationService.error({ title, message: description }),
  warning: (description: string, title: string = 'Warning') =>
    notificationService.warning({ title, message: description }),
  info: (description: string, title: string = 'Info') =>
    notificationService.info({ title, message: description }),
  /** Progress feedback. Returns the closer, as it always did. */
  loading: (content: string, duration: number = 0): (() => void) => {
    const id = toast({ message: content, busy: true, duration: duration * 1000 })
    return () => toast.dismiss(id)
  },
}
