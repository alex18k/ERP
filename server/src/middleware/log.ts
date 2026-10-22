import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export function operationLog(module: string, action: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (req.user && body && body.code === 200) {
        const prisma = req.app.get("prisma");
        if (prisma) {
          prisma.operationLog
            .create({
              data: {
                userId: req.user.id,
                module,
                action,
                detail: `${req.method} ${req.originalUrl}`,
                ipAddress: req.ip,
              },
            })
            .catch(() => {});
        }
      }
      return originalJson(body);
    };
    next();
  };
}