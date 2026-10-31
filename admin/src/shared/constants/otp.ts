export const OTP_PROVIDER_LABELS = {
  TWILIO: 'Twilio',
  AWS_SNS: 'AWS SNS',
  MSG91: 'MSG91',
  TWO_FACTOR: '2Factor',
} as const

export type OtpProviderCode = keyof typeof OTP_PROVIDER_LABELS

export const OTP_PROVIDER_OPTIONS = Object.entries(OTP_PROVIDER_LABELS).map(([value, label]) => ({
  value: value as OtpProviderCode,
  label,
}))

