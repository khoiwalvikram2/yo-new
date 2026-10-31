import { z } from 'zod'

export const UserProfileSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  level: z.number().optional(),
  balance: z.number().default(0),
  bonusBalance: z.number().optional(),
  exposure: z.number().optional(),
  walletType: z.enum(['1', '2']).optional(),
  affiliateCode: z.string().optional(),
  referralBalance: z.number().optional(),
})

export type UserProfile = z.infer<typeof UserProfileSchema>

export const AuthTokenSchema = z.object({
  token: z.string(),
  user: UserProfileSchema,
})

export type AuthTokenPayload = z.infer<typeof AuthTokenSchema>

export const OtpRequestSchema = z.object({
  phone: z.string().min(6),
})

export type OtpRequestInput = z.infer<typeof OtpRequestSchema>

export const VerifyOtpSchema = z.object({
  phone: z.string().min(6),
  otp: z.string().min(4),
})

export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>

const registerInputBaseSchema = z.object({
  username: z.string().min(3),
  phone: z.string().min(6),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  otp: z.string().min(4).optional(),
  affiliateCode: z.string().optional(),
})

export const RegisterInputSchema = registerInputBaseSchema.refine(
  (val: z.infer<typeof registerInputBaseSchema>) => val.password === val.confirmPassword,
  { message: 'Passwords must match', path: ['confirmPassword'] },
)

export type RegisterInput = z.infer<typeof RegisterInputSchema>

