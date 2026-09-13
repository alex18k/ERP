# MRP 运算逻辑说明

记录日期：2026-09-13
代码位置：`server/src/services/mrp.service.ts`

## 1. 取数（输入）

- **销售订单**：状态为 `confirmed` / `in_production`（接口可传 `orderIds` 指定范围，不传则全部）
- **订单明细**：状态为 `pending` / `in_production`
- **运算参数**（`MrpParams`）：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `deductStock` | `true` | 是否扣除现有库存 |
| `deductInTransit` | `true` | 是否扣除在途采购量 |
| `considerSafetyStock` | `true` | 是否考虑安全库存 |

> 前端 MRP 运算页提交 `{}`，即三项默认都参与。

## 2. BOM 递归展开（`expandDemand`）

- 从销售订单产品开始，逐层展开该产品的 **active BOM**（`Bom.status = "active"`）
- 每项用量 = 父需求 × BOM 用量 × (1 + 损耗率 `lossRate`)
- 若子件**自身还有 BOM** → 记为**半成品**（`isSemiProduct = true`）并继续向下展开
- 若无子 BOM → 作为叶子需求
- 订单产品自身也计入需求（用于跟踪）
- 保护：最大深度 `MAX_BOM_DEPTH = 20`；检测到循环引用时报错
- 汇总为 `demandMap`：`物料 → 订单 → 数量`

## 3. 可用量

- **现存量**：`Stock` 在**启用仓库**（`Warehouse.status = 1`）中按物料合计
- **在途**：`PurchaseOrderItem` 状态为 `pending` / `partial_received` 且所属采购单未取消，数量 = `数量 − 已收`

## 4. 净需求（按订货周期分桶）

- 按物料的 `orderCycleDays` 对需求分桶：与桶内**最早需求日期间隔在周期内**的合并，超出则新开一桶
- 需求日期取销售订单的交货期 `deliveryDate`
- 库存 / 在途按需求日期**由早到晚依次冲抵**
- **安全库存只计入最早一个桶**，且**先并入需求再冲抵**：

```
净需求 = max(0, 毛需求 + 安全库存 − 库存 − 在途)
```

> 说明：安全库存先并入需求、再用库存/在途冲抵，避免剩余库存无法覆盖安全库存导致重复建议。

## 5. 输出与落库

- **缺料清单**：每个需求桶一条（毛需求、可用库存、在途、安全库存、净需求、影响订单）
- **采购建议**：`shortages` 中 `category = purchase` 的物料
  - 建议量 = 净需求（保留 2 位小数）
  - 供应商、提前期取物料主文件；需求日期 = 桶需求日期
- **生产建议**：`isSemiProduct = true 且 category = manufacture` 的物料，按订单汇总数量
- 落库：
  - 创建 `MrpRun`（含 `result` JSON：shortages / purchaseSuggestions / productionOrders）
  - 写入 `MrpShortage` 缺料明细
  - **先把所有 `pending` 采购建议置为 `cancelled`**，再创建新的 `PurchaseSuggestion`（`status = pending`）

## 6. 后续流转

- **采购建议 → 采购单**：采购建议页勾选 → `POST /mrp/suggestion/generate-purchase`
  - 按「供应商 + 需求日期桶」分组生成采购单（`status = draft`）
  - 关联建议置为 `converted`
- **生产建议 → 生产订单**：从 MRP 建议下达生产订单 → 排产（按工艺路线生成加工单）

## 7. 安全库存检查（独立于 MRP）

- 接口：`POST /mrp/safety-stock-suggest`（权限 `purchase:create`）
- 逻辑：扫描**采购件**（`category = purchase`、`status = 1`、`safetyStock > 0`），当
  `现存量 + 在途 < 安全库存` 时生成采购建议，数量 = 缺口
- 需求日期 = 今天 + 采购提前期
- **去重**：该物料已有 `pending` 采购建议则跳过
- 来源标记：`listShortages` 返回的建议带 `source`（`mrp` = MRP 需求，`safety` = 安全库存）

## 8. 接口一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/mrp/calculate` | `mrp:run` | 执行 MRP 运算 |
| GET | `/mrp/history` | `mrp:view` | 运算历史 |
| GET | `/mrp/history/:id` | `mrp:view` | 某次运算结果 |
| GET | `/mrp/shortage` | `mrp:view` | 最新缺料榜 + 采购建议 |
| POST | `/mrp/suggestion/generate-purchase` | `purchase:create` | 采购建议转采购单 |
| POST | `/mrp/safety-stock-suggest` | `purchase:create` | 安全库存检查生成采购建议 |

## 9. 重要注意事项

1. **只对有毛需求的物料计算**：无销售需求但低于安全库存的物料不会出现在 MRP 结果中，需用「安全库存检查」
2. **安全库存是兜底**，不是独立的自动补货逻辑
3. **每次 MRP 运行会取消所有 `pending` 采购建议**（包括安全库存来源的），推荐顺序：先跑 MRP → 再做安全库存检查 → 转采购单
4. **订货周期分桶**会影响建议的拆分与需求日期
5. 现存量仅统计**启用仓库**；停用仓库库存不参与
