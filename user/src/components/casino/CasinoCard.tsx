import { useCallback, useEffect, useState } from "react";
import { Heart, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CasinoCardItem } from "@/types";
import ConfettiBurst from "../animations/ConfettiBurst";
import { likeCasinoGame, unlikeCasinoGame } from "@/lib/api/user";
import { useAuth } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { useLaunchGame } from "./useLaunchGame";

type Props = {
  item: CasinoCardItem;
  className?: string;
  onLike?: (nextLiked: boolean) => void | Promise<void>;
  onPlay?: () => void | Promise<void>;
  loading?: boolean;
};

const LIKED_STORAGE_KEY = "stakex_liked_casino_games";
const LIKED_CHANGED_EVENT = "stakex:liked-changed";

export default function CasinoCard({ item, className = "", onLike, onPlay, loading: controlledLoading = false }: Props) {
  const { t } = useTranslation();
  const { isAuthenticated, openAuthModal } = useAuth();
  const [storedLiked, setStoredLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const { launch, loading: localLoading, error } = useLaunchGame(item.gameId, onPlay);
  const [imgLoaded, setImgLoaded] = useState(false);
  const isLikeControlled = item.isLiked !== undefined;
  const liked = isLikeControlled ? item.isLiked : storedLiked;
  const loading = controlledLoading || localLoading;

  const readLikedState = useCallback(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(LIKED_STORAGE_KEY) || "[]") as Array<{
        id?: string;
        gameId?: string;
        title?: string;
        provider?: string;
      }>;
      const id = item.gameId || "";
      setStoredLiked(stored.some((game) =>
        (id && (game.id || game.gameId) === id)
        || (!id && game.title === item.title && game.provider === item.provider)
      ));
    } catch {
      setStoredLiked(false);
    }
  }, [item.gameId, item.provider, item.title]);

  useEffect(() => {
    if (isLikeControlled) return;

    readLikedState();
    window.addEventListener(LIKED_CHANGED_EVENT, readLikedState);
    return () => window.removeEventListener(LIKED_CHANGED_EVENT, readLikedState);
  }, [isLikeControlled, readLikedState]);

  function persistLike(nextLiked: boolean) {
    try {
      const stored = JSON.parse(window.localStorage.getItem(LIKED_STORAGE_KEY) || "[]") as Array<Record<string, unknown>>;
      const id = item.gameId || "";
      const matches = (game: Record<string, unknown>) =>
        (id && (game.id || game.gameId) === id)
        || (!id && game.title === item.title && game.provider === item.provider);

      const next = nextLiked
        ? stored.some(matches)
          ? stored
          : [...stored, {
              id: id || `${item.title}:${item.provider}`,
              gameId: id || `${item.title}:${item.provider}`,
              title: item.title,
              provider: item.provider,
              category: item.category || "live",
              thumbnail: item.imageUrl || "/dice-bg.svg",
              isLiked: true,
            }]
        : stored.filter((game) => !matches(game));

      window.localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(LIKED_CHANGED_EVENT, { detail: { source: "local" } }));
    } catch {
      // Storage can be unavailable in private browsing; the server action still runs.
    }
  }

  async function toggleLike() {
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }
    if (!item.gameId) {
      notify.error(t("nova.gameUnavailable"));
      return;
    }
    if (likePending) return;

    const nextLiked = !liked;
    setLikePending(true);

    if (isLikeControlled && onLike) {
      try {
        await onLike(nextLiked);
      } finally {
        setLikePending(false);
      }
      return;
    }

    setStoredLiked(nextLiked);
    if (!isLikeControlled) persistLike(nextLiked);
    try {
      if (nextLiked) {
        await likeCasinoGame(item.gameId);
        notify.success(t("nova.addedToBookmarks"));
      } else {
        await unlikeCasinoGame(item.gameId);
        notify.message(t("nova.removedFromBookmarks"));
      }
      window.dispatchEvent(new CustomEvent(LIKED_CHANGED_EVENT, { detail: { source: "server" } }));
    } catch {
      setStoredLiked(!nextLiked);
      if (!isLikeControlled) persistLike(!nextLiked);
      notify.error(t("nova.bookmarkUpdateError"));
    } finally {
      setLikePending(false);
    }
  }

  function launchGame() {
    if (controlledLoading) return;
    void launch();
  }

  const title = item.title?.trim() || t("nova.genericGame");
  const provider = item.provider?.trim() || t("nova.genericProvider");

  return (
    <article className={`nova-game-card group ${className}`}>
      <button
        type="button"
        className={`nova-game-save ${liked ? "is-saved" : ""}`}
        onClick={toggleLike}
        disabled={likePending}
        aria-pressed={liked}
        aria-label={`${t(liked ? "nova.removeBookmark" : "nova.addBookmark")} ${title}`}
      >
        <Heart aria-hidden="true" />
        {liked && <ConfettiBurst className="absolute inset-0" particleCount={5} durationMs={450} spread={14} />}
      </button>

      <button
        type="button"
        className="nova-game-art"
        onClick={launchGame}
        disabled={loading}
        aria-label={t("nova.openGame", { title })}
      >
        <span className={`nova-game-placeholder ${imgLoaded ? "is-hidden" : ""}`} aria-hidden="true" />
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.fallbackApplied === "true") {
                image.style.display = "none";
                setImgLoaded(true);
                return;
              }
              image.dataset.fallbackApplied = "true";
              image.src = "/dice-bg.svg";
            }}
          />
        )}
        <span className="nova-game-art-shade" aria-hidden="true" />
        <span className="nova-game-art-title">{title}</span>
        {loading && <span className="nova-game-loading" role="status"><LoaderCircle aria-hidden="true" /></span>}
      </button>

      <div className="nova-game-copy">
        <button type="button" className="nova-game-name" onClick={launchGame} disabled={loading}>
          {title}
        </button>
        <p>{provider}</p>
        {error && <span className="nova-game-error" role="alert">{error}</span>}
      </div>
    </article>
  );
}
