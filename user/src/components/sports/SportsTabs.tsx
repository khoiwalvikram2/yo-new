import { Search } from "lucide-react";

interface SportsTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export default function SportsTabs({
  activeTab,
  onTabChange,
  searchValue = "",
  onSearchChange,
}: SportsTabsProps) {
  const tabs = [
    { value: "in-play", label: "In-Play" },
    { value: "all", label: "All" },
    { value: "today", label: "Today" },
    { value: "tomorrow", label: "Tomorrow" },
  ];

  const selectClass =
    "px-4 py-2.5 rounded-[5px] font-medium text-sm border bg-[color:var(--ds-color-slate-800)] border-[color:var(--ds-color-slate-600)] text-[color:var(--ds-color-slate-100)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/50 focus:border-[var(--brand-primary)]/50 appearance-none cursor-pointer min-w-[140px]";
  const searchInputClass =
    "flex-1 min-w-0 px-3 py-2.5 pl-9 rounded-[5px] text-sm border bg-[color:var(--ds-color-slate-800)] border-[color:var(--ds-color-slate-600)] text-[color:var(--ds-color-slate-100)] placeholder-[color:var(--ds-color-slate-500)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/50 focus:border-[var(--brand-primary)]/50";

  return (
    <>
      {/* Mobile: dropdown + search stacked */}
      <div className="sm:hidden flex flex-col gap-2 w-full">
        <select
          value={activeTab}
          onChange={(e) => onTabChange(e.target.value)}
          className="w-full px-3 py-2 rounded-[5px] border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] text-[color:var(--ds-color-slate-100)] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/50 focus:border-[var(--brand-primary)]/50"
        >
          {tabs.map((tab) => (
            <option key={tab.value} value={tab.value}>
              {tab.label}
            </option>
          ))}
        </select>
        {onSearchChange && (
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--ds-color-slate-400)] pointer-events-none" />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search events…"
              className="w-full px-3 py-2 pl-9 rounded-[5px] text-sm border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] text-[color:var(--ds-color-slate-100)] placeholder-[color:var(--ds-color-slate-500)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/50 focus:border-[var(--brand-primary)]/50"
              aria-label="Search events"
            />
          </div>
        )}
      </div>

      {/* Desktop: dropdown left, search on the right */}
      <div className="hidden sm:flex items-center gap-2 flex-1 min-w-0">
        <select
          value={activeTab}
          onChange={(e) => onTabChange(e.target.value)}
          className={selectClass}
          aria-label="Filter by time"
        >
          {tabs.map((tab) => (
            <option key={tab.value} value={tab.value}>
              {tab.label}
            </option>
          ))}
        </select>
        {onSearchChange && (
          <div className="relative flex-1 min-w-0 max-w-[240px] ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--ds-color-slate-400)] pointer-events-none" />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search events…"
              className={searchInputClass}
              aria-label="Search events"
            />
          </div>
        )}
      </div>
    </>
  );
}
