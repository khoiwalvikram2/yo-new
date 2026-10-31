/**
 * Phone number normalization utilities
 * Ensures consistent phone number format for storage and lookup
 */

/**
 * Normalizes phone number for storage
 * - Removes all non-digit characters
 * - If starts with 91 and length is 12, removes 91 prefix (Indian country code)
 * - If starts with +91, removes +91 prefix
 * - Returns digits only (no + prefix, no country code)
 */
export function normalizePhoneForStorage(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    return phone
  }
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  
  // If empty after cleaning, return trimmed original
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
