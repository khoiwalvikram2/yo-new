import { useSyncExternalStore } from 'react'

/**
 * The player chat's state for launchers outside the widget: on the user panel's desktop the chat opens from the
 * utility rail, not the floating button (owner 2026-11-02). PlayerChatWidget writes it; a launcher reads it and opens
 * or closes the chat with the `support-chat:open` / `support-chat:close` window events (detail.opener gets focus back).
 * A launcher marks itself data-support-chat-launcher so a click on it is not taken as a click outside the chat.
 */
export type SupportLauncherState = { available: boolean; unread: number; open: boolean }

let state: SupportLauncherState = { available: false, unread: 0, open: false }
const listeners = new Set<() => void>()

export function setSupportLauncherState(next: SupportLauncherState) {
  if (next.available === state.available && next.unread === state.unread && next.open === state.open) return
  state = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useSupportLauncherState() {
  return useSyncExternalStore(subscribe, () => state, () => state)
}
