-- 货位管理：仓库下可维护多个货位
CREATE TABLE "WarehouseBin" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseBin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBin_warehouseId_code_key" ON "WarehouseBin"("warehouseId", "code");

-- CreateIndex
CREATE INDEX "WarehouseBin_warehouseId_idx" ON "WarehouseBin"("warehouseId");

-- AddForeignKey
ALTER TABLE "WarehouseBin" ADD CONSTRAINT "WarehouseBin_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
