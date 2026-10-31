import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { Grid, Inline, Stack } from './LayoutPrimitives'
import styles from './LayoutPrimitives.module.css'

afterEach(cleanup)

describe('layout primitives', () => {
  test('Stack is a presentational column with the fixed gap vocabulary', () => {
    render(
      <Stack gap={20} data-testid="stack">
        <span>One</span>
        <span>Two</span>
      </Stack>,
    )

    const stack = screen.getByTestId('stack')
    assert.equal(stack.tagName, 'DIV')
    assert.equal(stack.hasAttribute('role'), false)
    assert.ok(stack.classList.contains(styles.stack))
    assert.ok(stack.classList.contains(styles.gap20))
  })

  test('Inline applies wrap, alignment and distribution without adding semantics', () => {
    render(
      <Inline gap={6} wrap align="baseline" justify="between" data-testid="inline">
        <button type="button">Cancel</button>
        <button type="button">Apply</button>
      </Inline>,
    )

    const inline = screen.getByTestId('inline')
    assert.equal(inline.hasAttribute('role'), false)
    assert.ok(inline.classList.contains(styles.gap6))
    assert.ok(inline.classList.contains(styles.wrap))
    assert.ok(inline.classList.contains(styles.alignBaseline))
    assert.ok(inline.classList.contains(styles.justifyBetween))
  })

  test('Grid records the mobile-first column choice at every fixed breakpoint', () => {
    render(
      <Grid cols={{ base: 1, md: 2, lg: 3, xl: 4 }} gap={16} data-testid="grid">
        <span>One</span>
      </Grid>,
    )

    const grid = screen.getByTestId('grid')
    assert.equal(grid.hasAttribute('role'), false)
    assert.ok(grid.classList.contains(styles.grid))
    assert.ok(grid.classList.contains(styles.gap16))
    assert.ok(grid.classList.contains(styles.base1))
    assert.ok(grid.classList.contains(styles.md2))
    assert.ok(grid.classList.contains(styles.lg3))
    assert.ok(grid.classList.contains(styles.xl4))
  })

  test('defaults use the mockup rhythm and preserve a caller class', () => {
    const { container } = render(
      <>
        <Stack className="caller-stack">Stack</Stack>
        <Inline className="caller-inline">Inline</Inline>
        <Grid cols={{ base: 1 }} className="caller-grid">
          Grid
        </Grid>
      </>,
    )

    const children = Array.from(container.children)
    assert.ok(children[0]?.classList.contains(styles.gap20))
    assert.ok(children[0]?.classList.contains('caller-stack'))
    assert.ok(children[1]?.classList.contains(styles.gap8))
    assert.ok(children[1]?.classList.contains(styles.alignCenter))
    assert.ok(children[1]?.classList.contains(styles.justifyStart))
    assert.ok(children[2]?.classList.contains(styles.gap20))
    assert.ok(children[2]?.classList.contains('caller-grid'))
  })
})
