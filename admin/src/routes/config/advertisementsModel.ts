import { z } from 'zod'
import type { TableExportColumn } from '@/shared/utils/tableExport'

export interface Advertisement {
  id: string
  title: string
  subtitle?: string | null
  type: string
  status: string
  deviceType: string
  imageUrl?: string | null
  url?: string | null
  order?: number | null
  createdAt?: string
  updatedAt?: string
}

export const AD_TYPES = [
  { value: 'BANNER', label: 'Banner' }, { value: 'PROMOTIONAL', label: 'Promotional' },
  { value: 'FEATURED', label: 'Featured' },
]
export const AD_DEVICES = [
  { value: 'DESKTOP', label: 'Desktop Only' }, { value: 'MOBILE', label: 'Mobile Only' },
  { value: 'BOTH', label: 'Both (Desktop & Mobile)' },
]

export const advertisementSchema = z.object({
  title: z.string().min(1, 'Please enter title'),
  subtitle: z.string().max(512),
  imageUrl: z.string().min(1, 'Please upload an image'),
  type: z.string().min(1, 'Please select type'),
  deviceType: z.string().min(1, 'Please select a device type'),
  url: z.string().refine((value) => !value.trim() || value.startsWith('http://') ||
    value.startsWith('https://') || value.startsWith('/'), 'URL must start with http://, https://, or /'),
  order: z.number().min(0).nullable(),
  status: z.boolean(),
})
export type AdvertisementValues = z.infer<typeof advertisementSchema>

export function advertisementValues(ad?: Advertisement | null): AdvertisementValues {
  return {
    title: ad?.title || '', subtitle: ad?.subtitle || '', imageUrl: ad?.imageUrl || '',
    type: ad?.type || 'BANNER', deviceType: ad?.deviceType || 'BOTH', url: ad?.url || '',
    order: ad?.order ?? null, status: ad ? ad.status.toUpperCase() === 'ACTIVE' : true,
  }
}

export function advertisementInput(values: AdvertisementValues) {
  return {
    title: values.title, subtitle: values.subtitle || null, type: values.type,
    url: values.url.trim() || null, order: values.order ?? null,
    status: values.status ? 'ACTIVE' : 'INACTIVE', deviceType: values.deviceType || 'BOTH',
    ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}),
  }
}

export function filterAdvertisements(ads: readonly Advertisement[], filters: {
  type: string; deviceType: string; query: string
}) {
  const search = filters.query.toLowerCase().trim()
  return ads.filter((ad) => (!filters.type || ad.type === filters.type) &&
    (!filters.deviceType || ad.deviceType === filters.deviceType) &&
    (!search || ad.title?.toLowerCase().includes(search) || ad.subtitle?.toLowerCase().includes(search)))
}

export function sortAdvertisements(ads: readonly Advertisement[]) {
  return [...ads].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function reorderAdvertisements(ads: readonly Advertisement[], activeId: string, overId: string) {
  const sorted = sortAdvertisements(ads)
  const from = sorted.findIndex((ad) => ad.id === activeId)
  const to = sorted.findIndex((ad) => ad.id === overId)
  if (from < 0 || to < 0 || from === to) return null
  sorted.splice(to, 0, sorted.splice(from, 1)[0])
  return sorted.map((ad, index) => ({ id: ad.id, order: index + 1 }))
}

export const AD_EXPORT_COLUMNS: TableExportColumn<Advertisement>[] = [
  { header: 'Order', key: 'order', width: 8, getter: (ad) => ad.order ?? null },
  { header: 'Title', key: 'title', width: 24, getter: (ad) => ad.title ?? '' },
  { header: 'Subtitle', key: 'subtitle', width: 20, getter: (ad) => ad.subtitle ?? '' },
  { header: 'Type', key: 'type', width: 12, getter: (ad) => ad.type ?? '' },
  { header: 'Status', key: 'status', width: 10, getter: (ad) => ad.status ?? '' },
  { header: 'Device', key: 'deviceType', width: 10, getter: (ad) => ad.deviceType ?? 'BOTH' },
  { header: 'URL', key: 'url', width: 32, getter: (ad) => ad.url ?? '' },
  { header: 'Image URL', key: 'imageUrl', width: 28, getter: (ad) => ad.imageUrl ?? '' },
]
