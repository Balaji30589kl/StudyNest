/** Per-key token bucket plus a global daily cap. In-memory: one gateway instance. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();
  private day = '';
  private usedToday = 0;

  constructor(
    private readonly perMinute: number,
    private readonly dailyCap: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Returns null when allowed, or the reason the request is refused. */
  take(key: string): 'rate-limited' | 'daily-cap' | null {
    const now = this.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
    if (this.usedToday >= this.dailyCap) {
      return 'daily-cap';
    }

    const bucket = this.buckets.get(key) ?? { tokens: this.perMinute, updatedAt: now };
    const refill = ((now - bucket.updatedAt) / 60_000) * this.perMinute;
    bucket.tokens = Math.min(this.perMinute, bucket.tokens + refill);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return 'rate-limited';
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    this.usedToday += 1;
    if (this.buckets.size > 10_000) {
      this.buckets.delete(this.buckets.keys().next().value as string);
    }
    return null;
  }

  usage(): { day: string; usedToday: number; dailyCap: number } {
    return { day: this.day, usedToday: this.usedToday, dailyCap: this.dailyCap };
  }
}

/** Small LRU cache with a time-to-live. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
