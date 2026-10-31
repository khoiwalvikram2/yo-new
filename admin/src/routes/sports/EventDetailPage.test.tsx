import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EventDetailPageContent } from "./EventDetailPage";
import { useAuthStore } from "@/shared/core/authStore";
import type { DetailMarket, EventDetailBet, OddsPayload } from "./eventDetailPageModel";

const fixture = vi.hoisted(() => ({
  event: { id: "event-1", name: "India v Australia", sport: "cricket", eventCode: "local" },
  markets: [] as DetailMarket[], bets: [] as EventDetailBet[], socketOdds: {} as OddsPayload,
  placed: undefined as EventDetailBet | undefined,
  calls: [] as Array<{ name: string; options: Record<string, unknown> }>,
  refetch: vi.fn(), client: { query: vi.fn() }, loading: false, error: false, empty: false, autoRefresh: true,
}));
vi.mock("@apollo/client", async original => {
  const actual = await original<typeof import("@apollo/client")>();
  return { ...actual, useApolloClient: () => fixture.client,
    useSubscription: (document: { definitions: Array<{ name?: { value?: string } }> }) => document.definitions[0]?.name?.value === "BetPlaced" ? { data: { betPlaced: fixture.placed } } : {},
    useQuery: (document: { definitions: Array<{ name?: { value?: string } }> }, options: Record<string, unknown>) => {
      const name = document.definitions[0]?.name?.value || "";
      fixture.calls.push({ name, options });
      if (name === "EventDetail") {
        fixture.autoRefresh = options.pollInterval === 10000;
        return { data: fixture.empty ? { eventDetail: { event: null, markets: [] } } : { eventDetail: { event: fixture.event, markets: fixture.markets } }, loading: fixture.loading, error: fixture.error ? new Error("Offline") : undefined, refetch: fixture.refetch };
      }
      if (name === "EventBets") return { data: { sportsBets: fixture.bets } };
      return {};
    },
  };
});
vi.mock("@/lib/hooks/useOddsSocket", () => ({ useOddsSocket: () => fixture.socketOdds }));
vi.mock("./components/EventHeaderControls", () => ({ EventHeaderControls: ({ handleRefresh, autoRefresh, setAutoRefresh }: { handleRefresh: () => void; autoRefresh: boolean; setAutoRefresh: (value: boolean) => void }) =>
  <div><button onClick={handleRefresh}>Refresh</button><button onClick={() => setAutoRefresh(!autoRefresh)}>Auto refresh</button></div> }));
vi.mock("./components/EventHeaderStatsSection", () => ({ EventHeaderStatsSection: () => <div>Stats</div> }));
vi.mock("./components/EventSidebar", () => ({ EventSidebar: () => <div>People panel</div> }));
vi.mock("./components/EventBetsSidebar", () => ({ EventBetsSidebar: ({ isWide, onToggleWide, isCollapsed, setIsCollapsed }: { isWide?: boolean; onToggleWide?: () => void; isCollapsed: boolean; setIsCollapsed: (value: boolean) => void }) =>
  <div>Bets panel{onToggleWide && <button onClick={onToggleWide}>{isWide ? "Narrow bets" : "Widen bets"}</button>}<button onClick={() => setIsCollapsed(!isCollapsed)}>{isCollapsed ? "Open bets rail" : "Fold bets rail"}</button></div> }));
