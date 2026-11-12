# 生产订单列表「已计划」行配色 — 设计（短版）

日期：2026-11-12 ｜ 状态：待批准 ｜ 规模：小改动（单文件）

## 意图 / 为什么

生产订单列表目前没有任何行级配色，用户要"扫一眼就知道哪些单还没进入执行"。
参考对象是采购订单列表的草稿行高亮（`purchase/order/index.vue:202,324-336`）：
整行浅橙 + 首列橙色左标，视觉成熟、与全站风格一致。

## 目标

- 主列表中**状态 = 已计划（`status === 'planned'`）**的行整行浅橙高亮 + 首列 3px 橙色左标。
- 视觉与采购订单草稿行**像素级一致**（同色值、同 hover、同选中态处理）。

## 非目标 / 反目标

- 不看 `execStatus`：「已计划但已排产」照样染色、「已下达但未排产」不染色 —— 判据只认状态列。
- 不动批量排产弹窗、编辑弹窗、MRP 下达弹窗里的表格。
- 不动采购订单页、不抽公共样式类（避免为 10 行改动引入回归面）。
- 不加筛选、不改后端接口与权限。

## 约束

- 项目无自动化测试套件，验收 = `cd client && npm run build`（vue-tsc 严格 noUnusedLocals）+ 浏览器实测。
- 样式必须放本页 `<style scoped>` 并用 `:deep()`（Element 表格结构在子组件内）；
  表格开了 `stripe` + `highlight-current-row`，底色需 `!important` 才能压过斑马纹，
  选中行必须显式还回 Element 浅蓝，否则选中态被盖住。
- 配色语义不与本页既有颜色冲突：逾期红字 / 今日琥珀字 / 已入库绿字均为**文字色**，与整行底色正交。

## 方案取舍

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 本页 scoped 复刻采购样式** | `rowClassName` 返回 `row-planned` + 本页 4 条 `:deep` 规则 | **采用**：只动 1 个文件、零回归 |
| B. 抽到 `global.css` 通用类 | 采购页一并迁移共用 | 否：要改采购页，回归面 > 收益 |
| C. 只给单元格/tag 上底色 | 改动更小 | 否：与"参考采购列表"的要求不符，扫视效果差 |

## 实现要点（给实现者）

文件：`client/src/views/production/order/index.vue`（唯一改动文件）

1. script 增加（放 `canSchedule` 附近，约 L221）：
   ```ts
   // 已计划行整行高亮，便于与已下达/已关闭区分（口径同采购单草稿行）
   function rowClassName({ row }: any) {
     return row.status === 'planned' ? 'row-planned' : ''
   }
   ```
2. 主列表 `<el-table :data="flatRows" …>`（约 L545）加 `:row-class-name="rowClassName"`。
3. `<style scoped>`（L804 起）追加，色值照抄采购页：
   ```css
   :deep(.el-table__row.row-planned > td.el-table__cell) { background-color: #fff7e6 !important; }
   :deep(.el-table__row.row-planned:hover > td.el-table__cell) { background-color: #ffefd1 !important; }
   :deep(.el-table__row.row-planned > td.el-table__cell:first-child) { box-shadow: inset 3px 0 0 var(--el-color-warning); }
   :deep(.el-table__row.row-planned.current-row > td.el-table__cell) { background-color: var(--el-color-primary-light-9) !important; }
   ```

## 验收

1. `cd client && npm run build` 0 退出。
2. 浏览器打开 生产订单 列表：
   - 已计划行整行 `#fff7e6`、首列橙色竖标；
   - hover 变 `#ffefd1`；点选该行变 Element 浅蓝（不是橙色）；
   - 已下达 / 已关闭行保持原样；逾期红字、已入库绿字不受影响；
   - 筛选「状态=已计划」后仍正常着色；分页翻页后仍着色。
