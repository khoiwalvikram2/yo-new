import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import CasinoCard from "./casino/CasinoCard";
import { useFeaturedCasinoGames, type FeaturedItem } from "./casino/useFeaturedCasinoGames";
import type { CasinoCardItem } from "@/types";

type Props = {
  variant?: "default" | "slots";
  itemsOverride?: FeaturedItem[];
  titleOverride?: string;
  subtitleOverride?: string;
  sliderOnly?: boolean;
  gridOnly?: boolean;
};

function toCasinoCard(item: FeaturedItem): CasinoCardItem {
  return {
    title: item.title,
    provider: item.provider,
    imageUrl: item.image,
    gameId: item.game_id,
  };
}

export default function FeaturedGames({
  variant = "default",
  itemsOverride,
  titleOverride,
  subtitleOverride,
  gridOnly = false,
}: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const {
    items: dynamicItems,
    title: dynamicTitle,
    subtitle: dynamicSubtitle,
    loading,
    error: loadError,
  } = useFeaturedCasinoGames(variant, itemsOverride === undefined);

  const featuredList = itemsOverride ?? dynamicItems;
  const heading = titleOverride || dynamicTitle || t("home.featuredTitle");
  const subtitle = subtitleOverride || dynamicSubtitle;

  const scrollByAmount = (direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) return;
    const delta = Math.round(container.clientWidth * (window.innerWidth < 640 ? .72 : .84));
    container.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" });
  };

  const content = loading ? (
    <div role="status" className="py-8 text-sm text-[color:var(--subtle)]">{t("nova.loadingCasino")}</div>
  ) : loadError ? (
    <div role="alert" className="py-8 text-sm text-red-600 dark:text-red-400">{loadError}</div>
  ) : featuredList.length === 0 ? (
    <div className="py-8 text-sm text-[color:var(--subtle)]">{t("nova.noFeaturedGames")}</div>
  ) : gridOnly ? (
    <div className="nova-game-grid">
      {featuredList.map((item, index) => (
        <CasinoCard key={`${item.game_id}-grid-${index}`} item={toCasinoCard(item)} />
      ))}
    </div>
  ) : (
    <div
      ref={scrollRef}
      className="relative flex gap-[17px] overflow-x-auto overflow-y-visible scroll-smooth snap-x snap-mandatory no-scrollbar py-2 min-w-0"
    >
      {featuredList.map((item, index) => (
        <div key={`${item.game_id}-${index}`} className="nova-game-slide shrink-0 snap-start py-1">
          <CasinoCard item={toCasinoCard(item)} />
        </div>
      ))}
    </div>
  );

  return (
    <section className="nova-featured-games overflow-visible" aria-labelledby={`featured-${variant}`}>
      <div className="flex items-end justify-between gap-4 mb-3 sm:mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-[color:var(--nova-accent)]" aria-hidden="true" />
            <h2 id={`featured-${variant}`} className="text-base sm:text-lg font-semibold text-[color:var(--text)]">{heading}</h2>
          </div>
          {subtitle && <p className="mt-1 text-xs text-[color:var(--subtle)]">{subtitle}</p>}
        </div>
        {!gridOnly && featuredList.length > 0 && (
          <div className="inline-flex items-center gap-2">
            <button type="button" aria-label={t("nova.scrollLeft")} onClick={() => scrollByAmount("left")} className="casino-slider-nav h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label={t("nova.scrollRight")} onClick={() => scrollByAmount("right")} className="casino-slider-nav h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {content}
    </section>
  );
}
