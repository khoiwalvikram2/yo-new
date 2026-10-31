import twilio from 'twilio'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { getActiveOtpProvider } from '../repos/otpProvidersRepo.js'

const DEFAULT_MESSAGE = (code: string) => `Your login OTP is ${code}. It expires in 10 minutes.`

const DEFAULTS = {
  senderId: 'OTPMSG',
  msg91Url: 'https://api.msg91.com/api/v5/otp',
  twoFactorUrl: 'https://2factor.in/API/V1',
}

function normalizePhone(phone: string) {
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) return trimmed
  if (/^\d{10}$/.test(trimmed)) {
    return `+91${trimmed}`
  }
  if (/^\d+$/.test(trimmed)) {
    return `+${trimmed}`
  }
  throw new Error('Invalid phone format for OTP delivery')
}

async function sendViaTwilio(config: { accountSid: string; authToken: string; senderId?: string | null }, phone: string, body: string) {
  if (!config.senderId) {
    throw new Error('Twilio senderId is required')
  }
  const client = twilio(config.accountSid, config.authToken)
  await client.messages.create({
    from: config.senderId,
    to: phone,
    body,
  })
}

async function sendViaSns(config: { accessKey: string; secretKey: string; region?: string | null }, phone: string, body: string) {
  const client = new SNSClient({
    region: config.region || 'ap-south-1',
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  })
  await client.send(
    new PublishCommand({
      Message: body,
      PhoneNumber: phone,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }),
  )
}

async function sendViaMsg91(config: { apiKey: string; senderId?: string | null; templateId?: string | null; baseUrl?: string | null }, phone: string, code: string, body: string) {
  const url = config.baseUrl || DEFAULTS.msg91Url
  const payload = {
    template_id: config.templateId,
    sender: config.senderId || DEFAULTS.senderId,
    short_url: 1,
    mobiles: phone.replace('+', ''),
    otp: code,
    message: body,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: config.apiKey,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MSG91 error: ${text}`)
  }
}

async function sendViaTwoFactor(config: { apiKey: string; apiSecret?: string | null; templateId?: string | null; senderId?: string | null; baseUrl?: string | null }, phone: string, code: string, body: string) {
  const baseUrl = config.baseUrl || DEFAULTS.twoFactorUrl
  // 2Factor expects phone without + sign and only digits
  const phoneDigits = phone.replace(/^\+/, '').replace(/\D/g, '')
  if (!phoneDigits) {
    throw new Error('Invalid phone number for 2Factor')
  }

  // Debug: Check if API key looks encrypted (starts with encryption prefix)
  const apiKeyMasked = config.apiKey ? `${config.apiKey.substring(0, 4)}...${config.apiKey.substring(config.apiKey.length - 4)}` : 'MISSING'
  
  // Template ID is optional; if not provided, use default or leave empty
  const template = config.templateId || ''
  // 2Factor API format: /API/V1/{API_KEY}/SMS/{PHONE}/{OTP}/{TEMPLATE_NAME}
  // If template is empty, omit it from URL
  const url = template
    ? `${baseUrl}/${config.apiKey}/SMS/${phoneDigits}/${code}/${encodeURIComponent(template)}`
    : `${baseUrl}/${config.apiKey}/SMS/${phoneDigits}/${code}`

  
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.apiSecret) {
    headers['X-API-SECRET'] = config.apiSecret
  }
  
  const res = await fetch(url, {
    method: 'GET',
    headers,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`2Factor error: ${text}`)
  }
}

export async function sendOtpMessage(params: { tenant: string; phone: string; code: string }) {
  const { tenant, phone, code } = params
  const activeProvider = await getActiveOtpProvider(tenant)
  if (!activeProvider) {
    return
  }

  const normalizedPhone = normalizePhone(phone)
  const message = DEFAULT_MESSAGE(code)

  switch (activeProvider.provider) {
    case 'TWILIO':
      await sendViaTwilio(activeProvider, normalizedPhone, message)
      return
    case 'AWS_SNS':
      await sendViaSns(activeProvider, normalizedPhone, message)
      return
    case 'MSG91':
      await sendViaMsg91(activeProvider, normalizedPhone, code, message)
      return
    case 'TWO_FACTOR':
      // 2Factor needs phone without + sign, so pass original phone
      await sendViaTwoFactor(activeProvider, phone, code, message)
      return
    default:
      throw new Error('Unsupported OTP provider')
  }
}

