[README.md](https://github.com/user-attachments/files/33776989/README.md)
# ERP 生产管理系统

这是一个以 MRP（物料需求计划）为核心引擎的制造业 ERP 项目，覆盖从基础数据、销售订单、MRP 运算、采购建议与收货、生产排产与报工、库存事务到看板报表的主要业务流程。

项目采用前后端分离的 monorepo 结构：

- `server/`：Node.js + Express 5 + TypeScript + Prisma 5 + PostgreSQL
- `client/`：Vue 3 + Vite 8 + TypeScript + Element Plus
- `docs/`：需求、设计、MRP、UI 规范、导入样例 CSV/Excel 等文档

---

## 功能概览

### 1. 基础数据管理

- 物料主文件：编码、名称、规格、单位、分类、物料类别、供应商、库位、批号管理、安全库存等。
- BOM 管理：产品结构、父子件用量、生效状态、BOM 成本。
- 工艺路线：标准工序模板、工序顺序、工时、设备与工位信息。
- 主数据维护：供应商、客户、仓库、货位、部门、工位、物料类别、计量单位换算、库存事务类型。

### 2. 销售订单管理

- 销售订单录入、维护、明细行号、状态跟踪。
- 销售订单确认后进入 MRP 运算范围。
- 支持发运、发货/出库记录、送货单打印等库存相关业务入口。

### 3. MRP 物料需求计划

- 基于已确认/生产中的销售订单展开有效 BOM。
- 计算物料需求、库存占用、采购在途、在制数量、已发料数量和安全库存缺口。
- 生成缺料清单、采购建议和生产建议。
- 支持安全库存补货建议，用于独立触发采购补料。

详细逻辑可参考：`docs/MRP运算逻辑.md`。

### 4. 采购管理

- 采购建议、采购订单创建与维护。
- 采购单确认、收货、退货相关流程。
- 采购收货记录、收货报表与收货单打印。
- MRP 生成的采购订单默认是草稿，需要补充日期、采购员、供应商等信息后确认。
- 仅已确认采购单计入 MRP 在途，仅状态为空的采购明细可继续收货。

### 5. 生产与车间执行

- 生产订单创建、排产、批次维护。
- 排产时复制标准工艺路线到订单级工艺路线，便于后续差异维护。
- 以生产批次为执行单位进行领料、入库、报工。
- 支持生产领料、生产入库、批次报工、生产报表与数据导出。
- 生产订单与销售订单在满足条件后可自动完成。

详细取消逻辑可参考：`docs/生产订单取消逻辑.md`。

### 6. 库存与库存事务

- 库存按 `(物料, 仓库, 货位)` 维度管理。
- 支持批号库存：批号管理物料强制批号；非批号管理物料录入批号后也按批次库存管控。
- 支持库存查询、库存明细、批号库存、库存预警、安全库存比较。
- 支持库存事务记录、单据打印、移库、清除 0 库存。
- 支持库存入库、库存出库独立页面，可从库存事务记录页进入。
- 支持红单冲销：
  - 库存入库红单：按原入库单生成负数入库流水，扣回库存。
  - 库存出库红单：按原出库单生成负数出库流水，退回库存。
  - 产品入库维护与销售出库维护也支持按原单生成红单。

### 7. 看板与报表

- 管理驾驶舱/库存看板/订单追踪等可视化入口。
- 库存预警、缺料分析、生产报表、采购收货记录等业务报表。
- 单据打印页面支持销售发运、库存事务、采购收货、材料出库、产品入库等常见单据。

### 8. 权限与系统管理

- 用户、角色、权限码维护。
- 操作日志记录。
- 公司信息单例维护，打印页公司名统一读取系统配置。
- 接口权限按模块和操作划分，例如 `material:view`、`production:view`、`stock:edit`、`mrp:run`、`purchase:approve`。

---

## 技术栈

### 后端

- Node.js 22.12+
- Express 5
- TypeScript
- Prisma 5.22.0
- PostgreSQL
- JWT 登录鉴权
- 库存单据号、订单号使用事务与锁保证并发安全

### 前端

- Vue 3
- Vite 8
- TypeScript
- Element Plus
- Pinia
- Vue Router
- Axios
- ECharts
- dhtmlx-gantt

---

## 目录结构

```text
.
├── client/                 # Vue 3 前端应用
│   ├── src/api/            # API 封装
│   ├── src/views/          # 页面
│   ├── src/router/         # 路由
│   ├── src/layouts/        # 布局与菜单
│   └── src/stores/         # 状态管理
├── server/                 # Express + Prisma 后端应用
│   ├── src/config/         # 配置、Prisma client
│   ├── src/controllers/    # Controller 层
│   ├── src/services/       # Service 层
│   ├── src/routes/         # Express 路由
│   ├── src/middleware/     # 鉴权、日志、错误处理
│   ├── prisma/schema.prisma
│   ├── prisma/migrations/
│   ├── prisma/seed.ts
│   └── prisma/import-*.ts  # 主数据导入脚本
└── docs/                   # 设计文档、需求文档、样例数据
```

---

## 快速开始

### 环境要求

- Node.js：22.12 或更高
- PostgreSQL：需要本地或远程数据库
- npm：随 Node.js 安装

### 1. 配置后端环境变量

```bash
cd server
cp .env.example .env
```

推荐至少配置：

```env
DATABASE_URL="postgresql://user:password@localhost:5432/erp"
JWT_SECRET="请替换为足够随机的密钥"
PORT=3000
JWT_EXPIRES_IN="2h"
NODE_ENV="development"
```

注意：

- `JWT_SECRET` 在生产环境必须显式配置。
- 开发环境未配置 `JWT_SECRET` 时，后端会生成进程内随机密钥；重启服务后登录态会失效。

### 2. 安装后端依赖

```bash
cd server
npm install
```

### 3. 初始化数据库

```bash
cd server
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
```

说明：

- 当前数据库为 PostgreSQL。
- 迁移目录为 `server/prisma/migrations/`。
- 如果 `npx prisma migrate dev` 因缺少 shadow database 失败，建议直接手写迁移 SQL 并使用 `npx prisma migrate deploy`。

### 4. 启动后端

```bash
cd server
npm run dev
```

默认后端端口：

```text
http://localhost:3000
```

健康检查：

```bash
curl http://localhost:3000/api/health
```

后端启动方式说明：

- 开发时使用 `npm run dev`，内部会执行 `tsx watch src/index.ts`。
- 不要依赖 `npm start` 或 `node dist/index.js`，当前 TypeScript ESM 输出与目录导入存在兼容问题。

### 5. 安装前端依赖

```bash
cd client
npm install
```

### 6. 启动前端

```bash
cd client
npm run dev
```

默认前端端口：

```text
http://localhost:63130
```

Vite 开发服务器会把 `/api` 代理到：

```text
http://localhost:3000
```

### 7. 登录

使用种子数据中的账号登录。默认开发账号包括：

```text
admin / admin123
sales01 / admin123
user01 / admin123
purch01 / admin123
wh01 / admin123
plan01 / admin123
```

这些账号仅适合本地开发和测试。正式部署前请修改默认密码，并配置生产环境变量。

---

## 主数据导入

项目提供幂等导入脚本，可用于重建常用测试数据。脚本读取 `docs/` 下的 CSV 样例：

```bash
cd server

npx tsx prisma/import-materials.ts
npx tsx prisma/import-boms.ts
npx tsx prisma/import-suppliers.ts
npx tsx prisma/import-customers.ts
npx tsx prisma/import-transaction-types.ts
npx tsx prisma/import-locations.ts
```

导入顺序说明：

1. 物料必须先导入，BOM 依赖物料主数据。
2. 其他脚本通常可按需执行。
3. 脚本按编码或业务键做 upsert/dedupe，可重复运行。

---

## 构建与类型检查

### 后端

```bash
cd server
npm run build
```

### 前端

```bash
cd client
npm run build
```

前端构建脚本会执行：

```bash
vue-tsc -b && vite build
```

这比单独运行 Vite 更可靠，因为会带上 TypeScript 严格检查和未使用变量检查。

---

## API 约定

后端统一返回结构：

```json
{
  "code": 200,
  "message": "ok",
  "data": {},
  "timestamp": 1700000000000
}
```

业务成功通常使用 `code: 200`。前端 Axios 拦截器返回整个响应包装，页面通常读取：

```ts
res.data.items
res.data.total
res.data
```

主要路由：

```text
/api/v1/auth
/api/v1/materials
/api/v1/boms
/api/v1/process-routes
/api/v1/suppliers
/api/v1/warehouses
/api/v1/warehouse-bins
/api/v1/customers
/api/v1/workshops
/api/v1/workstations
/api/v1/stock-transaction-types
/api/v1/unit-conversions
/api/v1/material-categories
/api/v1/sales-orders
/api/v1/mrp
/api/v1/production
/api/v1/purchase
/api/v1/stocks
/api/v1/dashboard
/api/v1/report
/api/v1/system
```

---

## 库存与单据规则

### 库存维度

库存不是简单按物料累计，而是按：

```text
物料 + 仓库 + 货位
```

未启用货位管理的仓库，`binId` 为空。启用货位管理的仓库，出入库必须指定有效货位。

### 批号规则

- 批号管理物料入库可自动生成批号，出库必须选择有效批次并校验批次余量。
- 非批号管理物料如果录入批号，也会写入并扣减批次库存。
- 未录入批号时不记批次明细。

### 单位换算

业务单据可以同时记录录入单位和数量，但库存与 MRP 统一折算为基本单位。

需要维护：

```text
基础数据 → 计量单位维护
```

当录入单位没有维护换算关系时，后端会拒绝提交。

### 单据号

库存单据号由：

```text
事务类型前缀 + 日期 + 序号
```

生成。移库、生产领料、生产入库、采购收货、销售出库等路径使用各自的事务类型与单据规则。

红单通常表现为：

- 入库单中的负数流水：冲销原入库数量，库存减少。
- 出库单中的负数流水：冲销原出库数量，库存增加。

---

## 权限开发约定

新增页面通常需要同时维护三个位置：

1. 页面视图：`client/src/views/<module>/<name>/index.vue`
2. 路由：`client/src/router/index.ts`
3. 菜单：`client/src/layouts/MainLayout.vue`

所有后端路由都需要权限码：

```ts
requirePermission("module:action")
```

新增给非 ADMIN 角色使用的权限码时，需要同步：

- `server/prisma/seed.ts`
- 角色与权限分配
- 前端菜单/按钮显示条件

ADMIN 角色在权限校验中直接放行。

---

## 文档索引

- `erp.md`：初始需求说明。
- `docs/ERP系统设计说明.md`：系统总体设计。
- `docs/ERP项目开发计划.md`：开发计划。
- `docs/ERP生产管理系统-项目概要说明.md`：项目价值、模块和方案说明。
- `docs/MRP运算逻辑.md`：MRP 运算细节。
- `docs/生产订单取消逻辑.md`：生产订单取消规则。
- `docs/erp-ui-instruction.md`：UI 风格与页面规范。
- `AGENTS.md`：开发协作、运行方式与项目注意事项。

---

## 开发与排错提示

- 如果后端连接数据库失败，请检查 PostgreSQL 是否启动，以及 `DATABASE_URL` 是否正确。
- 修改 Prisma schema 后，必须执行 `npx prisma generate` 并重启后端服务。
- 库存写入路径应继续使用原子增减、单号锁和事务校验，避免高并发下库存或单据号冲突。
- 大列表必须分页，库存预警等数据量可能很大，不建议一次性渲染全量数据。
- 前端列表查询优先使用服务端分页接口：`{ total, page, pageSize, items }`。
- 打印页公司名不要硬编码，统一使用公司信息维护数据。

---

## License

当前仓库未声明开源许可证。默认视为项目私有代码，正式对外发布前请确认授权策略。
