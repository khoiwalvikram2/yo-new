import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type FilterOption = { value: string; label: string }

type FilterSelectProps = {
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  className?: string
}

/**
 * A filter strip's dropdown, drawn as the admin filter bar's: the cell shows the chosen value and a chevron, and
 * opens a list under it whose chosen row carries a tick and whose pointed-at row a red bar on its leading edge.
 * The list is placed against the directory (a positioned ancestor outside the strip), so the strip's rounded clip
 * does not cut it; it keeps inside the directory's width when the cell sits at the right edge.
 */
export function FilterSelect({ label, value, options, onChange, className = '' }: FilterSelectProps) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const chosen = Math.max(0, options.findIndex(option => option.value === value))

  const show = () => { setActive(chosen); setOpen(true) }
  const pick = (index: number) => { setOpen(false); if (options[index].value !== value) onChange(options[index].value) }

  useLayoutEffect(() => {
    const root = rootRef.current, list = listRef.current, frame = list?.offsetParent
    if (!open || !root || !list || !frame) return
    const place = () => {
      const cell = root.getBoundingClientRect(), base = frame.getBoundingClientRect()
      list.style.top = `${cell.bottom - base.top + 4}px`
      list.style.minWidth = `${cell.width}px`
      list.style.left = `${Math.max(0, Math.min(cell.left - base.left, base.width - list.offsetWidth))}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show() }
      return
    }
    const move: Record<string, number> = { ArrowDown: Math.min(active + 1, last), ArrowUp: Math.max(active - 1, 0), Home: 0, End: last }
    if (event.key in move) { event.preventDefault(); setActive(move[event.key]) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(active) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return <div ref={rootRef} className={`gw-matka-filter-select${className ? ` ${className}` : ''}`} data-open={open || undefined}>
    <button type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown}>
      <span>{options[chosen]?.label}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} className="gw-matka-filter-list">
      {options.map((option, index) => <li key={option.value} id={`${id}-${index}`} role="option" aria-selected={index === chosen} data-active={index === active || undefined}
        onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => pick(index)}>
        <span>{option.label}</span>{index === chosen && <Check size={15} aria-hidden="true" />}
      </li>)}
    </ul>}
  </div>
}
