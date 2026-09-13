import { Router } from "express";
import { loginHandler, changePasswordHandler } from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth";

const router = Router();

router.post("/login", loginHandler);
router.post("/change-password", authMiddleware, changePasswordHandler);

export default router;