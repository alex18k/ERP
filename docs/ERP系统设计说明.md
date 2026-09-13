# ERP生产管理系统 - 系统设计说明

---

## 一、引言

### 1.1 文档目的

本文档作为ERP生产管理系统的系统设计纲领，为AI开发团队提供完整的架构设计、数据模型、页面规范和技术实现指导。所有开发工作应以此文档为基准。

### 1.2 系统概述

本系统是以MRP（物料需求计划）为核心的生产管理系统，实现从销售订单到生产发货的全流程管理。系统包含以下核心模块：

- 基础数据管理（物料、BOM、工艺路线）
- 订单管理
- MRP物料需求计算引擎
- 缺料检查与预警
- 生产过程管理（加工单、车间执行）
- 采购管理
- 可视化看板
- 用户与权限管理

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| 模块化 | 各功能模块独立设计，松耦合高内聚 |
| 可扩展 | 预留扩展接口，支持后续功能迭代 |
| 安全性 | 数据隔离、权限控制、操作审计 |
| 性能优先 | MRP计算引擎优化，支持大数据量运算 |
| 用户体验 | 界面简洁直观，操作流程顺畅 |

---

## 二、系统架构设计

### 2.1 整体架构

采用前后端分离的B/S架构：

```
┌─────────────────────────────────────────────────────────┐
│                     客户端层                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  PC浏览器    │  │  平板端      │  │  手机端      │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    前端应用层                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Vue 3 + TypeScript                  │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │   │
│  │  │ 路由管理 │ │ 状态管理 │ │ UI组件库 │           │   │
│  │  └─────────┘ └─────────┘ └─────────┘           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    API网关层                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Nginx / API Gateway                    │   │
│  │  • 请求路由  • 负载均衡  • 静态资源  • SSL        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   后端服务层                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Node.js + Express/Koa                 │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │   │
│  │  │ 认证中间件│ │ 权限中间件│ │ 日志中间件│           │   │
│  │  └─────────┘ └─────────┘ └─────────┘           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   业务服务层                       │   │
│  │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐       │   │
│  │  │基础数据│ │ 订单  │ │ MRP   │ │ 采购  │       │   │
│  │  │ 服务  │ │ 服务  │ │ 引擎  │ │ 服务  │       │   │
│  │  └───────┘ └───────┘ └───────┘ └───────┘       │   │
│  │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐       │   │
│  │  │生产管理│ │库存管理│ │看板服务│ │用户权限│       │   │
│  │  │ 服务  │ │ 服务  │ │       │ │ 服务  │       │   │
│  │  └───────┘ └───────┘ └───────┘ └───────┘       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    数据层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   MySQL      │  │   Redis     │  │   MinIO     │    │
│  │  主数据库    │  │   缓存      │  │  文件存储   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 技术栈选型

| 层级 | 技术选型 | 版本 | 说明 |
|------|----------|------|------|
| 前端框架 | Vue 3 | 3.4+ | 组合式API，TypeScript支持 |
| 状态管理 | Pinia | 2.1+ | Vue 3官方推荐状态管理 |
| UI组件库 | Element Plus | 2.4+ | 企业级UI组件 |
| 图表库 | ECharts | 5.4+ | 可视化图表 |
| 甘特图 | dhtmlxGantt | 7.1+ | 生产排产甘特图 |
| 后端运行时 | Node.js | 20 LTS | 长期支持版本 |
| Web框架 | Express | 4.18+ | 轻量灵活 |
| ORM | Prisma | 5.4+ | 类型安全的数据库访问 |
| 数据库 | MySQL | 8.0+ | 主数据存储 |
| 缓存 | Redis | 7.0+ | 会话、热点数据缓存 |
| 文件存储 | MinIO | 最新 | S3兼容对象存储 |
| API文档 | Swagger/OpenAPI | 3.0 | 接口文档自动生成 |

### 2.3 目录结构

```
erp-system/
├── client/                          # 前端项目
│   ├── src/
│   │   ├── api/                     # API请求封装
│   │   ├── assets/                  # 静态资源
│   │   ├── components/              # 公共组件
│   │   │   ├── common/              # 通用组件
│   │   │   └── business/            # 业务组件
│   │   ├── composables/             # 组合式函数
│   │   ├── layouts/                 # 布局组件
│   │   ├── router/                  # 路由配置
│   │   ├── stores/                  # Pinia状态
│   │   ├── styles/                  # 全局样式
│   │   ├── utils/                   # 工具函数
│   │   └── views/                   # 页面视图
│   │       ├── base/                # 基础数据管理
│   │       ├── order/               # 订单管理
│   │       ├── mrp/                 # MRP计算
│   │       ├── production/          # 生产管理
│   │       ├── purchase/            # 采购管理
│   │       ├── inventory/           # 库存管理
│   │       ├── dashboard/           # 可视化看板
│   │       └── system/              # 系统管理
│   └── public/                      # 公共静态文件
│
├── server/                          # 后端项目
│   ├── src/
│   │   ├── config/                  # 配置文件
│   │   ├── controllers/             # 控制器
│   │   ├── middleware/               # 中间件
│   │   ├── models/                  # 数据模型(Prisma)
│   │   ├── routes/                  # 路由定义
│   │   ├── services/                # 业务逻辑
│   │   │   ├── base/                # 基础数据服务
│   │   │   ├── order/               # 订单服务
│   │   │   ├── mrp/                 # MRP计算引擎
│   │   │   ├── production/          # 生产服务
│   │   │   ├── purchase/            # 采购服务
│   │   │   ├── inventory/           # 库存服务
│   │   │   ├── dashboard/           # 看板服务
│   │   │   └── auth/                # 认证授权服务
│   │   ├── utils/                   # 工具函数
│   │   └── validators/              # 参数校验
│   └── prisma/                      # Prisma配置
│       └── schema.prisma            # 数据库Schema
│
├── docs/                            # 项目文档
├── scripts/                         # 脚本工具
└── docker/                          # Docker配置
```

---

## 三、数据架构设计

### 3.1 数据库ER图设计

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   User (用户)    │     │   Role (角色)    │     │ Permission(权限) │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id              │◄───┐│ id              │◄───┐│ id              │
│ username        │    ││ code            │    ││ code            │
│ password_hash   │    ││ name            │    ││ name            │
│ real_name       │    ││ description     │    ││ type            │
│ department_id   │    └│ created_at      │    └│ module          │
│ status          │     └─────────────────┘     │ action          │
│ created_at      │              │              └─────────────────┘
│ updated_at      │              │
└─────────────────┘              │
         │                       │
         │              ┌─────────────────┐
         │              │ UserRole(用户角色)│
         │              ├─────────────────┤
         └─────────────►│ user_id         │
                        │ role_id         │
                        └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Material (物料)  │     │   BOM (物料清单) │     │ BOMItem(BOM明细)│
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id              │◄───┐│ id              │◄───┐│ id              │
│ code            │    ││ code            │    ││ bom_id          │
│ name            │    ││ name            │    ││ material_id     │
│ specification   │    ││ product_id      │    ││ quantity        │
│ category        │    ││ version         │    ││ unit            │
│ unit            │    ││ status          │    ││ loss_rate       │
│ safety_stock    │    ││ created_by      │    ││ sort_order      │
│ min_stock       │    ││ created_at      │    └─────────────────┘
│ lead_time       │    └─────────────────┘
│ supplier_id     │
│ created_at      │
└─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ProcessRoute(工艺)│    │ Process(工序)    │     │Workstation(工位)│
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id              │◄───┐│ id              │     │ id              │
│ code            │    ││ route_id        │     │ code            │
│ name            │    ││ name            │     │ name            │
│ product_id      │    ││ code            │     │ workshop_id     │
│ total_time      │    ││ sequence        │     │ type            │
│ status          │    ││ workstation_id  │     │ capacity        │
│ created_at      │    ││ standard_time   │     │ status          │
└─────────────────┘    ││ setup_time      │     └─────────────────┘
                       ││ created_at      │
                       └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ SalesOrder(销售) │     │ OrderItem(订单行)│     │ProductionOrder  │
├─────────────────┤     ├─────────────────┤     │   (生产订单)     │
│ id              │◄───┐│ id              │◄───┐├─────────────────┤
│ order_no        │    ││ order_id        │    ││ id              │
│ customer_name   │    ││ material_id     │    ││ order_no        │
│ customer_code   │    ││ quantity        │    ││ sales_order_id  │
│ total_amount    │    ││ delivered_qty   │    ││ material_id     │
│ delivery_date   │    ││ unit_price      │    ││ quantity        │
│ status          │    ││ amount          │    ││ plan_date       │
│ priority        │    ││ delivery_date   │    ││ actual_date     │
│ created_by      │    ││ status          │    ││ status          │
│ created_at      │    │└─────────────────┘    ││ priority        │
│ updated_at      │    └─────────────────┘     ││ created_at      │
└─────────────────┘                            └─────────────────┘
         │                                              │
         │                                              │
         ▼                                              ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│PurchaseOrder(采购)│    │PurchaseItem(采购行)│   │WorkOrder(加工单) │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id              │◄───┐│ id              │     │ id              │
│ order_no        │    ││ order_id        │     │ order_no        │
│ supplier_id     │    ││ material_id     │     │ production_id   │
│ total_amount    │    ││ quantity        │     │ workstation_id  │
│ order_date      │    ││ received_qty    │     │ operator_id     │
│ expected_date   │    ││ unit_price      │     │ planned_qty     │
│ status          │    ││ amount          │     │ actual_qty      │
│ created_by      │    ││ status          │     │ scrap_qty       │
│ created_at      │    │└─────────────────┘    ││ start_time      │
└─────────────────┘                           ││ end_time        │
         │                                   ││ status          │
         │                                   │└─────────────────┘
         ▼                                   │
┌─────────────────┐     ┌─────────────────┐  │
│Supplier(供应商)  │     │StockRecord(库存)│  │
├─────────────────┤     ├─────────────────┤  │
│ id              │     │ id              │  │
│ code            │     │ material_id     │  │
│ name            │     │ warehouse_id    │  │
│ contact_person  │     │ quantity        │  │
│ phone           │     │ type            │  │
│ address         │     │ related_order   │  │
│ rating          │     │ created_at      │  │
│ status          │     └─────────────────┘  │
│ created_at      │                         │
└─────────────────┘                         │
                                            │
┌─────────────────┐     ┌─────────────────┐ │
│Workshop(车间)   │     │Warehouse(仓库)  │ │
├─────────────────┤     ├─────────────────┤ │
│ id              │     │ id              │ │
│ code            │     │ code            │ │
│ name            │     │ name            │ │
│ manager         │     │ type            │ │
│ status          │     │ address         │ │
│ created_at      │     │ status          │ │
└─────────────────┘     └─────────────────┘ │
```

