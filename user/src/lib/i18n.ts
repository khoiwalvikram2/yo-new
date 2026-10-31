import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './i18n/locales/en'
import { hi } from './i18n/locales/hi'
import { ta } from './i18n/locales/ta'
import { te } from './i18n/locales/te'

const LANGUAGE_STORAGE_KEY = 'stakex_language'

function readStoredLanguage() {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return stored || 'en'
}

function persistLanguage(code: string) {
  if (typeof window === 'undefined') return
  document.documentElement.lang = code.split('-')[0]
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
}

const resources = {
  en,
  hi,
  ta,
  te,
} as const

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: readStoredLanguage(),
    fallbackLng: 'en',
    supportedLngs: ['en', 'hi', 'ta', 'te'],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    returnNull: false,
  })

i18n.on('languageChanged', persistLanguage)
if (typeof document !== 'undefined') document.documentElement.lang = i18n.resolvedLanguage || i18n.language || 'en'

export default i18n

