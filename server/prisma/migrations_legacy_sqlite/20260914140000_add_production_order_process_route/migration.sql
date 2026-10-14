-- Migration: ProductionOrder 增加工艺路线字段（默认取产品路线，可手工指定）
ALTER TABLE "ProductionOrder" ADD COLUMN "processRouteId" INTEGER;
