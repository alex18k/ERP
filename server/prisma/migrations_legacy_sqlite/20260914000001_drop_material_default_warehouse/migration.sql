-- 库位(location)已全量维护且与仓库编码一一对应（warehouse.code === location），
-- defaultWarehouseId 仅少量数据且发料预填已失效，属冗余列，直接删除。
ALTER TABLE "Material" DROP COLUMN "defaultWarehouseId";