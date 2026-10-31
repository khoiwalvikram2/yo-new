import { Flame, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import CasinoCard from "./CasinoCard";
import type { CasinoCardItem } from "@/types";
import { getCasinoCategories, getCasinoGames } from "@/lib/api/user";
import { useTranslation } from "react-i18next";

type Props = {
  variant?: "casino" | "slots";
  itemsOverride?: CasinoCardItem[];
  titleOverride?: string;
  subtitleOverride?: string;
  compact?: boolean;
};

export default function TopCasinoSlider({ variant = "casino", itemsOverride, titleOverride, subtitleOverride, compact = false }: Props) {
  const { t } = useTranslation();
  const [dynamicItems, setDynamicItems] = useState<CasinoCardItem[] | null>(null);
  const [loading, setLoading] = useState(itemsOverride === undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  // An override is authoritative, including an empty array. Only an omitted override
  // is allowed to load the tenant's real Top category from the API.
  useEffect(() => {
    if (itemsOverride !== undefined) {
      setDynamicItems(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const slotsOnly = variant === "slots";
        const catsRes = await getCasinoCategories({
          liveOnly: slotsOnly ? undefined : true,
          slotsOnly: slotsOnly ? true : undefined,
        });
        if (cancelled) return;
        const cats = Array.isArray(catsRes?.data) ? catsRes.data : [];
        const topCat = cats.find((c: any) => {
          const type = (c?.type || "").toLowerCase();
          const name = (c?.name || "").toLowerCase();
          if (type === "top") return true;
          return name.includes("top casino") || name.includes("top games") || name === "top";
        });
        const topCatName = topCat ? (typeof topCat === "string" ? topCat : topCat.name) : null;
        if (!topCatName) {
          setDynamicItems([]);
          return;
        }
        const res = await getCasinoGames({
          category: topCatName,
          page: 1,
          limit: 24,
          slots: slotsOnly ? true : undefined,
          liveOnly: slotsOnly ? undefined : true,
        });
        if (cancelled) return;
        const data = Array.isArray((res as any)?.data) ? (res as any).data : [];
        const mapped: CasinoCardItem[] = data
          .map((g: any) => {
            const gameId = g.gameId ?? g.id ?? g.externalId;
            if (!gameId) return null;
            return {
              title: g.title || g.game_name || g.name || t("nova.genericGame"),
              provider: g.provider_name || g.provider || g.vendorName || t("nova.genericProvider"),
              imageUrl: g.imageUrl || g.thumbnail || g.thumbnailUrl || undefined,
              gameId: String(gameId),
              category: g.category,
            };
          })
          .filter(Boolean) as CasinoCardItem[];
        setDynamicItems(mapped);
      } catch {
        if (!cancelled) {
          setDynamicItems([]);
          setLoadError(t("nova.casinoLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [variant, itemsOverride, t]);

  const items = (itemsOverride !== undefined ? itemsOverride : (dynamicItems ?? []))
    .filter((game) => game && (game.gameId || game.title));
  const visibleItems = compact ? items.slice(0, 4) : items;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateButtons = () => {
      const el = scrollRef.current;
      if (!el) return;
      const rightButton = el.parentElement?.querySelector("[data-next]") as HTMLButtonElement | null;
      const leftButton = el.parentElement?.querySelector("[data-prev]") as HTMLButtonElement | null;
      if (!rightButton || !leftButton) return;
      const canScrollMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const canScrollPrev = el.scrollLeft > 1;
      rightButton.dataset.active = canScrollMore ? "true" : "false";
      leftButton.dataset.active = canScrollPrev ? "true" : "false";
    };

    const raf = requestAnimationFrame(updateButtons);
    window.addEventListener("resize", updateButtons);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateButtons);
    };
  }, [items]);

  const scrollByAmount = (direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) return;
    const isMobile = window.innerWidth < 640;
    const isTablet = window.innerWidth < 1024;
    const scrollRatio = isMobile ? 0.6 : isTablet ? 0.7 : 0.8;
    const delta = Math.round(container.clientWidth * scrollRatio);
    container.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" });
  };

  const heading = titleOverride || t(variant === "slots" ? "nova.topSlots" : "nova.topCasino");

  return (
    <section className={`nova-top-casino-slider ${compact ? "nova-top-casino-slider-compact" : ""} space-y-3 sm:space-y-4 overflow-visible`} aria-label={heading}>
      {!compact && <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[color:var(--primary)]" />
          <div className="text-base sm:text-lg font-semibold">{heading}</div>
        </div>
        {items.length > 0 && <div className="flex items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1 sm:gap-2">
            <button type="button" aria-label={t("nova.scrollLeft")} onClick={() => scrollByAmount("left")} data-prev className="casino-slider-nav h-7 w-7 sm:h-8 sm:w-8">
              <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button type="button" aria-label={t("nova.scrollRight")} onClick={() => scrollByAmount("right")} data-next className="casino-slider-nav h-7 w-7 sm:h-8 sm:w-8">
              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
        </div>}
      </div>}
      {subtitleOverride && (
        <div className="text-[11px] sm:text-xs text-[color:var(--subtle)]">{subtitleOverride}</div>
      )}

      {loading && (
        <div role="status" className="py-8 text-sm text-[color:var(--subtle)]">{t("nova.loadingCasino")}</div>
      )}
      {!loading && loadError && (
        <div role="alert" className="py-8 text-sm text-red-600 dark:text-red-400">{loadError}</div>
      )}
      {!loading && !loadError && items.length === 0 && (
        <div className="py-8 text-sm text-[color:var(--subtle)]">
          {t(variant === "slots" ? "nova.noTopSlots" : "nova.noTopCasino")}
        </div>
      )}
      {!loading && !loadError && visibleItems.length > 0 && <div
        ref={scrollRef}
        className="nova-top-casino-track relative flex gap-2 sm:gap-3 md:gap-4 overflow-x-auto overflow-y-visible scroll-smooth snap-x snap-mandatory no-scrollbar px-1 sm:px-0 py-2 min-w-0"
        onScroll={(e) => {
          const el = e.currentTarget;
          const rightButton = el.parentElement?.querySelector("[data-next]") as HTMLButtonElement | null;
          const leftButton = el.parentElement?.querySelector("[data-prev]") as HTMLButtonElement | null;
          if (!rightButton || !leftButton) return;
          const canScrollMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
          const canScrollPrev = el.scrollLeft > 1;
          rightButton.dataset.active = canScrollMore ? "true" : "false";
          leftButton.dataset.active = canScrollPrev ? "true" : "false";
        }}
        onLoadCapture={(e) => {
          const el = e.currentTarget;
          const rightButton = el.parentElement?.querySelector("[data-next]") as HTMLButtonElement | null;
          const leftButton = el.parentElement?.querySelector("[data-prev]") as HTMLButtonElement | null;
          if (!rightButton || !leftButton) return;
          const canScrollMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
          const canScrollPrev = el.scrollLeft > 1;
          rightButton.dataset.active = canScrollMore ? "true" : "false";
          leftButton.dataset.active = canScrollPrev ? "true" : "false";
        }}
      >
        {visibleItems.map((item, idx) => (
          <div key={`${item.title}-${item.gameId || idx}`} className="nova-top-casino-item shrink-0 snap-start py-1">
          <CasinoCard
            item={item}
            className={compact ? "nova-home-casino-card" : ""}
          />
          </div>
        ))}
      </div>}
    </section>
  );
}
