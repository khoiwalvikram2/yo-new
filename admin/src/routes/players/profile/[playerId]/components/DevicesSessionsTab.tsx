import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'

/**
 * Devices and sessions are not tracked yet. A player's login is a JWT and nothing records a device or a session, so
 * the playerDevices and playerSessions queries have nothing to read and always answer an empty list. This tab showed
 * those lists as "0 active sessions" and "No devices found", which reads as "none" rather than "not tracked", beside
 * Terminate buttons that could not work. Logins, with their IP address and device, are in the Activity Log; Force
 * Logout ends every session a player holds.
 */
export function DevicesSessionsTab() {
  return <Card title="Devices & Sessions">
    <EmptyState title="Not tracked yet" description="A player's devices and sessions are not recorded yet, so none can be listed or ended here. Each login, with its IP address and device, is in the Activity Log. To end every session this player has, use Force Logout in the player's actions on the Players list." />
  </Card>
}

