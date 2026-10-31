const STORAGE_KEY = "stakex_currency";
let whitelabelBaseCurrency: string | null = null;
let whitelabelDefaultLocale: string | null = null;

function normalizeLocale(locale: string | null | undefined): string {
  if (!locale || typeof locale !== "string") return "en-IN";
  return locale.trim().replace(/_/g, "-") || "en-IN";
}

/** Call when app settings load to use whitelabel base currency and locale for formatting. */
export function setWhitelabelCurrencyDefaults(baseCurrency: string, locale?: string | null): void {
  whitelabelBaseCurrency = baseCurrency || null;
  whitelabelDefaultLocale = locale != null ? normalizeLocale(locale) : null;
}

export function getCurrencyFromStorage(): string {
  if (typeof window === "undefined") return whitelabelBaseCurrency ?? "INR";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v || (whitelabelBaseCurrency ?? "INR");
}

export function setCurrencyToStorage(code: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, code);
}

export function formatAmount(
  amount: number,
  code: string = getCurrencyFromStorage(),
  locale?: string
): string {
  const resolvedLocale = locale ?? whitelabelDefaultLocale ?? "en-IN";
  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** A whole amount without paise (₹1,000, not ₹1,000.00): for preset buttons and other round figures. */
export function formatWholeAmount(
  amount: number,
  code: string = getCurrencyFromStorage(),
  locale?: string
): string {
  const resolvedLocale = locale ?? whitelabelDefaultLocale ?? "en-IN";
  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getCurrencySymbol(code: string = getCurrencyFromStorage()): string {
  const locale = whitelabelDefaultLocale ?? "en-IN";
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  });
  return formatter.formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
}

export function getDefaultLocale(): string {
  return whitelabelDefaultLocale ?? normalizeLocale("en_IN");
}
