import { formatAmount } from "../../lib/currency";

export interface BetListCardProps {
  eventName?: string;
  league?: string;
  dateTime: string;
  betType: string;
  selection: string;
  odds: number;
  stake: number;
  potential: number;
  className?: string;
}

export default function BetListCard({
  eventName,
  league,
  dateTime,
  betType,
  selection,
  odds,
  stake,
  potential,
  className,
}: BetListCardProps) {
  const isBack = (betType || "").toLowerCase() === "back";

  return (
    <div className={`group relative p-2.5 rounded-lg bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-3)] border border-[color:var(--border)]/20 cursor-pointer hover:shadow-md transition-all duration-200 overflow-hidden ${className ?? ""}`.trim()}>
      <div
        className={`absolute inset-0 rounded-lg pointer-events-none ${
          isBack
            ? "bg-gradient-to-br from-sky-500/24 via-transparent to-transparent"
            : "bg-gradient-to-br from-rose-500/24 via-transparent to-transparent"
        }`}
      />
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 pointer-events-none ${
          isBack
            ? "bg-gradient-to-b from-sky-500 to-sky-500/60"
            : "bg-gradient-to-b from-rose-500 to-rose-500/60"
        }`}
      />
      {Boolean(eventName || league) && (
        <div className="flex items-center justify-between mb-1.5">
          <div className="min-w-0 flex-1">
            {eventName && (
              <div className="text-xs font-semibold text-[color:var(--foreground)] truncate">
                {eventName}
              </div>
            )}
            {league && (
              <div className="text-[10px] text-[color:var(--subtle)] font-medium">{league}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[10px] text-[color:var(--text)] font-medium bg-[color:var(--surface-3)] px-2 py-1 rounded-md">
              {dateTime || "15 Sep 14:30"}
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2">
          <span
            className={`${
              isBack
                ? "text-sky-600 dark:text-sky-400 bg-sky-500/12 border-sky-500/20"
                : "text-rose-600 dark:text-rose-400 bg-rose-500/12 border-rose-500/20"
            } font-semibold px-1.5 py-0.5 rounded-md border`}
          >
            {selection}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] text-[color:var(--subtle)] uppercase tracking-wide">
              odds
            </span>
            <span
              className={`${
                isBack ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
              } font-extrabold`}
            >
              {Number(odds).toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="text-right">
            <div className="text-[9px] text-[color:var(--subtle)] uppercase tracking-wide">
              stake
            </div>
            <div className="text-[color:var(--text)] font-medium">
              {formatAmount(Number(stake))}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-[color:var(--subtle)] uppercase tracking-wide">
              P&L
            </div>
            <div
              className={`${
                isBack ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
              } font-semibold`}
            >
              {formatAmount(potential)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
