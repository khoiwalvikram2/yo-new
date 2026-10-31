import {
  IconAt,
  IconCoinRupee,
  IconInfoCircle,
  IconLock,
  IconPercentage,
  IconPhone,
  IconUser,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { PasswordField } from '@/ui/components/PasswordField'
import { Select } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import type { FormApi } from '@/ui/form/useForm'
import type { WhitelabelWizardValues } from '../whitelabelWizardModel'
import styles from '../WhitelabelWizardPage.module.css'

export interface WhitelabelEditAccountProps {
  form: FormApi<WhitelabelWizardValues>
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active — Full access enabled' },
  { value: 'inactive', label: 'Inactive — Limited access' },
  { value: 'suspend', label: 'Suspended — Access blocked' },
] as const

export default function WhitelabelEditAccount({ form }: WhitelabelEditAccountProps) {
  const { getCurrencySymbol } = useCurrency()
  const status = form.field('status')
  const adminEmail = form.field('adminEmail')
  const adminName = form.field('adminName')
  const adminPassword = form.field('adminPassword')
  const confirmPassword = form.field('confirmPassword')
  const adminPhone = form.field('adminPhone')
  const sports = form.field('sharingRates.sports')
  const casino = form.field('sharingRates.casino')
  const matka = form.field('sharingRates.matka')
  const creditLimit = form.field('creditLimit')
  const iconSize = 16
  const iconStroke = strokeFor(iconSize)

  return (
    <div className={styles.stepStack}>
      <Card title="Account Status">
        <div className={styles.statusLayout}>
          <Select
            id={status.id}
            name={status.name}
            label="Whitelabel Status"
            layout="stacked"
            value={status.value}
            onChange={(value) => status.onChange(value as WhitelabelWizardValues['status'])}
            onBlur={status.onBlur}
            error={status.error}
            required
            options={STATUS_OPTIONS}
            help="Current status of this whitelabel account. Status affects login access and functionality."
          />
          <Notice
            tone="info"
            icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
            title="Status Information"
          >
            <span className={styles.noticeLines}>
              <span><strong>Active:</strong> Full access to admin panel and all features</span>
              <span><strong>Inactive:</strong> Read-only access, limited functionality</span>
              <span><strong>Suspended:</strong> No access, account temporarily blocked</span>
            </span>
          </Notice>
        </div>
      </Card>

      <Card title="Login Credentials">
        <div className={styles.twoColumnGrid}>
          <TextField
            id={adminEmail.id}
            name={adminEmail.name}
            type="email"
            label="Admin Email"
            value={adminEmail.value}
            onChange={adminEmail.onChange}
            onBlur={adminEmail.onBlur}
            error={adminEmail.error}
            required
            autoComplete="email"
            placeholder="admin@whitelabel.com"
            prefix={<IconAt size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            help="Email address for whitelabel admin login. This email will be used for whitelabel admin login."
          />
          <TextField
            id={adminName.id}
            name={adminName.name}
            label="Admin Name"
            value={adminName.value}
            onChange={adminName.onChange}
            onBlur={adminName.onBlur}
            error={adminName.error}
            required
            autoComplete="name"
            placeholder="John Doe"
            prefix={<IconUser size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            help="Full name of the whitelabel admin. Display name for the whitelabel admin."
          />
          <PasswordField
            id={adminPassword.id}
            name={adminPassword.name}
            label="Login Password"
            value={adminPassword.value}
            onChange={adminPassword.onChange}
            onBlur={adminPassword.onBlur}
            error={adminPassword.error}
            required
            autoComplete="new-password"
            placeholder="Enter secure password"
            prefix={<IconLock size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            help="Password for whitelabel admin login. Secure password for admin access."
          />
          <PasswordField
            id={confirmPassword.id}
            name={confirmPassword.name}
            label="Confirm Password"
            value={confirmPassword.value}
            onChange={confirmPassword.onChange}
            onBlur={confirmPassword.onBlur}
            error={confirmPassword.error}
            required
            autoComplete="new-password"
            placeholder="Confirm password"
            prefix={<IconLock size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            help="Confirm the admin password. Must match the password above."
          />
          <TextField
            id={adminPhone.id}
            name={adminPhone.name}
            type="tel"
            label="Contact Phone"
            value={adminPhone.value}
            onChange={adminPhone.onChange}
            onBlur={adminPhone.onBlur}
            error={adminPhone.error}
            autoComplete="tel"
            placeholder="+1234567890"
            prefix={<IconPhone size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            help="Phone number for whitelabel admin. Optional: Contact number for the admin."
          />
          <Notice
            className={styles.loginInformation}
            tone="neutral"
            icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
            title="Login Information"
          >
            <span className={styles.noticeLines}>
              <span>• Admin can login at: <code>https://domain.com/admin</code></span>
              <span>• Credentials will be sent via email</span>
              <span>• Password can be changed after first login</span>
            </span>
          </Notice>
        </div>
      </Card>

      <Card
        title="Revenue Share (Per Domain)"
        sub="Set the percentage of gross gaming revenue shared with this partner."
      >
        <div className={styles.threeColumnGrid}>
          <NumberField
            id={sports.id}
            name={sports.name}
            label="Sports Share (%)"
            value={sports.value}
            onChange={sports.onChange}
            onBlur={sports.onBlur}
            error={sports.error}
            min={0}
            max={100}
            step={0.01}
            precision={2}
            placeholder="e.g., 15"
            prefix={<IconPercentage size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            suffix="%"
            help="Percentage of Sports GGR to share with this partner."
          />
          <NumberField
            id={casino.id}
            name={casino.name}
            label="Casino Share (%)"
            value={casino.value}
            onChange={casino.onChange}
            onBlur={casino.onBlur}
            error={casino.error}
            min={0}
            max={100}
            step={0.01}
            precision={2}
            placeholder="e.g., 15"
            prefix={<IconPercentage size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            suffix="%"
            help="Percentage of Casino GGR to share with this partner."
          />
          <NumberField
            id={matka.id}
            name={matka.name}
            label="Matka Share (%)"
            value={matka.value}
            onChange={matka.onChange}
            onBlur={matka.onBlur}
            error={matka.error}
            min={0}
            max={100}
            step={0.01}
            precision={2}
            placeholder="e.g., 15"
            prefix={<IconPercentage size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            suffix="%"
            help="Percentage of Matka GGR to share with this partner."
          />
        </div>
      </Card>

      <Card title="Initial Credit">
        <div className={styles.creditLayout}>
          <NumberField
            id={creditLimit.id}
            name={creditLimit.name}
            label={`Credit Limit (${getCurrencySymbol()})`}
            value={creditLimit.value}
            onChange={creditLimit.onChange}
            onBlur={creditLimit.onBlur}
            error={creditLimit.error}
            min={0}
            step={1000}
            precision={2}
            grouping="en-IN"
            placeholder="e.g., 100000"
            prefix={<IconCoinRupee size={iconSize} stroke={iconStroke} aria-hidden="true" />}
            suffix={getCurrencySymbol()}
            help="Initial credit amount to allocate to this whitelabel. This will be deducted when players deposit or when credit is given to agents/players. Optional: Initial credit allocation for this whitelabel."
          />
          <Notice
            tone="info"
            icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
            title="Credit System"
          >
            This credit will be used for player deposits and credit allocations. Withdrawals will add credit back.
          </Notice>
        </div>
      </Card>
    </div>
  )
}
