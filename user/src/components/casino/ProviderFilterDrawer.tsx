import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X } from 'lucide-react'

type Provider = { name: string; slug: string }

type Props = {
  isOpen: boolean
  onClose: () => void
  providers: Provider[]
  loading: boolean
  selectedProviders: string[]
  onSelectProviders: (providers: string[]) => void
  /** Forces the phone sheet (modal) or the desktop drawer; by default the viewport decides. */
  isMobile?: boolean
}

/** The rail and its drawers show from 801px; below that the filter is a modal sheet from the right edge. */
const hasRail = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(min-width: 801px)').matches

/**
 * Casino / slots provider filter. On the desktop shell it is the rail drawer (nova-modals.css): the same place,
 * size, header and slide as "Your account", non-modal, closed by Escape or a click outside. It lists provider
 * names directly (no A-Z groups); a click stages a provider and Apply hands the selection to the lobby.
 */
export default function ProviderFilterDrawer({ isOpen, onClose, providers, loading, selectedProviders, onSelectProviders, isMobile }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [tempSelected, setTempSelected] = useState<string[]>([])
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const modal = isMobile ?? !hasRail()

  useEffect(() => {
    if (!isOpen) return
    setSearchQuery('')
    setTempSelected([...selectedProviders])
  }, [isOpen, selectedProviders])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen && !dialog.open) {
      if (modal) dialog.showModal?.()
      else dialog.show?.()
      const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 150)
      return () => window.clearTimeout(focusTimer)
    }
    if (!isOpen && dialog.open) dialog.close?.()
  }, [isOpen, modal])

  // A non-modal dialog gets no Escape or outside-click handling of its own.
  useEffect(() => {
    if (!isOpen || modal) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      // The lobby's Providers button toggles the drawer itself.
      if (!target || dialogRef.current?.contains(target) || target.closest('.nova-lobby-providers-btn')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [isOpen, modal, onClose])

  const shown = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return providers
      .filter(provider => !query || provider.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providers, searchQuery])

  const toggleProvider = (name: string) => setTempSelected(previous => previous.includes(name) ? previous.filter(item => item !== name) : [...previous, name])
  const apply = () => { onSelectProviders(tempSelected); onClose() }

  const dialog = (
    <dialog ref={dialogRef} className="nova-panel nova-rail-panel nova-provider-panel" aria-label="Filter Providers"
      onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="nova-panel-content">
        <header>
          <div>
            <span className="nova-eyebrow">{tempSelected.length > 0 ? `${tempSelected.length} of ${providers.length} selected` : `${providers.length} providers`}</span>
            <h2 id="provider-filter-title">Providers</h2>
          </div>
          <button type="button" className="nova-icon-button" aria-label="Close provider filters" onClick={onClose}><X size={20} /></button>
        </header>

        <label className="nova-provider-search">
          <Search aria-hidden="true" />
          <input ref={searchRef} type="text" aria-label="Search providers" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search providers…" />
        </label>
        {tempSelected.length > 0 && <p className="nova-provider-meta">
          <span>{tempSelected.length} selected</span>
          <button type="button" onClick={() => setTempSelected([])}>Clear</button>
        </p>}

        <div className="nova-provider-list">
          {loading ? <p className="nova-provider-empty">Loading providers…</p>
            : shown.length === 0 ? <p className="nova-provider-empty">{searchQuery.trim() ? `No providers match "${searchQuery.trim()}"` : 'No providers available'}</p>
            : shown.map(provider => {
              const selected = tempSelected.includes(provider.name)
              return <button key={provider.slug || provider.name} type="button" aria-pressed={selected}
                className={`nova-provider-row${selected ? ' is-selected' : ''}`} onClick={() => toggleProvider(provider.name)}>
                {provider.name}{selected && <Check aria-hidden="true" />}
              </button>
            })}
        </div>

        <div className="nova-provider-actions">
          <button type="button" className="nova-provider-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="nova-provider-apply" onClick={apply}>{tempSelected.length > 0 ? `Apply (${tempSelected.length})` : 'Show all'}</button>
        </div>
      </div>
    </dialog>
  )
  // Inside the shell, so the drawer takes the rail drawers' place, sizes and styles.
  return createPortal(dialog, document.querySelector('.nova-shell-matchbook') ?? document.body)
}
