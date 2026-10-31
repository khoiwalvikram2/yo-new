import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCasinoGames } from "@/lib/api/user";

export type CasinoListGame = { key: string; title: string; provider: string; image: string; gameId: string };

/** Most popular live-casino tables or slot games, for showcase rows outside the casino pages. */
export function useCasinoGameList(kind: "live" | "slots", limit = 24) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CasinoListGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCasinoGames({
      page: 1,
      limit,
      sort: "popularity",
      liveOnly: kind === "live" ? true : undefined,
      slots: kind === "slots" ? true : undefined,
    })
      .then(response => {
        if (cancelled) return;
        const games: any[] = Array.isArray(response?.data) ? response.data : [];
        setItems(games.flatMap((game, index): CasinoListGame[] => {
          const gameId = game?.gameId ?? game?.id;
          if (!gameId) return [];
          return [{
            key: `${gameId}-${index}`,
            title: String(game?.title || game?.name || t("nova.genericGame")),
            provider: String(game?.provider || t("nova.genericProvider")),
            image: String(game?.imageUrl || game?.thumbnail || ""),
            gameId: String(gameId),
          }];
        }));
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, limit, t]);

  return { items, loading };
}
