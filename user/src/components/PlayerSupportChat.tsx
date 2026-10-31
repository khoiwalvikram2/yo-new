import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { tokenService } from '@/lib/tokenService'
import { getWhitelabelId } from '@/lib/whitelabel'
import { createSupportClient,supportEndpoint } from '../../../ui-shared/support/client'
import { PlayerChatWidget } from '../../../ui-shared/support/SupportChat'

export default function PlayerSupportChat(){
  const {pathname,search}=useLocation()
  const {isAuthenticated,user,openAuthModal,logout}=useAuth()
  const tenant=getWhitelabelId()
  const client=useMemo(()=>createSupportClient(import.meta.env.VITE_SUPPORT_API_URL||supportEndpoint(import.meta.env.VITE_USER_GRAPHQL_URL||(import.meta.env.VITE_API_BASE_URL?import.meta.env.VITE_API_BASE_URL.replace(/\/$/,'')+'/graphql':'/graphql')),()=>{
    const token=tokenService.getToken()
    return {'x-whitelabel-id':tenant,'x-tenant':tenant,...(token?{authorization:'Bearer '+token}:{})}
  },()=>logout()),[tenant,logout])
  useEffect(()=>{window.dispatchEvent(new Event('support-chat:close'))},[pathname,search])
  useEffect(()=>{
    const changed=(event:Event)=>{if((event as CustomEvent<{panel?:string|null}>).detail?.panel)window.dispatchEvent(new Event('support-chat:close'))}
    window.addEventListener('nova:panel-change',changed)
    return()=>window.removeEventListener('nova:panel-change',changed)
  },[])
  if(user?.requirePasswordReset)return null
  return <PlayerChatWidget key={tenant+':'+(user?.id||'guest')} client={client} authenticated={isAuthenticated} onLogin={()=>openAuthModal('login')}/>
}
