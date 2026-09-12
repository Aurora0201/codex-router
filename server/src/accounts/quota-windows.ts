import type { AccountRecord } from "../types.js";

/**
 * What the two quota windows mean, in one place: both warm-up and routing
 * have to answer the same questions about them, and a routing decision must
 * not have to import the warm-up service to ask.
 */

/** Anything shorter than a day is the window that stops the next request. */
export const SHORT_WINDOW_MAX_MINS = 1440;

function shortWindow(account: AccountRecord): { usedPercent: number | null; resetsAt: number | null } | null {
  const windows = [
    { mins: account.primaryWindowMinutes, usedPercent: account.primaryUsedPercent, resetsAt: account.primaryResetsAt },
    { mins: account.secondaryWindowMinutes, usedPercent: account.secondaryUsedPercent, resetsAt: account.secondaryResetsAt },
  ];
  return windows.find((w) => typeof w.mins === "number" && w.mins > 0 && w.mins < SHORT_WINDOW_MAX_MINS) ?? null;
}

/** Whatever the upstream last said the short window resets at, as it said it. */
export function shortWindowResetsAt(account: AccountRecord): number | null {
  return shortWindow(account)?.resetsAt ?? null;
}

export type ShortWindowState = "running" | "ready" | "expired" | "unknown" | "unavailable";

export function shortWindowState(account: AccountRecord, now = Date.now()): ShortWindowState {
  const window = shortWindow(account);
  if (!window) {
    return account.lastLimitsRefreshAt != null && longWindow(account) ? "unavailable" : "unknown";
  }
  if (window.usedPercent === null) return "unknown";
  if (window.usedPercent === 0) return "ready";
  if (window.resetsAt === null) return "unknown";
  return window.resetsAt > now ? "running" : "expired";
}

/**
 * True when the short window is actually counting, so warming it would buy
 * nothing.
 *
 * What makes a window count is that something has been spent in it, not that
 * its reset time is in the future. For a rested account the upstream reports
 * nothing spent and a reset time of *this reading plus five hours* — a
 * projection of when a window would end if one started now, which moves
 * forward with every read. Measured: two reads 218 seconds apart returned reset
 * times 218 seconds apart on an idle account, while an account with 46% spent
 * held its reset time exactly.
 *
 * Reading that projection as "still counting" meant a rested account looked
 * warm forever, and a machine that had been off all night — the case this
 * feature exists for — was the one case it never fired on.
 */
export function shortWindowRunning(account: AccountRecord, now = Date.now()): boolean {
  const window = shortWindow(account);
  if (!window || typeof window.usedPercent !== "number" || window.usedPercent <= 0) return false;
  return window.resetsAt !== null && window.resetsAt > now;
}

/**
 * When the short window really ends, or null when nothing has started one. The
 * projection an idle account reports is not a time worth showing or recording.
 */
export function shortWindowEndsAt(account: AccountRecord, now = Date.now()): number | null {
  return shortWindowRunning(account, now) ? shortWindowResetsAt(account) : null;
}

/**
 * The reading of the account's long (weekly) window, when there is one.
 */
function longWindow(account: AccountRecord): { usedPercent: number | null; resetsAt: number | null } | null {
  const windows = [
    { mins: account.primaryWindowMinutes, usedPercent: account.primaryUsedPercent, resetsAt: account.primaryResetsAt },
    { mins: account.secondaryWindowMinutes, usedPercent: account.secondaryUsedPercent, resetsAt: account.secondaryResetsAt },
  ];
  return windows.find((w) => typeof w.mins === "number" && w.mins >= SHORT_WINDOW_MAX_MINS) ?? null;
}

export function longWindowResetsAt(account: AccountRecord): number | null {
  return longWindow(account)?.resetsAt ?? null;
}

/**
 * The week is spent, so the account cannot serve anything until it turns over.
 * The five-hour window still lapses and reads as warmable in the meantime, but
 * starting it buys nothing — and the turn that would start it is refused by
 * the same limit, so it is certain to fail as well as pointless.
 *
 * A reset time already behind us means the reading is from before the week
 * turned over, not that it is still spent: the next status refresh brings the
 * fresh number, and on that same refresh the lapsed five-hour window gets
 * warmed, which is exactly the moment it becomes worth doing.
 */
export function longWindowExhausted(account: AccountRecord, now = Date.now()): boolean {
  const week = longWindow(account);
  if (!week || week.usedPercent === null || week.usedPercent < 100) return false;
  return week.resetsAt === null || week.resetsAt > now;
}
