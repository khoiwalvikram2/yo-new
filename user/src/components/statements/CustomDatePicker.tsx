import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { getDefaultLocale } from '@/lib/currency'
import { getTodayKolkata } from '@/lib/dateUtils'
import './custom-date-picker.css'

type CustomDatePickerProps = {
  value: string
  onChange: (date: string) => void
  min?: string
  max?: string
  placeholder?: string
}

export default function CustomDatePicker({ value, onChange, min, max, placeholder = 'Select date' }: CustomDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Initialize currentMonth to selected date or today
  useEffect(() => {
    if (value) {
      const [year, month] = value.split('-').map(Number)
      setCurrentMonth(new Date(year, month - 1, 1))
    }
  }, [value])

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    const days: Array<{ day: number; date: Date; isCurrentMonth: boolean }> = []

    // Previous month days
    const prevMonth = new Date(year, month - 1, 0)
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      days.push({
        day: prevMonth.getDate() - i,
        date: new Date(year, month - 1, prevMonth.getDate() - i),
        isCurrentMonth: false,
      })
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({
        day,
        date: new Date(year, month, day),
        isCurrentMonth: true,
      })
    }

    // Next month days to fill the grid
    const remainingDays = 42 - days.length
    for (let day = 1; day <= remainingDays; day++) {
      days.push({
        day,
        date: new Date(year, month + 1, day),
        isCurrentMonth: false,
      })
    }

    return days
  }

  const formatDate = (date: Date) => {
    // Use local date to avoid timezone issues
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return ''
    const [year, month, day] = dateStr.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString(getDefaultLocale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' })
  }

  const handleDateSelect = (date: Date) => {
    const dateStr = formatDate(date)

    // Check min/max constraints (compare as strings in YYYY-MM-DD format)
    if (min && dateStr < min) return
    if (max && dateStr > max) return

    onChange(dateStr)
    setIsOpen(false)
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth((prev) => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  const goToToday = () => {
    setCurrentMonth(new Date())
    const todayStr = getTodayKolkata()
    if (!max || todayStr <= max) {
      onChange(todayStr)
      setIsOpen(false)
    }
  }

  const days = getDaysInMonth(currentMonth)
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const isDateSelected = (date: Date) => {
    if (!value) return false
    const dateStr = formatDate(date)
    return dateStr === value
  }

  const isToday = (date: Date) => {
    const dateStr = formatDate(date)
    return dateStr === getTodayKolkata()
  }

  const isDisabled = (date: Date) => {
    const dateStr = formatDate(date)
    return (min && dateStr < min) || (max && dateStr > max)
  }

  return (
    <div className="nova-dp" ref={containerRef}>
      {/* Input Field */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`nova-dp-trigger${isOpen ? ' is-open' : ''}`}
      >
        <Calendar className="nova-dp-icon" />
        <span className={`nova-dp-value${value ? '' : ' is-placeholder'}`}>
          {value ? formatDisplayDate(value) : placeholder}
        </span>
        {value && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            className="nova-dp-clear"
            aria-label="Clear date"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Calendar Popup */}
      {isOpen && (
        <div className="nova-dp-pop">
          {/* Header */}
          <div className="nova-dp-head">
            <button
              onClick={() => navigateMonth('prev')}
              className="nova-dp-nav"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="nova-dp-title">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </div>
            <button
              onClick={() => navigateMonth('next')}
              className="nova-dp-nav"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Week Days Header */}
          <div className="nova-dp-week">
            {weekDays.map((day) => (
              <div key={day} className="nova-dp-weekday">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="nova-dp-grid">
            {days.map((dayObj, idx) => {
              const selected = isDateSelected(dayObj.date)
              const isTodayDate = isToday(dayObj.date)
              const disabled = Boolean(isDisabled(dayObj.date))

              return (
                <button
                  key={idx}
                  onClick={() => !disabled && handleDateSelect(dayObj.date)}
                  disabled={disabled}
                  className={`nova-dp-day${dayObj.isCurrentMonth ? '' : ' is-outside'}${
                    selected ? ' is-selected' : isTodayDate ? ' is-today' : ''
                  }`}
                >
                  {dayObj.day}
                </button>
              )
            })}
          </div>

          {/* Today Button */}
          <div className="nova-dp-foot">
            <button
              onClick={goToToday}
              className="nova-dp-today"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
