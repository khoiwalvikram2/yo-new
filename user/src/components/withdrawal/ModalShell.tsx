import type { ReactNode } from 'react'
import ModalSurface from '../modals/ModalSurface'

export default function ModalShell({ title, icon, isOpen, onClose, children }: { title: string; icon: ReactNode; isOpen: boolean; onClose: () => void; children: ReactNode }) {
  if (!isOpen) return null
  return (
    <ModalSurface open={isOpen} onClose={onClose} title={title} size="md" className="nova-account-form-modal wd-modal">
      <div className="nova-modal-body"><span className="nova-modal-form-mark" aria-hidden="true">{icon}</span>{children}</div>
    </ModalSurface>
  )
}


