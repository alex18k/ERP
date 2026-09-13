# 物料主文件分类的逻辑

物料分类（`Material.category`）是整个系统的**供应策略开关**——决定一个物料"是买还是造、怎么流转"。

## 四个分类

| 值 | 名称 | 定位 | 供应来源 |
|---|---|---|---|
| `raw` | 原材料 | 最底层物料 | 外部采购 |
| `accessory` | 辅料 | 辅助材料 | 外部采购 |
| `semi` | 半成品 | 中间装配件 | 内部生产 |
| `finished` | 成品 | 最终产品 | 内部生产 |

## 分类决定的关键逻辑

1. **MRP 分流（核心）**
   - `raw` / `accessory` 的缺料 → **采购建议**（`server/src/services/mrp.service.ts:239`）
   - `semi` 的缺料 → **生产建议**（`server/src/services/mrp.service.ts:257`）

2. **可制造件 = BOM 的产出物料**：只有 `finished`/`semi` 能当 BOM 的"成品/半成品"（前端下拉 `category: 'finished,semi'`）。`raw`/`accessory` 不可建 BOM。

3. **生产订单**：只有 `finished`/`semi` 能创建生产订单（`server/src/services/production.service.ts:59`）。

4. **销售发货自动出库**：只有 `finished` 的发货会扣库存（`server/src/services/salesOrder.service.ts:228`）。

5. **展示**：报表/导出/缺料榜的类别标签都取这里（`server/src/services/export.service.ts:4`）。

## 分类与 BOM 的配合

- **category 决定"买/造"，BOM 决定"造什么由什么组成"**。
- 注意：MRP 判定一个物料是否为"子装配（isSemiProduct）"实际看的是**它有没有激活 BOM**（`mrp.service.ts` 的 `hasSubBom`），而不是 category。所以多层制造链 = `semi` 分类 **且** 有自己的激活 BOM。

## 一个需要注意的边界

如果某物料设为 `semi` 但**没有激活 BOM**：

- 不是 `raw`/`accessory` → 不进采购建议
- `isSemiProduct` 为 false → 不进生产建议

结果：它只出现在缺料榜，**没有任何可执行建议**（悬空）。要避免这种情况，要么给它建 BOM，要么把分类改成 `raw`/`accessory`。
