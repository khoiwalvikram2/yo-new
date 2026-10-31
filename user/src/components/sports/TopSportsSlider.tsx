import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { ALL_SPORTS } from "./allSportsList";

export default function TopSportsSlider({ activeKey: activeKeyProp, countsByKey, onSelect }: { activeKey?: string; countsByKey?: Record<string, number>; onSelect?: (key: string) => void } = {}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeKey, setActiveKey] = useState<string>(activeKeyProp || "live");
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  useEffect(() => {
    if (activeKeyProp) setActiveKey(activeKeyProp);
  }, [activeKeyProp]);
  
  const scrollByAmount = (direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) return;
    const isMobile = window.innerWidth < 640;
    const isTablet = window.innerWidth < 1024;
    const scrollRatio = isMobile ? 0.6 : isTablet ? 0.7 : 0.8;
    const delta = Math.round(container.clientWidth * scrollRatio);
    container.scrollBy({
      left: direction === "left" ? -delta : delta,
      behavior: "smooth",
    });
  };

  const chips = useMemo(() => ALL_SPORTS.map(s => ({ ...s, count: typeof countsByKey?.[s.key] === 'number' ? countsByKey![s.key] : undefined })), [countsByKey]);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    const canScrollMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    const canScrollPrev = el.scrollLeft > 1;
    setCanScrollLeft(canScrollPrev);
    setCanScrollRight(canScrollMore);
  };

  useEffect(() => {
    const raf = requestAnimationFrame(updateScrollState);
    window.addEventListener("resize", updateScrollState);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateScrollState);
    };
  }, []);

  return (
    <section className="top-sports-slider nova-top-sports-slider" aria-label="Sports">
      <div className="nova-top-sports-row">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => scrollByAmount("left")}
          data-prev
          disabled={!canScrollLeft}
          className="top-sports-slider-nav nova-top-sports-nav nova-top-sports-nav-prev"
        >
          <ChevronLeft aria-hidden="true" />
        </button>

        <div
          ref={scrollRef}
          className="nova-top-sports-track no-scrollbar"
          onScroll={updateScrollState}
          onLoad={updateScrollState}
        >
          {chips.map((sport) => {
            const isActive = sport.key === activeKey;
            const Icon = sport.icon;
            const isLive = sport.key === "live";
            return (
              <button
                type="button"
                key={sport.key}
                aria-pressed={isActive}
                onClick={() => {
                  setActiveKey(sport.key);
                  onSelect?.(sport.key);
                }}
                className={`nova-top-sport-pill ${isActive ? "active" : ""}`}
              >
                <span className="nova-top-sport-icon" aria-hidden="true">
                  {isLive && <span className="nova-top-sport-live-dot" />}
                  {sport.imageSrc ? (
                    <img
                      src={sport.imageSrc}
                      alt=""
                      className="sport-img"
                      loading="lazy"
                    />
                  ) : (
                    Icon && <Icon />
                  )}
                </span>
                <span className="nova-top-sport-label">{sport.label}</span>
                {typeof sport.count === "number" && (
                  <small className="nova-top-sport-count">{sport.count}</small>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-label="Next"
          onClick={() => scrollByAmount("right")}
          data-next
          disabled={!canScrollRight}
          className="top-sports-slider-nav nova-top-sports-nav nova-top-sports-nav-next"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
