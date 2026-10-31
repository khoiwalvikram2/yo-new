/**
 * Phone number normalization utilities
 * Ensures consistent phone number format for storage and lookup
 */

/**
 * Normalizes phone number for storage
 * - Removes all non-digit characters
 * - If starts with 91 and length is 12, keeps as is (without +)
 * - If length is 10, assumes Indian number and keeps as is
 * - Returns digits only (no + prefix)
 */
export function normalizePhoneForStorage(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    return phone
  }
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  
  // If empty after cleaning, return original
  if (!digits || digits.length === 0) {
    return phone.trim()
  }
  
  // If starts with 91 and length is 12, remove 91 prefix (Indian country code)
  // This ensures we store numbers without country code prefix
  if (digits.startsWith('91') && digits.length === 12) {
    return digits.substring(2) // Remove '91' prefix
  }
  
  // If starts with 0 and length is 11, remove leading 0
  if (digits.startsWith('0') && digits.length === 11) {
    return digits.substring(1)
  }
  
  // Return digits as-is (should be 10 digits for Indian numbers)
  return digits
}

/**
 * Normalizes phone number for lookup/search
 * Handles both formats: with/without +91 prefix
 * Returns array of possible formats to try
 */
export function normalizePhoneForLookup(phone: string): string[] {
  if (!phone || typeof phone !== 'string') {
    return [phone]
  }
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  
  if (!digits || digits.length === 0) {
    return [phone.trim()]
  }
  
  const formats: string[] = []
  
  // If starts with 91 and length is 12, try both with and without 91
  if (digits.startsWith('91') && digits.length === 12) {
    const without91 = digits.substring(2)
    formats.push(without91) // Without country code (preferred)
    formats.push(digits) // With 91 prefix
    formats.push(`+${digits}`) // With +91 prefix
  } else if (digits.length === 10) {
    // 10-digit number - try as-is and with 91 prefix
    formats.push(digits) // Without country code (preferred)
    formats.push(`91${digits}`) // With 91 prefix
    formats.push(`+91${digits}`) // With +91 prefix
  } else if (digits.startsWith('0') && digits.length === 11) {
    // 11-digit number starting with 0
    const without0 = digits.substring(1)
    formats.push(without0) // Without leading 0 (preferred)
    formats.push(digits) // With leading 0
    formats.push(`91${without0}`) // With 91 prefix
    formats.push(`+91${without0}`) // With +91 prefix
  } else {
    // Other formats - try as-is
    formats.push(digits)
    // Also try with + prefix if it was in original
    if (phone.includes('+')) {
      formats.push(`+${digits}`)
    }
  }
  
  // Remove duplicates
  return Array.from(new Set(formats))
}
