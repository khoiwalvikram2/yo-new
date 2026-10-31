import { useId, useMemo, useRef, useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import { IconCircle, IconCircleCheck, IconLock } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAuthStore } from '@/shared/core/authStore'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Divider } from '@/ui/components/Divider'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { PasswordField } from '@/ui/components/PasswordField'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { useForm, type FormApi } from '@/ui/form/useForm'
import {
  CHANGE_PASSWORD_INITIAL_VALUES,
  PASSWORD_CHANGED_TITLE,
  PASSWORD_CHANGE_FAILED_TITLE,
  changePasswordSummary,
  changePasswordVariables,
  createChangePasswordSchema,
  graphQLErrorMessage,
  newPasswordPlaceholder,
  passwordChangedMessage,
  passwordMinLength,
  passwordRequirements,
  readChangePasswordResult,
  type ChangePasswordData,
  type ChangePasswordValues,
} from './changePasswordModel'
import styles from './ChangePasswordModal.module.css'

const CHANGE_ADMIN_PASSWORD = gql`
  mutation ChangeAdminPassword($currentPassword: String!, $newPassword: String!) {
    changeAdminPassword(currentPassword: $currentPassword, newPassword: $newPassword) {
      success
      message
    }
  }
`

const CHANGE_AGENT_PASSWORD = gql`
  mutation ChangeAgentPassword($currentPassword: String!, $newPassword: String!) {
    agents {
      changeAgentPassword(currentPassword: $currentPassword, newPassword: $newPassword) {
        success
        message
      }
    }
  }
`

/* antd's notification lasted 4.5 seconds; the kit toast keeps that timing, as notification.ts does for
   every converted call. Named change (D4): the toasts sit bottom-centre, not top-right. */
const NOTIFICATION_DURATION_MS = 4500

interface ChangePasswordModalProps {
  open: boolean
  onClose: () => void
}

/* The legacy LockOutlined prefix in each field; decorative, the label names the field. */
const LOCK_ICON = <IconLock size={16} stroke={strokeFor(16)} aria-hidden="true" />

/**
 * The signed-in admin's or agent's own password change, opened from the topbar profile menu
 * (shell/topbar/ProfileMenu.tsx). Kit Dialog + useForm + PasswordField; the mutation, its variables
 * and context, every rule and message, the toasts and the reset-on-close are the legacy antd modal's.
 */
