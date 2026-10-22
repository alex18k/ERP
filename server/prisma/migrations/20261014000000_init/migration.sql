-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "departmentId" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataScope" TEXT NOT NULL DEFAULT 'personal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "safetyStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadTime" INTEGER NOT NULL DEFAULT 0,
    "manufactureLeadTime" INTEGER NOT NULL DEFAULT 0,
    "orderCycleDays" INTEGER NOT NULL DEFAULT 30,
    "materialType" TEXT,
    "minOrderQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location" TEXT,
    "supplierId" INTEGER,
    "batchManaged" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processRouteId" INTEGER,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bom" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomItem" (
    "id" SERIAL NOT NULL,
    "bomId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "lossRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BomItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessRoute" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessStep" (
    "id" SERIAL NOT NULL,
    "routeId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "workstationId" INTEGER,
    "standardTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "setupTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workstation" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workshopId" INTEGER,
    "type" TEXT,
    "capacity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workstation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workshop" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manager" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workshop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "joinedDate" TIMESTAMP(3),
    "type" TEXT,
    "buyer" TEXT,
    "settleMethod" TEXT,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "joinedDate" TIMESTAMP(3),
    "type" TEXT,
    "seller" TEXT,
    "settleMethod" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" SERIAL NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "customerCode" TEXT,
    "contactPerson" TEXT,
    "contactPhone" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderDate" TIMESTAMP(3),
    "channel" TEXT,
    "seller1" TEXT,
    "seller2" TEXT,
    "paymentMethod" TEXT,
    "deliveryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "remark" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "unitPrice" DOUBLE PRECISION DEFAULT 0,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION DEFAULT 0,
    "deliveredQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" SERIAL NOT NULL,
    "orderNo" TEXT NOT NULL,
    "salesOrderId" INTEGER,
    "salesOrderNo" TEXT,
    "materialId" INTEGER NOT NULL,
    "processRouteId" INTEGER,
    "quantity" DOUBLE PRECISION NOT NULL,
    "planStartDate" TIMESTAMP(3),
    "planEndDate" TIMESTAMP(3),
    "planner" TEXT,
    "releaseDate" TIMESTAMP(3),
    "actualStartDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "remark" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" SERIAL NOT NULL,
    "productionOrderId" INTEGER NOT NULL,
    "batchNo" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "planStartDate" TIMESTAMP(3),
    "planEndDate" TIMESTAMP(3),
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatchMaterial" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "requiredQty" DOUBLE PRECISION NOT NULL,
    "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionBatchMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderRoute" (
    "id" SERIAL NOT NULL,
    "productionOrderId" INTEGER NOT NULL,
    "sourceRouteId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrderRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderStep" (
    "id" SERIAL NOT NULL,
    "orderRouteId" INTEGER NOT NULL,
    "sourceStepId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "workstationId" INTEGER,
    "standardTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "setupTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionOrderStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkReport" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "processStepId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materialUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT,

    CONSTRAINT "WorkReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "orderNo" TEXT NOT NULL,
    "supplierId" INTEGER,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderDate" TIMESTAMP(3),
    "expectedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "settleMethod" TEXT,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buyer" TEXT,
    "remark" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "unitPrice" DOUBLE PRECISION DEFAULT 0,
    "amount" DOUBLE PRECISION DEFAULT 0,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location" TEXT,
    "expectedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT '',
    "remark" TEXT,
    "suggestionId" INTEGER,
    "sourceOrderNo" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastInDate" TIMESTAMP(3),
    "lastOutDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRecord" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "transactionTypeId" INTEGER,
    "documentNo" TEXT,
    "lineNo" INTEGER,
    "location" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "quantity" DOUBLE PRECISION NOT NULL,
    "relatedType" TEXT,
    "relatedId" INTEGER,
    "operatorId" INTEGER,
    "remark" TEXT,
    "batchNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialBatch" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "batchNo" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransactionType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransactionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrpRecord" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "orderId" INTEGER,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MrpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrpRun" (
    "id" SERIAL NOT NULL,
    "runNo" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "materialCount" INTEGER NOT NULL DEFAULT 0,
    "shortageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "result" TEXT,

    CONSTRAINT "MrpRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrpShortage" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "grossDemand" DOUBLE PRECISION NOT NULL,
    "stockQuantity" DOUBLE PRECISION NOT NULL,
    "inTransit" DOUBLE PRECISION NOT NULL,
    "safetyStock" DOUBLE PRECISION NOT NULL,
    "netDemand" DOUBLE PRECISION NOT NULL,
    "affectedOrders" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "purchaseSuggestionId" INTEGER,

    CONSTRAINT "MrpShortage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseSuggestion" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "suggestedQty" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION DEFAULT 0,
    "supplierId" INTEGER,
    "leadTime" INTEGER,
    "needDate" TIMESTAMP(3),
    "orderDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "convertedOrderId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "OperationLog_userId_createdAt_idx" ON "OperationLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Material_category_status_idx" ON "Material"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bom_code_key" ON "Bom"("code");

-- CreateIndex
CREATE INDEX "Bom_productId_status_idx" ON "Bom"("productId", "status");

-- CreateIndex
CREATE INDEX "BomItem_bomId_idx" ON "BomItem"("bomId");

-- CreateIndex
CREATE INDEX "BomItem_materialId_idx" ON "BomItem"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessRoute_code_key" ON "ProcessRoute"("code");

-- CreateIndex
CREATE INDEX "ProcessStep_routeId_idx" ON "ProcessStep"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Workstation_code_key" ON "Workstation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Workshop_code_key" ON "Workshop"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNo_key" ON "SalesOrder"("orderNo");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_deliveryDate_idx" ON "SalesOrder"("deliveryDate");

-- CreateIndex
CREATE INDEX "SalesOrderItem_orderId_idx" ON "SalesOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_materialId_idx" ON "SalesOrderItem"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_orderNo_key" ON "ProductionOrder"("orderNo");

-- CreateIndex
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");

-- CreateIndex
CREATE INDEX "ProductionOrder_planEndDate_idx" ON "ProductionOrder"("planEndDate");

-- CreateIndex
CREATE INDEX "ProductionBatch_productionOrderId_idx" ON "ProductionBatch"("productionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_productionOrderId_batchNo_key" ON "ProductionBatch"("productionOrderId", "batchNo");

-- CreateIndex
CREATE INDEX "ProductionBatchMaterial_batchId_idx" ON "ProductionBatchMaterial"("batchId");

-- CreateIndex
CREATE INDEX "ProductionBatchMaterial_materialId_idx" ON "ProductionBatchMaterial"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatchMaterial_batchId_materialId_key" ON "ProductionBatchMaterial"("batchId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderRoute_productionOrderId_key" ON "ProductionOrderRoute"("productionOrderId");

-- CreateIndex
CREATE INDEX "ProductionOrderStep_orderRouteId_idx" ON "ProductionOrderStep"("orderRouteId");

-- CreateIndex
CREATE INDEX "WorkReport_batchId_idx" ON "WorkReport"("batchId");

-- CreateIndex
CREATE INDEX "WorkReport_processStepId_idx" ON "WorkReport"("processStepId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "PurchaseOrder"("orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_orderId_idx" ON "PurchaseOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_materialId_idx" ON "PurchaseOrderItem"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_materialId_warehouseId_key" ON "Stock"("materialId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockRecord_materialId_idx" ON "StockRecord"("materialId");

-- CreateIndex
CREATE INDEX "StockRecord_warehouseId_idx" ON "StockRecord"("warehouseId");

-- CreateIndex
CREATE INDEX "StockRecord_type_createdAt_idx" ON "StockRecord"("type", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialBatch_materialId_idx" ON "MaterialBatch"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialBatch_materialId_warehouseId_batchNo_key" ON "MaterialBatch"("materialId", "warehouseId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransactionType_code_key" ON "StockTransactionType"("code");

-- CreateIndex
CREATE INDEX "MrpRecord_runId_idx" ON "MrpRecord"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "MrpRun_runNo_key" ON "MrpRun"("runNo");

-- CreateIndex
CREATE INDEX "MrpShortage_runId_idx" ON "MrpShortage"("runId");

-- CreateIndex
CREATE INDEX "MrpShortage_materialId_idx" ON "MrpShortage"("materialId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_processRouteId_fkey" FOREIGN KEY ("processRouteId") REFERENCES "ProcessRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ProcessRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstation" ADD CONSTRAINT "Workstation_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatchMaterial" ADD CONSTRAINT "ProductionBatchMaterial_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatchMaterial" ADD CONSTRAINT "ProductionBatchMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderRoute" ADD CONSTRAINT "ProductionOrderRoute_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderStep" ADD CONSTRAINT "ProductionOrderStep_orderRouteId_fkey" FOREIGN KEY ("orderRouteId") REFERENCES "ProductionOrderRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderStep" ADD CONSTRAINT "ProductionOrderStep_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "StockTransactionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialBatch" ADD CONSTRAINT "MaterialBatch_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialBatch" ADD CONSTRAINT "MaterialBatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpShortage" ADD CONSTRAINT "MrpShortage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpShortage" ADD CONSTRAINT "MrpShortage_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseSuggestion" ADD CONSTRAINT "PurchaseSuggestion_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

