import type { FastifyInstance } from 'fastify'
import { registerSupportChat } from '@shared/support/chatRoutes.js'
import { ChatError } from '@shared/support/chatService.js'
import { pool } from '@/db/client.js'
import { buildAuthContext, hasPermission, verifyJwt } from '@/domains/common/auth.js'
import { buildCrmAuthContext } from '@/domains/crm/services/CrmAuthService.js'
import { crmPlayerScope, requireCrmPermission } from '@/domains/crm/guards.js'
import { getCrmSettings } from '@/repos/crm/CrmSettingsRepo.js'
import { isCrmIpAllowed } from '@/repos/crm/CrmSecurityRepo.js'
import { getCurrentWhitelabel } from '@/stores/whitelabelStore.js'

export async function registerAdminSupportChat(app:FastifyInstance,origins:string[]) {
  return registerSupportChat(app,{pool,origins,authenticate:async request=>{
    const raw=String(request.headers.authorization||'').replace(/^Bearer /,'')
    const token=verifyJwt(raw)
    if(!token)throw new ChatError(401,'Sign in to open support')
    if(token.type==='crm') {
      const tenant=token.tenant
      if(!tenant)throw new ChatError(401,'Invalid CRM session')
      const requested=request.headers['x-whitelabel-id']||request.headers['x-tenant']
      if(requested&&requested!==tenant)throw new ChatError(401,'Invalid CRM tenant')
      const context=await buildCrmAuthContext(request,tenant)
      requireCrmPermission(context,'crm.chat','view')
      const user=context.crmUser!
      if(user.requirePasswordReset)throw new ChatError(403,'Change your password before using support')
      const settings=await getCrmSettings(tenant)
      if(settings?.enforceIpAllowlist&&!(await isCrmIpAllowed(tenant,user.id,request.ip||'')))throw new ChatError(403,'This address cannot access the support desk')
      const scope=await crmPlayerScope(context)
      return {tenant,kind:'crm',id:user.id,name:user.name,readOnly:user.status!=='ACTIVE',canReply:hasPermission(context.permissions,'crm.chat','reply'),canAssign:hasPermission(context.permissions,'crm.chat','assign'),canSettings:false,viewAll:scope.viewAll,bookIds:scope.bookIds}
    }
    if(token.type==='agent')throw new ChatError(403,'A support staff account is required')
    const label=await getCurrentWhitelabel({request})
    const auth=await buildAuthContext(request,label.id)
    if(!auth.user)throw new ChatError(401,'Invalid support session')
    const user=(await pool.query('SELECT id,tenant,name,status,require_password_reset FROM users WHERE id=$1',[Number(auth.user.sub)])).rows[0]
    if(!user||user.status!=='active')throw new ChatError(401,'Invalid support session')
    const all=hasPermission(auth.permissions,'all','*')
    const tenant=all?(auth.directorMode==='whitelabel'?auth.directorWhitelabelId:label.id):user.tenant
    if(!tenant||tenant==='default')throw new ChatError(403,'Select a whitelabel to manage its support inbox')
    const owner=(await pool.query('SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.tenant=ur.tenant WHERE ur.user_id=$1 AND ur.tenant=$2 AND r.is_whitelabel_admin LIMIT 1',[user.id,user.tenant])).rowCount!>0
    const can=(action:string)=>all||owner||hasPermission(auth.permissions,'support.chat',action)
    if(!can('view'))throw new ChatError(403,'Support inbox permission is required')
    if(user.require_password_reset)throw new ChatError(403,'Change your password before using support')
    return {tenant,kind:'admin',id:String(user.id),name:user.name,readOnly:false,canReply:can('reply'),canAssign:can('assign'),canSettings:can('settings'),viewAll:true,bookIds:[]}
  }})
}
