import dotenv from "dotenv";
import { randomBytes } from "node:crypto";

dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";

// JWT 密钥不得有可预测的默认值：
// - 生产环境必须显式配置 JWT_SECRET，否则启动即失败
// - 开发/测试环境未配置时生成进程内随机密钥（重启后 token 失效），并打印告警
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (nodeEnv === "production") {
    throw new Error("[config] 生产环境必须配置 JWT_SECRET 环境变量（禁止使用默认密钥）");
  }
  jwtSecret = randomBytes(32).toString("hex");
  console.warn("[config] 未配置 JWT_SECRET，已生成进程内随机密钥；重启后登录态将失效，请在 .env 中配置 JWT_SECRET");
}

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "2h",
  nodeEnv,
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  maxFileSize: Number(process.env.MAX_FILE_SIZE || 10485760),
};
