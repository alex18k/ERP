import { Router } from "express";
import { loginHandler, changePasswordHandler } from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// 登录限流：按 IP + 用户名维度，15 分钟内最多 10 次，防暴力破解
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "登录尝试过于频繁，请稍后再试",
  key: (req) => `${req.ip || "unknown"}|${String(req.body?.username || "").toLowerCase()}`,
});

router.post("/login", loginRateLimit, loginHandler);
router.post("/change-password", authMiddleware, changePasswordHandler);

export default router;