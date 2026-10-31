import { graphqlRequest } from '@/lib/graphqlClient'
import type { User } from '@/types'

type AuthPayload = { token: string; user: User }

const USER_FIELDS = `
  id
  username
  name
  phone
  level
  balance
  bonusBalance
  exposure
  walletType
  affiliateCode
  referralBalance
  referralBonusBalance
  playerType
  creditAvailable
  creditLimit
  creditUsed
  requirePasswordReset
`

export async function requestOtp(phone: string) {
  const data = await graphqlRequest<{ requestOtp: { success: boolean; message?: string } }>(
    `
      mutation RequestOtp($phone: String!) {
        requestOtp(phone: $phone) { success message }
      }
    `,
    { phone }
  )
  return data.requestOtp
}

export async function registerUser(input: {
  username: string
  phone: string
  password: string
  confirmPassword: string
  affiliateCode?: string
  otp?: string
}) {
  const data = await graphqlRequest<{ registerUser: { success: boolean; message?: string } }>(
    `
      mutation RegisterUser($input: RegisterInput!) {
        registerUser(input: $input) { success message }
      }
    `,
    { input }
  )
  return data.registerUser
}

export async function loginWithOtp(phone: string, otp: string) {
  const data = await graphqlRequest<{ loginWithOtp: AuthPayload }>(
    `
      mutation LoginWithOtp($phone: String!, $otp: String!) {
        loginWithOtp(phone: $phone, otp: $otp) {
          token
          user { ${USER_FIELDS} }
        }
      }
    `,
    { phone, otp }
  )
  return data.loginWithOtp
}

export async function loginWithPassword(identifier: string, password: string) {
  const data = await graphqlRequest<{ login: AuthPayload }>(
    `
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          token
          user { ${USER_FIELDS} }
        }
      }
    `,
    { input: { phoneOrUsername: identifier, password } }
  )
  return data.login
}

export async function getMe() {
  const data = await graphqlRequest<{ me: User | null }>(
    `
      query Me {
        me { ${USER_FIELDS} }
      }
    `
  )
  return data.me
}

export async function getUserData() {
  const data = await graphqlRequest<{ userData: User | null }>(
    `
      query UserData {
        userData { ${USER_FIELDS} }
      }
    `
  )
  return data.userData
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const data = await graphqlRequest<{ changePassword: { success: boolean; message?: string } }>(
    `
      mutation ChangePassword($currentPassword: String!, $newPassword: String!) {
        changePassword(currentPassword: $currentPassword, newPassword: $newPassword) {
          success
          message
        }
      }
    `,
    { currentPassword, newPassword }
  )
  return data.changePassword
}

export async function requestResetOtp(phone: string) {
  const data = await graphqlRequest<{ requestResetOtp: { success: boolean; message?: string } }>(
    `
      mutation RequestResetOtp($phone: String!) {
        requestResetOtp(phone: $phone) { success message }
      }
    `,
    { phone }
  )
  return data.requestResetOtp
}

export async function resetPassword(phone: string, otp: string, newPassword: string) {
  const data = await graphqlRequest<{ resetPassword: { success: boolean; message?: string } }>(
    `
      mutation ResetPassword($phone: String!, $otp: String!, $newPassword: String!) {
        resetPassword(phone: $phone, otp: $otp, newPassword: $newPassword) {
          success
          message
        }
      }
    `,
    { phone, otp, newPassword }
  )
  return data.resetPassword
}

