import { forwardRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

type TextFieldProps = {
  id: string;
  label: string;
  icon?: ReactNode;
  error?: string | null;
  containerClassName?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ id, label, icon, error, containerClassName, className, type, ...inputProps }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const { t } = useTranslation();
    const containerClasses = `form-field ${containerClassName ? containerClassName : ""}`.trim();
    const invalid = !!error || inputProps["aria-invalid"] === true;
    const isPassword = type === "password";
    const errorId = `${id}-error`;
    const describedBy = [inputProps["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
    
    return (
      <div className={containerClasses}>
        <label htmlFor={id} className="mb-1 block text-xs text-[color:var(--ds-color-slate-450)]">
          {label}
        </label>
        <div className={`field ${invalid ? "field--invalid" : ""}`}>
          {icon && <span className="field__icon">{icon}</span>}
          <input
            id={id}
            ref={ref}
            className={`field__control ${className || ""}`}
            type={isPassword && showPassword ? "text" : type}
            {...inputProps}
            aria-invalid={error ? true : inputProps["aria-invalid"]}
            aria-describedby={describedBy}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="field__icon field__icon--right"
              aria-label={showPassword ? t('authUi.hidePassword', { defaultValue: 'Hide password' }) : t('authUi.showPassword', { defaultValue: 'Show password' })}
              aria-pressed={showPassword}
              aria-controls={id}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-[10px] text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }
);

TextField.displayName = "TextField";

export default TextField;


