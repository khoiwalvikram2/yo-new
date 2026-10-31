/* The rules of the Change Password dialog (shared/ui/ChangePasswordModal.tsx), kept free of React so they
 * are tested on their own. Every message and threshold is the legacy antd Form.Item's, word for word.
 *
 * Nothing here logs, stores or copies a password: the functions take the typed values and return
 * booleans, messages or the two mutation variables. */
import { z } from 'zod'

export interface ChangePasswordValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export type ChangePasswordField = keyof ChangePasswordValues

export const CHANGE_PASSWORD_INITIAL_VALUES: ChangePasswordValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

/** Agents may choose a 6-character password; admins need 8 (legacy `isAgent ? 6 : 8`). */
export function passwordMinLength(isAgent: boolean): number {
  return isAgent ? 6 : 8
}

export function newPasswordPlaceholder(minLength: number): string {
  return `Enter new password (min ${minLength} characters)`
}

export interface PasswordRequirement {
  key: 'length' | 'upper' | 'lower' | 'number'
  met: boolean
  text: string
}

/** The checklist shown under New Password while it holds anything. Advisory only, as before: only the
 *  length is enforced on submit. The length test is the legacy `newPassword.length` (UTF-16 units). */
export function passwordRequirements(newPassword: string, minLength: number): PasswordRequirement[] {
  return [
    { key: 'length', met: newPassword.length >= minLength, text: `At least ${minLength} characters` },
    { key: 'upper', met: /[A-Z]/.test(newPassword), text: 'One uppercase letter' },
    { key: 'lower', met: /[a-z]/.test(newPassword), text: 'One lowercase letter' },
    { key: 'number', met: /[0-9]/.test(newPassword), text: 'One number' },
  ]
}

/** antd's `min` rule (async-validator) counted a supplementary-plane character once, as code points do. */
function codePointLength(value: string): number {
  return Array.from(value).length
}

export interface ChangePasswordIssue {
  path: ChangePasswordField
  message: string
}

/**
 * The three legacy Form.Item rule sets, in field order:
 * - Current Password: required (`Please enter your current password`);
 * - New Password: required (`Please enter a new password`), then `min` (`Password must be at least N
 *   characters`), which async-validator skipped for an empty value;
 * - Confirm New Password: required (`Please confirm your new password`), then the validator that passed
 *   an empty value or one equal to New Password (`Passwords do not match`).
 * `required` meant a non-empty string: whitespace counted as entered (antd's `whitespace` was off).
 */
export function changePasswordIssues(values: ChangePasswordValues, minLength: number): ChangePasswordIssue[] {
  const issues: ChangePasswordIssue[] = []

  if (!values.currentPassword) {
    issues.push({ path: 'currentPassword', message: 'Please enter your current password' })
  }

  if (!values.newPassword) {
    issues.push({ path: 'newPassword', message: 'Please enter a new password' })
  } else if (codePointLength(values.newPassword) < minLength) {
    issues.push({ path: 'newPassword', message: `Password must be at least ${minLength} characters` })
  }

  if (!values.confirmPassword) {
    issues.push({ path: 'confirmPassword', message: 'Please confirm your new password' })
  } else if (values.confirmPassword !== values.newPassword) {
    issues.push({ path: 'confirmPassword', message: 'Passwords do not match' })
  }

  return issues
}

/* Every rule lives in one object-level check over plain strings, so the cross-field match runs even
   while another field is still empty, and a scoped validation (one field on blur) sees the same rules
   the full submit does. */
export function createChangePasswordSchema(minLength: number) {
  return z
    .object({
      currentPassword: z.string(),
      newPassword: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((values, context) => {
      for (const issue of changePasswordIssues(values, minLength)) {
        context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
      }
    })
}

/** The mutation variables: the current and the new password only, as legacy sent them. */
export function changePasswordVariables(values: ChangePasswordValues): {
  currentPassword: string
  newPassword: string
} {
  return {
    currentPassword: values.currentPassword,
    newPassword: values.newPassword,
  }
}

export interface ChangePasswordPayload {
  success?: boolean | null
  message?: string | null
}

export interface ChangePasswordData {
  changeAdminPassword?: ChangePasswordPayload | null
  agents?: { changeAgentPassword?: ChangePasswordPayload | null } | null
}

/** An agent's payload is nested under `agents`; an admin's is top level (legacy, both read the same way). */
export function readChangePasswordResult(
  data: ChangePasswordData | null | undefined,
  isAgent: boolean,
): { success: boolean; message: string | null | undefined } {
  const payload = isAgent ? data?.agents?.changeAgentPassword : data?.changeAdminPassword
  return { success: Boolean(payload?.success), message: payload?.message }
}

export const PASSWORD_CHANGED_TITLE = 'Password Changed Successfully'
export const PASSWORD_CHANGE_FAILED_TITLE = 'Password Change Failed'

export function passwordChangedMessage(message: string | null | undefined): string {
  return message || 'Your password has been updated successfully'
}

/** The first GraphQL error's message, the only failure the legacy dialog reported; anything else
 *  (a network failure, an error without GraphQL errors) stayed silent. */
export function graphQLErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const errors = (error as { graphQLErrors?: unknown }).graphQLErrors
  if (!Array.isArray(errors) || errors.length === 0) return null
  const first = errors[0] as { message?: unknown } | null | undefined
  return typeof first?.message === 'string' && first.message ? first.message : null
}

/** The failed-submit summary, after the Create Bonus pilot's wording (BEYOND-LEGACY: antd only outlined the fields). */
export function changePasswordSummary(errorCount: number): string {
  return `Fix ${errorCount} highlighted ${errorCount === 1 ? 'field' : 'fields'} and submit again.`
}
