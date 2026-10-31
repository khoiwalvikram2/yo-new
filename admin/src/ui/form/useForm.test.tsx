import { StrictMode, useState } from 'react'
import assert from 'node:assert/strict'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { z } from 'zod'
import { FORM_ERROR_PATH, useForm } from './useForm'

interface Values {
  title: string
  details: { code: string }
  tiers: Array<{ id: string; name: string }>
}

const schema = z.object({
  title: z.string().min(3, 'Title must contain at least 3 characters'),
  details: z.object({ code: z.string().min(1, 'Code is required') }),
  tiers: z.array(z.object({
    id: z.string(),
    name: z.string(),
  }).superRefine((tier, context) => {
    if (!tier.name) {
      context.addIssue({ code: 'custom', path: ['name'], message: `${tier.id} name is required` })
    }
  })),
})

const validValues: Values = {
  title: 'Welcome',
  details: { code: 'NEW' },
  tiers: [{ id: 'a', name: 'Bronze' }],
}

function renderValuesHook(initialValues: Values = validValues, onSubmit = vi.fn()) {
  return renderHook(() => useForm({ schema, initialValues, onSubmit }))
}

describe('useForm', () => {
  test('provides typed field bindings, immutable writes, touched state and structural dirty state', async () => {
    const initial = structuredClone(validValues)
    const { result } = renderValuesHook(initial)
    const originalDetails = result.current.values.details

    act(() => result.current.setValue('title', 'Changed'))
    assert.equal(result.current.getValue('title'), 'Changed')
    assert.equal(result.current.values.details, originalDetails)
    assert.equal(initial.title, 'Welcome')
    assert.equal(result.current.dirty, true)

    act(() => result.current.field('details.code').onBlur())
    await waitFor(() => assert.equal(result.current.touched['details.code'], true))

    act(() => result.current.setValue('title', 'Welcome'))
    assert.equal(result.current.dirty, false)
    assert.ok(result.current.field('title').id.endsWith('-title'))
    assert.equal(result.current.field('title').name, 'title')
  })

  test('imperative reads see sequential writes before React rerenders', () => {
    const { result } = renderValuesHook()
    const api = result.current

    act(() => {
      api.setValue('title', 'First')
      assert.equal(api.getValue('title'), 'First')
      api.setValues({ title: 'Second' })
      assert.equal(api.getValue('title'), 'Second')
    })
    assert.equal(result.current.values.title, 'Second')
  })

  test('validates on blur and revalidates on change only after that field has an error', async () => {
    const { result } = renderValuesHook({ ...validValues, title: '' })

    act(() => result.current.field('title').onChange('x'))
    await Promise.resolve()
    assert.equal(result.current.errors.title, undefined)

    act(() => result.current.field('title').onBlur())
    await waitFor(() => assert.equal(result.current.errors.title, 'Title must contain at least 3 characters'))
    assert.equal(result.current.errorAnnouncement, '1 form error found.')

    act(() => result.current.field('title').onChange('Valid title'))
    await waitFor(() => assert.equal(result.current.errors.title, undefined))
    assert.equal(result.current.errorCount, 0)
    assert.equal(result.current.errorAnnouncement, '')
  })

  test('runs the full async schema for partial validation but replaces only intersecting errors', async () => {
    const { result } = renderValuesHook({
      ...validValues,
      title: '',
      details: { code: '' },
    })

    let valid = true
    await act(async () => {
      valid = await result.current.validate(['title'])
    })
    assert.equal(valid, false)
    assert.deepEqual({ ...result.current.errors }, {
      title: 'Title must contain at least 3 characters',
    })

    await act(async () => {
      valid = await result.current.validate()
    })
    assert.equal(valid, false)
    assert.deepEqual({ ...result.current.errors }, {
      title: 'Title must contain at least 3 characters',
      'details.code': 'Code is required',
    })

    act(() => result.current.setValue('title', 'Now valid'))
    await waitFor(() => assert.equal(result.current.errors.title, undefined))
    assert.equal(result.current.errors['details.code'], 'Code is required')
  })

  test('keeps the first zod issue for each path', async () => {
    const duplicateSchema = z.object({ value: z.string() }).superRefine((_, context) => {
      context.addIssue({ code: 'custom', path: ['value'], message: 'First issue' })
      context.addIssue({ code: 'custom', path: ['value'], message: 'Second issue' })
    })
    const { result } = renderHook(() => useForm({
      schema: duplicateSchema,
      initialValues: { value: '' },
      onSubmit: vi.fn(),
    }))

    await act(async () => {
      await result.current.validate()
    })
    assert.equal(result.current.errors.value, 'First issue')
    assert.equal(result.current.errorCount, 1)
  })

  test('ignores an obsolete async validation result after values change', async () => {
    let releaseSlow: (() => void) | undefined
    const asyncSchema = z.object({ title: z.string() }).superRefine(async (value, context) => {
      if (value.title === 'slow') await new Promise<void>((resolve) => { releaseSlow = resolve })
      if (value.title !== 'good') {
        context.addIssue({ code: 'custom', path: ['title'], message: `Invalid ${value.title}` })
      }
    })
    const { result } = renderHook(() => useForm({
      schema: asyncSchema,
      initialValues: { title: 'slow' },
      onSubmit: vi.fn(),
    }))

    let oldValidation: Promise<boolean>
    act(() => { oldValidation = result.current.validate() })
    await waitFor(() => assert.equal(typeof releaseSlow, 'function'))

    act(() => result.current.setValue('title', 'good'))
    await act(async () => {
      assert.equal(await result.current.validate(), true)
    })
    assert.deepEqual({ ...result.current.errors }, {})

    await act(async () => {
      releaseSlow?.()
      assert.equal(await oldValidation!, false)
    })
    assert.deepEqual({ ...result.current.errors }, {})
  })

  test('uses the latest validation request when equal-value async runs finish out of order', async () => {
    let invocation = 0
    let releaseFirst: (() => void) | undefined
    const racingSchema = z.object({ title: z.string() }).superRefine(async (_, context) => {
      invocation += 1
      const currentInvocation = invocation
      if (currentInvocation === 1) await new Promise<void>((resolve) => { releaseFirst = resolve })
      context.addIssue({
        code: 'custom',
        path: ['title'],
        message: currentInvocation === 1 ? 'Obsolete error' : 'Latest error',
      })
    })
    const { result } = renderHook(() => useForm({
      schema: racingSchema,
      initialValues: { title: 'unchanged' },
      onSubmit: vi.fn(),
    }))

    let first: Promise<boolean>
    act(() => { first = result.current.validate(['title']) })
    await waitFor(() => assert.equal(typeof releaseFirst, 'function'))
    await act(async () => {
      assert.equal(await result.current.validate(['title']), false)
    })
    assert.equal(result.current.errors.title, 'Latest error')

    await act(async () => {
      releaseFirst?.()
      assert.equal(await first!, false)
    })
    assert.equal(result.current.errors.title, 'Latest error')
  })

  test('never applies a partial result from a stale cross-field snapshot', async () => {
    let releaseOldSnapshot: (() => void) | undefined
    const crossFieldSchema = z.object({
      title: z.string(),
      details: z.object({ code: z.string() }),
    }).superRefine(async (value, context) => {
      if (value.details.code === 'old') {
        await new Promise<void>((resolve) => { releaseOldSnapshot = resolve })
        context.addIssue({ code: 'custom', path: ['title'], message: 'Code makes title invalid' })
      }
    })
    const { result } = renderHook(() => useForm({
      schema: crossFieldSchema,
      initialValues: { title: 'Same title', details: { code: 'old' } },
      onSubmit: vi.fn(),
    }))

    let oldValidation: Promise<boolean>
    act(() => { oldValidation = result.current.validate(['title']) })
    await waitFor(() => assert.equal(typeof releaseOldSnapshot, 'function'))
    act(() => result.current.setValue('details.code', 'new'))
    await act(async () => {
      assert.equal(await result.current.validate(['title']), true)
    })

    await act(async () => {
      releaseOldSnapshot?.()
      assert.equal(await oldValidation!, false)
    })
    assert.equal(result.current.errors.title, undefined)
  })

  test('remains mounted across the StrictMode setup-cleanup-setup cycle', async () => {
    const { result } = renderHook(() => useForm({
      schema,
      initialValues: { ...validValues, title: '' },
      onSubmit: vi.fn(),
    }), { wrapper: StrictMode })

    await act(async () => {
      assert.equal(await result.current.validate(['title']), false)
    })
    assert.equal(result.current.errors.title, 'Title must contain at least 3 characters')

    act(() => result.current.setValue('title', 'Strictly valid'))
    await waitFor(() => assert.equal(result.current.errors.title, undefined))
  })

  test('generates collision-safe ids for nested and hyphenated keys', () => {
    const idSchema = z.object({
      details: z.object({ code: z.string() }),
      'details-code': z.string(),
    })
    const { result } = renderHook(() => useForm({
      schema: idSchema,
      initialValues: { details: { code: '' }, 'details-code': '' },
      onSubmit: vi.fn(),
    }))

    assert.notEqual(result.current.field('details.code').id, result.current.field('details-code').id)
    assert.ok(result.current.field('details.code').id.endsWith('-details.code'))
    assert.ok(result.current.field('details-code').id.endsWith('-details-code'))
  })

  test('deep-clones reset values and promotes an explicit reset value to the new baseline', () => {
    const initial = structuredClone(validValues)
    const replacement: Values = {
      title: 'Replacement',
      details: { code: 'R' },
      tiers: [{ id: 'b', name: 'Silver' }],
    }
    const { result } = renderValuesHook(initial)

    act(() => result.current.reset(replacement))
    replacement.details.code = 'mutated outside'
    assert.equal(result.current.values.details.code, 'R')
    assert.equal(result.current.dirty, false)

    act(() => result.current.setValue('details.code', 'Changed'))
    assert.equal(result.current.dirty, true)
    act(() => result.current.reset())
    assert.equal(result.current.values.details.code, 'R')
    assert.equal(result.current.dirty, false)
    assert.deepEqual(result.current.touched, {})
    assert.deepEqual(result.current.errors, {})
  })

  test('appends, removes and moves array items while remapping nested errors and touched metadata', async () => {
    const { result } = renderValuesHook({
      ...validValues,
      tiers: [
        { id: 'a', name: '' },
        { id: 'b', name: '' },
        { id: 'c', name: 'Gold' },
      ],
    })

    act(() => {
      result.current.field('tiers.0.name').onBlur()
      result.current.field('tiers.1.name').onBlur()
      result.current.field('tiers.2.name').onBlur()
    })
    await waitFor(() => assert.equal(result.current.errors['tiers.1.name'], 'b name is required'))

    act(() => result.current.array('tiers').remove(0))
    await waitFor(() => {
      assert.equal(result.current.errors['tiers.0.name'], 'b name is required')
      assert.equal(result.current.errors['tiers.1.name'], undefined)
    })
    assert.equal(result.current.touched['tiers.0.name'], true)
    assert.equal(result.current.touched['tiers.2.name'], undefined)

    act(() => result.current.array('tiers').move(0, 1))
    assert.equal(result.current.values.tiers[1]?.id, 'b')
    assert.equal(result.current.touched['tiers.1.name'], true)

    const appended = { id: 'd', name: 'Platinum' }
    act(() => result.current.array('tiers').append(appended))
    appended.name = 'mutated outside'
    assert.equal(result.current.values.tiers[2]?.name, 'Platinum')
  })

  test('composes sequential array actions before React has rerendered', () => {
    const { result } = renderValuesHook({
      ...validValues,
      tiers: [{ id: 'a', name: 'Bronze' }],
    })
    const controls = result.current.array('tiers')

    act(() => {
      controls.append({ id: 'b', name: 'Silver' })
      controls.append({ id: 'c', name: 'Gold' })
      controls.remove(0)
      controls.move(1, 0)
    })

    assert.deepEqual(result.current.values.tiers.map((tier) => tier.id), ['c', 'b'])
    const assertScalarPathRejected = (api: typeof result.current) => {
      // @ts-expect-error scalar fields cannot be used as form arrays
      api.array('title')
    }
    void assertScalarPathRejected
  })

  test('revalidates existing cross-field errors when an array changes', async () => {
    const totalsSchema = z.object({
      expectedTotal: z.number(),
      amounts: z.array(z.number()),
    }).superRefine((value, context) => {
      const actual = value.amounts.reduce((total, amount) => total + amount, 0)
      if (actual !== value.expectedTotal) {
        context.addIssue({ code: 'custom', path: ['expectedTotal'], message: 'Amounts must match total' })
      }
    })
    const { result } = renderHook(() => useForm({
      schema: totalsSchema,
      initialValues: { expectedTotal: 30, amounts: [10] },
      onSubmit: vi.fn(),
    }))

    await act(async () => {
      assert.equal(await result.current.validate(['expectedTotal']), false)
    })
    assert.equal(result.current.errors.expectedTotal, 'Amounts must match total')

    act(() => result.current.array('amounts').append(20))
    await waitFor(() => assert.equal(result.current.errors.expectedTotal, undefined))
  })

  test('provides a deterministic revision to re-announce equal-count failed submits', async () => {
    function Probe() {
      const form = useForm({
        schema,
        initialValues: { ...validValues, title: '' },
        onSubmit: vi.fn(),
      })
      const title = form.field('title')
      return (
        <form noValidate onSubmit={form.handleSubmit}>
          <label htmlFor={title.id}>Title</label>
          <input
            id={title.id}
            name={title.name}
            value={title.value}
            onChange={(event) => title.onChange(event.currentTarget.value)}
            onBlur={title.onBlur}
          />
          <div role="status" aria-live="polite" aria-atomic="true">
            <span key={form.errorAnnouncementRevision} data-testid="announcement">
              {form.errorAnnouncement}
            </span>
          </div>
          <output data-testid="announcement-revision">{form.errorAnnouncementRevision}</output>
          <button type="submit">Save</button>
        </form>
      )
    }

    render(<Probe />)
    fireEvent.blur(screen.getByRole('textbox', { name: 'Title' }))
    await waitFor(() => assert.equal(screen.getByTestId('announcement').textContent, '1 form error found.'))
    const blurAnnouncement = screen.getByTestId('announcement')
    assert.equal(screen.getByTestId('announcement-revision').textContent, '0')

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
    fireEvent.submit(form)
    await waitFor(() => assert.equal(screen.getByTestId('announcement-revision').textContent, '1'))
    const firstSubmitAnnouncement = screen.getByTestId('announcement')
    assert.notEqual(firstSubmitAnnouncement, blurAnnouncement)
    assert.equal(firstSubmitAnnouncement.textContent, '1 form error found.')

    fireEvent.submit(form)
    await waitFor(() => assert.equal(screen.getByTestId('announcement-revision').textContent, '2'))
    assert.notEqual(screen.getByTestId('announcement'), firstSubmitAnnouncement)
    assert.equal(screen.getByTestId('announcement').textContent, '1 form error found.')
  })

  test('retries submit validation until the latest value generation is current', async () => {
    const releases: Array<() => void> = []
    let validationRun = 0
    const slowSchema = z.object({ value: z.string().min(1) }).superRefine(async () => {
      validationRun += 1
      if (validationRun <= 2) {
        await new Promise<void>((resolve) => { releases[validationRun - 1] = resolve })
      }
    })
    const submit = vi.fn()

    function Probe() {
      const form = useForm({
        schema: slowSchema,
        initialValues: { value: 'first' },
        onSubmit: submit,
      })
      const value = form.field('value')
      return (
        <form noValidate onSubmit={form.handleSubmit}>
          <label htmlFor={value.id}>Value</label>
          <input
            id={value.id}
            name={value.name}
            value={value.value}
            onChange={(event) => value.onChange(event.currentTarget.value)}
          />
          <output data-testid="slow-submitting">{String(form.submitting)}</output>
          <button type="submit">Save latest</button>
        </form>
      )
    }

    render(<Probe />)
    const input = screen.getByRole('textbox', { name: 'Value' })
    const form = screen.getByRole('button', { name: 'Save latest' }).closest('form')!
    fireEvent.submit(form)
    await waitFor(() => assert.equal(typeof releases[0], 'function'))
    assert.equal(screen.getByTestId('slow-submitting').textContent, 'true')

    fireEvent.change(input, { target: { value: 'second' } })
    act(() => releases[0]?.())
    await waitFor(() => assert.equal(typeof releases[1], 'function'))

    fireEvent.change(input, { target: { value: 'third' } })
    act(() => releases[1]?.())
    await waitFor(() => assert.equal(submit.mock.calls.length, 1))
    assert.deepEqual(submit.mock.calls[0]?.[0], { value: 'third' })
    await waitFor(() => assert.equal(screen.getByTestId('slow-submitting').textContent, 'false'))
    assert.equal(validationRun, 3)
  })

  test('focuses the first invalid native field, exposes the live count, and submits only once', async () => {
    let finishSubmit: (() => void) | undefined
    const submit = vi.fn(() => new Promise<void>((resolve) => { finishSubmit = resolve }))

    function Probe() {
      const submitSchema = z.object({
        details: z.object({ code: z.string().min(1, 'Code is required') }),
        title: z.string().min(3, 'Title is required'),
        tiers: z.array(z.object({ id: z.string(), name: z.string() })),
      }).superRefine((value, context) => {
        if (!value.title || !value.details.code) {
          context.addIssue({ code: 'custom', path: [], message: 'Review the form' })
        }
      })
      const form = useForm({
        schema: submitSchema,
        initialValues: { ...validValues, title: '', details: { code: '' } },
        onSubmit: submit,
      })
      const title = form.field('title')
      const code = form.field('details.code')
      return (
        <form noValidate onSubmit={form.handleSubmit}>
          <label htmlFor={title.id}>Title</label>
          <input
            id={title.id}
            name={title.name}
            value={title.value}
            onChange={(event) => title.onChange(event.currentTarget.value)}
            onBlur={title.onBlur}
          />
          <label htmlFor={code.id}>Code</label>
          <input
            id={code.id}
            name={code.name}
            value={code.value}
            onChange={(event) => code.onChange(event.currentTarget.value)}
            onBlur={code.onBlur}
          />
          <div data-testid="live-errors" role="status" aria-live="polite" aria-atomic="true">
            {form.errorAnnouncement}
          </div>
          <output data-testid="submitting">{String(form.submitting)}</output>
          <button type="submit">Save</button>
        </form>
      )
    }

    render(<Probe />)
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
    await waitFor(() => assert.equal(screen.getByTestId('live-errors').textContent, '3 form errors found.'))
    // Schema issue order is Code, Title, then a root issue. Focus still follows DOM order and ignores `_form`.
    assert.equal(document.activeElement, screen.getByRole('textbox', { name: 'Title' }))
    assert.equal(submit.mock.calls.length, 0)

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Valid title' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'READY' } })
    await waitFor(() => assert.equal(screen.getByTestId('live-errors').textContent, ''))

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => assert.equal(submit.mock.calls.length, 1))
    assert.equal(screen.getByTestId('submitting').textContent, 'true')
    act(() => finishSubmit?.())
    await waitFor(() => assert.equal(screen.getByTestId('submitting').textContent, 'false'))
  })

  test('turns a rejected submit into a visible form error and allows a retry', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('Server rejected this bonus'))
      .mockResolvedValueOnce(undefined)

    function Probe() {
      const form = useForm({ schema, initialValues: validValues, onSubmit: submit })
      const [, renderAgain] = useState(0)
      return (
        <form noValidate onSubmit={form.handleSubmit}>
          <input name="title" value={form.values.title} readOnly />
          <output data-testid="form-error">{form.formError}</output>
          <output data-testid="error-key">{form.errors[FORM_ERROR_PATH]}</output>
          <output data-testid="submitting">{String(form.submitting)}</output>
          <button type="submit" onClick={() => renderAgain((value) => value + 1)}>Save</button>
        </form>
      )
    }

    render(<Probe />)
    const button = screen.getByRole('button', { name: 'Save' })
    fireEvent.submit(button.closest('form')!)
    await waitFor(() => assert.equal(screen.getByTestId('form-error').textContent, 'Server rejected this bonus'))
    assert.equal(screen.getByTestId('error-key').textContent, 'Server rejected this bonus')
    assert.equal(screen.getByTestId('submitting').textContent, 'false')

    fireEvent.submit(button.closest('form')!)
    await waitFor(() => assert.equal(submit.mock.calls.length, 2))
    await waitFor(() => assert.equal(screen.getByTestId('submitting').textContent, 'false'))
  })
})
