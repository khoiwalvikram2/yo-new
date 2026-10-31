import { useState } from 'react'
import { useAdminSupportClient } from '@/shared/core/useAdminSupportClient'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { SupportInbox,SupportSettings } from '../../../../ui-shared/support/SupportChat'

export default function LiveChatPage(){
  const client=useAdminSupportClient()
  const [settings,setSettings]=useState(false)
  return <RBACGuard required={[{domain:'support.chat',actions:['view']}]}><Page maxWidth="wide">{settings?<SupportSettings client={client} onBack={()=>setSettings(false)}/>:<SupportInbox client={client} onSettings={()=>setSettings(true)}/>}</Page></RBACGuard>
}
