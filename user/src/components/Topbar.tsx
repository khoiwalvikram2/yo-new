import {
  ChevronDown,
  User2,
  Search,
  BarChart3,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Gift,
  X,
} from "lucide-react";
import { formatAmount } from "../lib/currency";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../lib/auth";
import SearchModal from "./modals/SearchModal.tsx";
import ChangePasswordModal from "./modals/ChangePasswordModal";
import Logo from "./Logo";
import NewsTicker from "./NewsTicker";
import ThemeSwitch from "./ThemeSwitch";
import { NovaNavigationButton, PANEL_CHANGE_EVENT, TOGGLE_PANEL_EVENT, type TogglePanelDetail } from "./nova/NovaWorkspace";
import AccountLinks from "./nova/AccountLinks";
import { useFeatureFlags, useParsedSettings } from "../hooks/useAppSettings";
import "./topbar-controls.css";

/** Shown in the desktop search pill; the Ctrl/⌘+K listener in Topbar below opens search. */
const SEARCH_SHORTCUT = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘ K" : "Ctrl K";

import { Link, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const SELECTED_WALLET_KEY = "stakex_selected_wallet";

/** The header's phone layout: the stylesheet swaps the search pill for an icon button at this width. */
const PHONE_HEADER_QUERY = "(max-width: 800px)";

/**
 * Whether the header is in its phone layout, so only the search button for that layout is rendered
 * (one control, one accessible name). No matchMedia (tests, old engines) means the desktop layout.
 */
function usePhoneHeader() {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_HEADER_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(PHONE_HEADER_QUERY);
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return phone;
}

function readStoredSelectedWallet(): "balance" | "bonus" | "referralBonus" {
  try {
    const stored = localStorage.getItem(SELECTED_WALLET_KEY);
    if (stored === "bonus" || stored === "balance" || stored === "referralBonus") {
      return stored;
    }
  } catch {
    /* ignore (e.g. private mode) */
  }
  return "balance";
}

export default function Topbar() {
  const { user, isAuthenticated, openAuthModal, logout, refreshUser } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const features = useFeatureFlags();
  const parsedSettings = useParsedSettings();
  const hideDW = parsedSettings.hideDW ?? false;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const phoneHeader = usePhoneHeader();
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  // Desktop: the account button opens the rail's "Your account" drawer (NovaWorkspace); this mirrors whether it is open.
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  useEffect(() => {
    const onPanel = (event: Event) => setAccountPanelOpen((event as CustomEvent<{ panel: string | null }>).detail.panel === 'account');
    window.addEventListener(PANEL_CHANGE_EVENT, onPanel);
    return () => window.removeEventListener(PANEL_CHANGE_EVENT, onPanel);
  }, []);
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<"balance" | "bonus" | "referralBonus">(
    readStoredSelectedWallet
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const walletDropdownRef = useRef<HTMLDivElement>(null);
  const walletTriggerRef = useRef<HTMLButtonElement>(null);
  const walletPanelRef = useRef<HTMLDivElement>(null);
  const [drawerEnter, setDrawerEnter] = useState(false);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (user?.requirePasswordReset) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open], [role="dialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [user?.requirePasswordReset]);

  // Do not place a native top-layer panel over the existing forced security
  // dialog, or retain account overlays after the auth provider logs out.
  useEffect(() => {
    if (!isAuthenticated || user?.requirePasswordReset) {
      setIsUserDropdownOpen(false);
      setIsWalletDropdownOpen(false);
      setIsSearchOpen(false);
    }
    if (!isAuthenticated) setIsChangePasswordOpen(false);
  }, [isAuthenticated, user?.requirePasswordReset]);

  // Check if user is a credit player (should not see bonus wallet)
  const playerType = (user as any)?.playerType || 'REGULAR'
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
  
  // Derived wallet stats for richer UI
  // For credit players, use creditAvailable instead of balance
  const mainBalance = isCreditPlayer 
    ? (user?.creditAvailable ?? 0) 
    : ((user?.balance as number) || 0);
  const bonusBalance = (user?.bonusBalance as number) || 0;
  const referralBonusBalance = Number((user as any)?.referralBonusBalance ?? 0);
  const exposure = Number((user as any)?.exposure || 0);
  const mainWalletDisplay = isCreditPlayer ? mainBalance : mainBalance - Math.abs(exposure);
  
  // Reset selectedWallet to 'balance' if credit player has bonus or referralBonus selected
  useEffect(() => {
    if (isCreditPlayer && (selectedWallet === 'bonus' || selectedWallet === 'referralBonus')) {
      setSelectedWallet('balance')
    }
  }, [isCreditPlayer, selectedWallet])

  // Close drawer on route change so body scroll lock doesn't leak
  useEffect(() => {
    setIsUserDropdownOpen(false);
    setIsWalletDropdownOpen(false);
    setIsSearchOpen(false);
  }, [location.pathname, location.search]);

  const closeWallet = useCallback(() => {
    setIsWalletDropdownOpen(false);
    walletTriggerRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!isWalletDropdownOpen) return;
    walletPanelRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeWallet(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isWalletDropdownOpen, closeWallet]);

  // Listen for exposure updates from bet placement
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const val = Number(e?.detail?.exposure)
        if (!Number.isNaN(val)) {
          // Refresh user to sync all fields; exposure is displayed from user
          refreshUser()
        }
      } catch (_) {}
    }
    window.addEventListener('stakex:exposure:update', handler as any)
    return () => window.removeEventListener('stakex:exposure:update', handler as any)
  }, [refreshUser])

  // Animate profile drawer on mount
  useEffect(() => {
    if (isUserDropdownOpen) {
      const id = requestAnimationFrame(() => setDrawerEnter(true));
      return () => cancelAnimationFrame(id);
    } else {
      setDrawerEnter(false);
    }
  }, [isUserDropdownOpen]);

  // Persist wallet selection to localStorage (state is hydrated synchronously via readStoredSelectedWallet)
  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_WALLET_KEY, selectedWallet);
    } catch {
      /* ignore */
    }
  }, [selectedWallet]);

  // Get wallet balance based on selected wallet type
  const getWalletBalance = () => {
    if (!isAuthenticated || !user) return 0;
    
    // Credit players should see creditAvailable (no exposure deduction needed)
    if (isCreditPlayer) {
      return Number(user.creditAvailable ?? 0)
    }
    
    // Regular players: balance - exposure for main wallet, bonusBalance for bonus, referralBonusBalance for referral bonus
    const currentBalance = Number(user.balance || 0)
    const currentExposure = Math.abs(Number((user as any)?.exposure || 0))
    const netBalance = currentBalance - currentExposure
    if (selectedWallet === 'referralBonus') return Number((user as any)?.referralBonusBalance ?? 0)
    return selectedWallet === "balance" ? netBalance : (user as any).bonusBalance || 0
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Check if click is inside profile drawer (portaled to body)
      const isProfileDrawer = target && document.querySelector('[data-profile-drawer]')?.contains(target);
      
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !isProfileDrawer
      ) {
        setIsUserDropdownOpen(false);
      }
      if (
        walletDropdownRef.current &&
        !walletDropdownRef.current.contains(target)
      ) {
        setIsWalletDropdownOpen(false);
      }
    };

    if (isUserDropdownOpen || isWalletDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUserDropdownOpen, isWalletDropdownOpen]);

  return (
    <header
      className="nova-topbar sticky top-0 z-[100]" aria-label={t('nova.yourWorkspace')}
      data-ui-radius="square"
    >
      <div className="nova-topbar-inner flex-1 w-full">
      <div className="nova-topbar-row relative flex items-center justify-between">
        <div className="nova-header-left flex items-center min-w-0">
          <NovaNavigationButton />
          <Logo className="nova-header-logo" />
        </div>

        {/* Home/Sports/Matka/Live Casino/Slots moved from here to the sidebar's Popular section (owner, 2026-10-29). */}
        {/* One search control. Above 800px it sits right after the logo as a search field (an icon where the header
            has no room); on phones it is the icon button in the top band. It opens the search dialog either way. */}
        <button
          type="button"
          disabled={Boolean(user?.requirePasswordReset)}
          aria-haspopup="dialog"
          aria-label={t('nova.searchTeamsMarkets')}
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => { setIsWalletDropdownOpen(false); setIsUserDropdownOpen(false); setIsSearchOpen(true) }}
          className={`nova-header-search ${phoneHeader ? "nova-mobile-search" : "nova-desktop-search"}`}
          title={phoneHeader ? undefined : t('nova.searchTeamsMarkets')}
        >
          <Search aria-hidden="true" />
          <span className="sr-only">{t('nova.searchTeamsMarkets')}</span>
          {!phoneHeader && <>
            <span className="nova-search-label" aria-hidden="true">{t('nova.searchTeamsMarkets')}</span>
            <kbd aria-hidden="true">{SEARCH_SHORTCUT}</kbd>
          </>}
        </button>

        <div className="nova-header-right flex items-center">
          {isAuthenticated && (
            <div className="nova-header-wallet relative" ref={walletDropdownRef}>
              <button
                type="button"
                ref={walletTriggerRef}
                disabled={Boolean(user?.requirePasswordReset)}
                aria-haspopup="dialog"
                aria-controls={isWalletDropdownOpen ? 'topbar-wallet-panel' : undefined}
                aria-label={t('wallet.choose')}
                aria-expanded={isWalletDropdownOpen}
                onClick={() => { setIsUserDropdownOpen(false); setIsWalletDropdownOpen(!isWalletDropdownOpen) }}
                className="nova-wallet-summary"
              >
                <Wallet className="nova-wallet-icon" aria-hidden="true" />
                <span className="nova-wallet-selected">
                  <small>{isCreditPlayer ? t('nova.availableCredit') : selectedWallet === "balance"
                    ? t('wallet.main')
                    : selectedWallet === "referralBonus" ? 'Referral Bonus' : t('wallet.bonus')}</small>
                  <strong>{formatAmount(getWalletBalance())}</strong>
                </span>
                {!isCreditPlayer && <>
                  <span className="nova-wallet-exposure"><small>{t('wallet.exposure')}</small><strong>{formatAmount(Math.abs(exposure))}</strong></span>
                  <span className="nova-wallet-available"><small>{t('financial.available')}</small><strong>{formatAmount(Math.max(0, mainBalance - Math.abs(exposure)))}</strong></span>
                </>}
                <ChevronDown className={`nova-wallet-chevron ${isWalletDropdownOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>

              {/* Wallet Selection Popover: a flat Matchbook sheet (charcoal title bar, one row per wallet, the active
                  wallet marked by a red left edge and chip, exposure as the footer row). */}
              {isWalletDropdownOpen && (
                <div ref={walletPanelRef} id="topbar-wallet-panel" role="dialog" aria-labelledby="topbar-wallet-title" className="nova-wallet-popover">
                  <div className="nova-wallet-sheet">
                    <div className="nova-wallet-head">
                      <div>
                        <h3 id="topbar-wallet-title">{t('wallet.choose')}</h3>
                        <p>{t('wallet.switchHint')}</p>
                      </div>
                      <button type="button" onClick={closeWallet} aria-label={t('common.close')}>
                        <X aria-hidden="true" />
                      </button>
                    </div>

                    <div className="nova-wallet-options">
                      {([
                        { key: 'balance', label: isCreditPlayer ? t('nova.availableCredit') : t('wallet.main'), amount: mainWalletDisplay, icon: Wallet, note: null },
                        // Bonus and referral wallets are hidden for credit players.
                        ...(isCreditPlayer ? [] : [
                          { key: 'bonus' as const, label: t('wallet.bonus'), amount: bonusBalance, icon: Gift, note: null },
                          { key: 'referralBonus' as const, label: 'Referral Bonus', amount: referralBonusBalance, icon: Gift, note: 'Casino only' },
                        ]),
                      ] as const).map(({ key, label, amount, icon: Icon, note }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            if (selectedWallet !== key) setSelectedWallet(key)
                            closeWallet()
                          }}
                          className={`nova-wallet-option${selectedWallet === key ? ' is-active' : ''}`}
                          aria-pressed={selectedWallet === key}
                        >
                          <span className="nova-wallet-option-icon"><Icon aria-hidden="true" /></span>
                          <span className="nova-wallet-option-copy">
                            <strong>{label}{selectedWallet === key && <em>{t('wallet.active')}</em>}</strong>
                            {note && <small>{note}</small>}
                          </span>
                          <span className="nova-wallet-option-amount">{formatAmount(amount)}</span>
                        </button>
                      ))}
                    </div>

                    <div className="nova-wallet-exposure-row">
                      <span><BarChart3 aria-hidden="true" />{t('wallet.exposure')}</span>
                      <strong className={exposure !== 0 ? 'is-out' : undefined}>{exposure < 0 ? '−' : ''}{formatAmount(Math.abs(exposure))}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {isAuthenticated && !hideDW && !isCreditPlayer && <>
            <Link to="/deposit" className="nova-header-primary">
              <ArrowDownCircle aria-hidden="true" />
              <span>{t('nav.deposit')}</span>
            </Link>
            {/* Desktop only; phones reach it from the account sheet. */}
            <Link to="/withdrawal" className="nova-header-withdraw">
              <ArrowUpCircle aria-hidden="true" />
              <span>{t('nav.withdrawal')}</span>
            </Link>
          </>}
          {isAuthenticated && (features?.bonusesEnabled ?? true) && !isCreditPlayer && (
            <Link to="/bonus" className="nova-header-bonus" title={t('nav.bonus')}>
              <Gift aria-hidden="true" />
              <span className="sr-only">{t('nav.bonus')}</span>
            </Link>
          )}
          <span className="nova-header-theme"><ThemeSwitch variant="icon" /></span>

        <SearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
        />

        <ChangePasswordModal
          isOpen={isChangePasswordOpen}
          onClose={() => setIsChangePasswordOpen(false)}
        />

          {isAuthenticated ? (
            <div className="nova-header-profile relative" ref={dropdownRef}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={user?.username || t('nova.yourAccount')}
                disabled={Boolean(user?.requirePasswordReset)}
                aria-expanded={isUserDropdownOpen || accountPanelOpen}
                onClick={event => {
                  setIsWalletDropdownOpen(false);
                  // Where the rail exists the header opens the very same drawer as the rail's account button.
                  if (hasUtilityRail()) {
                    const detail: TogglePanelDetail = { panel: 'account', opener: event.currentTarget };
                    window.dispatchEvent(new CustomEvent(TOGGLE_PANEL_EVENT, { detail }));
                    return;
                  }
                  setIsUserDropdownOpen(!isUserDropdownOpen);
                }}
                className="nova-profile-trigger"
              >
                <span className="nova-profile-initials" aria-hidden="true">{user?.username?.slice(0, 2).toUpperCase() || <User2 />}</span>
                <span className="nova-profile-copy" aria-hidden="true"><strong>{user?.username || t('nova.yourAccount')}</strong><small>{t('nova.yourAccount')}</small></span>
                <ChevronDown className="nova-profile-chevron" aria-hidden="true" />
              </button>

              {/* Profile sheet: phones only, where there is no utility rail. */}
              {isUserDropdownOpen &&
                  createPortal(
                    <ProfileDrawer
                      open={drawerEnter}
                      onClose={() => setIsUserDropdownOpen(false)}
                      t={t}
                      onLogout={() => {
                        logout();
                        setIsUserDropdownOpen(false);
                      }}
                      onChangePassword={() => {
                        setIsChangePasswordOpen(true);
                        setIsUserDropdownOpen(false);
                      }}
                    />,
                    // Inside the shell, so the sheet takes the rail drawer's styles.
                    document.querySelector('.nova-shell-matchbook') ?? document.body
                  )}
            </div>
          ) : (
            <div className="nova-auth-actions flex items-center">
              <button
                type="button"
                onClick={() => openAuthModal("login")}
                className="nova-auth-login"
              >
                {t('nav.login')}
              </button>
              {(features.registerEnabled ?? true) && (
                <button
                  type="button"
                  onClick={() => openAuthModal("register")}
                  className="nova-auth-register"
                >
                  {t('nav.register')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <NewsTicker />
      </div>
    </header>
  );
}

/** The utility rail (and its drawers) shows from 801px; below that the header keeps its own profile sheet. */
const hasUtilityRail = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 801px)').matches;

function ProfileDrawer(
  props: {
    open: boolean;
    onClose: () => void;
    t: (key: string) => string;
    onLogout: () => void;
    onChangePassword: () => void;
  }
) {
  const { open, onClose, t, onLogout, onChangePassword } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    // The sheet starts off-screen (it slides in): focusing without preventScroll would scroll the dialog sideways
    // to reach the close button, and the sheet would jump when the slide ends.
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = originalOverflow;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);
  // Phones only (no rail): a modal sheet from the right holding the same "Your account" drawer as the rail
  // (header, AccountLinks rows), so the two never differ.
  return (
    <dialog ref={dialogRef} className="nova-profile-dialog fixed inset-0 m-0 h-full w-full max-h-none max-w-none border-0 bg-transparent p-0" data-profile-drawer aria-labelledby="profile-drawer-title" onCancel={onClose} onClose={event => { if (!event.currentTarget.open) onClose() }}>
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        style={{ zIndex: 1 }}
      />
      <div
        className={`nova-profile-sheet flex flex-col w-full max-w-sm h-full transform transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ zIndex: 2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nova-panel-content">
          <header>
            <div><span className="nova-eyebrow">{t('nova.yourWorkspace')}</span><h2 id="profile-drawer-title">{t('nova.yourAccount')}</h2></div>
            <button type="button" ref={closeRef} className="nova-icon-button" aria-label={t('common.close')} onClick={onClose}><X size={20} /></button>
          </header>
          <AccountLinks onClose={onClose} onChangePassword={onChangePassword} onLogout={onLogout} />
        </div>
      </div>
    </dialog>
  );
}