### 3.2 核心数据表设计

#### 3.2.1 物料表 (materials)

```sql
CREATE TABLE materials (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE COMMENT '物料编码',
    name VARCHAR(200) NOT NULL COMMENT '物料名称',
    specification VARCHAR(500) COMMENT '规格型号',
    category ENUM('raw', 'semi', 'finished', 'accessory') NOT NULL COMMENT '分类：原材料/半成品/成品/辅料',
    unit VARCHAR(20) NOT NULL COMMENT '计量单位',
    safety_stock DECIMAL(15,4) DEFAULT 0 COMMENT '安全库存',
    min_stock DECIMAL(15,4) DEFAULT 0 COMMENT '最低库存',
    max_stock DECIMAL(15,4) DEFAULT 0 COMMENT '最高库存',
    lead_time INT DEFAULT 0 COMMENT '采购提前期(天)',
    default_warehouse_id BIGINT COMMENT '默认仓库',
    supplier_id BIGINT COMMENT '主要供应商',
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_category (category),
    INDEX idx_status (status)
) COMMENT '物料主数据表';
```

#### 3.2.2 BOM表 (boms)

```sql
CREATE TABLE boms (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE COMMENT 'BOM编码',
    name VARCHAR(200) NOT NULL COMMENT 'BOM名称',
    product_id BIGINT NOT NULL COMMENT '成品物料ID',
    version VARCHAR(20) DEFAULT '1.0' COMMENT '版本号',
    status ENUM('draft', 'active', 'obsolete') DEFAULT 'draft',
    created_by BIGINT COMMENT '创建人',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_product (product_id),
    INDEX idx_status (status)
) COMMENT '物料清单主表';

CREATE TABLE bom_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    bom_id BIGINT NOT NULL COMMENT 'BOM主表ID',
    material_id BIGINT NOT NULL COMMENT '子物料ID',
    quantity DECIMAL(15,6) NOT NULL COMMENT '用量',
    unit VARCHAR(20) NOT NULL COMMENT '单位',
    loss_rate DECIMAL(5,4) DEFAULT 0 COMMENT '损耗率',
    sort_order INT DEFAULT 0 COMMENT '排序',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bom (bom_id),
    INDEX idx_material (material_id),
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
) COMMENT 'BOM明细表';
```

