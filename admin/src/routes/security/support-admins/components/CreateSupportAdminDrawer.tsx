import { useId, useRef, type RefObject } from 'react'
import { IconCheck, IconUserPlus } from '@tabler/icons-react'
import type { Role } from '@/state/rbacStore'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { Form } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Notice } from '@/ui/components/Notice'
import { PasswordField } from '@/ui/components/PasswordField'
import { TextField } from '@/ui/components/TextField'
import { useForm } from '@/ui/form/useForm'
import {
  EMPTY_CREATE_ADMIN,
  createAdminSchema,
  roleOptions,
  type CreateAdminValues,
} from '../supportAdminsModel'
import styles from '../SupportAdminsPage.module.css'
import { DrawerFooter, DrawerIntro } from './DrawerParts'

interface CreateSupportAdminDrawerProps {
  open: boolean
  roles: readonly Role[]
  creating: boolean
  restoreFocusTo: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onSubmit: (values: CreateAdminValues) => Promise<void>
}

export function CreateSupportAdminDrawer({
  open,
  roles,
  creating,
  restoreFocusTo,
  onOpenChange,
  onSubmit,
}: CreateSupportAdminDrawerProps) {
  const formId = `create-support-admin-${useId().replace(/:/g, '')}`
  const nameRef = useRef<HTMLInputElement>(null)
  const form = useForm<CreateAdminValues>({
    schema: createAdminSchema,
    initialValues: EMPTY_CREATE_ADMIN,
    onSubmit,
  })
  const busy = creating || form.submitting

  return (
    <Drawer
      title="Create Support Admin"
      size="md"
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      initialFocus={nameRef}
      dismissible={!busy}
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <DrawerFooter hint="Create a new support admin user with assigned roles">
          <Button size="sm" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            size="sm"
            icon={<IconCheck size={15} stroke={strokeFor(15)} />}
            loading={busy}
          >
            Create
          </Button>
        </DrawerFooter>
      )}
    >
      <div className={styles.drawerBody}>
        <DrawerIntro
          icon={<IconUserPlus size={17} stroke={strokeFor(17)} />}
          title="New Support Admin"
          sub="Create administrator account"
          tag="Create"
          tagTone="ok"
        />
        <Form
          id={formId}
          className={styles.createForm}
          onSubmit={form.handleSubmit}
          errorAnnouncement={form.errorAnnouncement}
          errorAnnouncementRevision={form.errorAnnouncementRevision}
        >
          {form.formError ? <Notice tone="error" live="assertive">{form.formError}</Notice> : null}
          {form.errorAnnouncementRevision > 0 && form.errorCount > 0 ? (
            <Notice tone="error" title="Administrator not created">
              {`Fix ${form.errorCount} highlighted ${form.errorCount === 1 ? 'field' : 'fields'} and submit again.`}
            </Notice>
          ) : null}
          <div className={styles.formGrid}>
            <TextField
              {...form.field('name')}
              ref={nameRef}
              label="Name"
              placeholder="Enter name"
              required
            />
            <TextField
              {...form.field('email')}
              label="Email"
              type="email"
              placeholder="Enter email"
              required
            />
            <PasswordField
              {...form.field('password')}
              label="Password"
              placeholder="Enter password"
              autoComplete="new-password"
              required
            />
            <TextField
              {...form.field('phone')}
              label="Phone (Optional)"
              type="tel"
              placeholder="Enter phone number"
            />
            <MultiSelect
              {...form.field('roleIds')}
              className={styles.formWide}
              label="Roles"
              placeholder="Select roles"
              options={roleOptions(roles)}
              clearable
              required
            />
          </div>
        </Form>
      </div>
    </Drawer>
  )
}
