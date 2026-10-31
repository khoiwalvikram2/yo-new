import type { FastifyInstance } from 'fastify'
import { registerSupportChat } from '@shared/support/chatRoutes.js'
import { ChatError } from '@shared/support/chatService.js'
import { pool } from '../db/client.js'
import { buildAuthContext } from '../domains/common/auth.js'

export async function registerPlayerSupportChat(app:FastifyInstance,origins:string[]) {
  return registerSupportChat(app,{pool,origins,publicTenant:async request=>(await buildAuthContext(request)).requestTenant,authenticate:async request=>{
    const auth=await buildAuthContext(request)
    if(!auth.userId||auth.forceLoggedOut)throw new ChatError(401,'Sign in to chat with support')
    const user=(await pool.query(`SELECT id,name,username,status FROM users u WHERE id=$1 AND tenant=$2 AND NOT EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id)`,[auth.userId,auth.tenant])).rows[0]
    if(!user)throw new ChatError(401,'Invalid player session')
    return {tenant:auth.tenant,kind:'player',id:String(user.id),name:user.username||user.name,readOnly:false,canReply:true,canAssign:false,canSettings:false,viewAll:false,bookIds:[]}
  }})
}
