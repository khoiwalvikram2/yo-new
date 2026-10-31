import { assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
import { randomUUID } from 'crypto'
import { getGmagCasinoEnv } from '../../config/env.js'
import { createCasinoSession } from '../../repos/casinoSessionRepo.js'
import { ensureWallet } from '../../repos/userRepo.js'
import { getActiveCasinoBonusAwardId } from '../../repos/userAppRepo.js'
import { getWhitelabelCurrency } from '../../shared/whitelabelConfig.js'
import { db } from '../../db/client.js'
import { users } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'
import { assertPlayerAgentAllowsBetting } from '../userApp/services/agentBettingGate.js'

const LOG_PREFIX = '[GmagCasinoLaunch]'

export interface GmagLaunchParams {
  userId: number
  tenant: string
  gameId: string
  username: string
  walletType?: 'balance' | 'bonus' | 'referralBonus'
  userAgent?: string
  clientIp?: string
}

export interface GmagLaunchResult {
  redirectUrl: string
}

export async function getGmagCasinoRedirectUrl(params: GmagLaunchParams): Promise<GmagLaunchResult> {

  const env = getGmagCasinoEnv()
  if (!env || !env.GMAG_LAUNCHER_URL) {
    console.warn(`${LOG_PREFIX} Config missing`, { hasEnv: !!env, hasLauncherUrl: !!env?.GMAG_LAUNCHER_URL })
    throw new Error('GM-Ag Casino not configured')
  }

  const [userRow] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, params.userId), eq(users.tenant, params.tenant)))
    .limit(1)
  if (!userRow || userRow.status !== 'active' || !userRow.casinoBetAllowed) {
    console.warn(`${LOG_PREFIX} User not allowed`, { userId: params.userId, tenant: params.tenant, hasUser: !!userRow, status: userRow?.status, casinoBetAllowed: userRow?.casinoBetAllowed })
    throw new Error('User not allowed to play')
  }
  // Agent players: no casino play while the agent branch is not ACTIVE or lacks the casino
  // domain. The bet callback refuses the stake anyway; refusing the launch gives the
  // player the reason up front.
  await assertPlayerAgentAllowsBetting(db, { userId: params.userId, tenant: params.tenant }, 'casino')
  await assertPlayerDomainBetting(db, params.tenant, params.userId, 'casino')

  const currency = await getWhitelabelCurrency(params.tenant)

  const wallet = await ensureWallet(params.userId, params.tenant, currency)
  const cash = Number(wallet.cash ?? 0)
  const bonus = Number(wallet.bonus ?? 0)
  const referralBonus = Number(wallet.referralBonus ?? 0)
  const exposure = Number(wallet.exposure ?? 0)

  let walletType: 'bonus' | 'cash' | 'referralBonus'
  if (params.walletType === 'referralBonus') {
    walletType = 'referralBonus'
  } else if (params.walletType === 'bonus') {
    walletType = 'bonus'
  } else if (params.walletType === undefined) {
    const activeBonusId = await getActiveCasinoBonusAwardId(params.userId, params.tenant)
    if (activeBonusId != null && bonus > 0) {
      walletType = 'bonus'
    } else {
      walletType = 'cash'
    }
  } else {
    walletType = 'cash'
  }

  const token = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await createCasinoSession(
    {
      token,
      userId: params.userId,
      tenant: params.tenant,
      walletType,
      expiresAt,
      providerKey: 'gmagcasino',
    },
    db
  )

  const isMobile =
    params.userAgent != null &&
    /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini/i.test(params.userAgent)

  const brandId = String(env.GMAG_BRAND_ID)
  const last4Launch = userRow.phone ? String(userRow.phone).slice(-4) : '0000'
  const playerId = `${params.userId}_${last4Launch}`
  const gameCode = params.gameId

  const search = new URLSearchParams()
  search.set('gameCode', gameCode)
  search.set('token', token)
  search.set('platform', isMobile ? 'mobile' : 'web')
  search.set('language', 'en')
  search.set('playerId', playerId)
  search.set('brandId', brandId)
  search.set('currency', currency)

  const redirectUrl = `${env.GMAG_LAUNCHER_URL.replace(/\/$/, '')}/launcher?${search.toString()}`
  return { redirectUrl }
}