#### 3.2.3 销售订单表 (sales_orders)

```sql
CREATE TABLE sales_orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(50) NOT NULL UNIQUE COMMENT '订单编号',
    customer_name VARCHAR(200) NOT NULL COMMENT '客户名称',
    customer_code VARCHAR(50) COMMENT '客户编码',
    contact_person VARCHAR(100) COMMENT '联系人',
    contact_phone VARCHAR(20) COMMENT '联系电话',
    total_amount DECIMAL(15,2) DEFAULT 0 COMMENT '订单总额',
    delivery_date DATE COMMENT '要求交货日期',
    status ENUM('draft', 'confirmed', 'in_production', 'completed', 'shipped', 'cancelled') DEFAULT 'draft',
    priority ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal',
    remark TEXT COMMENT '备注',
    created_by BIGINT COMMENT '创建人',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_no (order_no),
    INDEX idx_customer (customer_code),
    INDEX idx_status (status),
    INDEX idx_delivery_date (delivery_date)
) COMMENT '销售订单表';

CREATE TABLE sales_order_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL COMMENT '订单ID',
    material_id BIGINT NOT NULL COMMENT '物料ID',
    quantity DECIMAL(15,4) NOT NULL COMMENT '订单数量',
    unit_price DECIMAL(15,4) COMMENT '单价',
    amount DECIMAL(15,2) COMMENT '金额',
    delivered_qty DECIMAL(15,4) DEFAULT 0 COMMENT '已发货数量',
    delivery_date DATE COMMENT '行项交货日期',
    status ENUM('pending', 'in_production', 'completed', 'shipped', 'cancelled') DEFAULT 'pending',
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (order_id),
    INDEX idx_material (material_id),
    FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
) COMMENT '销售订单明细表';
```

