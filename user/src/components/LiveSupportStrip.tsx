import { useTranslation } from "react-i18next";
import { Headphones, ArrowRight } from "lucide-react";
import { useAppIdentity } from "../hooks/useAppSettings";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function LiveSupportStrip() {
  const { t } = useTranslation();
  const { whatsappSupportPhone } = useAppIdentity();
  const phone = whatsappSupportPhone?.trim();
  if (!phone) return null;

  const waNumber = phone.replace(/\D/g, "");
  if (!waNumber) return null;

  const displayPhone = phone.startsWith("+") ? phone : `+${waNumber}`;
  const waUrl = `https://wa.me/${waNumber}`;

  return (
    <div className="bg-[color:var(--ds-color-slate-900)] border-t border-[color:var(--ds-color-slate-800)]">
      <div className="max-w-[1400px] mx-auto w-full px-4 sm:px-5 md:px-6 py-4 sm:py-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
          {/* Left: icon + text */}
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-center sm:justify-start">
            <div className="shrink-0 h-11 w-11 rounded-[5px] bg-[color:var(--ds-color-slate-800)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center">
              <Headphones className="h-5 w-5 text-[color:var(--ds-color-slate-300)]" />
            </div>
            <div>
              <div className="text-sm sm:text-base font-semibold text-[color:var(--text)]">
                {t("footer.liveSupport")}
              </div>
              <div className="text-xs text-[color:var(--ds-color-slate-400)]">
                {t("footer.liveSupportSub")}
              </div>
            </div>
          </div>

          {/* Right: WhatsApp button */}
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="w-full sm:w-auto flex items-center justify-between sm:justify-center gap-3 px-4 py-3 sm:px-5 sm:py-3 rounded-[5px] bg-gradient-to-r from-green-500 to-green-700 hover:from-green-600 hover:to-green-800 text-white font-semibold text-sm transition-all min-h-[48px]"
          >
            <span className="flex items-center gap-2">
              <WhatsAppIcon className="h-5 w-5 shrink-0 text-white" />
              <span className="flex flex-col items-start">
                <span className="uppercase tracking-wide">{t("footer.chatOnWhatsApp")}</span>
                <span className="text-xs font-normal opacity-90">{displayPhone}</span>
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0" />
          </a>
        </div>
      </div>
    </div>
  );
}
