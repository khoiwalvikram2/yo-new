import { assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
import { getCasinoEnv } from '../../config/env.js'
import { createCasinoSignature, stringifyCanonical } from '../../config/casino/signatureUtils.js'
import { createCasinoSession } from '../../repos/casinoSessionRepo.js'
import { ensureWallet } from '../../repos/userRepo.js'
import { getActiveCasinoBonusAwardId } from '../../repos/userAppRepo.js'
import { getWhitelabelCurrency } from '../../shared/whitelabelConfig.js'
import { db } from '../../db/client.js'
import { users } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'
import { gapLog } from './gapCasinoLog.js'
import { assertPlayerAgentAllowsBetting } from '../userApp/services/agentBettingGate.js'

const GAP_LOGIN_TIMEOUT_MS = 10_000
const LOG_PREFIX = '[GapCasinoLaunch]'

// Development-only opt-in tracing; sensitive fields are redacted by gapLog.
function gdbg(tag: string, data: Record<string, unknown>) { gapLog('[GapCasinoLaunch]', tag, data) }

export interface GapLaunchParams {
  userId: number
  tenant: string
  gameId: string
  username: string
  walletType?: 'balance' | 'bonus' | 'referralBonus'
  userAgent?: string
  clientIp?: string
}

export interface GapLaunchResult {
  redirectUrl: string
}

export async function getGapCasinoRedirectUrl(params: GapLaunchParams): Promise<GapLaunchResult> {
  gdbg('Enter', { userId: params.userId, tenant: params.tenant, gameId: params.gameId, walletType: params.walletType })

  const env = getCasinoEnv()
  if (!env) {
    gdbg('NoEnv', {})
    throw new Error('Casino not configured')
  }

  // Fetch user from database
  const [userRow] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, params.userId), eq(users.tenant, params.tenant)))
    .limit(1)
  gdbg('UserLookup', { found: !!userRow, userStatus: userRow?.status, casinoBetAllowed: userRow?.casinoBetAllowed })

  if (!userRow) {
    throw new Error('User not found')
  }

  if (userRow.status !== 'active' || !userRow.casinoBetAllowed) {
    gdbg('UserRejected', { userStatus: userRow.status, casinoBetAllowed: userRow.casinoBetAllowed })
    throw new Error('User not allowed to play')
  }
  // Agent players: no casino play while the agent branch is not ACTIVE or lacks the casino
  // domain. The debit callback refuses the stake anyway; refusing the launch gives the
  // player the reason up front.
  await assertPlayerAgentAllowsBetting(db, { userId: params.userId, tenant: params.tenant }, 'casino')
  await assertPlayerDomainBetting(db, params.tenant, params.userId, 'casino')
  
  // Fetch wallet details
  const currency = await getWhitelabelCurrency(params.tenant)
  const wallet = await ensureWallet(params.userId, params.tenant, currency)
  const cash = Number(wallet.cash ?? 0)
  const bonus = Number(wallet.bonus ?? 0)
  const referralBonus = Number(wallet.referralBonus ?? 0)
  const exposure = Number(wallet.exposure ?? 0)
  
  // Determine wallet type and balance from user selection or fallback (referralBonus is casino-only)
  let walletType: 'bonus' | 'cash' | 'referralBonus'
  let balance: number
  if (params.walletType === 'referralBonus') {
    walletType = 'referralBonus'
    balance = Math.max(0, referralBonus)
  } else if (params.walletType === 'bonus') {
    walletType = 'bonus'
    balance = Math.max(0, bonus)
  } else {
    // params.walletType === 'balance' or undefined: use main wallet, with backward-compatible fallback
    if (params.walletType === undefined) {
      const activeBonusId = await getActiveCasinoBonusAwardId(params.userId, params.tenant)
      if (activeBonusId != null && bonus > 0) {
        walletType = 'bonus'
        balance = bonus
      } else {
        walletType = 'cash'
        balance = Math.max(0, cash - exposure)
      }
    } else {
      walletType = 'cash'
      balance = Math.max(0, cash - exposure)
    }
  }
  
  // Detect mobile
  const isMobile =
    params.userAgent != null &&
    /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini/i.test(params.userAgent)
  
  // Build payload
  const payload = {
    operatorId: env.CASINO_PARTNER_ID,
    userId: String(params.userId),
    platformId: isMobile ? 'mobile' : 'desktop',
    currency,
    username: params.username,
    lobby: false,
    gameId: params.gameId,
    clientIp: params.clientIp ?? '',
    balance: Number(balance.toFixed(2)),
    redirectUrl: env.CASINO_REDIRECT_URL,
  }
  gdbg('Wallet', { walletType, balance, cash, bonus, referralBonus, exposure })
  gdbg('Payload', { payload })

  // Create canonical string and signature
  const dataString = stringifyCanonical(payload)

  const signature = createCasinoSignature(dataString)
  gdbg('SignedPayload', { dataString, sigLen: signature.length, sigPreview: signature.slice(0, 32) })

  // Make API request
  const loginUrl = `${env.CASINO_BASE_URL}/api/operator/login`
  gdbg('CallingGap', { loginUrl })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GAP_LOGIN_TIMEOUT_MS)
  let response: Response

  const startTime = Date.now()
  try {
    response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        Signature: signature,
        'Content-Type': 'application/json',
      },
      body: dataString,
      signal: controller.signal,
    })
    const elapsed = Date.now() - startTime
    gdbg('GapResponse', { status: response.status, ok: response.ok, elapsed })
  } catch (err) {
    clearTimeout(timeoutId)
    const elapsed = Date.now() - startTime
    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    gdbg('GapError', { errMsg, errStack, elapsed })
    throw err instanceof Error ? err : new Error('Gap casino login request failed')
  }
  clearTimeout(timeoutId)

  // Read the body as text FIRST so we can log GAP's verbatim response even when
  // it returns a non-JSON / error payload (the real 400 reason usually lives here).
  const rawBody = await response.text().catch((e) => {
    gdbg('GapResponseReadError', { err: (e as Error).message })
    return ''
  })

  let data: { token?: string; url?: string; message?: string; error?: string; errors?: unknown } = {}
  if (rawBody) {
    try {
      data = JSON.parse(rawBody)
    } catch (e) {
      gdbg('GapResponseJsonError', { err: (e as Error).message, rawBody })
    }
  }
  gdbg('GapResponseBody', { status: response.status, ok: response.ok, data, rawBody })

  if (!response.ok || !data?.token || !data?.url) {
    const reason = data?.message ?? data?.error ?? response.statusText ?? 'Gap login failed'
    // Full diagnostic dump: GAP's raw answer + exactly what we sent, so a 400
    // (signature mismatch / bad operatorId / disabled gameId / currency) is traceable.
    gdbg('GapRejected', {
      reason,
      responseStatus: response.status,
      rawBody,
      gapMessage: data?.message,
      gapError: data?.error,
      gapErrors: data?.errors,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      loginUrl,
      partnerId: env.CASINO_PARTNER_ID,
      sentBody: dataString,
      sentPayload: payload,
      sigPreview: signature.slice(0, 32),
    })
    throw new Error(typeof reason === 'string' && reason.length > 0 ? reason : 'Gap login failed')
  }

  // GAP returns TWO tokens and each is used in a different flow:
  //   1. `data.token` — the operator-side token that GAP's backend carries in
  //      seamless wallet callbacks (verified from production logs: POST /gap/balance
  //      from GAP's server IP sends this one).
  //   2. `token=` query param inside `data.url` — the token embedded in the game
  //      iframe URL; our own /gap-test UI extracts this from the redirect URL.
  // Save BOTH as alias rows so either flow resolves to the same session. The
  // unique index is on (providerKey, token) so two rows with different tokens
  // are allowed.
  const operatorToken = data.token
  let urlToken: string | null = null
  try {
    const parsedUrl = new URL(data.url)
    urlToken = parsedUrl.searchParams.get('token')
  } catch (urlErr) {
    gdbg('RedirectUrlParseFailed', { err: (urlErr as Error).message })
  }
  gdbg('TokenResolved', { operatorToken, urlToken, saveAlias: !!(urlToken && urlToken !== operatorToken) })

  // Create session
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await createCasinoSession(
    {
      token: operatorToken,
      userId: params.userId,
      tenant: params.tenant,
      walletType,
      expiresAt,
    },
    db
  )
  gdbg('SessionCreated', { token: operatorToken, kind: 'operator', walletType, expiresAt: expiresAt.toISOString() })

  if (urlToken && urlToken !== operatorToken) {
    await createCasinoSession(
      {
        token: urlToken,
        userId: params.userId,
        tenant: params.tenant,
        walletType,
        expiresAt,
      },
      db
    )
    gdbg('SessionCreated', { token: urlToken, kind: 'url-alias', walletType, expiresAt: expiresAt.toISOString() })
  }

  gdbg('Success', { redirectUrl: data.url })
  return { redirectUrl: data.url }
}