#### 3.2.4 生产订单表 (production_orders)

```sql
CREATE TABLE production_orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(50) NOT NULL UNIQUE COMMENT '生产订单号',
    sales_order_id BIGINT COMMENT '关联销售订单',
    material_id BIGINT NOT NULL COMMENT '生产物料ID',
    quantity DECIMAL(15,4) NOT NULL COMMENT '计划生产数量',
    plan_start_date DATE COMMENT '计划开始日期',
    plan_end_date DATE COMMENT '计划完成日期',
    actual_start_date DATE COMMENT '实际开始日期',
    actual_end_date DATE COMMENT '实际完成日期',
    status ENUM('planned', 'in_progress', 'completed', 'cancelled') DEFAULT 'planned',
    priority ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal',
    remark TEXT,
    created_by BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_no (order_no),
    INDEX idx_sales_order (sales_order_id),
    INDEX idx_material (material_id),
    INDEX idx_status (status),
    INDEX idx_plan_date (plan_end_date)
) COMMENT '生产订单表';
```

#### 3.2.5 加工单表 (work_orders)

```sql
CREATE TABLE work_orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(50) NOT NULL UNIQUE COMMENT '加工单号',
    production_order_id BIGINT NOT NULL COMMENT '生产订单ID',
    process_route_id BIGINT COMMENT '工艺路线ID',
    workstation_id BIGINT COMMENT '工位ID',
    operator_id BIGINT COMMENT '操作员ID',
    planned_qty DECIMAL(15,4) NOT NULL COMMENT '计划数量',
    actual_qty DECIMAL(15,4) DEFAULT 0 COMMENT '完工数量',
    scrap_qty DECIMAL(15,4) DEFAULT 0 COMMENT '报废数量',
    start_time DATETIME COMMENT '开始时间',
    end_time DATETIME COMMENT '结束时间',
    status ENUM('pending', 'in_progress', 'paused', 'completed', 'cancelled') DEFAULT 'pending',
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_no (order_no),
    INDEX idx_production_order (production_order_id),
    INDEX idx_workstation (workstation_id),
    INDEX idx_status (status)
) COMMENT '加工单表';
```

#### 3.2.6 库存表 (stocks)

```sql
CREATE TABLE stocks (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    material_id BIGINT NOT NULL COMMENT '物料ID',
    warehouse_id BIGINT NOT NULL COMMENT '仓库ID',
    quantity DECIMAL(15,4) DEFAULT 0 COMMENT '库存数量',
    reserved_qty DECIMAL(15,4) DEFAULT 0 COMMENT '预留数量',
    available_qty DECIMAL(15,4) GENERATED ALWAYS AS (quantity - reserved_qty) STORED COMMENT '可用数量',
    last_in_date DATE COMMENT '最近入库日期',
    last_out_date DATE COMMENT '最近出库日期',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_material_warehouse (material_id, warehouse_id),
    INDEX idx_material (material_id),
    INDEX idx_warehouse (warehouse_id)
) COMMENT '库存表';

CREATE TABLE stock_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    material_id BIGINT NOT NULL COMMENT '物料ID',
    warehouse_id BIGINT NOT NULL COMMENT '仓库ID',
    type ENUM('in', 'out', 'transfer', 'adjust') NOT NULL COMMENT '类型：入库/出库/调拨/调整',
    quantity DECIMAL(15,4) NOT NULL COMMENT '数量',
    related_type VARCHAR(50) COMMENT '关联单据类型',
    related_id BIGINT COMMENT '关联单据ID',
    operator_id BIGINT COMMENT '操作人',
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_material (material_id),
    INDEX idx_warehouse (warehouse_id),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
) COMMENT '库存流水表';
```

#### 3.2.7 采购订单表 (purchase_orders)

```sql
CREATE TABLE purchase_orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(50) NOT NULL UNIQUE COMMENT '采购订单号',
    supplier_id BIGINT NOT NULL COMMENT '供应商ID',
    total_amount DECIMAL(15,2) DEFAULT 0 COMMENT '订单总额',
    order_date DATE COMMENT '下单日期',
    expected_date DATE COMMENT '期望到货日期',
    status ENUM('draft', 'confirmed', 'partial_received', 'received', 'cancelled') DEFAULT 'draft',
    created_by BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_no (order_no),
    INDEX idx_supplier (supplier_id),
    INDEX idx_status (status)
) COMMENT '采购订单表';

CREATE TABLE purchase_order_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL COMMENT '采购订单ID',
    material_id BIGINT NOT NULL COMMENT '物料ID',
    quantity DECIMAL(15,4) NOT NULL COMMENT '采购数量',
    received_qty DECIMAL(15,4) DEFAULT 0 COMMENT '已收货数量',
    unit_price DECIMAL(15,4) COMMENT '单价',
    amount DECIMAL(15,2) COMMENT '金额',
    expected_date DATE COMMENT '期望到货日期',
    status ENUM('pending', 'partial_received', 'received', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (order_id),
    INDEX idx_material (material_id),
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
) COMMENT '采购订单明细表';
```

