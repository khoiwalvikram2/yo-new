import { useState } from "react";
import { useTranslation } from "react-i18next";
import CategorySections from "../components/casino/CategorySections";
import CasinoSearch from "../components/casino/CasinoSearch";
import type { LobbyCategory } from "../components/casino/lobbyModel";
import UserGamesSection from "../components/casino/UserGamesSection";
import useLobbyTotal from "../components/casino/useLobbyTotal";
import { useProvidersParam } from "../components/casino/useProvidersParam";
import { usePageSEO } from "../hooks/usePageSEO";
import "../components/nova/exchange-home/nova-exchange-home.css";
import "../components/casino/casino-lobby.css";

export default function CasinoPage() {
  const { t } = useTranslation();
  // ?providers=Name,Name filters the lobby, as on /slots (the home's provider tiles link here this way).
  const [globalProviders, setGlobalProviders] = useProvidersParam();
  const [rows, setRows] = useState<LobbyCategory[] | null>(null);
  const total = useLobbyTotal("live", globalProviders);

  usePageSEO({
    title: "Casino",
    description: "Explore the casino games available on this platform",
  });

  return (
    <div className="nova-ex-grid nova-lobby">
      <div id="casino-main" className="nova-lobby-main">
        {/* The page title for assistive tech and search; the lobby opens straight on its categories. */}
        <h1 className="nova-lobby-sr-only">{t("nav.liveCasino")}</h1>
        <CasinoSearch
          selectedProviders={globalProviders}
          onProvidersChange={setGlobalProviders}
          rowCategories={rows}
          totalCount={total}
        />
        <UserGamesSection />
        <CategorySections
          providers={globalProviders.length > 0 ? globalProviders : undefined}
          onCategoriesChange={setRows}
          onClearProviders={() => setGlobalProviders([])}
        />
      </div>
    </div>
  );
}
