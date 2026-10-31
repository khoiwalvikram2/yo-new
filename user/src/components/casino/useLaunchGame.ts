import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCasinoUrl } from "@/lib/api/user";
import { getSelectedWallet } from "@/lib/walletUtils";
import { useAuth } from "@/lib/auth";

/**
 * Opens a casino game: asks guests to log in, then swaps the page for the provider URL.
 * `onPlay` replaces the URL lookup for callers that launch games their own way.
 */
export function useLaunchGame(gameId: string | undefined, onPlay?: () => void | Promise<void>) {
  const { t } = useTranslation();
  const { isAuthenticated, openAuthModal } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const launch = useCallback(async () => {
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }
    if (!gameId) {
      setError(t("nova.gameUnavailable"));
      return;
    }
    if (inFlight.current) return;

    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      if (onPlay) {
        await onPlay();
        return;
      }

      const response = await getCasinoUrl(gameId, getSelectedWallet());
      const url = response?.data?.redirectUrl;
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        window.open(url, "_self");
      } else {
        // A 403 refusal carries a player-facing reason (e.g. betting suspended by the agent).
        const refusal = response?.meta?.code === 403 ? response.meta.message : undefined;
        setError(refusal || t("nova.gameUnavailable"));
      }
    } catch {
      setError(t("nova.gameLaunchError"));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [gameId, isAuthenticated, onPlay, openAuthModal, t]);

  return { launch, loading, error };
}
