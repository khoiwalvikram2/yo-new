import type { ReactNode } from 'react'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SELECT_WHITELABEL_HINT, SELECT_WHITELABEL_TITLE, useNeedsWhitelabelSelection } from './whitelabelScope'

interface MatkaWhitelabelGateProps {
  /** The page's heading, kept while the page asks for a whitelabel. */
  title: string
  /** The page itself. It is not mounted until a whitelabel is chosen, so none of its queries or subscriptions start. */
  children: ReactNode
}

/**
 * A Super Admin in core mode has no whitelabel selected. Matka markets, results and live figures belong to one
 * whitelabel, and in that mode admin-backend read the platform's own tenant, which holds none: Management,
 * Results and Live showed silent zeros, and Management warned that default rates were missing. They now show
 * the select-a-whitelabel state Running Markets and the Worli sessions show. The write pages opened by URL
 * (create, edit, settings, a matka's details and a Worli session) use it too: a write there fell back to the
 * platform's own tenant ('default'), where no whitelabel sees it. Whitelabel admins and agents always get the page.
 */
export function MatkaWhitelabelGate({ title, children }: MatkaWhitelabelGateProps) {
  const needsWhitelabel = useNeedsWhitelabelSelection()
  if (!needsWhitelabel) return <>{children}</>
  return (
    <Page maxWidth="wide">
      <PageHeader title={title} />
      <Notice tone="info" title={SELECT_WHITELABEL_TITLE}>{SELECT_WHITELABEL_HINT}</Notice>
    </Page>
  )
}
