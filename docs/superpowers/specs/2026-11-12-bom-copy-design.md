# BOM 复制功能设计

日期：2026-11-12 ｜ 分支：`BOM` ｜ 状态：待批准

## 意图

BOM 页面（`/base/bom`）目前只能从零手工录入明细。相似产品往往共用同一套配料表，
逐行重录既慢又容易出错。本功能提供「复制BOM」：选中一张已有BOM，把它连同**父零件物料**
一起克隆成一套新的，用户只需改明细再保存。

因为后端硬性限制**同一物料只允许一张BOM**（`createBom` 校验 + `bomProductOptions` 只返回未挂BOM的物料），
复制不可能是"同一产品再来一张"，只能是"新父零件 + 源明细结构"。用户已确认走这条路。

## 目标

- BOM 列表点击选中一行，工具栏「新增BOM」右侧出现「复制BOM」。
- 点击后打开**预填的编辑弹窗**：明细整份来自源BOM，父零件处变成可编辑的「新父零件编码」，
  预填 `源编码-copy`，下方只读显示源物料的名称/规格。
- 保存后一次性完成：新建父零件物料 + 新建BOM（含明细），刷新列表。

## 非目标

- 不复制源物料的库存、批次、库存流水、销售/采购/生产单据。
- 不做批量复制、不做"复制到指定已存在物料"。
- 不改动现有「新增BOM」「编辑BOM」的行为与表单结构（复制只是弹窗的第三种模式）。
- 不新增数据库字段，**无 schema 变更 → 无迁移、无需 `prisma generate`**（但改完后端必须重启服务）。

## 约束（硬性）

- `Material.code` 全局唯一；`Bom.code` 全局唯一。
- 同一 `productId` 只允许一张BOM。
- `createMaterial` 强制 `materialType`（物料类别）与 `库位` 非空——但导入的老数据里这两项可能为 `null`。
  **克隆必须绕过这条新建校验**，照抄源物料的空值，否则这类物料永远复制不了。
- 权限：`bom:edit`（种子数据里只有 ADMIN 有）。复制隐含建物料动作，视为BOM维护，
  **不额外要求 `material:create`** —— 这是本设计的决定。
- 无自动化测试套件，验证靠 `curl` + 构建。

## 方案取舍

| | A（已选）后端原子复制 | B 纯前端两步 |
|---|---|---|
| 做法 | `POST /boms/:id/copy`，事务内克隆物料 + 建BOM | `materialApi.create` → `bomApi.create` |
| 原子性 | 是，不会留下"物料建了BOM没建"的半截数据 | 否，第二步失败留孤儿物料 |
| 权限 | 只需 `bom:edit` | 需同时 `material:create` + `bom:edit` |
| 字段克隆清单 | 贴着 `schema.prisma` 放服务端 | 写在前端，schema 改动易漏 |
| 代价 | 新增 route/controller/service 约60行 | 改动最小 |

选 A：复制是数据克隆，正确性比代码量重要；克隆清单与模型定义放在一起才不会随时间腐烂。

## 已定细节

### 1. 前端交互（`client/src/views/base/bom/index.vue`）

- 表格加 `ref` + `highlight-current-row` + `@current-change` 记录 `currentRow`
  （与 `views/base/material/index.vue` 的 `handleCopyCurrent` 同款模式）。
- 工具栏「新增BOM」按钮右侧加「复制BOM」（`CopyDocument` 图标）。未选行 →
  `ElMessage.warning('请先点击选择一行')`。
- 弹窗引入第三种模式 `mode: 'create' | 'edit' | 'copy'`（现有 `isEdit` 二元标志改造而来），
  标题 `复制BOM`。
- copy 模式的差异：
  - 「父零件」`el-select` 整块替换为「新父零件编码」`el-input`（绑定 `form.newCode`），
    下方只读一行：`源物料：{code} {name} - {specification}`，
    提示文案「保存后将新建父零件物料，并为其创建BOM」。
  - 明细、版本号预填源BOM，可自由增删改。
  - 校验：copy 模式跳过 `rules.productId`（字段未渲染），改为单独校验 `newCode` 非空。
  - `matList` 由 `bomApi.get()` 返回的 `items[].material` 构造（复用现有编辑分支的写法），
    保证明细行"名称-型号规格"列能正常显示。
- **编码预探测**：打开弹窗时调 `materialApi.list({ keyword: 源code, pageSize: 100 })`，
  过滤 `code` 以 `源code-copy` 开头的既有物料，取第一个未被占用的后缀
  （`-copy` → `-copy2` → `-copy3` …）填入 `form.newCode`。
  该请求包在 `try/catch` 里，失败（例如自定义角色没有 `material:view`）时静默保留默认 `-copy`，
  由后端 400 兜底。
