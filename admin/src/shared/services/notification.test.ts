/**
 * 36 files and 172 call sites reach the toasts through this module, so its contract is the thing that
 * must not drift: the same names, the same arguments, and the same timings antd gave them (seconds
 * there, milliseconds here). What changed on purpose is where they appear and how they are announced,
 * which the Toaster owns.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { toast } from '@/ui/components/toast'
import { messageService, notificationService, notify, toastService } from './notification'

vi.mock('antd', () => {
  throw new Error('notification service must not load antd')
})

beforeEach(() => {
  toast.clear()
})

const only = () => {
  const queued = toast.peek()
  assert.equal(queued.length, 1)
  return queued[0]
}

describe('messageService', () => {
  test('keeps antd\'s 3-second default and its tones', () => {
    messageService.success('Saved')
    assert.equal(only().duration, 3000)
    assert.equal(only().tone, 'ok')

    toast.clear()
    messageService.error('Failed')
    assert.equal(only().tone, 'error')

    toast.clear()
    messageService.warning('Careful')
    assert.equal(only().tone, 'warn')

    toast.clear()
    messageService.info('Heads up')
    assert.equal(only().tone, 'info')
  })

  test('takes a duration in seconds, as antd did', () => {
    messageService.success('Saved', 8)
    assert.equal(only().duration, 8000)
  })

  test('loading stays until it is replaced, as antd\'s did', () => {
    messageService.loading('Working')
    const record = only()
    assert.equal(record.busy, true)
    assert.equal(record.duration, 0)
  })

  test('toastService is still the same object', () => {
    assert.equal(toastService, messageService)
  })
})

describe('notificationService', () => {
  test('keeps the 4.5-second default and carries title and message', () => {
    notificationService.error({ title: 'Export Failed', message: 'Disk full' })
    const record = only()
    assert.equal(record.title, 'Export Failed')
    assert.equal(record.message, 'Disk full')
    assert.equal(record.tone, 'error')
    assert.equal(record.duration, 4500)
  })

  test('a caller duration is still in seconds', () => {
    notificationService.info({ title: 'FYI', message: 'Nothing to do', duration: 2 })
    assert.equal(only().duration, 2000)
  })
})

describe('notify', () => {
  test('defaults its titles exactly as before', () => {
    notify.success('All done')
    assert.equal(only().title, 'Success')
    assert.equal(only().message, 'All done')

    toast.clear()
    notify.error('Broke')
    assert.equal(only().title, 'Error')

    toast.clear()
    notify.warning('Careful')
    assert.equal(only().title, 'Warning')

    toast.clear()
    notify.info('Heads up')
    assert.equal(only().title, 'Info')

    toast.clear()
    notify.success('All done', 'Saved')
    assert.equal(only().title, 'Saved')
  })

  test('loading returns the closer it always returned', () => {
    const close = notify.loading('Uploading')
    assert.equal(only().busy, true)
    close()
    assert.equal(toast.peek().length, 0)
  })
})
