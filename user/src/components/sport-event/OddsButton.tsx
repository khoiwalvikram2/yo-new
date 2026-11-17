import { useEffect, useRef, useState, memo } from 'react'
import { MoveUp, MoveDown, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hasPrice } from '../nova/exchange-home/exchangeShared'

interface OddsButtonProps {
    value: number
    volume?: number
    isMain: boolean
    type: 'back' | 'lay'
    onClick: (e: React.MouseEvent) => void
    isVisible: boolean
  }

type ChangeDirection = 'up' | 'down' | null

  const OddsButton = memo(function OddsButton({
    value,
    volume,
    isMain,
    type,
    onClick,
    isVisible
  }: OddsButtonProps) {
  const { t } = useTranslation()
  const prevValueRef = useRef<number>(value)
  const [changeDirection, setChangeDirection] = useState<ChangeDirection>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const prevValue = prevValueRef.current

    if (prevValue !== value && value > 0 && prevValue > 0) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      setChangeDirection(value > prevValue ? 'up' : 'down')

      timeoutRef.current = setTimeout(() => {
        setChangeDirection(null)
      }, 800)
    }

    prevValueRef.current = value

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [value])

  // Matchbook ladder colours live in nova-sports-event.css: best back/lay deeper, the depth behind lighter.
  const tone = `nova-ev-odd ${type === 'back' ? 'is-back' : 'is-lay'}${isMain ? ' is-main' : ''}`

  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(1)}M`
    if (vol >= 1000) return `${(vol / 1000).toFixed(0)}K`
    return vol.toFixed(0)
    }

    // No price: a locked box that keeps its side tint and cannot open the bet slip.
    if (!hasPrice(value)) {
      const label = t('exchangeHome.suspended', { defaultValue: 'Suspended' })
      return (
        <span
          role="img"
          aria-label={label}
          title={label}
          data-locked="true"
          className={`${tone} is-locked relative overflow-hidden w-16 h-12 flex-col items-center justify-center ${!isVisible ? 'hidden sm:flex' : 'flex'}`}
        ><Lock aria-hidden="true" /></span>
      )
    }

    return (
        <button
          type="button"
          onClick={onClick}
      className={`${tone} relative overflow-hidden w-16 h-12 flex-col items-center justify-center ${!isVisible ? 'hidden sm:flex' : 'flex'}`}
        >
      {/* Arrow indicator - shows only on odds change */}
      {changeDirection === 'up' && (
        <div className="absolute right-0.5 inset-y-0 flex items-center pointer-events-none">
          <MoveUp className="w-3 h-3 text-emerald-700 animate-[arrowUp_0.7s_ease-out_forwards]" strokeWidth={2.5} />
        </div>
      )}
      {changeDirection === 'down' && (
        <div className="absolute right-0.5 inset-y-0 flex items-center pointer-events-none">
          <MoveDown className="w-3 h-3 text-red-700 animate-[arrowDown_0.7s_ease-out_forwards]" strokeWidth={2.5} />
        </div>
          )}

      <span className="nova-ev-odd-price">
        {value.toFixed(2)}
      </span>
      {volume !== undefined && volume > 0 && (
        <span className="nova-ev-odd-size">
          {formatVolume(volume)}
            </span>
          )}

      <style>{`
        @keyframes arrowUp {
          0% { opacity: 0; transform: translateY(10px) scale(1.1); }
          16% { opacity: 1; transform: translateY(6px) scale(1.1); }
          45% { opacity: 1; transform: translateY(0px) scale(1); }
          100% { opacity: 0; transform: translateY(-14px) scale(0.98); }
        }
        @keyframes arrowDown {
          0% { opacity: 0; transform: translateY(-10px) scale(1.1); }
          16% { opacity: 1; transform: translateY(-6px) scale(1.1); }
          45% { opacity: 1; transform: translateY(0px) scale(1); }
          100% { opacity: 0; transform: translateY(14px) scale(0.98); }
        }
      `}</style>
        </button>
    )
  }, (prevProps, nextProps) => {
    // Only re-render if value, volume, or visibility changes
    return (
      prevProps.value === nextProps.value &&
      prevProps.volume === nextProps.volume &&
      prevProps.isMain === nextProps.isMain &&
      prevProps.type === nextProps.type &&
      prevProps.isVisible === nextProps.isVisible
    )
  })

  export default OddsButton
