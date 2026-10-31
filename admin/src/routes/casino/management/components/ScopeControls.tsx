import {
  IconApi,
  IconBuildingStore,
  IconCards,
  IconDeviceGamepad2,
  IconDice,
  IconLayoutGrid,
  IconLivePhoto,
  IconCrown,
} from '@tabler/icons-react'
import type { CasinoMainCategory } from '@/state/casinoStore'
import { Combobox, type ListboxOption } from '@/ui/components/Combobox'
import { FilterBar } from '@/ui/components/FilterBar'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Select } from '@/ui/components/Select'
import { strokeFor } from '@/ui/components/icons'
import { CATEGORY_OPTIONS, STATUS_OPTIONS, categoryLabel } from '../casinoManagementModel'
import styles from '../ManagementPage.module.css'

interface ScopeControlsProps {
  selectedProviderId: string | null
  selectedCategory: CasinoMainCategory | null
  selectedVendorId: string | null
  selectedVipTierId: string | null
  enabled: boolean | null
  providersOptions: ListboxOption[]
  vendorOptions: ListboxOption[]
  vipTierOptions: ListboxOption[]
  setProvider: (value: string | null) => void
  setCategory: (value: CasinoMainCategory | null) => void
  setVendor: (value: string | null) => void
  setVipTier: (value: string | null) => void
  setEnabled: (value: boolean | null) => void
  isWhitelabelAdmin?: boolean
}

const CATEGORY_SEGMENTS = CATEGORY_OPTIONS.map((option) => ({
  ...option,
  icon:
    option.value === 'ALL' ? <IconLayoutGrid size={14} stroke={strokeFor(14)} />
    : option.value === 'LIVE_CASINO' ? <IconLivePhoto size={14} stroke={strokeFor(14)} />
    : option.value === 'CASINO' ? <IconDice size={14} stroke={strokeFor(14)} />
    : <IconCards size={14} stroke={strokeFor(14)} />,
}))

export function ScopeControls({
  selectedProviderId,
  selectedCategory,
  selectedVendorId,
  selectedVipTierId,
  enabled,
  providersOptions,
  vendorOptions,
  vipTierOptions,
  setProvider,
  setCategory,
  setVendor,
  setVipTier,
  setEnabled,
  isWhitelabelAdmin = false,
}: ScopeControlsProps) {
  const vendorLabel = vendorOptions.find((option) => option.value === selectedVendorId)?.label || 'Vendor'
  // The dashboard picks the first API provider on load, so only a different provider counts as a filter;
  // clearing goes back to that provider rather than to none, which would empty the games list.
  const defaultProviderId = isWhitelabelAdmin ? null : (providersOptions[0]?.value ?? null)
  const providerChanged = !isWhitelabelAdmin && selectedProviderId !== defaultProviderId
  const activeCount = [providerChanged, selectedVendorId, selectedVipTierId, enabled !== null].filter(Boolean).length
  const clearFilters = () => {
    if (providerChanged) setProvider(defaultProviderId)
    setVendor(null)
    setVipTier(null)
    setEnabled(null)
  }
  return (
    <div className={styles.scope}>
      <FilterBar label="Scope filters" activeCount={activeCount} onClearAll={clearFilters}>
        <SegmentedControl
          value={selectedCategory || 'ALL'}
          options={CATEGORY_SEGMENTS}
          onChange={setCategory}
          label="Category selector"
          size="sm"
        />
        {!isWhitelabelAdmin ? (
          <Combobox
            label="API provider"
            hideLabel
            size="sm"
            placeholder="API provider..."
            options={providersOptions}
            value={selectedProviderId}
            onChange={(value) => setProvider(value)}
            clearable
          />
        ) : null}
        <Combobox
          label="Vendor"
          hideLabel
          size="sm"
          placeholder={
            selectedCategory === 'ALL'
              ? 'All vendors'
              : selectedCategory
                ? 'Select vendor...'
                : 'Select category first'
          }
          options={vendorOptions}
          value={selectedVendorId}
          onChange={(value) => setVendor(value)}
          clearable
          disabled={!selectedCategory || (!isWhitelabelAdmin && !selectedProviderId)}
        />
        <Combobox
          label="VIP tier"
          hideLabel
          size="sm"
          placeholder="VIP tier..."
          options={vipTierOptions}
          value={selectedVipTierId}
          onChange={(value) => setVipTier(value)}
          clearable
        />
        <Select
          label="Status"
          hideLabel
          size="sm"
          value={enabled === null ? 'all' : enabled ? 'active' : 'inactive'}
          options={STATUS_OPTIONS}
          onChange={(value) => setEnabled(value === 'all' ? null : value === 'active')}
        />
      </FilterBar>
      <ol className={styles.scopeTrail} aria-label="Current casino scope">
        <li><IconApi size={13} stroke={strokeFor(13)} /> API Providers</li>
        {selectedCategory ? (
          <li><IconDeviceGamepad2 size={13} stroke={strokeFor(13)} /> {categoryLabel(selectedCategory)}</li>
        ) : null}
        {selectedVendorId ? (
          <li><IconBuildingStore size={13} stroke={strokeFor(13)} /> {vendorLabel}</li>
        ) : null}
        {selectedVipTierId ? (
          <li><IconCrown size={13} stroke={strokeFor(13)} /> VIP filtered</li>
        ) : null}
      </ol>
    </div>
  )
}
