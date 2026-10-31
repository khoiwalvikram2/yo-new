import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'

const kitConfirm = vi.hoisted(() => vi.fn())

vi.mock('@/ui/components/confirm', () => ({ confirm: kitConfirm }))
vi.mock('antd', () => {
  throw new Error('confirmation service must not load antd')
})

import { confirmationService } from './confirmation'

beforeEach(() => {
  kitConfirm.mockReset()
  kitConfirm.mockResolvedValue(true)
})

describe('confirmationService', () => {
  test('preserves its public signatures and routes confirm through the kit', async () => {
    assert.equal(confirmationService.confirm.length, 2)
    assert.equal(confirmationService.delete.length, 0)
    assert.equal(confirmationService.save.length, 0)

    assert.equal(await confirmationService.confirm('Publish?', 'Customers will see the change.'), true)
    assert.deepEqual(kitConfirm.mock.calls[0], [{
      title: 'Publish?',
      description: 'Customers will see the change.',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
    }])
  })

  test('marks deletion as danger and keeps its custom item wording', async () => {
    await confirmationService.delete('API key')

    assert.deepEqual(kitConfirm.mock.calls[0], [{
      title: 'Delete Confirmation',
      description: 'Are you sure you want to delete this API key? This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    }])
  })

  test('keeps the save prompt and result', async () => {
    kitConfirm.mockResolvedValue(false)

    assert.equal(await confirmationService.save(), false)
    assert.deepEqual(kitConfirm.mock.calls[0], [{
      title: 'Save Changes',
      description: 'You have unsaved changes. Do you want to save them before leaving?',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
    }])
  })
})
