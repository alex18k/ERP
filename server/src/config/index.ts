import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "erp-system-secret-key",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "2h",
  nodeEnv: process.env.NODE_ENV || "development",
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  maxFileSize: Number(process.env.MAX_FILE_SIZE || 10485760),
};