### 3.3 数据字典

| 字段名 | 类型 | 说明 | 示例值 |
|--------|------|------|--------|
| material_category | ENUM | 物料分类 | raw=原材料, semi=半成品, finished=成品, accessory=辅料 |
| order_status | ENUM | 订单状态 | draft=草稿, confirmed=已确认, in_production=生产中, completed=已完成, shipped=已发货, cancelled=已取消 |
| priority | ENUM | 优先级 | low=低, normal=普通, high=高, urgent=紧急 |
| work_status | ENUM | 工单状态 | pending=待处理, in_progress=进行中, paused=暂停, completed=已完成, cancelled=已取消 |
| stock_type | ENUM | 库存类型 | in=入库, out=出库, transfer=调拨, adjust=调整 |

---

## 四、前端页面设计

### 4.1 页面布局结构

```
┌────────────────────────────────────────────────────────────┐
│  顶部导航栏 (Header)                                       │
│  ┌──────────┐  ┌──────────────────────┐  ┌──────────┐    │
│  │  Logo    │  │      系统名称         │  │ 用户信息 │    │
│  └──────────┘  └──────────────────────┘  └──────────┘    │
├────────────┬───────────────────────────────────────────────┤
│            │                                               │
│  侧边栏    │              主内容区                          │
│  (Menu)    │  ┌───────────────────────────────────────┐   │
│            │  │                                       │   │
│  ┌──────┐  │  │           页面内容                     │   │
│  │ 首页  │  │  │                                       │   │
│  ├──────┤  │  │                                       │   │
│  │基础数据│  │  │                                       │   │
│  ├──────┤  │  │                                       │   │
│  │订单管理│  │  │                                       │   │
│  ├──────┤  │  │                                       │   │
│  │MRP计算│  │  │                                       │   │
│  ├──────┤  │  │                                       │   │
│  │生产管理│  │  │                                       │   │
│  ├──────┤  │  │                                       │   │
│  │采购管理│  │  └───────────────────────────────────────┘   │
│  ├──────┤  │                                               │
│  │库存管理│  │                                               │
│  ├──────┤  │                                               │
│  │看板   │  │                                               │
│  ├──────┤  │                                               │
│  │系统管理│  │                                               │
│  └──────┘  │                                               │
│            │                                               │
└────────────┴───────────────────────────────────────────────┘
```

### 4.2 页面清单与路由设计

| 模块 | 页面名称 | 路由路径 | 功能说明 |
|------|----------|----------|----------|
| 首页 | 工作台 | `/dashboard/workbench` | 待办事项、快捷入口、关键指标 |
| **基础数据** | 物料列表 | `/base/material` | 物料查询、新增、编辑、导入导出 |
| | 物料详情 | `/base/material/:id` | 物料详细信息、关联BOM、库存 |
| | BOM管理 | `/base/bom` | BOM列表、新增、编辑、版本管理 |
| | 工艺路线 | `/base/process-route` | 工艺路线管理、工序配置 |
| | 供应商管理 | `/base/supplier` | 供应商列表、评分、联系人 |
| | 仓库管理 | `/base/warehouse` | 仓库列表、库位管理 |
| **订单管理** | 销售订单 | `/order/sales` | 订单列表、新增、编辑、审核 |
| | 订单详情 | `/order/sales/:id` | 订单全流程跟踪 |
| | 客户管理 | `/order/customer` | 客户信息管理 |
| **MRP计算** | MRP运算 | `/mrp/calculate` | 参数设置、执行运算、结果查看 |
| | 缺料清单 | `/mrp/shortage` | 缺料TOP榜、影响分析 |
| | 采购建议 | `/mrp/suggestion` | 自动生成的采购建议 |
| **生产管理** | 生产订单 | `/production/order` | 生产订单列表、排产 |
| | 加工单管理 | `/production/work-order` | 加工单分配、报工 |
| | 车间看板 | `/production/workshop` | 车间实时状态、甘特图 |
| | 报工记录 | `/production/report` | 报工历史、统计 |
| **采购管理** | 采购订单 | `/purchase/order` | 采购订单管理 |
| | 到货跟踪 | `/purchase/arrival` | 到货状态、收货确认 |
| | 供应商评估 | `/purchase/evaluation` | 供应商绩效评分 |
| **库存管理** | 库存查询 | `/inventory/query` | 当前库存、预警 |
| | 出入库记录 | `/inventory/record` | 出入库流水 |
| | 库存调整 | `/inventory/adjust` | 盘点、调整 |
| **看板** | 管理驾驶舱 | `/dashboard/executive` | 高管总览 |
| | 订单追踪 | `/dashboard/order-tracking` | 订单状态跟踪 |
| | 车间电子看板 | `/dashboard/workshop` | 车间实时大屏 |
| | 缺料预警 | `/dashboard/shortage-alert` | 缺料预警大屏 |
| | 库存看板 | `/dashboard/inventory` | 库存状态大屏 |
| **系统管理** | 用户管理 | `/system/user` | 用户CRUD |
| | 角色管理 | `/system/role` | 角色权限配置 |
| | 操作日志 | `/system/log` | 操作审计记录 |

