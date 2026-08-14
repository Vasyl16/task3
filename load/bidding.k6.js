import http from "k6/http";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { check, fail } from "k6";

// Many concurrent bidders on ONE auction — chosen over concurrent
// checkout because it puts every virtual user in contention for the SAME
// database row. Checkout under limited inventory contends too, but it
// spreads across several products and sellers; here the contention is
// total and unavoidable, which is what actually exercises the optimistic
// locking strategy in BiddingService.placeBid.
//
// What this is measuring is not "how fast is the API". It is whether the
// concurrency strategy stays CORRECT while under real load, and what it
// costs. The correctness assertions run in teardown() against the live
// API after the load has stopped.
//
// Usage (see ../README.md):
//   k6 run load/bidding.k6.js
//   BASE_URL=http://localhost:3000 VUS=50 DURATION=30s k6 run load/bidding.k6.js

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = parseInt(__ENV.VUS || "50", 10);
const DURATION = __ENV.DURATION || "30s";
const STARTING_PRICE = 100;
const MIN_INCREMENT = 1;

// Bid outcomes, tracked separately because "rejected" is not an error
// here — it is the optimistic lock working. Conflating them would make a
// correctly-behaving system look like a broken one.
const bidsAccepted = new Counter("bids_accepted");
const bidsRejectedStale = new Counter("bids_rejected_stale");
const bidsConflict = new Counter("bids_conflict_exhausted");
const bidsFailed = new Counter("bids_unexpected_failure");
const bidDuration = new Trend("bid_duration", true);

export const options = {
  scenarios: {
    contention: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
      gracefulStop: "10s",
    },
  },
  thresholds: {
    // A 5xx, a dropped request, or a hung connection is a real failure.
    // A 400 (bid no longer high enough) is not, so http_req_failed is
    // scoped to genuine transport/server errors via the custom counter
    // below rather than being read off status codes.
    bids_unexpected_failure: ["count==0"],
    http_req_duration: ["p(95)<2000"],
  },
};

function post(path, body, token) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function login(email, password) {
  const res = post("/auth/login", { email, password });
  if (res.status !== 200) {
    fail(`login failed for ${email}: ${res.status} ${res.body}`);
  }
  return JSON.parse(res.body).accessToken;
}

// Everything the run needs is built here, once, before any load starts —
// so fixture creation never shows up in the measured numbers.
export function setup() {
  const stamp = `${Date.now()}`;
  const sellerEmail = __ENV.SELLER_EMAIL || "aurora@seed.marketplace.test";
  const password = __ENV.SEED_PASSWORD || "SeedPass123!";
  const sellerToken = login(sellerEmail, password);

  const categories = http.get(`${BASE_URL}/categories`);
  if (categories.status !== 200) {
    fail(`could not list categories: ${categories.status}`);
  }
  const categoryId = JSON.parse(categories.body)[0].id;

  // A dedicated AUCTION product per run, so repeated runs never contend
  // with each other's leftover state.
  const productRes = post(
    "/products",
    {
      categoryId,
      name: `Load Test Lot ${stamp}`,
      slug: `load-test-lot-${stamp}`,
      basePrice: 1,
      type: "AUCTION",
      initialQuantity: 1,
    },
    sellerToken,
  );
  if (productRes.status !== 201) {
    fail(`product creation failed: ${productRes.status} ${productRes.body}`);
  }
  const productId = JSON.parse(productRes.body).id;

  const auctionRes = post(
    "/auctions",
    {
      productId,
      quantity: 1,
      startingPrice: STARTING_PRICE,
      minBidIncrement: MIN_INCREMENT,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    },
    sellerToken,
  );
  if (auctionRes.status !== 201) {
    fail(`auction creation failed: ${auctionRes.status} ${auctionRes.body}`);
  }
  const auctionId = JSON.parse(auctionRes.body).id;

  // One account per VU. Distinct bidders matter: a single account
  // bidding against itself would still be a valid concurrency test, but
  // it would not exercise the "you cannot outbid yourself trivially"
  // path or produce a realistic mix of winners and losers.
  const bidders = [];
  for (let i = 0; i < VUS; i++) {
    const email = `loadbidder-${stamp}-${i}@loadtest.local`;
    const reg = post("/auth/register", {
      email,
      password: "LoadTest123!",
      name: `Load Bidder ${i}`,
    });
    if (reg.status !== 201) {
      fail(`bidder registration failed (${reg.status}). If this is a 429, raise ` + `THROTTLE_AUTH_LIMIT for the load-test run — see README.md.`);
    }
    bidders.push(JSON.parse(reg.body).accessToken);
  }

  console.log(`[setup] auction=${auctionId} product=${productId} bidders=${bidders.length}`);
  return { auctionId, productId, bidders, startedAt: Date.now() };
}

