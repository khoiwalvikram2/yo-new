import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, Lock, Loader2, ArrowLeft, Phone, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../lib/auth";
import { useFeatureFlags } from "../../hooks/useAppSettings";
import { extractApiMessage } from "@/lib/errors";
import { notify } from "@/lib/notify";
import TextField from "../forms/TextField";
import OtpInput from "../forms/OtpInput";
import ModalSurface from "./ModalSurface";
import AuthIntro from "./AuthIntro";

const RESEND_MAX = 120;

export default function LoginModal() {
  const { t } = useTranslation();
  const { isAuthModalOpen, authModalMode, closeAuthModal, openAuthModal, login, requestOtp, loginWithOtp, requestResetOtp, resetPassword } = useAuth();
  const features = useFeatureFlags();
  const registerEnabled = features.registerEnabled ?? true;
  const isOpen = isAuthModalOpen && authModalMode === "login";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const idInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  useEffect(() => {
    generationRef.current += 1;
    busyRef.current = false;
    if (!isOpen) {
      setIdentifier(""); setPassword(""); setError(null); setIsSubmitting(false);
      setOtp(""); setOtpSent(false); setResendIn(0); setForgotPasswordMode(false);
      setNewPassword(""); setConfirmPassword("");
      return;
    }
    const timer = setTimeout(() => idInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const phoneValid = useMemo(() => /^[0-9]{10}$/.test(identifier.trim()), [identifier]);
  const passwordValid = useMemo(() => password.trim().length >= 6, [password]);
  const otpValid = useMemo(() => /^\d{4}$/.test(otp.trim()), [otp]);
  const newPasswordValid = useMemo(() => {
    const value = newPassword.trim();
    return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
  }, [newPassword]);
  const passwordsMatch = newPassword.trim() === confirmPassword.trim();
  const canSubmit = forgotPasswordMode
    ? (otpSent ? phoneValid && otpValid && newPasswordValid && passwordsMatch : phoneValid)
    : (otpSent ? phoneValid && otpValid : phoneValid && passwordValid);

  const runRequest = async (request: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = generationRef.current;
    setIsSubmitting(true); setError(null);
    try { await request(); }
    catch (err) {
      if (openRef.current && generationRef.current === generation) {
        const message = extractApiMessage(err, t("auth.requestError"));
        setError(message); notify.error(message);
      }
    } finally {
      if (generationRef.current === generation) { busyRef.current = false; setIsSubmitting(false); }
    }
  };

  const sendCode = async () => {
    if (!phoneValid || resendIn > 0) return;
    const generation = generationRef.current;
    await runRequest(async () => {
      const phone = "+91" + identifier.trim();
      if (forgotPasswordMode) await requestResetOtp(phone);
      else await requestOtp(phone);
      if (!openRef.current || generationRef.current !== generation) return;
      setOtpSent(true); setResendIn(RESEND_MAX); notify.success(t("auth.codeSent"));
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (forgotPasswordMode && !otpSent) { await sendCode(); return; }
    const generation = generationRef.current;
    await runRequest(async () => {
      const phone = "+91" + identifier.trim();
      if (forgotPasswordMode) {
        await resetPassword(phone, otp.trim(), newPassword.trim());
        if (!openRef.current || generationRef.current !== generation) return;
        notify.success(t("auth.passwordResetSuccess"));
        setForgotPasswordMode(false); setOtpSent(false); setOtp(""); setResendIn(0);
        setNewPassword(""); setConfirmPassword("");
      } else {
        if (otpSent) await loginWithOtp(phone, otp.trim());
        else await login(phone, password.trim());
        notify.success(t("auth.signInSuccess"));
      }
    });
  };

  const handleOtpChange = (index: number, value: string) => {
    const digits = Array.from({ length: 4 }, (_, digit) => otp[digit] || " ");
    digits[index] = value.replace(/\D/g, "").slice(0, 1) || " ";
    setOtp(digits.join(""));
  };
  const handleOtpPaste = (event: React.ClipboardEvent) => {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (!digits) return;
    event.preventDefault(); setOtp(digits);
  };
  const backToPassword = () => {
    setForgotPasswordMode(false); setOtpSent(false); setOtp(""); setResendIn(0);
    setNewPassword(""); setConfirmPassword(""); setError(null);
  };

  const title = forgotPasswordMode ? t("auth.resetTitle") : t("auth.loginTitle");
  const phoneError = identifier.length > 0 && !phoneValid;
  const passwordError = password.length > 0 && !passwordValid;
  const newPasswordError = newPassword.length > 0 && !newPasswordValid;
  const confirmError = confirmPassword.length > 0 && !passwordsMatch;
  const submitLabel = forgotPasswordMode
    ? (otpSent ? t("auth.resetTitle") : t("auth.sendCode"))
    : (otpSent ? t("auth.verifySignIn") : t("auth.signIn"));

  return <ModalSurface open={isOpen} onClose={closeAuthModal} title={title} titleId="login-modal-title" size="auth" hideHeader className="nova-auth-modal">
    <div className="nova-auth-layout">
      <AuthIntro onNavigate={closeAuthModal} />
      <section className="nova-auth-form-panel">
        <button type="button" className="nova-modal-close" aria-label={t("common.close")} onClick={closeAuthModal}><X size={20} aria-hidden="true" /></button>
        <div className="nova-auth-tabs" aria-label={t("auth.accountAccess")}>
          <button type="button" aria-pressed="true" disabled={isSubmitting} onClick={backToPassword}>{t("nav.login")}</button>
          {registerEnabled && <button type="button" aria-pressed="false" disabled={isSubmitting} onClick={() => openAuthModal("register")}>{t("nav.register")}</button>}
        </div>
        <header className="nova-auth-heading"><h2 id="login-modal-title">{title}</h2><p>{forgotPasswordMode ? t("auth.resetDescription") : t("auth.loginDescription")}</p></header>
        <form onSubmit={handleSubmit} className="nova-auth-form" aria-busy={isSubmitting}>
          <div className="form-field">
            <label htmlFor="login-phone">{t("auth.phoneLabel")}</label>
            <div className={"field nova-auth-phone" + (phoneError ? " field--invalid" : "")}>
              <span className="nova-auth-phone-code" aria-hidden="true"><Phone size={16} />+91</span>
              <input id="login-phone" ref={idInputRef} type="tel" inputMode="numeric" autoComplete="tel-national" required readOnly={otpSent || isSubmitting}
                value={identifier} onChange={event => setIdentifier(event.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder={t("auth.phonePlaceholder")} className="field__control" aria-invalid={phoneError} aria-describedby={phoneError ? "login-phone-error" : undefined} />
            </div>
            {phoneError && <p id="login-phone-error" className="nova-auth-error">{t("auth.phoneError")}</p>}
          </div>
          {!otpSent && !forgotPasswordMode && <div>
            <TextField id="login-password" label={t("auth.passwordLabel")} type="password" value={password} onChange={event => setPassword(event.target.value)}
              autoComplete="current-password" required disabled={isSubmitting} icon={<Lock size={16} aria-hidden="true" />}
              aria-invalid={passwordError} aria-describedby={passwordError ? "login-password-error" : undefined} />
            {passwordError && <p id="login-password-error" className="nova-auth-error">{t("auth.loginPasswordRule")}</p>}
            <div className="nova-auth-inline">
              <button type="button" disabled={isSubmitting} onClick={() => { setForgotPasswordMode(true); setPassword(""); setError(null); }}>{t("auth.forgotPassword")}</button>
              <button type="button" disabled={!phoneValid || isSubmitting} title={t("auth.useCode")} onClick={sendCode}>{t("auth.sendCode")}</button>
            </div>
          </div>}
          {otpSent && <fieldset className="nova-auth-code" disabled={isSubmitting}>
            <legend>{t("auth.codeLabel")}</legend>
            <p id="login-code-hint" className="nova-auth-note">{t("auth.codeHint", { phone: "+91 " + identifier })}</p>
            <div role="group" aria-labelledby="login-code-hint"><OtpInput value={otp} onPaste={handleOtpPaste} onChangeAt={handleOtpChange} onKeyDownAt={() => {}} /></div>
            <div className="nova-auth-inline">
              <button type="button" onClick={() => { setOtpSent(false); setOtp(""); setResendIn(0); setError(null); }}><ArrowLeft size={14} aria-hidden="true" />{forgotPasswordMode ? t("auth.changePhone") : t("auth.usePassword")}</button>
              <button type="button" disabled={resendIn > 0 || isSubmitting || !phoneValid} onClick={sendCode}>{resendIn > 0 ? t("auth.resendWait", { seconds: resendIn }) : t("auth.resendCode")}</button>
            </div>
          </fieldset>}
          {forgotPasswordMode && otpSent && <div className="nova-auth-passwords">
            <div>
              <TextField id="new-password" label={t("auth.newPasswordLabel")} type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)}
                autoComplete="new-password" required disabled={isSubmitting} icon={<Lock size={16} aria-hidden="true" />} aria-invalid={newPasswordError} aria-describedby="login-new-password-hint" />
              <p id="login-new-password-hint" className={newPasswordError ? "nova-auth-error" : "nova-auth-note"}>{t("auth.resetPasswordRule")}</p>
            </div>
            <div>
              <TextField id="confirm-password" label={t("auth.confirmPasswordLabel")} type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
                autoComplete="new-password" required disabled={isSubmitting} icon={<Lock size={16} aria-hidden="true" />} aria-invalid={confirmError} aria-describedby={confirmError ? "login-confirm-password-error" : undefined} />
              {confirmError && <p id="login-confirm-password-error" className="nova-auth-error">{t("auth.passwordMismatch")}</p>}
            </div>
          </div>}
          {error && <div role="alert" className="nova-auth-error nova-auth-error-panel"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span></div>}
          <div className="nova-auth-actions">
            <button type="submit" className="nova-button-primary" disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}<span>{isSubmitting ? t("auth.working") : submitLabel}</span>
            </button>
            {forgotPasswordMode && <button type="button" className="nova-button-secondary" disabled={isSubmitting} onClick={backToPassword}><ArrowLeft size={16} aria-hidden="true" />{t("auth.backToLogin")}</button>}
          </div>
        </form>
        <footer className="nova-auth-footer">
          {registerEnabled && <p>{t("auth.newHere")} <button type="button" disabled={isSubmitting} onClick={() => openAuthModal("register")}>{t("auth.createAccount")}</button></p>}
          <p className="nova-auth-legal">{t("auth.loginLegal")} <Link to="/terms" onClick={closeAuthModal}>{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy" onClick={closeAuthModal}>{t("auth.privacy")}</Link>.</p>
        </footer>
      </section>
    </div>
  </ModalSurface>;
}
