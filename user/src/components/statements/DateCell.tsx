import './statements-ui.css'

const IST = 'Asia/Kolkata'

export default function DateCell({ iso }: { iso: string }) {
  const d = new Date(iso)
  return (
    <div className="nova-stmt-date">
      <div className="nova-stmt-date-day">{d.toLocaleDateString(undefined, { timeZone: IST })}</div>
      <div className="nova-stmt-date-time">{d.toLocaleTimeString(undefined, { timeZone: IST })}</div>
    </div>
  )
}

