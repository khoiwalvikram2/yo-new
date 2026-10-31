import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ModalSurface from './ModalSurface';
import TextField from "../forms/TextField";
import { useAuth } from "../../lib/auth";

export default function ChangePasswordModal({
  isOpen,
  onClose,
  forced = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  forced?: boolean;
}) {
  const { t } = useTranslation();
  const { changePassword, refreshUser, updateUser } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsSubmitting(false);
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  // Autofocus first field
  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => currentRef.current?.focus(), 0);
  }, [isOpen]);

  const newPasswordValid = useMemo(() => newPassword.trim().length >= 8 && /[A-Za-z]/.test(newPassword) && /\d/.test(newPassword), [newPassword]);
  const confirmValid = useMemo(() => confirmPassword === newPassword && newPasswordValid, [confirmPassword, newPassword, newPasswordValid]);
  const canSubmit = useMemo(() => currentPassword.trim().length > 0 && newPasswordValid && confirmValid && !isSubmitting, [currentPassword, newPasswordValid, confirmValid, isSubmitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await changePassword(currentPassword.trim(), newPassword.trim());
      setSuccess("Password updated successfully");
      if (forced && updateUser && refreshUser) {
        await new Promise((r) => setTimeout(r, 600));
        updateUser({ requirePasswordReset: false });
        refreshUser();
      }
      if (!forced) setTimeout(() => onClose(), 900);
    } catch (err) {
      setError((err as Error)?.message || "Failed to update password");
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalSurface open={isOpen} onClose={onClose} title={forced ? t('auth.forceChangePasswordTitle') : t('settings.changePassword')} titleId="change-password-title" description={forced ? t('auth.forceChangePasswordSubtitle') : 'Keep your account secure'} size="md" dismissible={!forced} className="nova-change-password-modal">
              <form onSubmit={handleSubmit} className="nova-modal-body">
                <div className="space-y-4">
                <TextField
                  id="cp-current"
                  label="Current password"
                  type="password"
                  ref={currentRef}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  icon={<Lock className="h-4 w-4 text-[color:var(--ds-color-slate-400)]" />}
                />

                <TextField
                  id="cp-new"
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 chars, include letters and numbers"
                  autoComplete="new-password"
                  icon={<Lock className="h-4 w-4 text-[color:var(--ds-color-slate-400)]" />}
                  error={!newPasswordValid && newPassword.length > 0 ? "Min 8 chars, letters and numbers required." : null}
                />

                <TextField
                  id="cp-confirm"
                  label="Confirm new password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  icon={<Lock className="h-4 w-4 text-[color:var(--ds-color-slate-400)]" />}
                  error={!confirmValid && confirmPassword.length > 0 ? "Passwords do not match." : null}
                />

                {error && (
                  <div role="alert" className="nova-modal-notice nova-modal-danger">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="7" x2="12" y2="13" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                  </div>
                )}
                {success && (
                  <div role="status" className="nova-modal-notice">
                    <span>{success}</span>
                  </div>
                )}
                </div>

                <div className="nova-modal-actions pt-5">
                  <button
                    type="submit"
                    aria-label="Update password"
                    aria-busy={isSubmitting}
                    disabled={!canSubmit || isSubmitting}
                    className="nova-button w-full"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <span>Update password</span>
                    )}
                  </button>
                </div>
              </form>
    </ModalSurface>
  );
}


