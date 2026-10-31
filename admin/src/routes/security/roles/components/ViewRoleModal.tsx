import { IconShieldHalf } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { StatusPill } from '@/ui/components/StatusPill'
import { permissionCount } from '../rolesManagementModel'
import type { GraphQLRole } from '../types'
import styles from '../RolesManagementPage.module.css'

interface ViewRoleModalProps {
  open: boolean
  role: GraphQLRole | null
  onClose: () => void
}

/* The legacy read-only permissions view on the kit Dialog (420px; legacy 450): title "Permissions" with the
   role's name under it, the two counts, then every permission with its actions. The dialog body scrolls,
   so the legacy 350px inner scroller is gone. */
export function ViewRoleModal({ open, role, onClose }: ViewRoleModalProps) {
  if (!role) return null

  const totalPerms = permissionCount(role)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Permissions"
      description={role.name}
      size="sm"
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className={styles.view}>
        <p className={styles.viewCounts}>
          <span>
            Perms: <strong className={styles.viewCount}>{totalPerms}</strong>
          </span>
          <span>
            Domains: <strong className={styles.viewCount}>{role.permissions.length}</strong>
          </span>
        </p>

        {role.permissions.length > 0 ? (
          <ul className={styles.viewList}>
            {role.permissions.map((permission, idx) => (
              <li key={idx} className={styles.viewItem}>
                <div className={styles.viewItemHead}>
                  <h3 className={styles.viewDomain}>{permission.domain}</h3>
                  <StatusPill tone="info">
                    {permission.actions.length}
                    <span className={styles.srOnly}> actions</span>
                  </StatusPill>
                </div>
                <ul className={styles.viewActions}>
                  {permission.actions.map((action, actionIdx) => (
                    <li key={actionIdx}>
                      <StatusPill tone="neutral">{action}</StatusPill>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}

        {(!role.permissions || role.permissions.length === 0) && (
          <EmptyState
            inset="none"
            icon={<IconShieldHalf size={20} stroke={strokeFor(20)} />}
            title="No permissions assigned"
          />
        )}
      </div>
    </Dialog>
  )
}

