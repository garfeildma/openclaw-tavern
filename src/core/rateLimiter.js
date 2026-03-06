import { RPError } from "../errors.js";
import { RP_ERROR_CODES } from "../types.js";

export class InMemoryRateLimiter {
  constructor({ windowMs = 5000 } = {}) {
    this.windowMs = windowMs;
    this.lastAt = new Map();
  }

  consume(key) {
    const now = Date.now();
    const last = this.lastAt.get(key) || 0;
    if (now - last < this.windowMs) {
      throw new RPError(RP_ERROR_CODES.RATE_LIMITED, "Too many requests, please retry later", {
        retry_after_ms: this.windowMs - (now - last),
      });
    }
    this.lastAt.set(key, now);
  }
}
