/**
 * Store-card state model — shared between the home StoresTable, the
 * TopBar store switcher, and the server-side stores route.
 *
 * No JSX in this module by design. The 6-state machine and its Bulgarian
 * labels live here so the API can stay neutral about phrasing and the UI
 * can pick the right wording without exporting components.
 */

/** Raw level emitted by the server — strictly from today_roas / median_14d. */
export type BorderLevel = "red" | "amber" | "green";

/**
 * Display state after the frontend folds in todaySpend/todayRevenue and the
 * time-of-day guard. The server can't know that "amber + spend=0" should
 * really read "paused" instead of "underperforming" — that decision lives
 * here so the UI stays in charge of phrasing.
 */
export type DisplayState =
  | "green"
  | "amber"
  | "red"
  | "measuring"
  | "paused"
  | "early";

export interface StoreCardData {
  /** Store UUID — used for the card-wide tap target. */
  storeId: string;
  marketCode: string;
  name: string;
  /** 14 values, oldest first, one per day. Zero-filled for missing days. */
  sparkline14d: number[];
  /** Today's Meta spend (EUR). Drives paused vs measuring vs ratio decision. */
  todaySpend: number;
  /** Today's Meta-attributed revenue (EUR). */
  todayRevenue: number;
  /** Today's real Shopify revenue for this store (EUR). */
  shopifyTodayRevenue: number;
  /** Today's real Shopify order count for this store. */
  shopifyTodayOrders: number;
  roasLast24h: number;
  roasMedian14d: number;
  borderLevel: BorderLevel;
  lastSyncedAt: string | null;
  /** MAX(created_at) across bindings — lets FreshnessDot amber-grade new accounts. */
  accountCreatedAt: string | null;
}

export const STATE_LABEL: Record<DisplayState, string> = {
  green: "над нормата",
  amber: "леко под нормата",
  red: "под нормата",
  measuring: "още няма конверсии",
  paused: "кампании спрени",
  early: "още рано за оценка",
};

/**
 * Below this many Sofia hours elapsed, intraday signals are too noisy to
 * trust: matchedSoFar denominators are tiny, partial-day ROAS swings hard,
 * and any single late-attribution prior row can push vsTypical into the
 * thousands of percent. The top-strip route uses this to gate tempo math;
 * StoresTable uses it to demote red borders to "още рано за оценка".
 *
 * Unified at 3h across server + client — same threshold means an operator
 * never sees one section call something "под нормата" while another says
 * "още рано". Was previously 3h server-side, 14h client-side.
 */
export const EARLY_DAY_THRESHOLD_HOURS = 3;

export function deriveDisplayState(
  data: Pick<StoreCardData, "todaySpend" | "todayRevenue" | "borderLevel">,
  isEarly: boolean
): DisplayState {
  // Order matters: activity gates ratio. A store with todaySpend=0 is
  // "paused", not "under normata", regardless of what borderLevel says.
  if (data.todaySpend === 0) return "paused";
  if (data.todayRevenue === 0) return "measuring";
  if (data.borderLevel === "red" && isEarly) return "early";
  return data.borderLevel;
}
