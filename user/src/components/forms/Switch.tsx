import type { HTMLAttributes } from 'react'
import './switch.css'

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
} & Omit<HTMLAttributes<HTMLButtonElement>, 'onChange'>

/** On/off switch: a pill track that turns green with the knob sliding right when on. */
export default function Switch({ checked, onChange, disabled, size = 'md', className = '', ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`nova-switch is-${size}${checked ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      <span className="nova-switch-knob" />
    </button>
  )
}
