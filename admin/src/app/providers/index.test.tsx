import { test } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AppProviders } from './index'
import { confirm } from '../../ui/components/confirm'

test('mounts routed content, the toast regions and the global confirmation host', async () => {
  render(
    <AppProviders>
      <p>Current route</p>
    </AppProviders>,
  )

  assert.ok(screen.getByText('Current route'))
  assert.ok(screen.getByRole('status', { name: 'Notifications' }))
  assert.ok(screen.getByRole('alert', { name: 'Errors' }))

  let result!: Promise<boolean>
  act(() => {
    result = confirm({ title: 'Global confirmation' })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  assert.equal(await result, false)
})
