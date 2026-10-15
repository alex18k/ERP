-- CreateTable
CREATE TABLE "MaterialUnitConversion" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "conversionRate" DOUBLE PRECISION NOT NULL,
    "remark" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialUnitConversion_materialId_idx" ON "MaterialUnitConversion"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialUnitConversion_materialId_unit_key" ON "MaterialUnitConversion"("materialId", "unit");

-- AddForeignKey
ALTER TABLE "MaterialUnitConversion" ADD CONSTRAINT "MaterialUnitConversion_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
