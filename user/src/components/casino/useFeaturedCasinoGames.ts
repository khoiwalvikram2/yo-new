import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCasinoCategories, getCasinoGames } from "@/lib/api/user";

export type FeaturedItem = {
  title: string;
  provider: string;
  badge?: "HOT" | "NEW";
  image: string;
  game_id: string;
};

/**
 * Loads the admin's "featured" casino category: live-casino by default, slots with `variant: "slots"`.
 * Pass `enabled: false` when the caller already has items.
 */
export function useFeaturedCasinoGames(variant: "default" | "slots", enabled = true) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeaturedItem[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const slotsOnly = variant === "slots";
        const categoryResponse = await getCasinoCategories({
          liveOnly: slotsOnly ? undefined : true,
          slotsOnly: slotsOnly ? true : undefined,
        });
        if (cancelled) return;
        const categories = Array.isArray(categoryResponse?.data) ? categoryResponse.data : [];
        const category = categories.find((entry: any) => {
          const name = typeof entry === "string" ? entry : entry?.name;
          const type = typeof entry === "string" ? "" : entry?.type;
          return String(type || "").toLowerCase() === "featured"
            || String(name || "").toLowerCase().includes("featured");
        });
        const categoryName = typeof category === "string" ? category : category?.name;
        if (!categoryName) {
          setItems([]);
          return;
        }

        const gamesResponse = await getCasinoGames({
          category: categoryName,
          page: 1,
          limit: 24,
          slots: slotsOnly ? true : undefined,
          liveOnly: slotsOnly ? undefined : true,
        });
        if (cancelled) return;
        const games = Array.isArray(gamesResponse?.data) ? gamesResponse.data : [];
        const mapped = games.flatMap((game: any): FeaturedItem[] => {
          const gameId = game?.gameId ?? game?.id ?? game?.externalId;
          if (!gameId) return [];
          return [{
            title: String(game?.title || game?.name || game?.game_name || t("nova.genericGame")),
            provider: String(game?.provider || game?.provider_name || game?.vendorName || t("nova.genericProvider")),
            image: String(game?.imageUrl || game?.thumbnail || game?.thumbnailUrl || ""),
            game_id: String(gameId),
          }];
        });
        setItems(mapped);
        setTitle(String(categoryName));
        setSubtitle(typeof category === "object" && category?.subtitle ? String(category.subtitle) : null);
      } catch {
        if (!cancelled) {
          setItems([]);
          setError(t("nova.casinoLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, t, variant]);

  return { items, title, subtitle, loading, error };
}
