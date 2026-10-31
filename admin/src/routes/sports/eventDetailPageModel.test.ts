import { describe, expect, it } from "vitest";
import { getMergedMarketWithOdds, marketIdSetForCard, betsForMarketCard, type DetailMarket, type EventDetailBet } from "./eventDetailPageModel";
const market: DetailMarket = { id: "m1", kind: "exchange", runners: [{ id: "r1", selectionCode: "provider-1", name: "India" }] };
const bet = (id: string, marketId: string): EventDetailBet => ({ id, marketId, userId: "u1", side: "back", stake: 10, status: "matched" });

describe("Event detail odds merge invariants", () => {
  it("keeps inherited projected three-level prices and 700/850/1000 sizes", () => {
    const result = getMergedMarketWithOdds(market, {}, { markets: [{ marketId: "m1", top: [{ selectionId: "r1", back: 2, lay: 2.1 }] }] }, undefined);
    const runner = result.mergedMarket.runners![0];
    expect(runner.ex?.availableToBack).toEqual([{ price: 1.98, size: 700 }, { price: 1.99, size: 850 }, { price: 2, size: 1000 }]);
    expect(runner.ex?.availableToLay).toEqual([{ price: 2.1, size: 1000 }, { price: 2.11, size: 850 }, { price: 2.12, size: 700 }]);
    expect(runner._projectedDepth).toBe(true); expect(result.mergedMarket._hasProjectedDepth).toBe(true);
  });
  it("preserves real provider depth without projected labeling", () => {
    const ex = { availableToBack: [{ price: 1.8, size: 11 }, { price: 2, size: 23 }], availableToLay: [{ price: 2.2, size: 41 }] };
    const result = getMergedMarketWithOdds({ ...market, marketCode: "provider" }, { provider: { runners: [{ selectionId: "provider-1", ex }] } }, null, undefined);
    expect(result.mergedMarket.runners![0].ex).toBe(ex); expect(result.mergedMarket.runners![0].back).toBe(2);
    expect(result.mergedMarket._hasProjectedDepth).toBe(false);
  });
  it("uses existing stored quotes before socket prices", () => {
    const result = getMergedMarketWithOdds({ ...market, marketCode: "provider", runners: [{ id: "r1", back: 3, lay: 4 }] }, { provider: { selections: [{ id: "r1", back: 9, lay: 10 }] } }, null, undefined);
    expect(result.mergedMarket.runners![0]).toMatchObject({ back: 3, lay: 4 });
  });
  it("matches runner by normalized name then falls back to provider index", () => {
    const result = getMergedMarketWithOdds({ ...market, marketCode: "provider" }, { provider: { runners: { one: { name: " INDIA ", back: 5, lay: 6 } } } }, null, undefined);
    expect(result.mergedMarket.runners![0]).toMatchObject({ back: 5, lay: 6 });
    const fallback = getMergedMarketWithOdds({ ...market, marketCode: "provider" }, { provider: [{ name: "Other", back: 7, lay: 8 }] }, null, undefined);
    expect(fallback.mergedMarket.runners![0]).toMatchObject({ back: 7, lay: 8 });
  });
  it("retains synthetic fancy raw sizing/status and no exchange depth", () => {
    const result = getMergedMarketWithOdds({ id: "f1", kind: "fancy", _isSynthetic: true, runners: [{ id: "line", name: "Runs", _fancyLine: { b1: 51.6, l1: 49.6, bs1: 120, ls1: 110, gstatus: "Ball Running" } }] }, {}, null, "event");
    expect(result.mergedMarket.runners![0]).toMatchObject({ back: 51.6, lay: 49.6, volume: 100, ex: null, fancyData: { bs1: "120", ls1: "110", status1: "Ball Running" } });
    expect(result.mergedMarket._hasProjectedDepth).toBe(false);
  });
  it("retains JSON fancy payload matching and GraphQL fallback", () => {
    const fancy: DetailMarket = { id: "f1", kind: "fancy", runners: [{ id: "line", name: "First Runs" }] };
    const result = getMergedMarketWithOdds(fancy, { "fancy-event": { payload: [JSON.stringify({ id: "line", name: "First Runs", yes: 50, no: 49, yesSize: 90, status: "SUSPENDED" })] } }, null, "event");
    expect(result.mergedMarket.runners![0]).toMatchObject({ back: 50, lay: 49, fancyData: { bs1: "90", status1: "SUSPENDED" } });
    const gql = getMergedMarketWithOdds(fancy, {}, { markets: [{ marketId: "f1", fancy: [{ name: "First Runs", back: 60, lay: 59 }] }] }, undefined);
    expect(gql.mergedMarket.runners![0]).toMatchObject({ back: 60, lay: 59 });
  });
  it("does not synthesize depth when no price exists and floors back estimates at 1.01", () => {
    expect(getMergedMarketWithOdds(market, {}, null, undefined).mergedMarket.runners![0].ex).toBeNull();
    const result = getMergedMarketWithOdds({ ...market, runners: [{ id: "r", back: 1.01 }] }, {}, null, undefined);
    expect(result.mergedMarket.runners![0].ex?.availableToBack?.map(row => row.price)).toEqual([1.01, 1.01, 1.01]);
    expect(result.mergedMarket.runners![0].ex?.availableToLay).toEqual([]);
  });
  it("joins all merged fancy DB IDs without changing bet ordering", () => {
    const fancy: DetailMarket = { id: "f1", _dbMarketIds: ["f2", 3, ""] };
    expect([...marketIdSetForCard(fancy)]).toEqual(["f1", "f2", "3"]);
    expect(betsForMarketCard(fancy, [bet("a", "f2"), bet("b", "other"), bet("c", "3"), bet("d", "f1")]).map(row => row.id)).toEqual(["a", "c", "d"]);
  });
});