### 4.3 核心页面原型

#### 4.3.1 物料列表页面

```
┌────────────────────────────────────────────────────────────┐
│  面包屑：首页 > 基础数据 > 物料管理                          │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 搜索区域                                              │ │
│  │  物料编码：[________]  名称：[________]                │ │
│  │  分类：[全部 ▼]  状态：[全部 ▼]    [查询] [重置]       │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  操作栏：[新增] [导入] [导出] [批量删除]                    │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 数据表格                                              │ │
│  │ ☐ │ 编码     │ 名称     │ 规格   │ 分类 │ 单位 │ 操作 │ │
│  │───┼─────────┼─────────┼───────┼─────┼─────┼──────│ │
│  │ ☐ │ M001    │ 钢板A   │ 2mm   │ 原料 │ 张   │ 编辑 删除│ │
│  │ ☐ │ M002    │ 螺丝M6  │ M6*20 │ 辅料 │ 个   │ 编辑 删除│ │
│  │ ☐ │ M003    │ 成品X   │       │ 成品 │ 台   │ 编辑 删除│ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  分页：共 128 条  < 1 2 3 ... 13 >  每页 20 条            │
└────────────────────────────────────────────────────────────┘
```

#### 4.3.2 MRP计算页面

```
┌────────────────────────────────────────────────────────────┐
│  面包屑：首页 > MRP计算 > MRP运算                           │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 运算参数设置                                          │ │
│  │                                                      │ │
│  │  计算范围：○ 指定订单  ○ 全部未完成订单                 │ │
│  │  选择订单：[订单1 ▼] [订单2 ▼] [订单3 ▼]  (+)        │ │
│  │                                                      │ │
│  │  ☑ 扣除现有库存  ☑ 扣除在途采购量  ☑ 考虑安全库存     │ │
│  │                                                      │ │
│  │  运算模式：○ 重新计算  ○ 增量计算                      │ │
│  │                                                      │ │
│  │              [开始运算]                                │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 运算结果                                              │ │
│  │                                                      │ │
│  │  运算时间：2024-01-15 10:30:25                        │ │
│  │  涉及订单：3 张                                       │ │
│  │  涉及物料：45 种                                      │ │
│  │  缺料物料：12 种                                      │ │
│  │                                                      │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │ 缺料清单                                        │ │ │
│  │  │ 物料   │ 需求量 │ 现有 │ 在途 │ 缺口   │ 影响订单│ │ │
│  │  │────────┼───────┼─────┼─────┼───────┼───────│ │ │
│  │  │ 钢板A  │ 100   │ 30  │ 20  │ 50    │ SO001 │ │ │
│  │  │ 螺丝M6 │ 5000  │ 0   │ 3000│ 2000  │ SO002 │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  │  [生成采购建议] [导出Excel] [查看影响分析]              │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

#### 4.3.3 车间电子看板

```
┌────────────────────────────────────────────────────────────┐
│                    车间生产看板    2024-01-15 14:30:00       │
├──────────────────┬──────────────────┬──────────────────────┤
│   今日生产任务    │    生产进度       │     异常预警         │
│                  │                  │                      │
│  待处理：8       │  ████████░░ 80%  │  ⚠ 工位A03设备故障   │
│  进行中：12      │  ██████░░░░ 60%  │  ⚠ M001物料即将用完  │
│  已完成：5       │  ██████████ 100% │  ⚠ 订单SO001即将逾期│
│                  │                  │                      │
├──────────────────┴──────────────────┴──────────────────────┤
│   工位状态                                                  │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐      │
│  │ A01   │ │ A02   │ │ A03   │ │ B01   │ │ B02   │      │
│  │ 🟢 空闲│ │ 🔴 生产中│ │ 🔴 故障│ │ 🟢 空闲│ │ 🔴 生产中│      │
│  │ 工单:0│ │ 工单:3│ │ 工单:0│ │ 工单:0│ │ 工单:2│      │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘      │
├────────────────────────────────────────────────────────────┤
│   今日报工统计                                              │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  ████████████████████████████░░░░░░░░░░░░░░░░░░░░░ │  │
│  │  08:00  09:00  10:00  11:00  12:00  13:00  14:00  │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 4.4 组件规范

#### 4.4.1 通用表格组件

