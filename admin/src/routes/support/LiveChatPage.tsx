import { useState } from 'react'
import { useAdminSupportClient, useSupportNeedsWhitelabel } from '@/shared/core/useAdminSupportClient'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { EmptyState } from '@/ui/components/EmptyState'
import { Page } from '@/ui/components/Page'
import { SupportInbox,SupportSettings } from '../../../../ui-shared/support/SupportChat'

export default function LiveChatPage(){
  const client=useAdminSupportClient()
  // A Super Admin with no whitelabel chosen has no inbox: the inbox is not mounted, so nothing is requested.
  const needsWhitelabel=useSupportNeedsWhitelabel()
  const [settings,setSettings]=useState(false)
  return <RBACGuard required={[{domain:'support.chat',actions:['view']}]}><Page maxWidth="wide">{needsWhitelabel?<EmptyState role="status" title="Select a whitelabel" description="Live chat is kept per whitelabel. Switch to Whitelabel mode in the top bar and choose the site whose support inbox you want to manage."/>:settings?<SupportSettings client={client} onBack={()=>setSettings(false)}/>:<SupportInbox client={client} onSettings={()=>setSettings(true)}/>}</Page></RBACGuard>
}
