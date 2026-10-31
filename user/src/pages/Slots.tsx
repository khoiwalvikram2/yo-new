import { useState } from "react";
import { useTranslation } from "react-i18next";
import CategorySections from "@/components/casino/CategorySections";
import CasinoSearch from "@/components/casino/CasinoSearch";
import type { LobbyCategory } from "@/components/casino/lobbyModel";
import UserGamesSection from "../components/casino/UserGamesSection";
import useLobbyTotal from "@/components/casino/useLobbyTotal";
import { useProvidersParam } from "@/components/casino/useProvidersParam";
import { usePageSEO } from "../hooks/usePageSEO";
import "@/components/nova/exchange-home/nova-exchange-home.css";
import "@/components/casino/casino-lobby.css";

export default function SlotsPage() {
  const { t } = useTranslation();
  // ?providers=Name,Name filters the lobby (the home's provider tiles link here this way).
  const [selectedProviders, setSelectedProviders] = useProvidersParam();
  const [rows, setRows] = useState<LobbyCategory[] | null>(null);
  const total = useLobbyTotal("slots", selectedProviders);

  usePageSEO({
    title: "Slots",
    description: "Explore the slot games available on this platform",
  });

  return (
    <div className="nova-ex-grid nova-lobby">
      <div id="slots-main" className="nova-lobby-main">
        {/* The page title for assistive tech and search; the lobby opens straight on its categories. */}
        <h1 className="nova-lobby-sr-only">{t("nav.slots")}</h1>
        <CasinoSearch
          slotsOnly
          selectedProviders={selectedProviders}
          onProvidersChange={setSelectedProviders}
          rowCategories={rows}
          totalCount={total}
        />
        <UserGamesSection filterSlotsOnly />
        <CategorySections
          slotsOnly
          providers={selectedProviders.length > 0 ? selectedProviders : undefined}
          onCategoriesChange={setRows}
          onClearProviders={() => setSelectedProviders([])}
        />
      </div>
    </div>
  );
}
