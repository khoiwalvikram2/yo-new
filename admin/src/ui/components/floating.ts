import type { HTMLAttributes, ReactElement, Ref } from 'react'

/**
 * A single trigger element for Tooltip / Popover / Menu.
 * The element MUST forward its ref to a DOM node and spread unknown props
 * (event handlers, aria-*) onto it, or positioning and interactions break.
 * React 18: an element's ref lives on `element.ref`, not `element.props.ref`.
 */
export type FloatingTrigger = ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }> & {
  ref?: Ref<HTMLElement>
}

/**
 * Floating layers are portaled to <body>, so they would inherit <html data-theme>.
 * Inherit that root palette live, including System-mode changes while a layer stays open.
 * Only copy an explicit closer region, so a locally themed editor/dialog keeps its override.
 */
export function getFloatingTheme(reference: Element | null): 'light' | 'dark' | undefined {
  const region = reference?.closest('[data-theme]')
  if (typeof document !== 'undefined' && region === document.documentElement) return undefined
  const value = region?.getAttribute('data-theme')
  return value === 'light' || value === 'dark' ? value : undefined
}