vi.mock("./components/MarketCard", () => ({ MarketCard: ({ market, bets, onToggle, isExpanded }: { market: { name?: string }; bets: unknown[]; onToggle: () => void; isExpanded: boolean }) => <div><span>{market.name}</span><output>Card bets {bets.length}</output><button onClick={onToggle}>{isExpanded ? "Collapse market" : "Expand market"}</button></div> }));
vi.mock("./components/MarketTabs", () => ({ MarketTabs: ({ onTabChange }: { onTabChange: (value: string) => void }) => <div><button onClick={() => onTabChange("all")}>All filters</button><button onClick={() => onTabChange("fancy")}>Fancy filter</button></div> }));
vi.mock("./components/ProfitCalculator", () => ({ ProfitCalculator: () => null }));
vi.mock("./components/PriceAlertModal", () => ({ PriceAlertModal: () => null }));
vi.mock("./components/AnalyticsDrawer", () => ({ AnalyticsDrawer: () => null }));
vi.mock("./components/RiskConfigDrawer", () => ({ RiskConfigDrawer: () => null }));
vi.mock("./components/AutomationConfigDrawer", () => ({ AutomationConfigDrawer: () => null }));
vi.mock("./components/RiskAlertBanner", () => ({ RiskAlertBanner: () => null }));
vi.mock("./components/RiskAlertList", () => ({ RiskAlertList: () => null }));
function mount() { return render(<MemoryRouter initialEntries={["/sports/event/event-1"]}><Routes><Route path="/sports/event/:eventId" element={<EventDetailPageContent />} /></Routes></MemoryRouter>); }
beforeEach(() => {
  fixture.calls = []; fixture.loading = false; fixture.empty = false; fixture.error = false;
  fixture.socketOdds = {}; fixture.placed = undefined;
  fixture.markets = [{ id: "m1", name: "Match Odds", kind: "exchange", runners: [{ id: "r1", name: "India", back: 2, lay: 2.1 }] }];
  fixture.bets = [{ id: "b1", userId: "u1", eventId: "event-1", marketId: "m1", selectionId: "r1", side: "back", stake: 100, status: "matched" }];
  fixture.refetch.mockReset(); fixture.refetch.mockResolvedValue({ data: {} });
  useAuthStore.setState({ roles: [], agent: undefined, permissions: [] });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
});
afterEach(cleanup);
describe("Event detail composition", () => {
  it("mounts one actual mobile panel and switches without hidden duplicate sidebars", async () => {
    const view = mount();
    expect(view.container.querySelectorAll("[data-event-panel]")).toHaveLength(1);
    expect(screen.queryByText("People panel")).toBeNull();
    expect(screen.getByRole("button", { name: "Markets, 1" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Book, 1" }));
    expect(screen.getByText("People panel")).toBeTruthy(); expect(screen.queryByText("Match Odds")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bets, 1" }));
    expect(screen.getByText("Bets panel")).toBeTruthy(); expect(screen.queryByText("People panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Widen bets" })).toBeNull();
    act(() => { Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 }); window.dispatchEvent(new Event("resize")); });
    expect(view.container.querySelectorAll("[data-event-panel]")).toHaveLength(3);
    expect(screen.getAllByText("People panel")).toHaveLength(1); expect(screen.getAllByText("Bets panel")).toHaveLength(1);
  });
  it("switches the two-column side rail and widens the bets rail until it is folded", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    const view = mount(); const grid = view.container.querySelector("[data-side]");
    expect(grid?.getAttribute("data-side")).toBe("bets");
    fireEvent.click(screen.getByRole("tab", { name: "Book, 1" }));
    expect(grid?.getAttribute("data-side")).toBe("players");
    expect(screen.getByRole("tab", { name: "Book, 1" }).getAttribute("aria-controls")).toBe(view.container.querySelector("[data-event-panel='players']")?.id);
    fireEvent.click(screen.getByRole("button", { name: "Widen bets" }));
    expect(grid?.hasAttribute("data-wide")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Narrow bets" }));
    expect(grid?.hasAttribute("data-wide")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Widen bets" })); fireEvent.click(screen.getByRole("button", { name: "Fold bets rail" }));
    expect(grid?.hasAttribute("data-wide")).toBe(false); expect(screen.getByRole("button", { name: "Open bets rail" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Widen bets" }));
    expect(grid?.hasAttribute("data-wide")).toBe(true); expect(screen.getByRole("button", { name: "Fold bets rail" })).toBeTruthy();
  });
  it("preserves initial query scope, exact default polling and projected liquidity explanation", async () => {
    mount();
    expect(fixture.calls.find(call => call.name === "EventBets")?.options).toMatchObject({ variables: { query: { eventId: "event-1", limit: 1000 } }, fetchPolicy: "network-only" });
    expect(fixture.autoRefresh).toBe(true);
    expect(screen.getByText(/Projected depth/)).toBeTruthy();
    expect(screen.getByText(/subscriptions and panel polling continue independently/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Auto refresh" }));
    expect(fixture.autoRefresh).toBe(false);
    await waitFor(() => expect(screen.getByText("Card bets 1")).toBeTruthy());
  });
  it("guards repeated refresh and keeps old data on a refused read", async () => {
    let rejectRead: ((reason: Error) => void) | undefined;
    fixture.refetch.mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Refresh" })); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(fixture.refetch).toHaveBeenCalledTimes(1); expect(screen.getByText(/Refreshing event details/)).toBeTruthy();
    await act(async () => { rejectRead?.(new Error("Refused")); });
    expect(screen.getByRole("alert").textContent).toContain("Existing data is kept");
    expect(screen.getByText("Match Odds")).toBeTruthy();
    fixture.refetch.mockResolvedValueOnce({ data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
  it("preserves expansion and filtered empty state", async () => {
    const view = mount(); await waitFor(() => expect(screen.getByRole("button", { name: "Collapse market" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Collapse market" }));
    expect(screen.getByRole("button", { name: "Expand market" })).toBeTruthy();
    fixture.markets = fixture.markets.map(market => ({ ...market, runners: [{ id: "r1", name: "India", back: 2.2, lay: 2.3 }] }));
    view.rerender(<MemoryRouter initialEntries={["/sports/event/event-1"]}><Routes><Route path="/sports/event/:eventId" element={<EventDetailPageContent />} /></Routes></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Expand market" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fancy filter" }));
    expect(screen.getByText("No markets available for this filter")).toBeTruthy();
  });
  it("distinguishes missing, initial loading and failed-event states", () => {
    fixture.empty = true; fixture.loading = true; const view = mount();
    expect(screen.getByText("Loading event details...")).toBeTruthy(); view.unmount();
    fixture.loading = false; const empty = mount(); expect(screen.getByText("Event not found")).toBeTruthy(); empty.unmount();
    fixture.error = true; mount(); expect(screen.getByText("Event details could not be loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry event details" })).toBeTruthy();
  });
  it("caps query snapshots at 1500 and rejects other-event subscription updates", async () => {
    fixture.bets = Array.from({ length: 1505 }, (_, index) => ({ id: String(index), userId: "u1", eventId: "event-1", marketId: "m1", side: "back", stake: 1, status: "matched" }));
    const view = mount(); await waitFor(() => expect(screen.getByText("Card bets 1500")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Bets" })).toBeTruthy(); // a list at its row limit shows no count
    fixture.placed = { id: "new", userId: "u1", eventId: "other-event", marketId: "m1", side: "back", stake: 1, status: "matched" };
    view.rerender(<MemoryRouter initialEntries={["/sports/event/event-1"]}><Routes><Route path="/sports/event/:eventId" element={<EventDetailPageContent />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Card bets 1500")).toBeTruthy();
  });
  it("merges socket fancy lines into the first database market and keeps all matching DB bets", async () => {
    fixture.markets = [{ id: "f1", name: "First DB Fancy", kind: "fancy", eventId: "event-1", runners: [] }, { id: "f2", name: "Second DB Fancy", kind: "fancy", eventId: "event-1", runners: [] }];
    fixture.socketOdds = { "fancy-local": { payload: [JSON.stringify({ id: "line", name: "Runs", b1: 50, l1: 49, priority: 1 })] } };
    fixture.bets = [{ id: "one", marketId: "f1", userId: "u1", eventId: "event-1", side: "back", stake: 1, status: "matched" }, { id: "two", marketId: "f2", userId: "u1", eventId: "event-1", side: "back", stake: 1, status: "matched" }, { id: "wrong", marketId: "f1", userId: "u1", eventId: "other", side: "back", stake: 1, status: "matched" }];
    const view = mount(); await waitFor(() => expect(screen.getByText("Card bets 2")).toBeTruthy());
    expect(screen.getByText("Fancy")).toBeTruthy(); expect(view.container.querySelectorAll("section")).toHaveLength(1);
  });
});

