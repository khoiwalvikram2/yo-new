import { useEffect, useState } from 'react'
import { Building2, User2, Hash, Landmark } from 'lucide-react'
import TextField from '@/components/forms/TextField'
import ModalShell from './ModalShell'

export type BankPayload = { holderName: string; accountNumber: string; ifsc: string; bankName?: string; isPrimary?: boolean }

export default function BankModal({ isOpen, onClose, onSubmit }: { isOpen: boolean; onClose: () => void; onSubmit: (data: BankPayload) => void }) {
  const [holderName, setHolderName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [bankName, setBankName] = useState('')

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setHolderName('')
      setAccountNumber('')
      setIfsc('')
      setBankName('')
    }
  }, [isOpen])
  const accValid = accountNumber.trim().length >= 9
  const ifscValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())
  const nameValid = holderName.trim().length > 1
  const canSave = accValid && ifscValid && nameValid

  return (
    <ModalShell title="Add Bank Account" icon={<Building2 className="h-5 w-5" />} isOpen={isOpen} onClose={onClose}>
      <div className="wd-form">
        <TextField id="bank-holder" label="Account Holder Name" value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Full name" icon={<User2 className="h-4 w-4" />} />
        {!nameValid && holderName.length > 0 && <p className="wd-field-error">Enter a valid name</p>}
        <TextField id="bank-acc" label="Account Number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="1234567890" icon={<Hash className="h-4 w-4" />} />
        {!accValid && accountNumber.length > 0 && <p className="wd-field-error">Enter a valid account number</p>}
        <TextField id="bank-ifsc" label="IFSC" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234" icon={<Hash className="h-4 w-4" />} />
        {!ifscValid && ifsc.length > 0 && <p className="wd-field-error">IFSC format ABCD0XXXXXX</p>}
        <TextField id="bank-name" label="Bank Name (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g., HDFC Bank" icon={<Landmark className="h-4 w-4" />} />
        <div className="wd-form-actions">
          <button disabled={!canSave} onClick={() => onSubmit({ holderName: holderName.trim(), accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase(), bankName: bankName.trim() || undefined, isPrimary: false })} className="wd-btn wd-btn-primary">
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  )
}


