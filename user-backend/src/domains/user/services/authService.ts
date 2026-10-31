import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getAppConfig } from '../../../config/app.js'
import { ensureWallet, findUserById, findUserByPhone, findUserByUsername, mapUserProfile, createUser, updatePassword, incrementTokenVersion, setLastLoginAt, type UserRow } from '../../../repos/userRepo.js'
import { getReferralLinkByCode, getUnsettledReferralBalance } from '../../../repos/referralRepo.js'
import {
  isAgentBranchActive,
  loadAgentWithAncestors,
  type AgentWithAncestorsRow,
} from '../../userApp/services/agentBettingGate.js'
import { getWhitelabelCurrency } from '../../../shared/whitelabelConfig.js'
import { upsertOtp, verifyOtp } from '../../../repos/otpRepo.js'
import { sendOtpMessage } from '../../../services/otpDeliveryService.js'
import type { RegisterInput } from '@shared/types/user.js'
import { recordAudit } from '@shared/audit/recordAudit.js'
import { db } from '../../../db/client.js'
import { isIdentifierExcluded } from '@shared/services/exclusionRegister.js'

const config = getAppConfig()
const OTP_PURPOSE_LOGIN: 'login' = 'login'
const OTP_PURPOSE_REGISTER: 'register' = 'register'
const OTP_PURPOSE_RESET: 'reset' = 'reset'

function randomOtp() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function signToken(userId: number, tenant: string, tokenVersion: number = 0) {
  return jwt.sign({ sub: String(userId), userId, tenant, v: tokenVersion }, config.jwtSecret, { expiresIn: '7d' })
}

export async function requestOtp(phone: string, tenant = 'default', purpose: 'login' | 'register' | 'reset' = OTP_PURPOSE_LOGIN) {
  // If purpose is 'register', check if phone is already registered BEFORE sending OTP
  if (purpose === OTP_PURPOSE_REGISTER) {
    const existingPhone = await findUserByPhone(phone, tenant)
    if (existingPhone) {
      throw new Error('Phone already registered')
    }
  }
  
  // If purpose is 'reset', check if phone is registered BEFORE sending OTP
  if (purpose === OTP_PURPOSE_RESET) {
    const existingPhone = await findUserByPhone(phone, tenant)
    if (!existingPhone) {
      throw new Error('Phone number not registered')
    }
  }
  
  // Every send bills a real SMS, and this endpoint needs no credential, so the
  // caps are checked before anything is dispatched. Without them a single
  // client could run up the messaging bill and flood a victim's phone.
  const { getOtpSendState } = await import('../../../repos/otpRepo.js')
  const sendState = await getOtpSendState(phone, purpose, tenant)

  if (sendState.lastSentAt) {
    const secondsSinceLast = (Date.now() - sendState.lastSentAt.getTime()) / 1000
    const minGap = config.otp.minSecondsBetweenSends
    if (secondsSinceLast < minGap) {
      const wait = Math.ceil(minGap - secondsSinceLast)
      throw new Error(`Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another OTP`)
    }
  }

  if (sendState.sendsInWindow >= config.otp.perPhonePerHour) {
    throw new Error('Too many OTP requests for this number. Please try again later.')
  }

  const expiresAt = new Date(Date.now() + config.otpExpiryMinutes * 60 * 1000)
  const code = randomOtp()
  await upsertOtp({ phone, code, purpose, expiresAt, tenant })
  await sendOtpMessage({ tenant, phone, code })
  return { success: true, message: 'OTP sent' }
}

