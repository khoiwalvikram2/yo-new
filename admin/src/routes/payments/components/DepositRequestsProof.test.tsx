/**
 * A deposit's payment proof, read on demand (owner 2026-11-04: screenshots are base64 in the database, up to 2 MB each).
 * - The list and the live feed ask only whether a request has a proof (hasProof), never for the screenshot.
 * - The review drawer reads its request's screenshot when it shows it, and a row's button reads that one request's
 *   when it is pressed: one depositRequestProof per request opened, none per page.
 * - Loading and failure keep the box of what they stand in for, and a failure can be retried.
 */
import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { print } from 'graphql'
import {
  ADMIN_DEPOSIT_REQUESTS,
  DEPOSIT_REQUEST_PROOF,
  DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION,
} from '@/lib/graphql/deposits'
import { DepositRequestsProofButton, DepositRequestsProofPreview } from './DepositRequestsProof'
import styles from './DepositRequestsProof.module.css'

const SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let sent: string[] = []

/** Answers depositRequestProof with each answer in turn (an Error fails that request), recording the ids asked. */
function proofMocks(...answers: Array<string | null | Error>): MockedResponse[] {
  return answers.map((answer) => ({
    request: { query: DEPOSIT_REQUEST_PROOF },
    variableMatcher: (variables: Record<string, unknown>) => {
      sent.push(String(variables.id))
      return true
    },
    ...(answer instanceof Error ? { error: answer } : { result: { data: { depositRequestProof: answer } } }),
  }))
}

afterEach(() => {
  sent = []
  document.body.removeAttribute('inert')
})

describe('the deposit documents', () => {
  test('the list and the live feed ask whether there is a proof, never for the screenshot', () => {
    for (const document of [ADMIN_DEPOSIT_REQUESTS, DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION]) {
      const text = print(document)
      assert.match(text, /\bhasProof\b/)
      assert.doesNotMatch(text, /\bproofUrl\b|depositRequestProof/)
    }
    assert.match(print(DEPOSIT_REQUEST_PROOF), /depositRequestProof\(id: \$id\)/)
  })
})

describe('DepositRequestsProofPreview (the review drawer)', () => {
  test('reads its request\'s proof as it shows, holding the thumbnail box, then opens it full size', async () => {
    render(
      <MockedProvider mocks={proofMocks(SCREENSHOT)}>
        <DepositRequestsProofPreview requestId="7" />
      </MockedProvider>,
    )
    // A status takes no name from its text, so its label is read as text (as the table's loading state is).
    const loading = screen.getByRole('status')
    assert.equal(loading.textContent, 'Loading payment proof')
    assert.ok(loading.classList.contains(styles.thumbBox), 'the loading state takes the thumbnail box')

    const thumbnail = await screen.findByRole('button', { name: 'View payment proof: Payment proof' })
    assert.deepEqual(sent, ['7'])
    assert.ok(thumbnail.closest(`.${styles.preview}`), 'the thumbnail sits in a block, as the loading box did')
    assert.equal(screen.queryByRole('status'), null)

    fireEvent.click(thumbnail)
    const dialog = await screen.findByRole('dialog', { name: 'Payment proof' })
    assert.equal((within(dialog).getByRole('img', { name: 'Payment proof' }) as HTMLImageElement).getAttribute('src'), SCREENSHOT)
    assert.deepEqual(sent, ['7'], 'opening it full size reads nothing more')
  })

  test('a proof that could not be read says so in the same box, and Try again reads it again', async () => {
    render(
      <MockedProvider mocks={proofMocks(new Error('Network down'), SCREENSHOT)}>
        <DepositRequestsProofPreview requestId="8" />
      </MockedProvider>,
    )
    const problem = await screen.findByRole('alert')
    assert.match(problem.textContent ?? '', /could not be loaded/)
    assert.ok(problem.classList.contains(styles.thumbBox), 'the failure keeps the thumbnail box')

    fireEvent.click(within(problem).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'View payment proof: Payment proof' })
    assert.deepEqual(sent, ['8', '8'])
    assert.equal(screen.queryByRole('alert'), null)
  })

  test('no proof after all (the server answered none) is the kit placeholder, with nothing to open', async () => {
    render(
      <MockedProvider mocks={proofMocks(null)}>
        <DepositRequestsProofPreview requestId="9" />
      </MockedProvider>,
    )
    const placeholder = await screen.findByRole('img', { name: 'Payment proof' })
    assert.ok(placeholder.hasAttribute('data-image-placeholder'))
    assert.equal(screen.queryByRole('button'), null)
  })

  test('its loading and failed box is the size of the kit thumbnail it stands in for', () => {
    // ImagePreview's thumbnail: a 168x104 image, 3px padding and a 1px border, so 176x112; its missing state says so.
    const kit = readFileSync(join(process.cwd(), 'src', 'ui', 'components', 'ImagePreview.module.css'), 'utf8')
    const ours = readFileSync(join(process.cwd(), 'src', 'routes', 'payments', 'components', 'DepositRequestsProof.module.css'), 'utf8')
    const rule = (css: string, selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)))
    assert.match(rule(kit, '.preview .missing'), /width: 176px;[\s\S]*height: 112px;/)
    assert.match(rule(ours, '.thumbBox'), /box-sizing: border-box;[\s\S]*width: 176px;[\s\S]*height: 112px;/)
  })
})

describe('DepositRequestsProofButton (a list row)', () => {
  test('reads nothing until pressed, then that one request\'s proof, full size in a frame that keeps its height', async () => {
    render(
      // MockedProvider renders a single child. The answer is held back a little, so the loading frame can be seen.
      <MockedProvider mocks={proofMocks(SCREENSHOT).map((mock) => ({ ...mock, delay: 300 }))}>
        <div>
          <DepositRequestsProofButton requestId="41" />
          <DepositRequestsProofButton requestId="42" />
          <DepositRequestsProofButton requestId="43" />
        </div>
      </MockedProvider>,
    )
    const trigger = screen.getByRole('button', { name: 'View payment proof for deposit 42' })
    assert.equal(trigger.textContent?.trim(), 'View')
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(sent, [], 'a page of rows read no screenshot')

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Payment proof - #42' })
    const frame = dialog.querySelector(`.${styles.fullFrame}`)
    assert.ok(frame, 'the full view has its fixed-height frame')
    assert.equal(within(frame as HTMLElement).getByRole('status').textContent, 'Loading payment proof')

    const image = await within(dialog).findByRole('img', { name: 'Payment proof' }) as HTMLImageElement
    assert.equal(image.getAttribute('src'), SCREENSHOT)
    assert.ok(frame?.contains(image), 'the image lands in the same frame the loading state held')
    assert.ok(image.classList.contains(styles.fullImage))
    assert.deepEqual(sent, ['42'])

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closes'))
    await waitFor(() => assert.ok(document.activeElement === trigger, 'focus returns to the row'))
  })
})