```typescript
// 表格列配置类型
interface TableColumn {
  prop: string;           // 字段名
  label: string;          // 列标题
  width?: number;         // 列宽
  minWidth?: number;      // 最小列宽
  fixed?: 'left' | 'right';  // 固定列
  sortable?: boolean;     // 可排序
  formatter?: (row: any, column: any, cellValue: any) => string;  // 格式化
  slot?: string;          // 自定义插槽
  children?: TableColumn[];  // 多级表头
}
```

#### 4.4.2 表单验证规则

```typescript
// 通用验证规则
const formRules = {
  required: { required: true, message: '请输入{label}', trigger: 'blur' },
  number: { type: 'number', message: '{label}必须为数字' },
  email: { type: 'email', message: '请输入正确的邮箱地址' },
  phone: { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
  code: { pattern: /^[A-Z0-9_-]+$/, message: '编码只能包含大写字母、数字、下划线' }
};
```

### 4.5 状态码规范

| 模块 | 状态码 | 含义 |
|------|--------|------|
| 订单 | 0 | 草稿 |
| | 10 | 已确认 |
| | 20 | 生产中 |
| | 30 | 已完成 |
| | 40 | 已发货 |
| | 90 | 已取消 |
| 工单 | 0 | 待处理 |
| | 10 | 进行中 |
| | 20 | 暂停 |
| | 30 | 已完成 |
| | 90 | 已取消 |

---

## 五、后端API设计

### 5.1 API规范

- 基础路径：`/api/v1`
- 认证方式：Bearer Token (JWT)
- 请求格式：JSON
- 响应格式：统一响应结构

### 5.2 统一响应结构

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "timestamp": 1705312225000
}
```

### 5.3 核心API清单

#### 基础数据模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/materials` | 获取物料列表 |
| POST | `/materials` | 创建物料 |
| PUT | `/materials/:id` | 更新物料 |
| DELETE | `/materials/:id` | 删除物料 |
| POST | `/materials/import` | 批量导入物料 |
| GET | `/materials/export` | 导出物料 |
| GET | `/boms` | 获取BOM列表 |
| POST | `/boms` | 创建BOM |
| PUT | `/boms/:id` | 更新BOM |

#### 订单管理模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sales-orders` | 获取销售订单列表 |
| POST | `/sales-orders` | 创建销售订单 |
| PUT | `/sales-orders/:id` | 更新销售订单 |
| PUT | `/sales-orders/:id/confirm` | 确认订单 |
| PUT | `/sales-orders/:id/cancel` | 取消订单 |
| GET | `/sales-orders/:id/track` | 订单跟踪 |

#### MRP计算模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/mrp/calculate` | 执行MRP计算 |
| GET | `/mrp/shortage` | 获取缺料清单 |
| POST | `/mrp/suggestion/generate` | 生成采购建议 |
| GET | `/mrp/history` | 计算历史记录 |

#### 生产管理模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/production-orders` | 获取生产订单列表 |
| POST | `/production-orders` | 创建生产订单 |
| GET | `/work-orders` | 获取加工单列表 |
| POST | `/work-orders` | 创建加工单 |
| PUT | `/work-orders/:id/report` | 报工 |
| GET | `/workshop/status` | 车间状态查询 |

#### 库存管理模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/stocks` | 查询库存 |
| POST | `/stocks/in` | 入库操作 |
| POST | `/stocks/out` | 出库操作 |
| GET | `/stocks/records` | 库存流水 |
| POST | `/stocks/adjust` | 库存调整 |

#### 看板数据模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/dashboard/executive` | 管理驾驶舱数据 |
| GET | `/dashboard/order-tracking` | 订单追踪数据 |
| GET | `/dashboard/workshop` | 车间看板数据 |
| GET | `/dashboard/shortage-alert` | 缺料预警数据 |

---

## 六、MRP计算引擎设计

### 6.1 计算流程

```
┌─────────────────┐
│   开始运算      │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 1.获取销售订单   │
│ (已确认未完成)   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2.展开BOM       │
│ (递归展开)      │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3.计算毛需求     │
│ (订单数量×用量)  │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4.计算净需求     │
│ 毛需求 - 现有库存 │
│      - 在途量    │
│      + 安全库存  │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5.生成缺料清单   │
│ (净需求>0的物料) │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 6.生成采购建议   │
│ (考虑提前期)    │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 7.生成生产订单   │
│ (半成品/成品)    │
└────────┬────────┘
         ▼
┌─────────────────┐
│   运算完成      │
└─────────────────┘
```

### 6.2 核心算法伪代码

