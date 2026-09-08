import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const ALLOWED_KEYS = new Set(["requestMetadataLogging", "theme", "logLevel", "autoSwitch"]);

export const ALL_BELOW_BEHAVIOURS = ["highest", "stay", "pause"] as const;
export type AllBelowBehaviour = (typeof ALL_BELOW_BEHAVIOURS)[number];

export interface AutoSwitchSettings {
  enabled: boolean;
  /** Record what would have happened without doing it. */
  dryRun: boolean;
  /** Switch when the routed account's long (weekly) window drops below this. */
  thresholdPercent: number;
  /**
   * The short (5-hour) window is what actually stops the next request, so it
   * gets to trigger a switch too — but only when asked, and on its own
   * threshold, because a five-hour window at 25% is far more urgent than a
   * week at 25%.
   */
  watchShortWindow: boolean;
  shortThresholdPercent: number;
  /** Quota hovers around a threshold; without this it would flap. */
  minDwellMs: number;
  switchBackToHigherPriority: boolean;
  onAllBelow: AllBelowBehaviour;
  triggerOn429: boolean;
  triggerOnAuthFailure: boolean;
}

/**
 * Off, and cautious when turned on: dry run first, and the threshold starts at
 * the same 25% the console already calls "tight".
 */
export const AUTO_SWITCH_DEFAULTS: AutoSwitchSettings = {
  enabled: false,
  dryRun: true,
  thresholdPercent: 25,
  watchShortWindow: false,
  shortThresholdPercent: 15,
  minDwellMs: 5 * 60_000,
  switchBackToHigherPriority: false,
  onAllBelow: "highest",
  triggerOn429: true,
  triggerOnAuthFailure: true,
};

function parseAutoSwitch(value: unknown): AutoSwitchSettings {
  if (typeof value !== "object" || value === null) throw new Error("invalid_setting");
  const input = value as Record<string, unknown>;
  const bool = (key: keyof AutoSwitchSettings): boolean => {
    const raw = input[key];
    if (raw === undefined) return AUTO_SWITCH_DEFAULTS[key] as boolean;
    if (typeof raw !== "boolean") throw new Error("invalid_setting");
    return raw;
  };
  const percent = (key: "thresholdPercent" | "shortThresholdPercent"): number => {
    const raw = input[key] ?? AUTO_SWITCH_DEFAULTS[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) throw new Error("invalid_setting");
    return Math.round(raw);
  };
  const dwell = input.minDwellMs ?? AUTO_SWITCH_DEFAULTS.minDwellMs;
  if (typeof dwell !== "number" || !Number.isSafeInteger(dwell) || dwell < 0 || dwell > 6 * 3_600_000) {
    throw new Error("invalid_setting");
  }
  const onAllBelow = input.onAllBelow ?? AUTO_SWITCH_DEFAULTS.onAllBelow;
  if (!ALL_BELOW_BEHAVIOURS.includes(onAllBelow as AllBelowBehaviour)) throw new Error("invalid_setting");

  return {
    enabled: bool("enabled"),
    dryRun: bool("dryRun"),
    thresholdPercent: percent("thresholdPercent"),
    watchShortWindow: bool("watchShortWindow"),
    shortThresholdPercent: percent("shortThresholdPercent"),
    minDwellMs: dwell,
    switchBackToHigherPriority: bool("switchBackToHigherPriority"),
    onAllBelow: onAllBelow as AllBelowBehaviour,
    triggerOn429: bool("triggerOn429"),
    triggerOnAuthFailure: bool("triggerOnAuthFailure"),
  };
}

export class SettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(): Record<string, unknown> {
    const rows = this.db.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]));
  }

  update(values: Record<string, unknown>): Record<string, unknown> {
    const statement = this.db.prepare("INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json");
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (!ALLOWED_KEYS.has(key)) throw new Error("unsupported_setting");
        if (key === "requestMetadataLogging" && typeof value !== "boolean") throw new Error("invalid_setting");
        if (key === "theme" && !["system", "light", "dark"].includes(String(value))) throw new Error("invalid_setting");
        if (key === "logLevel" && !LOG_LEVELS.includes(value as (typeof LOG_LEVELS)[number])) throw new Error("invalid_setting");
        statement.run(key, JSON.stringify(key === "autoSwitch" ? parseAutoSwitch(value) : value));
      }
    })();
    return this.get();
  }

  requestMetadataLoggingEnabled(): boolean {
    return this.get().requestMetadataLogging === true;
  }

  autoSwitch(): AutoSwitchSettings {
    const stored = this.get().autoSwitch;
    if (stored === undefined) return { ...AUTO_SWITCH_DEFAULTS };
    try {
      return parseAutoSwitch(stored);
    } catch {
      // A row written by a newer build must not take the gateway down; the
      // safe reading of an unreadable setting is "off".
      return { ...AUTO_SWITCH_DEFAULTS };
    }
  }
}