export async function registerUser(input: RegisterInput, tenant = 'default') {
  // Normalize phone before checking
  const { normalizePhoneForStorage } = await import('../../../utils/phoneUtils.js')
  const normalizedPhone = normalizePhoneForStorage(input.phone)
  
  // Check if phone is already registered BEFORE sending OTP
  // This prevents unnecessary OTP sending and provides immediate feedback
  const existingPhone = await findUserByPhone(normalizedPhone, tenant)
  if (existingPhone) {
    throw new Error('This phone number is already registered')
  }

  // Someone who excluded themselves must not be able to open a second
  // account with the same number. Checked before the OTP goes out, so they
  // are not charged a message to be refused. The register stores hashes, so
  // this reveals nothing about who is on it.
  if (await isIdentifierExcluded(tenant, 'phone', normalizedPhone)) {
    throw new Error('This number cannot be registered. Please contact support.')
  }
  
  // Check if username is already taken BEFORE sending OTP
  const existingUsername = await findUserByUsername(input.username, tenant)
  if (existingUsername) {
    throw new Error('This username is already taken')
  }

  // Resolve the referral code before anything else is sent or created. A link to an agent
  // whose branch is not ACTIVE refuses the signup here (owner decision 1), before an OTP
  // is billed, instead of silently creating a REGULAR player. Re-resolved on the OTP step.
  const referral = await resolveSignupReferral(input.affiliateCode, tenant)

  // If OTP not provided, just send OTP for registration
  // Phone and username checks are already done above
  if (!input.otp) {
    await requestOtp(input.phone, tenant, OTP_PURPOSE_REGISTER)
    return { success: true, message: 'OTP sent' }
  }

  // Verify OTP with register purpose
  const verification = await verifyOtp({
    phone: input.phone,
    otp: input.otp,
    purpose: OTP_PURPOSE_REGISTER,
    maxAttempts: config.otpMaxAttempts,
    tenant,
  })
  if (!verification.valid) {
    throw new Error('Invalid or expired OTP')
  }

  // Agent attribution (agent_id, player_type) is written in the same insert as the account,
  // so a player who signed up through an agent's link can never end up as an unattached
  // REGULAR player. The signup bonus below runs after it, so exclusion-by-agent applies.
  const agentInfo = referral.kind === 'agent' ? referral : null
  const userReferrerId = referral.kind === 'user' ? referral.userReferrerId : null
  const user = await createUser({
    phone: normalizedPhone,
    username: input.username,
    password: input.password,
    tenant,
    name: input.username,
    agentId: agentInfo?.agentId ?? null,
    playerType: agentInfo?.playerType,
  })
  const currency = await getWhitelabelCurrency(tenant)
  await ensureWallet(user.id, tenant, currency)

  // Process signup bonus (non-blocking, async) — after agentId is set so exclusion-by-agent works
  setImmediate(async () => {
    try {
      const { findEligibleCampaigns, awardBonus } = await import('@shared/services/bonusService.js')
      const campaigns = await findEligibleCampaigns(tenant, 'signup')

      for (const campaign of campaigns) {
        await awardBonus({
          userId: user.id,
          tenant,
          campaignId: campaign.id,
        })
      }
    } catch {
      // Best-effort; don't fail registration
    }
  })

  // User-to-user referral attribution: create referral_attributions row when referee signed up with a user's code
  if (userReferrerId != null && userReferrerId !== user.id) {
    try {
      const { createReferralAttribution } = await import('../../../repos/referralRepo.js')
      const result = await createReferralAttribution(tenant, userReferrerId, user.id, 1)
      if (result) {
        // Trigger signup referral rewards (SIGNUP_CPA) via admin internal API so earnings are created for user referrer
        setImmediate(async () => {
          try {
            const { triggerSignupReferralRewards } = await import('../../../services/referralSignupTrigger.js')
            await triggerSignupReferralRewards(tenant, user.id)
          } catch {
            // Best-effort; don't fail registration
          }
        })
      }
    } catch (err) {
      // The account exists already; keep it, but leave a trace so the attribution can be repaired.
      console.error('[registerUser] user referral attribution failed', {
        tenant,
        userId: user.id,
        referrerId: userReferrerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { success: true, message: 'Registered' }
}

export const INACTIVE_AGENT_LINK_MESSAGE =
  'This referral link is no longer active. Please contact the person who shared it.'

type SignupReferral =
  | { kind: 'none' }
  | { kind: 'agent'; agentId: string; playerType: 'SHARING_AGENT_PLAYER' | 'COMMISSION_AGENT_PLAYER' }
  | { kind: 'user'; userReferrerId: number }

/**
 * Resolves a signup referral code into the attribution to write with the new account.
 *
 *  - Unknown, inactive or other-tenant codes: a plain signup, as before.
 *  - Link to an agent whose row is missing, or that (or any ancestor) is not ACTIVE: the
 *    signup is refused with INACTIVE_AGENT_LINK_MESSAGE. A suspended branch takes no new
 *    players (owner decision 1).
 *  - Link to an ACTIVE SHARING or COMMISSION agent: agent attribution.
 *  - Link to a CREDIT agent: credit players need a limit from their agent, which a
 *    self-signup cannot have, so this stays a plain signup (logged).
 *  - Link owned by a player: user-to-user referral.
 *
 * A failed lookup refuses the signup (the player can retry) rather than silently
 * dropping the attribution.
 */
export async function resolveSignupReferral(
  affiliateCode: string | null | undefined,
  tenant: string
): Promise<SignupReferral> {
  const code = typeof affiliateCode === 'string' ? affiliateCode.trim() : ''
  if (!code) return { kind: 'none' }

  let link: Awaited<ReturnType<typeof getReferralLinkByCode>>
  let chain: AgentWithAncestorsRow[] = []
  try {
    link = await getReferralLinkByCode(code)
    if (link && link.tenant === tenant && link.isActive && link.agentId) {
      chain = await loadAgentWithAncestors(db, String(link.agentId))
    }
  } catch (err) {
    console.error('[registerUser] referral lookup failed', {
      tenant,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new Error('Could not verify the referral code. Please try again.')
  }

  if (!link || link.tenant !== tenant || !link.isActive) return { kind: 'none' }

  if (link.agentId) {
    const agentId = String(link.agentId)
    const own = chain.find((r) => r.agent_id === agentId)
    if (!own || own.tenant_id !== tenant || !isAgentBranchActive(chain, agentId)) {
      console.warn('[registerUser] signup refused: agent link points to an inactive branch', { tenant, agentId })
      throw new Error(INACTIVE_AGENT_LINK_MESSAGE)
    }
    if (own.scheme_type === 'SHARING' || own.scheme_type === 'COMMISSION') {
      return {
        kind: 'agent',
        agentId,
        playerType: own.scheme_type === 'SHARING' ? 'SHARING_AGENT_PLAYER' : 'COMMISSION_AGENT_PLAYER',
      }
    }
    console.warn('[registerUser] agent link of scheme without self-signup; plain signup', {
      tenant,
      agentId,
      scheme: own.scheme_type,
    })
    return { kind: 'none' }
  }

  if (link.userId != null) return { kind: 'user', userReferrerId: Number(link.userId) }
  return { kind: 'none' }
}

async function loadUserProfileByPhone(phone: string, tenant = 'default') {
  const user = await findUserByPhone(phone, tenant)
  if (!user) throw new Error('User not found')
  const currency = await getWhitelabelCurrency(tenant)
  const wallet = await ensureWallet(user.id, tenant, currency)
  return { user, wallet }
}

async function loadUserProfileById(userId: number, tenant = 'default') {
  const user = await findUserById(userId, tenant)
  if (!user) throw new Error('User not found')
  const currency = await getWhitelabelCurrency(tenant)
  const wallet = await ensureWallet(user.id, tenant, currency)
  return { user, wallet }
}

export type RequestMeta = {
  ip?: string
  userAgent?: string
  language?: string
  screenResolution?: string
  timezone?: string
  platform?: string
  mobile?: string
  referer?: string
} | undefined

function buildAuditMeta(requestMeta?: RequestMeta, extra?: Record<string, unknown>) {
  const ipAddress = requestMeta?.ip
  const userAgent = requestMeta?.userAgent
  const clientMeta: Record<string, unknown> = {}
  if (requestMeta?.language) clientMeta.language = requestMeta.language
  if (requestMeta?.screenResolution) clientMeta.screenResolution = requestMeta.screenResolution
  if (requestMeta?.timezone) clientMeta.timezone = requestMeta.timezone
  if (requestMeta?.platform) clientMeta.platform = requestMeta.platform
  if (requestMeta?.mobile) clientMeta.mobile = requestMeta.mobile
  if (requestMeta?.referer) clientMeta.referer = requestMeta.referer
  return { ipAddress, userAgent, ...clientMeta, ...extra }
}

export async function loginWithOtp(phone: string, otp: string, tenant = 'default', requestMeta?: RequestMeta) {
  const normalizedTenant = (typeof tenant === 'string' && tenant.trim()) ? tenant.trim() : 'default'
  const ipAddress = requestMeta?.ip
  const userAgent = requestMeta?.userAgent
  const verification = await verifyOtp({ phone, otp, purpose: OTP_PURPOSE_LOGIN, maxAttempts: config.otpMaxAttempts, tenant: normalizedTenant })
  if (!verification.valid) {
    await recordAudit(db, {
      tenant: normalizedTenant,
      actorId: 'unknown',
      domain: 'players',
      action: 'login_failed',
      resourceType: 'user',
      resourceId: 'unknown',
      after: buildAuditMeta(requestMeta, { success: false }),
    }).catch(() => {})
    throw new Error('Invalid or expired OTP')
  }
  let user: UserRow
  let wallet: Awaited<ReturnType<typeof ensureWallet>>
  try {
    const loaded = await loadUserProfileByPhone(phone, normalizedTenant)
    user = loaded.user
    wallet = loaded.wallet
  } catch {
    await recordAudit(db, {
      tenant: normalizedTenant,
      actorId: 'unknown',
      domain: 'players',
      action: 'login_failed',
      resourceType: 'user',
      resourceId: 'unknown',
      after: buildAuditMeta(requestMeta, { success: false }),
    }).catch(() => {})
    throw new Error('User not found')
  }

  // Check user status - only active users can login
  if (user.status !== 'active') {
    await recordAudit(db, {
      tenant: normalizedTenant,
      actorId: String(user.id),
      domain: 'players',
      action: 'login_failed',
      resourceType: 'user',
      resourceId: String(user.id),
      after: buildAuditMeta(requestMeta, { success: false }),
    }).catch(() => {})
    if (user.status === 'suspended') {
      throw new Error('Account is suspended. Please contact support.')
    }
    throw new Error('Account is not active. Please contact support.')
  }

  // Increment token version to invalidate all previous sessions (single-device enforcement).
  // Any JWT signed with the old version will fail validation → force-logout on other devices.
  const newTokenVersion = await incrementTokenVersion(user.id, normalizedTenant)
  const token = signToken(user.id, normalizedTenant, newTokenVersion)
  const referralBalance = await getUnsettledReferralBalance(user.id, normalizedTenant)

  await recordAudit(db, {
    tenant: normalizedTenant,
    actorId: String(user.id),
    domain: 'players',
    action: 'login',
    resourceType: 'user',
    resourceId: String(user.id),
    after: buildAuditMeta(requestMeta, { success: true }),
  }).catch(() => {})

  await setLastLoginAt(user.id, normalizedTenant).catch(() => {})

  return { token, user: mapUserProfile(user, wallet, referralBalance) }
}

export async function loginWithPassword(identifier: string, password: string, tenant = 'default', requestMeta?: RequestMeta) {
  const normalizedTenant = (typeof tenant === 'string' && tenant.trim()) ? tenant.trim() : 'default'
  const user = /^\+?[0-9]{6,15}$/.test(identifier)
    ? await findUserByPhone(identifier, normalizedTenant)
    : await findUserByUsername(identifier, normalizedTenant)
  if (!user) {
    await recordAudit(db, {
      tenant: normalizedTenant,
      actorId: 'unknown',
      domain: 'players',
      action: 'login_failed',
      resourceType: 'user',
      resourceId: 'unknown',
      after: buildAuditMeta(requestMeta, { success: false }),
    }).catch(() => {})
    throw new Error('Invalid credentials')
  }

  // Check user status - only active users can login
  if (user.status !== 'active') {
    await recordAudit(db, {
      tenant: normalizedTenant,
      actorId: String(user.id),
      domain: 'players',
      action: 'login_failed',
      resourceType: 'user',
      resourceId: String(user.id),
      after: buildAuditMeta(requestMeta, { success: false }),
    }).catch(() => {})
    if (user.status === 'suspended') {
      throw new Error('Account is suspended. Please contact support.')
    }
    throw new Error('Account is not active. Please contact support.')
  }

  // Use user's actual tenant (from database) instead of request tenant
  const userTenant = (user.tenant && typeof user.tenant === 'string' && user.tenant.trim() !== '')
    ? user.tenant.trim()
    : normalizedTenant

  const match = await bcrypt.compare(password, user.passwordHash)
  if (!match) {
    await recordAudit(db, {
      tenant: userTenant,
      actorId: String(user.id),
      domain: 'players',
      action: 'login_failed',
      resourceType: 'user',
      resourceId: String(user.id),
      after: buildAuditMeta(requestMeta, { success: false }),
    }).catch(() => {})
    throw new Error('Invalid credentials')
  }
  const userCurrency = await getWhitelabelCurrency(userTenant)
  const wallet = await ensureWallet(user.id, userTenant, userCurrency)
  const referralBalance = await getUnsettledReferralBalance(user.id, userTenant)
  const newTokenVersion = await incrementTokenVersion(user.id, userTenant)
  const token = signToken(user.id, userTenant, newTokenVersion)
  const userProfile = mapUserProfile(user, wallet, referralBalance)

  await recordAudit(db, {
    tenant: userTenant,
    actorId: String(user.id),
    domain: 'players',
    action: 'login',
    resourceType: 'user',
    resourceId: String(user.id),
    after: buildAuditMeta(requestMeta, { success: true }),
  }).catch(() => {})

  await setLastLoginAt(user.id, userTenant).catch(() => {})

  return { token, user: userProfile }
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string, tenant = 'default') {
  const user = await findUserById(userId, tenant)
  if (!user) throw new Error('User not found')
  const matches = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!matches) throw new Error('Incorrect password')
  await updatePassword(userId, newPassword)
  return { success: true }
}

export async function resetPassword(phone: string, otp: string, newPassword: string, tenant = 'default') {
  // Verify OTP with reset purpose
  const verification = await verifyOtp({
    phone,
    otp,
    purpose: OTP_PURPOSE_RESET,
    maxAttempts: config.otpMaxAttempts,
    tenant,
  })
  if (!verification.valid) {
    throw new Error('Invalid or expired OTP')
  }
  
  // Find user by phone
  const user = await findUserByPhone(phone, tenant)
  if (!user) {
    throw new Error('User not found')
  }
  
  // Update password
  await updatePassword(user.id, newPassword)
  return { success: true, message: 'Password reset successfully' }
}

export async function getProfile(userId: number, tenant = 'default') {
  const { user, wallet } = await loadUserProfileById(userId, tenant)
  const referralBalance = await getUnsettledReferralBalance(userId, tenant)
  return mapUserProfile(user, wallet, referralBalance)
}

