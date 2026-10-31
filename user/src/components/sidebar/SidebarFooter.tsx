import { ChevronDown, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LanguageCode } from "@/types";
import { getCurrencySymbol } from "@/lib/currency";
import { applyLanguage } from "@/lib/locale";

type Language = { code: string; name: string; flag: string };

type Props = {
  languages: Language[];
  initialLanguage: LanguageCode;
  baseCurrency?: string;
  timeZone?: string | null;
};

function safeCurrencySymbol(code: string) {
  try {
    return getCurrencySymbol(code);
  } catch {
    return code;
  }
}

function shortTimeZone(timeZone: string | null | undefined, fallback: string) {
  if (!timeZone) return fallback;
  if (/Asia\/(Kolkata|Calcutta)/i.test(timeZone)) return "IST";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value || timeZone;
  } catch {
    return timeZone;
  }
}

export default function SidebarFooter({
  languages,
  initialLanguage,
  baseCurrency = "INR",
  timeZone,
}: Props) {
  const { t, i18n } = useTranslation();
  const currentLanguage = (i18n?.resolvedLanguage || i18n?.language || initialLanguage).split(/[-_]/)[0];
  const selectedLanguage = languages.some(item => item.code === currentLanguage) ? currentLanguage : initialLanguage;
  const zoneLabel = shortTimeZone(timeZone, t("nova.localTime"));

  return (
    <div className="nova-sidebar-locale nova-locale-settings">
        <span className="nova-locale-currency" title={t("nova.baseCurrency")}>
          <b>{safeCurrencySymbol(baseCurrency)}</b>
          <span>{baseCurrency}</span>
        </span>
        <div className="nova-locale-language">
          <Languages aria-hidden="true" />
          <div className="nova-locale-field">
            <select aria-label={t("settings.language")} value={selectedLanguage}
              onChange={event => applyLanguage(event.target.value as LanguageCode)}>
              {languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
            <small>{zoneLabel}</small>
          </div>
          <ChevronDown aria-hidden="true" />
        </div>
    </div>
  );
}