```python
def mrp_calculate(sales_orders, params):
    # 1. 收集所有需求物料
    all_demands = []
    for order in sales_orders:
        for item in order.items:
            all_demands.append({
                'material_id': item.material_id,
                'quantity': item.quantity,
                'order_id': order.id
            })
    
    # 2. 展开BOM
    expanded_demands = []
    for demand in all_demands:
        bom = get_active_bom(demand['material_id'])
        if bom:
            # 递归展开BOM
            expanded = expand_bom(bom, demand['quantity'])
            expanded_demands.extend(expanded)
        else:
            expanded_demands.append(demand)
    
    # 3. 汇总需求
    material_demands = {}
    for demand in expanded_demands:
        mid = demand['material_id']
        if mid not in material_demands:
            material_demands[mid] = 0
        material_demands[mid] += demand['quantity']
    
    # 4. 计算净需求
    shortage_list = []
    for material_id, total_demand in material_demands.items():
        stock = get_stock(material_id)
        in_transit = get_in_transit(material_id)
        safety_stock = get_safety_stock(material_id)
        
        net_demand = total_demand - stock - in_transit + safety_stock
        
        if net_demand > 0:
            shortage_list.append({
                'material_id': material_id,
                'gross_demand': total_demand,
                'stock': stock,
                'in_transit': in_transit,
                'safety_stock': safety_stock,
                'net_demand': net_demand
            })
    
    # 5. 生成结果
    return {
        'shortage_list': shortage_list,
        'purchase_suggestions': generate_purchase_suggestions(shortage_list),
        'production_orders': generate_production_orders(shortage_list)
    }
```

---

## 七、安全设计

### 7.1 认证授权

- 采用JWT Token认证
- Token有效期：2小时
- 支持Token刷新
- 密码使用bcrypt加密存储

### 7.2 权限模型

采用RBAC（基于角色的访问控制）模型：

```
用户 ──┐
       ├──► 角色 ──┐
       │           ├──► 权限
       │           │
       └───────────┘
```

### 7.3 数据权限

| 角色 | 数据范围 |
|------|----------|
| 管理员 | 全部数据 |
| 厂长/经理 | 全部门数据 |
| 车间主任 | 本车间数据 |
| 仓库管理员 | 本仓库数据 |
| 普通员工 | 本人相关数据 |

---

## 八、性能设计

### 8.1 缓存策略

| 数据类型 | 缓存时间 | 更新策略 |
|----------|----------|----------|
| 用户信息 | 30分钟 | 写时失效 |
| 物料数据 | 10分钟 | 写时失效 |
| BOM数据 | 10分钟 | 写时失效 |
| 库存数据 | 1分钟 | 实时更新 |
| 看板数据 | 5分钟 | 定时刷新 |

### 8.2 数据库优化

- 为高频查询字段建立索引
- 大表使用分页查询
- MRP计算使用批量操作
- 定期归档历史数据

---

## 九、开发规范

### 9.1 代码规范

- 前端使用ESLint + Prettier
- 后端使用ESLint + Airbnb规范
- 提交信息遵循Conventional Commits规范

### 9.2 Git分支规范

```
main        # 生产分支
develop     # 开发分支
feature/*   # 功能分支
hotfix/*    # 紧急修复
release/*   # 发布分支
```

### 9.3 API返回码

| 返回码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

---

## 十、部署架构

### 10.1 生产环境部署

```
                    ┌─────────────────┐
                    │    CDN          │
                    │  (静态资源)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    Nginx        │
                    │  (反向代理)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐    │    ┌────────▼────────┐
     │   Node.js #1    │    │    │   Node.js #2    │
     │   (API服务)     │    │    │   (API服务)     │
     └────────┬────────┘    │    └────────┬────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │    MySQL        │
                    │   (主从)        │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    Redis        │
                    │  (Cluster)      │
                    └─────────────────┘
```

### 10.2 Docker部署配置

```yaml
# docker-compose.yml
version: '3.8'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./client/dist:/usr/share/nginx/html
    
  api:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=mysql
      - REDIS_HOST=redis
    depends_on:
      - mysql
      - redis
    
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      - MYSQL_ROOT_PASSWORD=secret
      - MYSQL_DATABASE=erp_system
    volumes:
      - mysql_data:/var/lib/mysql
    
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  mysql_data:
  redis_data:
```

---

## 十一、测试策略

### 11.1 测试层次

| 层次 | 工具 | 覆盖率要求 |
|------|------|------------|
| 单元测试 | Jest | >80% |
| 集成测试 | Supertest | 核心接口100% |
| E2E测试 | Cypress | 关键流程 |
| 性能测试 | k6 | 核心接口 |

### 11.2 关键测试用例

- MRP计算准确性测试
- 库存并发操作测试
- 权限控制测试
- 数据一致性测试

---

## 十二、附录

### 12.1 环境变量配置

```env
# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_NAME=erp_system
DB_USER=root
DB_PASSWORD=

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT配置
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=2h

# 文件存储
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

### 12.2 开发工具推荐

- IDE: VS Code
- API测试: Postman / Apifox
- 数据库管理: Navicat / DBeaver
- Git客户端: SourceTree

---

**文档版本：** v1.0  
**最后更新：** 2024-01-15  
**文档状态：** 初稿
