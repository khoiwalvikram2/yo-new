import ThemeSwitch from "../components/ThemeSwitch";
import Switch from "../components/forms/Switch";
import { useState } from "react";
import ChangePasswordModal from "../components/modals/ChangePasswordModal";
import { useAuth } from '@/lib/auth'
import { getLanguageFromStorage, applyLanguage } from "../lib/locale";
import type { LanguageCode } from "@/types";
import { isSyncEnabled, setSyncEnabled } from "../lib/sync";
import { languages } from "../components/sidebar/localeData";
import {
  Palette,
  Cloud,
  Languages as LanguagesIcon,
  Lock,
} from "lucide-react";
import StakePageHeader from '@/components/StakePageHeader'
import { useTranslation } from "react-i18next";
import { usePageSEO } from '../hooks/usePageSEO'
import '../styles/account/settings.css'

export default function SettingsPage() {
  usePageSEO({ title: 'Settings' })
  const { isAuthenticated, openAuthModal } = useAuth()
  const { t } = useTranslation();
  const [language, setLanguage] = useState<LanguageCode>(
    getLanguageFromStorage()
  );
  const [syncEnabled, setSyncEnabledState] = useState<boolean>(isSyncEnabled());
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  const handleLanguageChange = (code: LanguageCode) => {
    setLanguage(code);
    applyLanguage(code);
  };

  const handleSyncToggle = (enabled: boolean) => {
    setSyncEnabledState(enabled);
    setSyncEnabled(enabled);
  };

  return (
    <div className="user-settings-page space-y-6">
      {/* The charcoal title bar every account page uses. */}
      <StakePageHeader title={t('settings.title')} />

      <section
        className="user-settings-card space-y-4"
      >
        <div className="flex items-center justify-between gap-4 transition-all duration-200 hover:-translate-y-[2px]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[color:var(--surface-2)]/70 border border-[color:var(--border)] grid place-items-center">
              <Palette className="h-4 w-4 text-[color:var(--subtle)]" />
            </div>
            <div className="space-y-0.5">
              <div className="font-medium">{t('settings.theme')}</div>
              <div className="text-xs text-[color:var(--subtle)]">
                {t('settings.themeDescription')}
              </div>
            </div>
          </div>
          <ThemeSwitch />
        </div>
      </section>

      {/* Security */}
      <section
        className="user-settings-card space-y-4"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[color:var(--surface-2)]/70 border border-[color:var(--border)] grid place-items-center">
              <Lock className="h-4 w-4 text-[color:var(--subtle)]" />
            </div>
            <div className="space-y-0.5">
              <div className="font-medium">{t('settings.security')}</div>
              <div className="text-xs text-[color:var(--subtle)]">{t('settings.securityDescription')}</div>
            </div>
          </div>
          <button
            onClick={() => (isAuthenticated ? setIsChangePasswordOpen(true) : openAuthModal('login'))}
            className="px-3 py-2 rounded-lg bg-[color:var(--surface-2)] border border-[color:var(--border)] text-[color:var(--text)] hover:bg-[color:var(--surface-2)]/80 transition-all duration-200 text-sm"
          >
            {t('settings.changePassword')}
          </button>
        </div>
      </section>

      <section
        className="user-settings-card space-y-4"
      >
        <div className="flex items-center justify-between gap-4 transition-all duration-200 hover:-translate-y-[2px]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[color:var(--surface-2)]/70 border border-[color:var(--border)] grid place-items-center">
              <Cloud className="h-4 w-4 text-[color:var(--subtle)]" />
            </div>
            <div className="space-y-0.5">
          <div className="font-medium">{t('settings.sync')}</div>
          <div className="text-xs text-[color:var(--subtle)]">
            {t('settings.syncDescription')}
          </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[color:var(--subtle)]">
              {syncEnabled ? "On" : "Off"}
            </span>
            <Switch checked={syncEnabled} onChange={handleSyncToggle} />
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <div
          className="user-settings-card space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[color:var(--surface-2)]/70 border border-[color:var(--border)] grid place-items-center">
                <LanguagesIcon className="h-4 w-4 text-[color:var(--subtle)]" />
              </div>
              <div>
                <div className="font-medium">{t('settings.language')}</div>
                <div className="text-xs text-[color:var(--subtle)]">
                  {t('settings.languageDescription')}
                </div>
              </div>
            </div>
            <select
              value={language}
              onChange={(e) =>
                handleLanguageChange(e.target.value as LanguageCode)
              }
              className="w-40 bg-[color:var(--surface-2)] border border-[color:var(--border)] rounded-md px-3 py-2 text-sm ring-1 ring-transparent focus:ring-[color:var(--brand-primary)]/40 focus:border-[color:var(--brand-primary)]/40"
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
      <p className="text-xs text-[color:var(--subtle)]">
        {t('settings.autoSaveNote')}
      </p>

      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </div>
  );
}
