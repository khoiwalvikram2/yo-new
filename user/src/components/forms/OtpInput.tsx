import { forwardRef, useRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";

type OtpInputProps = {
  value: string;
  onChangeAt: (index: number, value: string) => void;
  onKeyDownAt: (index: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  length?: number;
};

const OtpInput = forwardRef<HTMLInputElement[], OtpInputProps>(
  ({ value, onChangeAt, onKeyDownAt, onPaste, length = 4 }, ref) => {
    const digits = Array.from({ length }, (_, i) => /\d/.test(value[i] || "") ? value[i] : "");
    const { t } = useTranslation();
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

    useImperativeHandle(ref, () => {
      // Expose current input elements as an array
      return (inputRefs.current.filter(Boolean) as HTMLInputElement[]);
    });

    return (
      <div
        className="mt-1 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
        onPaste={onPaste}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            aria-label={t('authUi.otpDigit', { position: i + 1, count: length, defaultValue: `Code digit ${i + 1} of ${length}` })}
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={1}
            className="otp-input"
            value={d}
            onMouseDown={(e) => {
              // Prevent focus-loss on re-render due to state updates
              e.preventDefault();
              inputRefs.current[i]?.focus();
            }}
            onFocus={(e) => {
              // Select existing digit for quick replacement
              e.currentTarget.select();
            }}
            onChange={(e) => {
              onChangeAt(i, e.target.value);
              const val = e.target.value.replace(/\D/g, "").slice(0, 1);
              if (val && i < length - 1) {
                inputRefs.current[i + 1]?.focus();
              }
            }}
            onKeyDown={(e) => {
              onKeyDownAt(i, e);
              if (e.key === "Backspace" && !e.currentTarget.value && i > 0) {
                e.preventDefault();
                inputRefs.current[i - 1]?.focus();
              }
              if (e.key === "ArrowLeft" && i > 0) {
                e.preventDefault();
                inputRefs.current[i - 1]?.focus();
              }
              if (e.key === "ArrowRight" && i < length - 1) {
                e.preventDefault();
                inputRefs.current[i + 1]?.focus();
              }
            }}
          />
        ))}
      </div>
    );
  }
);

OtpInput.displayName = "OtpInput";

export default OtpInput;


