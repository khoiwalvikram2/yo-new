export type DialOption = { code: string; label: string }

export const DIAL_CODES: DialOption[] = [
  { code: '1', label: '+1' },
  { code: '44', label: '+44' },
  { code: '91', label: '+91' },
  { code: '61', label: '+61' },
  { code: '81', label: '+81' },
  { code: '971', label: '+971' },
  { code: '49', label: '+49' },
  { code: '33', label: '+33' },
  { code: '34', label: '+34' },
]

const WL_DEFAULT_DIAL: Record<string, string> = {
  'us-whitelabel': '1',
  'uk-whitelabel': '44',
  'india-whitelabel': '91',
  'europe-whitelabel': '49',
  'default': '91',
  'localhost': '91',
}

export function getDefaultDialCodeForWhitelabel(whitelabelId: string | undefined | null): string {
  if (!whitelabelId) return WL_DEFAULT_DIAL['default']
  return WL_DEFAULT_DIAL[whitelabelId] || WL_DEFAULT_DIAL['default']
}

