import { IconLink, IconWorld } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import type { FormApi } from '@/ui/form/useForm'
import type { WhitelabelWizardValues } from '../whitelabelWizardModel'
import styles from '../WhitelabelWizardPage.module.css'

interface WhitelabelEditBasicInfoProps {
  form: FormApi<WhitelabelWizardValues>
}

export default function WhitelabelEditBasicInfo({ form }: WhitelabelEditBasicInfoProps) {
  const name = form.field('name')
  const domain = form.field('domain')

  return (
    <Card
      title="Basic Information"
      sub="Choose the partner name and the primary domain people will use."
    >
      <div className={styles.twoColumnGrid}>
        <TextField
          id={name.id}
          name={name.name}
          label="Whitelabel Name"
          value={name.value}
          onChange={name.onChange}
          onBlur={name.onBlur}
          error={name.error}
          required
          autoComplete="organization"
          placeholder="e.g., Partner1 Gaming"
          prefix={<IconWorld size={16} stroke={strokeFor(16)} aria-hidden="true" />}
          help="Enter a descriptive name for this whitelabel. This will be displayed in the admin panel."
        />
        <TextField
          id={domain.id}
          name={domain.name}
          label="Primary Domain"
          value={domain.value}
          onChange={domain.onChange}
          onBlur={domain.onBlur}
          error={domain.error}
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g., partner1.ankadda.com"
          prefix={<IconLink size={16} stroke={strokeFor(16)} aria-hidden="true" />}
          help="The main domain for this whitelabel. This will be the main domain for the whitelabel."
        />
      </div>
    </Card>
  )
}