- 保存成功后 `Promise.all([loadData(), loadActiveBoms()])`，提示带实际编码：
  `已复制到物料 {code}`。
- `client/src/api/index.ts` 的 `bomApi` 加 `copy: (id, data) => request.post(\`/boms/${id}/copy\`, data)`。

### 2. 后端

- `server/src/routes/bom.routes.ts`：`router.post("/:id/copy", requirePermission("bom:edit"), bomController.copyHandler)`
  （与已有 `POST /batch-delete` 无路由冲突；不同 method，不与 `GET /:id` 抢）。
- `server/src/controllers/bom.controller.ts`：`copyHandler` → `bomService.copyBom(Number(req.params.id), req.body)`，
  catch → `fail(res, 400, error.message)`（与 `createHandler` 同款）。
- `server/src/services/bom.service.ts` 新增 `copyBom(id, data)`，**单个 `prisma.$transaction`**：
  1. 读源BOM（`getBom` 口径：含 `product` 与 `items.material`），不存在 → `throw new Error("BOM不存在")`。
  2. 新编码 = `data.code?.trim()` || `${源product.code}-copy`；
     `prisma.material.findUnique({ code })` 命中 → `throw new Error("物料编码已存在")`（严格，不静默加后缀，
     与全系统重复编码口径一致；预探测已把常见情况挡在前面）。
  3. 克隆物料：**除 `id`/`code`/`createdAt`/`updatedAt` 外全部照抄源物料**
     （`name`、`specification`、`description`、`packageType`、`brand`、`category`、`unit`、
     `safetyStock`/`minStock`/`maxStock`、`leadTime`/`manufactureLeadTime`、`orderCycleDays`、
     `materialType`、`minOrderQty`、`cost`、`price`、`location`、`supplierId`、`batchManaged`、
     `remark`、`desc1`~`desc4`、`processRouteId`、`bomcode`），`status: 1`。
     直接 `tx.material.create`，**不走 `createMaterial`**，允许 `materialType`/`location` 为空。
     `cost`/`price` 照抄（新物料无库存，首次收货会按移动加权平均重算）。
  4. 创建BOM：`code` = 新物料 code，`name` = 新物料 code（与 `createBom` 的
     `defaultBomCode`/`name` 口径一致），`version` = `data.version` || 源BOM version || `'1.0'`，
     `status: 'active'`（与现有"创建成功，已自动启用"一致；新物料只有这一张BOM，无冲突）。
  5. 创建明细：`data.items` 存在则用之，否则复制源 `items`；两者都过 `assertBomItems`
     （数量为正、同一子件不重复、单位可折算），`sortOrder` 按序重排。
  6. 返回新建的BOM（含 `items.material`），供前端提示与刷新。

### 3. 错误与边界

- 源BOM不存在 / 新编码重复 / 明细非法 → 400，由 axios 拦截器统一 `ElMessage.error` 弹出。
- 源BOM明细为空：`assertBomItems` 报「BOM至少需要一个子件」。
- 并发两处同时复制同一张BOM：后到的那方撞 `Material.code` 唯一约束报 400，无脏数据
  （事务 + 唯一索引兜底，不加应用层锁）。

## 交给实现者

改动文件（5个，无新文件、无迁移）：

1. `server/src/services/bom.service.ts` — `copyBom`
2. `server/src/controllers/bom.controller.ts` — `copyHandler`
3. `server/src/routes/bom.routes.ts` — 路由
4. `client/src/api/index.ts` — `bomApi.copy`
5. `client/src/views/base/bom/index.vue` — 行选中、按钮、弹窗 copy 模式、保存分支

验证（无测试套件，必须逐条跑）：

```bash
cd server && npm run build        # tsc
cd client && npm run build        # vue-tsc -b && vite build（strict noUnusedLocals）
# 重启服务（改了后端必须重启，tsx 不热载）
cd server && (setsid npx tsx src/index.ts > /tmp/log 2>&1 < /dev/null &)
# 接口验证
curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
curl -s -X POST localhost:3000/api/v1/boms/<源id>/copy -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' -d '{"version":"1.0"}'
# 期望：新物料（code=源code-copy）+ 新BOM + 明细条数一致
# 再复制一次同一张：期望 400 物料编码已存在（预探测已填 -copy2，故应为 -copy2 成功）
```

手工验收：`/base/bom` 点选一行 → 复制BOM → 弹窗标题「复制BOM」、明细与源一致、
编码框为 `源编码-copy` → 改几行数量保存 → 列表出现新行、父零件列显示新编码、状态"启用"。
