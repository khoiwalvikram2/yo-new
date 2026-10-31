import type { ReactNode, ComponentType } from 'react';

// Auth
export interface User {
  id: string;
  username: string;
  phone: string;
  level: number;
  balance: number;
  bonusBalance?: number;
  exposure?: number;
  walletType?: '1' | '2';
  affiliateCode?: string;
  referralBalance?: number;
  referralBonusBalance?: number;
  playerType?: string; // For credit player detection (AGENT_CREDIT, WHITELABEL_CREDIT, etc.)
  creditAvailable?: number;
  creditLimit?: number;
  creditUsed?: number;
  requirePasswordReset?: boolean;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  isAuthModalOpen: boolean;
  authModalMode: 'login' | 'register';
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, identifier: string, password: string, confirmPassword?: string) => Promise<void>;
  requestOtp: (identifier: string) => Promise<void>;
  loginWithOtp: (identifier: string, otp: string) => Promise<void>;
  registerWithOtp: (username: string, identifier: string, otp: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  requestResetOtp: (identifier: string) => Promise<void>;
  resetPassword: (identifier: string, otp: string, newPassword: string) => Promise<void>;
  logout: () => void;
  openAuthModal: (mode?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  refreshUser: () => Promise<void>;
  /** Sync balance/bonus from userDetail (e.g. after bonus/wallet actions). Lighter than refreshUser. */
  syncWallet: () => Promise<void>;
  updateUser: (partial: Partial<User>) => void;
  // Optimistic local balance adjustment; server refresh will reconcile later
  adjustBalance?: (delta: number) => void;
  setExposure?: (exposure: number) => void;
}

export interface AuthProviderProps {
  children: ReactNode;
}

// i18n / Locale
export type LanguageCode = 'en' | 'hi' | 'ta' | 'te';

// Currency
export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'BTC';

// Theme
export interface BrandTheme {
  '--brand-primary': string;
  '--brand-primary-light': string;
  '--brand-primary-dark': string;
  '--brand-primary-shadow': string;
  '--brand-primary-shadow-light': string;

  '--brand-secondary': string;
  '--brand-accent': string;
  '--brand-secondary-shadow': string;
  '--brand-accent-shadow': string;

  '--brand-neutral': string;
  '--brand-neutral-light': string;
  '--brand-neutral-dark': string;
}

export type ThemeName = 'modern' | 'classic';
export type ThemeMode = 'light' | 'dark';

// Navigation
export type NavItem = { label: string; icon: ComponentType<{ className?: string }> };

// Sports (events domain)
export type SportType = 'cricket' | 'football' | 'tennis' | 'basketball' | 'baseball' | 'hockey' | 'ice-hockey' | 'volleyball' | 'boxing' | 'mma' | 'rugby' | 'horseracing' | 'greyhoundracing' | 'darts' | 'snooker' | 'cycling' | 'golf' | 'esports';

export type RunnerOdds = {
  name: string;
  back?: number;
  lay?: number;
};

export type EventItem = {
  eventId?: string;
  /** Provider (feed) event id; the odds socket's bookmaker-/fancy- channels use it. */
  eventCode?: string;
  sport: SportType;
  eventName: string;
  league: string;
  startISO: string;
  runners: RunnerOdds[];
  isLive?: boolean;
  primaryMarketCode?: string;
};

// Sports (UI chip list)
export type Sport = {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  imageSrc?: string;
  count?: number;
};

// Casino
export type CasinoCardItem = {
  title: string;
  provider: string;
  imageUrl?: string;
  gameId?: string; // GAP casino gameId
  category?: string;
  isLiked?: boolean;
};

export type CasinoGame = {
  title: string;
  provider: string;
  category?: 'slots' | 'live' | 'table';
  badge?: 'HOT' | 'NEW' | 'POPULAR';
  imageUrl?: string;
};

// User games section
export type Game = {
  id: string;
  title: string;
  provider: string;
  category: 'slots' | 'live' | 'table';
  thumbnail: string;
  lastPlayed?: string;
  isLiked?: boolean;
  rating?: number;
  badge?: 'HOT' | 'NEW' | 'POPULAR';
};


