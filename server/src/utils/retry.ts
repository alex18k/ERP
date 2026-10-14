import { Prisma } from "@prisma/client";

// 唯一约束冲突（如单号并发撞号）判定
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// 单号生成依赖“查最大号+1”，并发下会撞 @unique；冲突时退避重试并重新生成
export async function retryOnDuplicate<T>(fn: () => Promise<T>, times = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      lastErr = e;
      if (i < times - 1) await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
    }
  }
  throw lastErr;
}

// 单号串行锁（PostgreSQL advisory 事务锁）：同一前缀的“生成单号 → 插入”串行化，
// 持有到事务提交为止。键为私有常量，任意取值即可。
export const ORDER_NO_LOCK = { SO: 74000101, MO: 74000102, PO: 74000103 } as const;

export async function lockOrderNo(tx: any, key: number): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key})`);
}
