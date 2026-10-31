import { useMemo } from 'react'
import { useAuth,isIdleExpired } from '@/state/auth'
import { createSupportClient,supportEndpoint } from '../../../ui-shared/support/client'
import { SupportInbox } from '../../../ui-shared/support/SupportChat'

export function LiveChatPage(){
  const token=useAuth(s=>s.token),tenant=useAuth(s=>s.me?.tenant)
  const client=useMemo(()=>createSupportClient(import.meta.env.VITE_SUPPORT_API_URL||supportEndpoint(import.meta.env.VITE_API_URL||(import.meta.env.DEV?'http://localhost:4000/graphql':'/graphql')),()=>{
    const state=useAuth.getState()
    if(isIdleExpired(state)){state.signOut();throw new Error('Session expired. Please sign in again.')}
    return {authorization:'Bearer '+(token||''),'x-client-type':'crm','x-whitelabel-id':tenant||''}
  },()=>useAuth.getState().signOut()),[token,tenant])
  return <SupportInbox client={client}/>
}
