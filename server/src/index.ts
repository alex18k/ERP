import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config";
import prisma from "./config/prisma";
import authRoutes from "./routes/auth.routes";
import materialRoutes from "./routes/material.routes";
import bomRoutes from "./routes/bom.routes";
import processRouteRoutes from "./routes/processRoute.routes";
import { supplierRoutes, warehouseRoutes, customerRoutes, workshopRoutes, workstationRoutes, stockTransactionTypeRoutes } from "./routes/base.routes";
import salesOrderRoutes from "./routes/salesOrder.routes";
import mrpRoutes from "./routes/mrp.routes";
import productionRoutes from "./routes/production.routes";
import purchaseRoutes from "./routes/purchase.routes";
import stockRoutes from "./routes/stock.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportRoutes from "./routes/report.routes";
import systemRoutes from "./routes/system.routes";
import { errorHandler, notFoundHandler } from "./middleware/error";

const app: Express = express();

// ===== 基础中间件 =====
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

// 注入 prisma 实例便于日志中间件使用
app.set("prisma", prisma);

// ===== 健康检查 =====
app.get("/api/health", (_req, res) => {
  res.json({ code: 200, message: "ok", timestamp: Date.now() });
});

// ===== 业务路由 =====
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/materials", materialRoutes);
app.use("/api/v1/boms", bomRoutes);
app.use("/api/v1/process-routes", processRouteRoutes);
app.use("/api/v1/suppliers", supplierRoutes);
app.use("/api/v1/warehouses", warehouseRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/workstations", workstationRoutes);
app.use("/api/v1/workshops", workshopRoutes);
app.use("/api/v1/stock-transaction-types", stockTransactionTypeRoutes);
app.use("/api/v1/sales-orders", salesOrderRoutes);
app.use("/api/v1/mrp", mrpRoutes);
app.use("/api/v1/production", productionRoutes);
app.use("/api/v1/purchase", purchaseRoutes);
app.use("/api/v1/stocks", stockRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/report", reportRoutes);
app.use("/api/v1/system", systemRoutes);

// ===== 404与错误处理 =====
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 ERP系统后端服务已启动: http://localhost:${config.port}`);
});