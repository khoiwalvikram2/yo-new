import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Facebook,
  Headphones,
  Instagram,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import {
  useAppIdentity,
  useFeatureFlags,
  useLogo,
  useSEO,
  useSocialLinks,
} from "../hooks/useAppSettings";
import "./footer-matchbook.css";

const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "twitter",
  "youtube",
  "linkedin",
  "telegram",
] as const;

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function SocialIcon({ platform }: { platform: string }) {
  const className = "h-4 w-4";
  switch (platform) {
    case "facebook":
      return <Facebook className={className} />;
    case "instagram":
      return <Instagram className={className} />;
    case "telegram":
      return <TelegramIcon className={className} />;
    case "twitter":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "youtube":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    default:
      return null;
  }
}

function safeExternalUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function FooterGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <nav className="nova-ftr-group" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul>{children}</ul>
    </nav>
  );
}

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <li>
      <Link to={to}>{children}</Link>
    </li>
  );
}

/**
 * Site footer in the matchbook shell (footer-matchbook.css): charcoal in both themes like the header, sidebar
 * and rail, in four bands: support contacts, brand + link columns, responsible play + socials, legal line.
 */
export default function Footer() {
  const { t } = useTranslation();
  const features = useFeatureFlags();
  const socialLinks = useSocialLinks();
  const { description } = useSEO();
  const {
    appName,
    supportEmail,
    supportPhone,
    whatsappSupportPhone,
    baseCurrency,
    timeZone,
  } = useAppIdentity();
  const { logoSrc, siteTitle } = useLogo();

  const displayName = (appName || siteTitle || "").replace(/\bexample\b/gi, "").trim();
  const phone = supportPhone?.trim();
  const phoneHref = phone?.replace(/[^+\d]/g, "");
  const email = supportEmail?.trim();
  const rawWhatsappDigits = whatsappSupportPhone?.replace(/\D/g, "") || "";
  const whatsappDigits = rawWhatsappDigits.length >= 8 ? rawWhatsappDigits : "";
  const hasSupport = Boolean(email || phoneHref || whatsappDigits);
  const configuredSocials = SOCIAL_PLATFORMS.flatMap((platform) => {
    const value = socialLinks?.[platform] ?? socialLinks?.[platform.charAt(0).toUpperCase() + platform.slice(1)];
    const url = safeExternalUrl(value);
    return url ? [{ platform, url }] : [];
  });

  return (
    <footer className="nova-site-footer" aria-label={t("footer.siteFooter")}>
      {hasSupport && (
        <section className="nova-ftr-support" aria-labelledby="footer-support-title">
          <div className="nova-ftr-support-copy">
            <span className="nova-ftr-support-icon" aria-hidden="true"><Headphones /></span>
            <div>
              <p className="nova-ftr-kicker">{t("footer.support")}</p>
              <h2 id="footer-support-title">{t("footer.contactSupport")}</h2>
            </div>
          </div>
          <address className="nova-ftr-support-actions">
            {email && <a href={`mailto:${email}`}><Mail aria-hidden="true" /><span>{email}</span></a>}
            {phone && phoneHref && <a href={`tel:${phoneHref}`}><Phone aria-hidden="true" /><span>{phone}</span></a>}
            {whatsappDigits && (
              <a className="is-whatsapp" href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" /><span>{t("footer.whatsapp")}</span>
              </a>
            )}
          </address>
        </section>
      )}

      <div className="nova-ftr-main">
        <section className="nova-ftr-brand" aria-label={displayName || t("footer.home")}>
          <Link to="/" className="nova-ftr-logo" aria-label={`${displayName || t("footer.home")} — ${t("footer.home")}`}>
            {logoSrc && <img src={logoSrc} alt="" />}
            {!logoSrc && displayName && <span>{displayName}</span>}
          </Link>
          {description && <p className="nova-ftr-summary">{description}</p>}
          <div className="nova-ftr-context" aria-label={t("footer.platformContext")}>
            <span className="is-age">18+</span>
            {baseCurrency && <span>{baseCurrency}</span>}
            {timeZone && <span>{timeZone}</span>}
          </div>
        </section>

        <FooterGroup id="footer-explore" title={t("footer.explore")}>
          <FooterLink to="/">{t("footer.home")}</FooterLink>
          {features.sportsEnabled && (
            <>
              <FooterLink to="/sports">{t("footer.sports")}</FooterLink>
              <FooterLink to="/sports?sport=live">{t("footer.inPlay")}</FooterLink>
            </>
          )}
          {features.casinoEnabled && <FooterLink to="/casino">{t("footer.casino")}</FooterLink>}
          {features.casinoEnabled && <FooterLink to="/slots">{t("footer.slots")}</FooterLink>}
          {features.bonusesEnabled && <FooterLink to="/bonus">{t("footer.promotions")}</FooterLink>}
        </FooterGroup>

        <FooterGroup id="footer-account" title={t("footer.account")}>
          <FooterLink to="/my-bets">{t("footer.myBets")}</FooterLink>
          <FooterLink to="/statements">{t("footer.statements")}</FooterLink>
          <FooterLink to="/settings">{t("footer.settings")}</FooterLink>
          {features.referralsEnabled && <FooterLink to="/referral">{t("footer.referral")}</FooterLink>}
        </FooterGroup>

        <FooterGroup id="footer-legal" title={t("footer.legal")}>
          <FooterLink to="/terms">{t("footer.termsConditions")}</FooterLink>
          <FooterLink to="/privacy">{t("footer.privacyPolicy")}</FooterLink>
          <FooterLink to="/terms#responsible">{t("footer.responsibleGambling")}</FooterLink>
          <FooterLink to="/settings">{t("footer.playControls")}</FooterLink>
        </FooterGroup>
      </div>

      <section className="nova-ftr-play" aria-labelledby="footer-responsible-title">
        <div className="nova-ftr-play-copy">
          <span className="nova-ftr-age" aria-hidden="true">18+</span>
          <span>
            <strong id="footer-responsible-title"><ShieldCheck aria-hidden="true" />{t("footer.responsibleTitle")}</strong>
            <small>{t("footer.responsibleCopy")}</small>
          </span>
        </div>
        {configuredSocials.length > 0 && (
          <div className="nova-ftr-socials" aria-label={t("footer.socialLinks")}>
            {configuredSocials.map(({ platform, url }) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${displayName || t("footer.platform")} ${platform}`}
              >
                <SocialIcon platform={platform} />
              </a>
            ))}
          </div>
        )}
      </section>

      <div className="nova-ftr-legal">
        <p>{"\u00A9"} {new Date().getFullYear()} {displayName || t("footer.platform")}. {t("footer.allRightsReserved")}</p>
        <nav aria-label={t("footer.legal")}>
          <Link to="/terms">{t("footer.terms")}</Link>
          <Link to="/privacy">{t("footer.privacy")}</Link>
          <Link to="/terms#responsible">18+</Link>
        </nav>
      </div>
    </footer>
  );
}
