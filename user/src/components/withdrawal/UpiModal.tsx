import { useEffect, useState } from 'react'
import { CreditCard, User2 } from 'lucide-react'
import TextField from '@/components/forms/TextField'
import ModalShell from './ModalShell'

export type UpiPayload = { upiId: string; holderName: string; isPrimary?: boolean }

export default function UpiModal({ isOpen, onClose, onSubmit }: { isOpen: boolean; onClose: () => void; onSubmit: (data: UpiPayload) => void }) {
  const [upiId, setUpiId] = useState('')
  const [holderName, setHolderName] = useState('')

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setUpiId('')
      setHolderName('')
    }
  }, [isOpen])
  const upiValid = /^[a-zA-Z0-9_.-]+@[a-zA-Z]+$/.test(upiId.trim())
  const nameValid = holderName.trim().length > 1
  const canSave = upiValid && nameValid
  return (
    <ModalShell title="Add UPI" icon={<CreditCard className="h-5 w-5" />} isOpen={isOpen} onClose={onClose}>
      <div className="wd-form">
        <TextField id="upi-id" label="UPI ID" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@bank" icon={<CreditCard className="h-4 w-4" />} />
        {!upiValid && upiId.length > 0 && <p className="wd-field-error">Enter UPI like name@bank</p>}
        <TextField id="upi-name" label="Account Holder Name" value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Full name" icon={<User2 className="h-4 w-4" />} />
        {!nameValid && holderName.length > 0 && <p className="wd-field-error">Enter a valid name</p>}
        <div className="wd-form-actions">
          <button disabled={!canSave} onClick={() => onSubmit({ upiId: upiId.trim(), holderName: holderName.trim(), isPrimary: false })} className="wd-btn wd-btn-primary">
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  )
}


