import { useState } from 'react'
import { ChangePasswordModal } from '@/shared/ui/ChangePasswordModal'
import { ProfileMenuView } from './ProfileMenuView'
import { useLogout } from './useLogout'

export interface ProfileMenuProps {
  userName: string
  userRole: string
}

/**
 * Topbar profile menu container: owns the Change Password modal state and the sign-out action.
 * The modal is rendered outside the Menu, so closing the menu does not unmount it.
 */
export function ProfileMenu({ userName, userRole }: ProfileMenuProps) {
  const [showChangePassword, setShowChangePassword] = useState(false)
  const logout = useLogout()

  const openChangePassword = () => {
    // The menu returns focus to its trigger in a microtask after it closes. Opening the antd modal on the
    // next task lets that finish first, so the modal records the trigger as the element to refocus on close.
    window.setTimeout(() => setShowChangePassword(true), 0)
  }

  const signOut = () => {
    void logout()
  }

  return (
    <>
      <ProfileMenuView
        userName={userName}
        userRole={userRole}
        onChangePassword={openChangePassword}
        onSignOut={signOut}
      />
      <ChangePasswordModal open={showChangePassword} onClose={() => setShowChangePassword(false)} />
    </>
  )
}
