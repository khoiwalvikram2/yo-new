import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, Lock, User2, Loader2, Gift, Phone, Check, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../lib/auth";
import { extractApiMessage } from "@/lib/errors";
import { notify } from "@/lib/notify";
import TextField from "../forms/TextField";
import OtpInput from "../forms/OtpInput";
import ModalSurface from "./ModalSurface";
import AuthIntro from "./AuthIntro";
import { graphqlRequest } from "@/lib/graphqlClient";
import { useAppIdentity, useFeatureFlags } from "@/hooks/useAppSettings";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function RegisterModal() {
  const { t } = useTranslation();
  const { whatsappSupportPhone } = useAppIdentity();
  const features = useFeatureFlags();
  const registerEnabled = features.registerEnabled ?? true;
  const { isAuthModalOpen, authModalMode, closeAuthModal, openAuthModal, register, registerWithOtp } = useAuth();
  const waNumber = (whatsappSupportPhone?.trim() || "").replace(/\D/g, "");
  const whatsAppRegisterUrl = waNumber.length >= 8
    ? "https://wa.me/" + waNumber + "?text=" + encodeURIComponent("Hi, I want to create an account.")
    : null;
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneValidationStatus, setPhoneValidationStatus] = useState<"checking" | "error" | "success" | "">("");
  const [phoneValidationMessage, setPhoneValidationMessage] = useState("");
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const isOpen = isAuthModalOpen && authModalMode === "register" && registerEnabled;
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const referralCode = useMemo(() => {
    if (!isOpen) return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlRef = params.get("ref") || params.get("affiliateCode");
      if (urlRef) return urlRef.trim().toUpperCase();
      const stored = localStorage.getItem("referral_code");
      if (stored) {
        const referralData = JSON.parse(stored);
        if (referralData.expiresAt && Date.now() < referralData.expiresAt) return referralData.code;
      }
    } catch { /* A malformed or expired referral must not prevent registration. */ }
    return null;
  }, [isOpen]);

  useEffect(() => {
    generationRef.current += 1;
    busyRef.current = false;
    if (!isOpen) {
      setUsername(""); setIdentifier(""); setPassword(""); setConfirmPassword("");
      setOtp(""); setOtpSent(false); setResendIn(0); setError(null); setIsSubmitting(false);
      setPhoneValidationStatus(""); setPhoneValidationMessage("");
      return;
    }
    const timer = setTimeout(() => usernameInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    setPhoneValidationStatus(""); setPhoneValidationMessage("");
    if (!isOpen || otpSent || identifier.length < 6) return;
    let active = true;
    const timer = setTimeout(async () => {
      setPhoneValidationStatus("checking");
      try {
        const data = await graphqlRequest<{ checkPhoneAvailable: { available: boolean; message: string | null } }>(
          "query CheckPhoneAvailable($phone: String!) { checkPhoneAvailable(phone: $phone) { available message } }",
          { phone: "+91" + identifier }
        );
        if (!active) return;
        if (data?.checkPhoneAvailable) {
          const { available, message } = data.checkPhoneAvailable;
          setPhoneValidationStatus(available ? "success" : "error");
          setPhoneValidationMessage(available ? "" : message || t("auth.phoneRegistered"));
        } else setPhoneValidationStatus("");
      } catch {
        if (active) { setPhoneValidationStatus(""); setPhoneValidationMessage(""); }
      }
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [identifier, isOpen, otpSent, t]);

  const usernameValid = useMemo(() => username.trim().length >= 3, [username]);
  const phoneValid = useMemo(() => /^[0-9]{10}$/.test(identifier.trim()) && phoneValidationStatus !== "error", [identifier, phoneValidationStatus]);
  const passwordValid = useMemo(() => password.trim().length >= 8, [password]);
  const confirmPasswordValid = useMemo(() => confirmPassword.trim().length >= 6 && confirmPassword === password, [confirmPassword, password]);
  const otpValid = useMemo(() => /^\d{4}$/.test(otp.trim()), [otp]);
  const canSubmit = usernameValid && (otpSent ? phoneValid && otpValid : phoneValid && passwordValid && confirmPasswordValid);

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const generation = generationRef.current;
    await runRequest(async () => {
      const phone = "+91" + identifier.trim();
      if (otpSent) {
        await registerWithOtp(username.trim(), phone, otp.trim());
        notify.success(t("auth.registerSuccess"));
        if (openRef.current && generationRef.current === generation) closeAuthModal();
      } else {
        await register(username.trim(), phone, password.trim(), confirmPassword.trim());
        if (!openRef.current || generationRef.current !== generation) return;
        setOtpSent(true); setResendIn(120); notify.success(t("auth.codeSent"));
      }
    });
  };
  const resendCode = async () => {
    if (resendIn > 0 || !phoneValid) return;
    const generation = generationRef.current;
    await runRequest(async () => {
      // A signup code is a 'register' OTP: registerUser checks it under that purpose, so the resend goes
      // through register() (registerUser without an OTP sends one) rather than requestOtp, whose code is
      // a login OTP the signup would always reject. The server's OTP throttle applies to both.
      await register(username.trim(), "+91" + identifier.trim(), password.trim(), confirmPassword.trim());
      if (!openRef.current || generationRef.current !== generation) return;
      setResendIn(120); notify.success(t("auth.codeSent"));
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

  const usernameError = username.length > 0 && !usernameValid;
  const phoneError = identifier.length > 0 && !phoneValid;
  const passwordError = password.length > 0 && !passwordValid;
  const confirmError = confirmPassword.length > 0 && !confirmPasswordValid;
  const title = otpSent ? t("auth.verifyTitle") : t("auth.registerTitle");

  return <ModalSurface open={isOpen} onClose={closeAuthModal} title={title} titleId="register-modal-title" size="auth" hideHeader className="nova-auth-modal">
    <div className="nova-auth-layout">
      <AuthIntro onNavigate={closeAuthModal} />
      <section className="nova-auth-form-panel">
        <button type="button" className="nova-modal-close" aria-label={t("common.close")} onClick={closeAuthModal}><X size={20} aria-hidden="true" /></button>
        <div className="nova-auth-tabs" aria-label={t("auth.accountAccess")}>
          <button type="button" aria-pressed="false" disabled={isSubmitting} onClick={() => openAuthModal("login")}>{t("nav.login")}</button>
          <button type="button" aria-pressed="true">{t("nav.register")}</button>
        </div>
        <header className="nova-auth-heading"><h2 id="register-modal-title">{title}</h2><p>{otpSent ? t("auth.verifyDescription") : t("auth.registerDescription")}</p></header>
        <form onSubmit={handleSubmit} className="nova-auth-form" aria-busy={isSubmitting}>
          <div>
            <TextField id="register-username" label={t("auth.nameLabel")} ref={usernameInputRef} type="text" autoComplete="name" required readOnly={otpSent || isSubmitting}
              value={username} onChange={event => setUsername(event.target.value)} placeholder={t("auth.namePlaceholder")} icon={<User2 size={16} aria-hidden="true" />}
              aria-invalid={usernameError} aria-describedby={usernameError ? "register-name-error" : undefined} />
            {usernameError && <p id="register-name-error" className="nova-auth-error">{t("auth.nameRule")}</p>}
          </div>
          <div className="form-field">
            <label htmlFor="register-phone">{t("auth.phoneLabel")}</label>
            <div className={"field nova-auth-phone" + (phoneError ? " field--invalid" : "")}>
              <span className="nova-auth-phone-code" aria-hidden="true"><Phone size={16} />+91</span>
              <input id="register-phone" type="tel" inputMode="numeric" autoComplete="tel-national" required readOnly={otpSent || isSubmitting}
                value={identifier} onChange={event => setIdentifier(event.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder={t("auth.phonePlaceholder")} className="field__control" aria-invalid={phoneError} aria-describedby={phoneError ? "register-phone-error" : phoneValidationStatus === "checking" ? "register-phone-status" : undefined} />
              <span className="nova-auth-phone-status" aria-hidden="true">
                {phoneValidationStatus === "checking" && <Loader2 size={16} className="animate-spin" />}
                {phoneValidationStatus === "success" && <Check size={16} />}
                {phoneValidationStatus === "error" && <CircleAlert size={16} />}
              </span>
            </div>
            {phoneError && <p id="register-phone-error" className="nova-auth-error">{phoneValidationMessage || t("auth.phoneError")}</p>}
            {phoneValidationStatus === "checking" && <p id="register-phone-status" className="nova-auth-note" role="status">{t("auth.checkingPhone")}</p>}
          </div>
          {referralCode && <div className="nova-auth-referral"><Gift size={18} aria-hidden="true" /><div><span>{t("referral.referralCodeLabel")}</span><strong>{referralCode}</strong></div></div>}
          {!otpSent && <div className="nova-auth-passwords">
            <div>
              <TextField id="register-password" label={t("auth.passwordLabel")} type="password" autoComplete="new-password" required disabled={isSubmitting}
                value={password} onChange={event => setPassword(event.target.value)} icon={<Lock size={16} aria-hidden="true" />} aria-invalid={passwordError} aria-describedby="register-password-hint" />
              <p id="register-password-hint" className={passwordError ? "nova-auth-error" : "nova-auth-note"}>{t("auth.registerPasswordRule")}</p>
            </div>
            <div>
              <TextField id="register-confirm-password" label={t("auth.confirmPasswordLabel")} type="password" autoComplete="new-password" required disabled={isSubmitting}
                value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} icon={<Check size={16} aria-hidden="true" />} aria-invalid={confirmError} aria-describedby={confirmError ? "register-confirm-password-error" : undefined} />
              {confirmError && <p id="register-confirm-password-error" className="nova-auth-error">{t("auth.passwordMismatch")}</p>}
            </div>
          </div>}
          {otpSent && <fieldset className="nova-auth-code" disabled={isSubmitting}>
            <legend>{t("auth.codeLabel")}</legend>
            <p id="register-code-hint" className="nova-auth-note">{t("auth.codeHint", { phone: "+91 " + identifier })}</p>
            <div role="group" aria-labelledby="register-code-hint"><OtpInput value={otp} onPaste={handleOtpPaste} onChangeAt={handleOtpChange} onKeyDownAt={() => {}} /></div>
            <div className="nova-auth-inline">
              <button type="button" onClick={() => { setOtpSent(false); setOtp(""); setResendIn(0); setError(null); }}>{t("auth.changeDetails")}</button>
              <button type="button" disabled={resendIn > 0 || isSubmitting || !phoneValid} onClick={resendCode}>{resendIn > 0 ? t("auth.resendWait", { seconds: resendIn }) : t("auth.resendCode")}</button>
            </div>
          </fieldset>}
          {error && <div role="alert" className="nova-auth-error nova-auth-error-panel"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span></div>}
          <div className="nova-auth-actions">
            <button type="submit" className="nova-button-primary" disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}<span>{isSubmitting ? t("auth.working") : otpSent ? t("auth.verifySignIn") : t("auth.createAccount")}</span>
            </button>
            {whatsAppRegisterUrl && <span className="nova-auth-divider">{t("auth.orDivider")}</span>}
            {whatsAppRegisterUrl && <a href={whatsAppRegisterUrl} target="_blank" rel="noopener noreferrer" className="nova-button-secondary nova-auth-whatsapp"><WhatsAppIcon className="h-5 w-5 shrink-0" /><span>{t("auth.whatsAppRegister")}</span></a>}
          </div>
        </form>
        <footer className="nova-auth-footer">
          <p>{t("auth.haveAccount")} <button type="button" disabled={isSubmitting} onClick={() => openAuthModal("login")}>{t("auth.signIn")}</button></p>
          <p className="nova-auth-legal">{t("auth.registerLegal")} <Link to="/terms" onClick={closeAuthModal}>{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy" onClick={closeAuthModal}>{t("auth.privacy")}</Link>.</p>
        </footer>
      </section>
    </div>
  </ModalSurface>;
}