export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const isAgent = useAuthStore(s => s.isAgent())
  const [changePassword, { loading }] = useMutation(
    isAgent ? CHANGE_AGENT_PASSWORD : CHANGE_ADMIN_PASSWORD,
    {
      context: { uiToast: 'notification' },
    }
  )

  const minLength = passwordMinLength(isAgent)
  const schema = useMemo(() => createChangePasswordSchema(minLength), [minLength])
  const formId = `change-password-${useId().replace(/:/g, '')}`
  const requirementsId = `${formId}-requirements`
  // Focus starts in Current Password (the kit Dialog would otherwise start on its close button).
  const currentPasswordRef = useRef<HTMLInputElement>(null)
  /* useForm's reset() keeps its failed-submit revision, and this component stays mounted while the dialog
     is closed, so each reset records the revision reached; the summary needs a failed submit beyond it. */
  const [summaryFloor, setSummaryFloor] = useState(0)

  /* Runs only after the form validated (useForm's submit). A false success leaves the dialog open with
     nothing raised here, as before (the Apollo notification link reports the server's message); a
     failure is reported only when it carries a GraphQL error, as before. */
  const submitPassword = async (values: ChangePasswordValues) => {
    try {
      const result = await changePassword({
        variables: changePasswordVariables(values),
      })

      // For agents, check nested result
      const { success, message } = readChangePasswordResult(
        result.data as ChangePasswordData | null | undefined,
        isAgent,
      )

      if (success) {
        setSummaryFloor(form.errorAnnouncementRevision)
        form.reset()
        onClose()
        toast({
          title: PASSWORD_CHANGED_TITLE,
          message: passwordChangedMessage(message),
          tone: 'ok',
          duration: NOTIFICATION_DURATION_MS,
        })
      }
    } catch (error: unknown) {
      const failure = graphQLErrorMessage(error)
      if (failure) {
        toast({
          title: PASSWORD_CHANGE_FAILED_TITLE,
          message: failure,
          tone: 'error',
          duration: NOTIFICATION_DURATION_MS,
        })
      }
    }
  }

  const form: FormApi<ChangePasswordValues> = useForm<ChangePasswordValues>({
    schema,
    initialValues: CHANGE_PASSWORD_INITIAL_VALUES,
    onSubmit: submitPassword,
  })

  // Every way out (Cancel, the close button, Escape, a scrim click) clears the three fields, as before.
  const handleCancel = () => {
    setSummaryFloor(form.errorAnnouncementRevision)
    form.reset()
    onClose()
  }

  const currentPassword = form.field('currentPassword')
  const newPassword = form.field('newPassword')
  const confirmPassword = form.field('confirmPassword')
  const showRequirements = form.values.newPassword !== ''
  const requirements = passwordRequirements(form.values.newPassword, minLength)
  const busy = loading || form.submitting
  // BEYOND-LEGACY: antd only outlined the fields. After a failed submit in this opening this says why, and
  // its count follows the remaining errors; focus goes to the first invalid field and the form announces
  // the count.
  const showSummary = form.errorAnnouncementRevision > summaryFloor && form.errorCount > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleCancel()
      }}
      title="Change Password"
      description="Update your account password for better security"
      size="md"
      initialFocus={currentPasswordRef}
      footer={(
        <>
          <Button onClick={handleCancel}>Cancel</Button>
          {/* In the dialog's footer, outside the form element, so it names its form. */}
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            Update Password
          </Button>
        </>
      )}
    >
      <Form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        {showSummary ? (
          <Notice tone="error" title="Password not changed">
            {changePasswordSummary(form.errorCount)}
          </Notice>
        ) : null}

        {/* Required is announced (aria-required) but not marked: the legacy form hid required marks. */}
        <PasswordField
          {...currentPassword}
          ref={currentPasswordRef}
          label="Current Password"
          autoComplete="current-password"
          placeholder="Enter your current password"
          prefix={LOCK_ICON}
          aria-required
        />

        <Divider />

        <div className={styles.newPassword}>
          <PasswordField
            {...newPassword}
            label="New Password"
            autoComplete="new-password"
            placeholder={newPasswordPlaceholder(minLength)}
            prefix={LOCK_ICON}
            aria-required
            aria-describedby={showRequirements ? requirementsId : undefined}
            onChange={(value) => {
              // Once any field shows an error, setValue re-checks New Password and every errored field,
              // Confirm among them when it shows one. A narrower Confirm check after that would mark the
              // run stale (useForm's latest-wins rule) and freeze New Password's own error, so Confirm is
              // checked here only when that run does not already cover it.
              const confirmCovered = form.errors.confirmPassword !== undefined
              newPassword.onChange(value)
              // antd re-validated Confirm New Password whenever New Password changed once Confirm had
              // been edited (dependencies); here, once Confirm holds anything.
              if (!confirmCovered && form.getValue('confirmPassword')) void form.validate(['confirmPassword'])
            }}
          />

          {showRequirements ? (
            <div className={styles.requirements} id={requirementsId}>
              <p className={styles.requirementsTitle}>Password Requirements:</p>
              <ul className={styles.requirementList}>
                {requirements.map((requirement) => (
                  <li
                    key={requirement.key}
                    className={clsx(styles.requirement, requirement.met && styles.met)}
                  >
                    <span className={styles.requirementIcon} aria-hidden="true">
                      {requirement.met ? (
                        <IconCircleCheck size={14} stroke={strokeFor(14)} />
                      ) : (
                        <IconCircle size={14} stroke={strokeFor(14)} />
                      )}
                    </span>
                    <span>{requirement.text}</span>
                    <span className={styles.visuallyHidden}>{requirement.met ? ', met' : ', not met'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <PasswordField
          {...confirmPassword}
          label="Confirm New Password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          prefix={LOCK_ICON}
          aria-required
        />
      </Form>
    </Dialog>
  )
}

