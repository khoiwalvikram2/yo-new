export type OtpProviderInput = {
  tenant: string
  provider: 'TWILIO' | 'AWS_SNS' | 'MSG91' | 'TWO_FACTOR'
  accountSid?: string | null
  authToken?: string | null
  accessKey?: string | null
  secretKey?: string | null
  region?: string | null
  senderId?: string | null
  templateId?: string | null
  apiKey?: string | null
  apiSecret?: string | null
  baseUrl?: string | null
  active?: boolean
  priority?: number
}

