import { useId, useRef, type RefObject } from 'react'
import { IconPlus, IconShieldLock, IconTrash } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import { TextField } from '@/ui/components/TextField'
import { useForm } from '@/ui/form/useForm'
import {
  EMPTY_IP,
  IP_HELP,
  IP_PLACEHOLDER,
  ipSchema,
  type AdminUser,
  type IpAllowlistEntry,
  type IpValues,
} from '../supportAdminsModel'
import styles from '../SupportAdminsPage.module.css'
import { DrawerFooter, DrawerIntro, DrawerSection } from './DrawerParts'

interface IpAllowlistDrawerProps {
  open: boolean
  admin: AdminUser
  entries: readonly IpAllowlistEntry[]
  loading: boolean
  adding: boolean
  formatDate: (value: string) => string
  formatTime: (value: string) => string
  restoreFocusTo: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onAdd: (values: IpValues) => Promise<void>
  onRemove: (entry: IpAllowlistEntry) => Promise<void>
}

export function IpAllowlistDrawer({
  open,
  admin,
  entries,
  loading,
  adding,
  formatDate,
  formatTime,
  restoreFocusTo,
  onOpenChange,
  onAdd,
  onRemove,
}: IpAllowlistDrawerProps) {
  const formId = `support-admin-ip-${useId().replace(/:/g, '')}`
  const cidrRef = useRef<HTMLInputElement>(null)
  const form = useForm<IpValues>({
    schema: ipSchema,
    initialValues: EMPTY_IP,
    onSubmit: async (values) => {
      await onAdd(values)
      form.reset(EMPTY_IP)
    },
  })

  const columns: DataTableColumn<IpAllowlistEntry>[] = [
    { key: 'cidr', header: 'IP/CIDR', cell: (entry) => entry.cidr, emphasis: 'key' },
    {
      key: 'createdAt',
      header: 'Added',
      cell: (entry) => entry.createdAt ? (
        <span className={styles.stack}>
          <span>{formatDate(entry.createdAt)}</span>
          <span className={styles.secondary}>{formatTime(entry.createdAt)}</span>
        </span>
      ) : <span className={styles.dim}>—</span>,
    },
  ]
  const busy = adding || form.submitting

  return (
    <Drawer
      title="IP Allowlist - Administrator"
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={cidrRef}
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <DrawerFooter hint="When IP allowlist entries exist, only requests from those IPs will be allowed">
          <Button size="sm" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
        </DrawerFooter>
      )}
    >
      <div className={styles.drawerBody}>
        <DrawerIntro
          icon={<IconShieldLock size={17} stroke={strokeFor(17)} />}
          title={admin.name}
          sub="IP allowlist management"
          tag="IP Allowlist"
          tagTone="info"
        />
        <DrawerSection title="Add IP Address">
          <div className={styles.ipBox}>
            <Form
              id={formId}
              className={styles.ipForm}
              onSubmit={form.handleSubmit}
              errorAnnouncement={form.errorAnnouncement}
              errorAnnouncementRevision={form.errorAnnouncementRevision}
            >
              <TextField
                {...form.field('cidr')}
                ref={cidrRef}
                className={styles.ipField}
                label="IP Address or CIDR"
                placeholder={IP_PLACEHOLDER}
                help={IP_HELP}
                required
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                icon={<IconPlus size={15} stroke={strokeFor(15)} />}
                loading={busy}
              >
                Add IP
              </Button>
            </Form>
          </div>
        </DrawerSection>
        <DrawerSection title="Allowed IPs">
          <div className={styles.tableBox}>
            <DataTable
              columns={columns}
              rows={entries}
              rowKey={(entry) => entry.id}
              label="Allowed IP addresses"
              state={loading ? 'loading' : 'ready'}
              density="compact"
              pagination={false}
              empty={<EmptyState title="No IP addresses in allowlist" inset="none" />}
              rowActions={(entry) => ({
                primary: (
                  <Button
                    variant="danger"
                    size="xs"
                    icon={<IconTrash size={14} stroke={strokeFor(14)} />}
                    onClick={() => void onRemove(entry)}
                  >
                    Remove
                  </Button>
                ),
              })}
            />
          </div>
        </DrawerSection>
      </div>
    </Drawer>
  )
}
