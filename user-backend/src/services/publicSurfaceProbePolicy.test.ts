import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFIED_PURE_QUERY_NAMES,
  selectVerifiedPureQueryResolvers,
} from "./publicSurfaceProbePolicy.js";

test("public-surface probe invokes only explicitly verified pure queries", async () => {
  const invoked: string[] = [];
  const resolver = (name: string) => async () => {
    invoked.push(name);
    return null;
  };
  const queryResolvers = {
    appSettings: resolver("appSettings"),
    sportsList: resolver("sportsList"),
    // These all have lazy writes or provider side effects and must never be
    // executed by a diagnostic advertised as read-only.
    me: resolver("me"),
    userData: resolver("userData"),
    userDetail: resolver("userDetail"),
    accountStatement: resolver("accountStatement"),
    myReferralLink: resolver("myReferralLink"),
    casinoUrl: resolver("casinoUrl"),
    gapCasinoUrl: resolver("gapCasinoUrl"),
    futureQuery: resolver("futureQuery"),
  };

  const { probeable, skipped } = selectVerifiedPureQueryResolvers(queryResolvers);
  await Promise.all(probeable.map(([, fn]) => fn(undefined, {}, {}, undefined)));

  assert.deepEqual(invoked.sort(), ["appSettings", "sportsList"]);
  for (const riskyName of [
    "me",
    "userData",
    "userDetail",
    "accountStatement",
    "myReferralLink",
    "casinoUrl",
    "gapCasinoUrl",
    "futureQuery",
  ]) {
    assert.equal(invoked.includes(riskyName), false, `${riskyName} must not be invoked`);
    assert.ok(skipped.includes(`Query.${riskyName} (not on the verified-pure allowlist)`));
  }
});

test("the allowlist excludes known lazy-write and provider-launch queries", () => {
  const allowed = new Set<string>(VERIFIED_PURE_QUERY_NAMES);
  for (const riskyName of [
    "me",
    "userData",
    "userDetail",
    "accountStatement",
    "myReferralLink",
    "casinoUrl",
    "gapCasinoUrl",
  ]) {
    assert.equal(allowed.has(riskyName), false, `${riskyName} must remain excluded`);
  }
});
