import { useState } from 'react'
import { IconSparkles } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { useToolRailShownContext } from '@/shell/toolRailShown'
import { AiAssistantPanel, ASSISTANT_TITLE } from './AiAssistantPanel'
import styles from './AiAssistant.module.css'

/** Administrators only: matches the assistant resolver's agent-token refusal. Where the shell shows the
 *  right tool rail, the assistant opens from the rail instead and this floating button steps aside. */
export function AiAssistantLauncher() {
  const [open, setOpen] = useState(false)
  const user = useAuthStore((state) => state.user)
  const isAgent = useAuthStore((state) => state.isAgent())
  const tenant = useUIStore((state) => state.tenant)
  const mode = useUIStore((state) => state.directorMode)
  const selected = useUIStore((state) => state.selectedWhitelabelId)
  const inToolRail = useToolRailShownContext()
  if (!user || isAgent || inToolRail) return null
  return <>
    <Button variant="primary" className={styles.launcher} icon={<IconSparkles size={18} />} aria-label="Open portal assistant" title={ASSISTANT_TITLE} onClick={() => setOpen(true)}>Assistant</Button>
    <AiAssistantPanel key={`${user.id}:${tenant}:${mode}:${selected}`} open={open} onClose={() => setOpen(false)} />
  </>
}
