import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// SQLite 调优（WAL：读写不互斥；busy_timeout：写锁等待，Prisma 默认已为 5000ms）
// WAL 模式会持久化到 dev.db 文件头，首次初始化后即使重启也保持；
// 此处每次启动兜底执行，保证重建/还原库后仍生效。
prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => {});

export default prisma;