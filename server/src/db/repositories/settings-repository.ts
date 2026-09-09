import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const ALLOWED_KEYS = new Set(["requestMetadataLogging", "theme", "logLevel", "autoSwitch", "warmup"]);

export const ALL_BELOW_BEHAVIOURS = ["highest", "stay", "pause"] as const;
export type AllBelowBehaviour = (typeof ALL_BELOW_BEHAVIOURS)[number];

/** Which quota window the switch decision reads. */
export const SWITCH_BASES = ["weekly", "short", "both"] as const;
export type SwitchBasis = (typeof SWITCH_BASES)[number];

export interface AutoSwitchSettings {
  enabled: boolean;
  /**
   * Which reading decides a switch. The 5-hour window is what actually stops
   * the next request; the week is what runs out for good. Watching both is
   * neither one's job, so it is a choice rather than a default.
   */
  switchOn: SwitchBasis;
  /** The long (weekly) window's threshold. */
  thresholdPercent: number;
  /**
   * The short window's own threshold, because a five-hour window at 25% is far
   * more urgent than a week at 25%.
   */
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
  switchOn: "weekly",
  thresholdPercent: 25,
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
  // An earlier shape had a boolean that meant "the week, and also the short
  // window". Read it as that, so a console saved before the choice existed
  // keeps behaving the way it was left.
  const legacyBoth = input.switchOn === undefined && input.watchShortWindow === true;
  const switchOn = legacyBoth ? "both" : (input.switchOn ?? AUTO_SWITCH_DEFAULTS.switchOn);
  if (!SWITCH_BASES.includes(switchOn as SwitchBasis)) throw new Error("invalid_setting");

  const onAllBelow = input.onAllBelow ?? AUTO_SWITCH_DEFAULTS.onAllBelow;
  if (!ALL_BELOW_BEHAVIOURS.includes(onAllBelow as AllBelowBehaviour)) throw new Error("invalid_setting");

  return {
    enabled: bool("enabled"),
    switchOn: switchOn as SwitchBasis,
    thresholdPercent: percent("thresholdPercent"),
    shortThresholdPercent: percent("shortThresholdPercent"),
    minDwellMs: dwell,
    switchBackToHigherPriority: bool("switchBackToHigherPriority"),
    onAllBelow: onAllBelow as AllBelowBehaviour,
    triggerOn429: bool("triggerOn429"),
    triggerOnAuthFailure: bool("triggerOnAuthFailure"),
  };
}

/**
 * A quota window only starts counting once something is spent on it, so an
 * account nobody has touched today has a five-hour window that has not begun.
 * Warm-up spends the smallest amount that starts one: one turn, one sentence.
 */
export interface WarmupSettings {
  /**
   * The gateway warming accounts up by itself, which means spending the user's
   * quota without being asked. Off unless it is turned on, deliberately.
   */
  auto: boolean;
  /** Empty means "whatever this account's default model is". */
  model: string | null;
  message: string;
  /**
   * How long an account is left alone after an attempt. An upstream that has
   * not published the new window yet would otherwise be warmed again and again.
   */
  cooldownMs: number;
  /** A five-hour window resets at most five times a day; more than this is a bug. */
  dailyLimit: number;
}

export const WARMUP_DEFAULTS: WarmupSettings = {
  auto: false,
  model: null,
  message: "回复 OK 即可，不要解释。",
  cooldownMs: 15 * 60_000,
  dailyLimit: 6,
};

/** Long enough to say anything useful, short enough that it stays a warm-up. */
const MAX_WARMUP_MESSAGE = 500;

function parseWarmup(value: unknown): WarmupSettings {
  if (typeof value !== "object" || value === null) throw new Error("invalid_setting");
  const input = value as Record<string, unknown>;

  const auto = input.auto ?? WARMUP_DEFAULTS.auto;
  if (typeof auto !== "boolean") throw new Error("invalid_setting");

  const model = input.model ?? WARMUP_DEFAULTS.model;
  if (model !== null && (typeof model !== "string" || model.length > 200)) throw new Error("invalid_setting");

  // A blank box means the default rather than an empty turn, which the
  // upstream would refuse anyway.
  const rawMessage = input.message ?? WARMUP_DEFAULTS.message;
  if (typeof rawMessage !== "string" || rawMessage.length > MAX_WARMUP_MESSAGE) throw new Error("invalid_setting");
  const message = rawMessage.trim() === "" ? WARMUP_DEFAULTS.message : rawMessage;

  const cooldownMs = input.cooldownMs ?? WARMUP_DEFAULTS.cooldownMs;
  if (typeof cooldownMs !== "number" || !Number.isSafeInteger(cooldownMs) || cooldownMs < 60_000 || cooldownMs > 6 * 3_600_000) {
    throw new Error("invalid_setting");
  }

  const dailyLimit = input.dailyLimit ?? WARMUP_DEFAULTS.dailyLimit;
  if (typeof dailyLimit !== "number" || !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 48) {
    throw new Error("invalid_setting");
  }

  return { auto, model: model === "" ? null : (model as string | null), message, cooldownMs, dailyLimit };
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
        const parsed = key === "autoSwitch" ? parseAutoSwitch(value) : key === "warmup" ? parseWarmup(value) : value;
        statement.run(key, JSON.stringify(parsed));
      }
    })();
    return this.get();
  }

  requestMetadataLoggingEnabled(): boolean {
    return this.get().requestMetadataLogging === true;
  }

  /**
   * Lay a partial change over what is stored. `update` replaces the whole row
   * and `parseAutoSwitch` fills anything missing from the defaults, so patching
   * one field through it would quietly reset every other one — turning the
   * feature off again the moment a threshold moved.
   */
  patchAutoSwitch(patch: Partial<AutoSwitchSettings>): AutoSwitchSettings {
    const next = { ...this.autoSwitch(), ...patch };
    return this.update({ autoSwitch: next }).autoSwitch as AutoSwitchSettings;
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

  patchWarmup(patch: Partial<WarmupSettings>): WarmupSettings {
    const next = { ...this.warmup(), ...patch };
    return this.update({ warmup: next }).warmup as WarmupSettings;
  }

  warmup(): WarmupSettings {
    const stored = this.get().warmup;
    if (stored === undefined) return { ...WARMUP_DEFAULTS };
    try {
      return parseWarmup(stored);
    } catch {
      return { ...WARMUP_DEFAULTS };
    }
  }
}
