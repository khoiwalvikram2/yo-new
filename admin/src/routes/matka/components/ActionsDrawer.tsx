import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconBan,
  IconCalendar,
  IconCopy,
  IconEdit,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react'
import type { Matka } from '@/modules/matka/types'
import { useCloneMatka, useDeleteMatka, useSetMatkaStatus } from '@/modules/matka'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Drawer } from '@/ui/components/Drawer'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { cloneVariables, matkaErrorText, matkaStatus, statusLabel, statusTone, type MatkaRecord } from '../matkaManagementModel'
import styles from '../ManagementPage.module.css'

interface ActionsDrawerProps {
  matka: Matka | null
  open: boolean
  onClose: () => void
  onRefetch: () => void
}

export function ActionsDrawer({ matka, open, onClose, onRefetch }: ActionsDrawerProps) {
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const navigate = useNavigate()
  const { formatDateTime } = useFormatDate()
  const [deleteMatka, { loading: deleting }] = useDeleteMatka()
  const [setMatkaStatus, { loading: changingStatus }] = useSetMatkaStatus()
  const [cloneMatka, { loading: cloning }] = useCloneMatka()
  const record = matka as MatkaRecord | null

  const closeDelete = () => {
    setDeleteModalVisible(false)
    setDeleteReason('')
  }

  // The error link toasts nothing for a mutation, and the notification link reports only a successful
  // { success, message } payload, so a refusal is reported here (the drawer stays open).
  const handleStatusChange = async (newStatus: 'active' | 'inactive' | 'suspend') => {
    if (!record) return
    try {
      // The legacy drawer used lower-case strings even though the shared operation declares the
      // upper-case MatkaStatus enum. The migration restores the intended action at that API boundary.
      await setMatkaStatus({ variables: { id: record.id, toStatus: newStatus.toUpperCase() as never } })
      onRefetch()
      onClose()
    } catch (error) {
      toast({ message: matkaErrorText(error, 'The matka status could not be changed.'), tone: 'error' })
    }
  }

  const handleClone = async () => {
    if (!record) return
    try {
      await cloneMatka({ variables: cloneVariables(record) })
      onRefetch()
      onClose()
    } catch (error) {
      toast({ message: matkaErrorText(error, 'The matka could not be cloned.'), tone: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!record || !deleteReason.trim()) return
    try {
      await deleteMatka({ variables: { id: record.id, reason: deleteReason } })
    } catch (error) {
      toast({ message: matkaErrorText(error, 'The matka could not be deleted.'), tone: 'error' })
      return
    }
    // deleteMatka answers a bare Boolean, which the notification link has nothing to say about.
    toast({ message: `${record.name} deleted`, tone: 'ok' })
    closeDelete()
    onRefetch()
    onClose()
  }

  // The API sends the upper-case MatkaStatus enum; compared as typed in lower case, every button showed.
  const currentStatus = matkaStatus(record?.status)

  const formatDate = (value?: string) => {
    if (!value) return '—'
    try {
      return formatDateTime(value, 'MMM d, yyyy HH:mm')
    } catch {
      return value
    }
  }

  const drawerTitle = record?.name || 'Matka actions'
  const drawerSub = record ? `${record.code} • Priority ${record.priority ?? 0}` : undefined

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={drawerTitle}
        sub={drawerSub}
        size="md"
      >
        {record ? (
          <div className={styles.drawerBody}>
            <div className={styles.drawerHero}>
              <div className={styles.drawerIdentity}>
                <span className={styles.drawerIcon} aria-hidden="true">
                  <IconCalendar size={18} stroke={strokeFor(18)} />
                </span>
                <div className={styles.drawerHeading}>
                  <span className={styles.drawerTitle}>{record.name}</span>
                  <span className={styles.drawerSub}>{record.code}</span>
                </div>
              </div>
              <StatusPill status={statusLabel(record.status)} tone={statusTone(record.status)}>
                {statusLabel(record.status)}
              </StatusPill>
            </div>

            <section className={styles.drawerSection}>
              <h3 className={styles.sectionTitle}>Basic Information</h3>
              <div className={styles.factsPanel}>
                <dl className={styles.factsList}>
                  <div className={styles.fact}><dt>Description</dt><dd>{record.description || '—'}</dd></div>
                  <div className={styles.fact}><dt>Timezone</dt><dd>{record.timezone}</dd></div>
                  <div className={styles.fact}><dt>Created</dt><dd>{formatDate(record.createdAt)}</dd></div>
                  <div className={styles.fact}><dt>Last Updated</dt><dd>{formatDate(record.updatedAt)}</dd></div>
                </dl>
              </div>
            </section>

            <section className={styles.drawerSection}>
              <h3 className={styles.sectionTitle}>Quick Actions</h3>
              <div className={styles.drawerStack}>
                <Button
                  block
                  icon={<IconEdit size={16} stroke={strokeFor(16)} />}
                  onClick={() => {
                    navigate(`/matka/edit/${record.id}`)
                    onClose()
                  }}
                >
                  Edit Matka
                </Button>
                <Button
                  block
                  loading={cloning}
                  icon={<IconCopy size={16} stroke={strokeFor(16)} />}
                  onClick={() => void handleClone()}
                >
                  Clone Matka
                </Button>
                <Button
                  block
                  variant="danger"
                  icon={<IconTrash size={16} stroke={strokeFor(16)} />}
                  onClick={() => setDeleteModalVisible(true)}
                >
                  Delete Matka
                </Button>
              </div>
            </section>

            <section className={styles.drawerSection}>
              <h3 className={styles.sectionTitle}>Status Management</h3>
              <div className={styles.drawerStack}>
                {currentStatus !== 'ACTIVE' ? (
                  <Button
                    block
                    loading={changingStatus}
                    icon={<IconPlayerPlay size={16} stroke={strokeFor(16)} />}
                    onClick={() => void handleStatusChange('active')}
                  >
                    Activate
                  </Button>
                ) : null}
                {currentStatus !== 'INACTIVE' ? (
                  <Button
                    block
                    loading={changingStatus}
                    icon={<IconPlayerPause size={16} stroke={strokeFor(16)} />}
                    onClick={() => void handleStatusChange('inactive')}
                  >
                    Deactivate
                  </Button>
                ) : null}
                {currentStatus !== 'SUSPEND' ? (
                  <Button
                    block
                    variant="danger"
                    loading={changingStatus}
                    icon={<IconBan size={16} stroke={strokeFor(16)} />}
                    onClick={() => void handleStatusChange('suspend')}
                  >
                    Suspend
                  </Button>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>

      <Dialog
        open={deleteModalVisible}
        onOpenChange={(next) => {
          if (!next) closeDelete()
        }}
        title="Delete Matka"
        role="alertdialog"
        size="sm"
        footer={(
          <div className={styles.drawerActions}>
            <Button onClick={closeDelete}>Cancel</Button>
            <Button
              variant="dangerSolid"
              loading={deleting}
              disabled={!deleteReason.trim()}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </div>
        )}
      >
        <Textarea
          label="Please provide a reason for deleting this matka:"
          value={deleteReason}
          onChange={setDeleteReason}
          rows={4}
          placeholder="Enter deletion reason..."
          required
        />
      </Dialog>
    </>
  )
}
