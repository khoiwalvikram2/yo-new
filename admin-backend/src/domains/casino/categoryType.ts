export type CasinoCategoryType = 'GENERAL' | 'TOP' | 'FEATURED' | 'LOUNGE'
export type CasinoCategoryDbType = 'general' | 'top' | 'featured' | 'lounge'

export function toCasinoCategoryDbType(type: CasinoCategoryType | null | undefined): CasinoCategoryDbType {
  if (type === 'TOP') return 'top'
  if (type === 'FEATURED') return 'featured'
  if (type === 'LOUNGE') return 'lounge'
  return 'general'
}

export function toCasinoCategoryType(type: unknown): CasinoCategoryType {
  if (type === 'top') return 'TOP'
  if (type === 'featured') return 'FEATURED'
  if (type === 'lounge') return 'LOUNGE'
  return 'GENERAL'
}
