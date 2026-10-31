import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Radio, ShieldCheck } from "lucide-react";
import Logo from "../Logo";
import { LivePulse } from "../nova/exchange-home/LivePulse";
import "./auth-modal.css";

const FEATURES = [
  { icon: ArrowLeftRight, title: "auth.introExchangeTitle", text: "auth.introExchangeText" },
  { icon: Radio, title: "auth.introLiveTitle", text: "auth.introLiveText" },
  { icon: ShieldCheck, title: "auth.introSecureTitle", text: "auth.introSecureText" },
] as const;

/** Illustrative prices for the decorative board; no real market behind them. */
const BOARD = [
  { back: "1.85", lay: "1.87" },
  { back: "3.40", lay: "3.55" },
  { back: "4.10", lay: "4.30" },
];

/** The dark showcase beside the login and register forms: brand, what the product does, a live odds board. */
export default function AuthIntro({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  return <aside className="nova-auth-intro">
    <div className="nova-auth-brand" onClick={onNavigate}><Logo size="lg" /></div>
    <div className="nova-auth-intro-copy">
      <span>{t("nova.homeGround")}</span>
      <h3>{t("auth.introTitle")}</h3>
      <p>{t("auth.introDescription")}</p>
    </div>
    <ul className="nova-auth-features">
      {FEATURES.map(({ icon: Icon, title, text }) => <li key={title}>
        <span className="nova-auth-feature-icon"><Icon aria-hidden="true" /></span>
        <span><strong>{t(title)}</strong><small>{t(text)}</small></span>
      </li>)}
    </ul>
    <div className="nova-auth-board" aria-hidden="true">
      <div className="nova-auth-board-head">
        <span className="nova-auth-board-live"><i />{t("nova.live")}<LivePulse /></span>
        <span className="nova-auth-board-cols"><b>Back</b><b>Lay</b></span>
      </div>
      {BOARD.map(row => <div className="nova-auth-board-row" key={row.back}>
        <span className="nova-auth-board-runner"><i /><b /></span>
        <span className="nova-auth-board-price is-back">{row.back}</span>
        <span className="nova-auth-board-price is-lay">{row.lay}</span>
      </div>)}
    </div>
    <p className="nova-auth-intro-note">{t("auth.introNote")}</p>
  </aside>;
}