export default function (data) {
  const token = data.bidders[exec.vu.idInTest - 1];

  // iterationInTest is unique and monotonically increasing across ALL
  // VUs, so every request in the run targets a distinct, ever-higher
  // amount. They are ISSUED in ascending order but ARRIVE interleaved —
  // which is precisely the race the optimistic lock has to survive.
  const amount = STARTING_PRICE + (exec.scenario.iterationInTest + 1) * MIN_INCREMENT;

  const res = post(`/auctions/${data.auctionId}/bids`, { amount }, token);
  bidDuration.add(res.timings.duration);

  if (res.status === 201) {
    bidsAccepted.add(1);
  } else if (res.status === 400) {
    // Someone else's bid landed first and raised the floor above this
    // amount. The correct outcome, not an error.
    bidsRejectedStale.add(1);
  } else if (res.status === 409) {
    // MAX_BID_ATTEMPTS consecutive version conflicts — the retry budget
    // ran out. Honest backpressure; still not data loss.
    bidsConflict.add(1);
  } else {
    bidsFailed.add(1);
    console.error(`unexpected ${res.status}: ${String(res.body).slice(0, 200)}`);
  }

  check(res, {
    "no server error": (r) => r.status < 500,
  });
}

// The business-correctness half of the test. Perf numbers alone would
// not tell us the strategy is sound — a system that silently dropped
// bids would look FASTER here, not slower.
export function teardown(data) {
  const auction = JSON.parse(http.get(`${BASE_URL}/auctions/${data.auctionId}`).body);
  const bids = JSON.parse(http.get(`${BASE_URL}/auctions/${data.auctionId}/bids`).body);

  const amounts = bids.map((b) => Number(b.amount)).sort((a, b) => a - b);
  const highest = amounts.length ? amounts[amounts.length - 1] : null;

  // Bids come back newest-first from the API; re-sort by placedAt to
  // inspect the order they were actually accepted in.
  const chronological = [...bids].sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
  let strictlyAscending = true;
  for (let i = 1; i < chronological.length; i++) {
    if (Number(chronological[i].amount) <= Number(chronological[i - 1].amount)) {
      strictlyAscending = false;
    }
  }

  const results = {
    acceptedBidRows: bids.length,
    // One version bump per accepted bid. Fewer would mean an UPDATE was
    // lost; more would mean one applied twice.
    auctionVersion: auction.version,
    versionMatchesBidCount: auction.version === bids.length,
    currentHighestBid: Number(auction.currentHighestBid),
    maxAcceptedBid: highest,
    // The headline invariant: the auction settled on the genuine
    // highest bid, not on whichever write happened to land last.
    highestBidWins: Number(auction.currentHighestBid) === highest,
    // No accepted bid is ever lower than one accepted before it. This is
    // the definition of "no lost update" for this domain.
    acceptedChainStrictlyAscending: strictlyAscending,
    winnerIsHighestBidder: auction.currentHighestBidderId === (bids.find((b) => Number(b.amount) === highest) || {}).bidderId,
  };

  console.log("\n===== BUSINESS CORRECTNESS =====");
  for (const [key, value] of Object.entries(results)) {
    console.log(`  ${key}: ${value}`);
  }

  const invariantsHeld = results.versionMatchesBidCount && results.highestBidWins && results.acceptedChainStrictlyAscending && results.winnerIsHighestBidder;
  console.log(`  VERDICT: ${invariantsHeld ? "all invariants held" : "INVARIANT VIOLATED"}\n`);
}
