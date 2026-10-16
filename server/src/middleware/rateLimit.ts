import { Request, Response, NextFunction } from "express";
import { fail } from "../utils/response";

interface HitEntry {
  count: number;
  resetAt: number;
}

// 进程内内存限流：适用于单实例部署；多实例需改为 Redis 等共享存储
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
  key?: (req: Request) => string;
}) {
  const hits = new Map<string, HitEntry>();

  const prune = (now: number) => {
    if (hits.size < 10000) return;
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key ? opts.key(req) : req.ip || "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      prune(now);
      return next();
    }

    entry.count += 1;
    if (entry.count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return fail(res, 429, opts.message || `操作过于频繁，请 ${retryAfter} 秒后再试`, 429);
    }
    return next();
  };
}
