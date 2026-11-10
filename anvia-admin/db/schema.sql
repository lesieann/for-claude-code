-- 予安所託後台 — Supabase (Postgres) schema v1
-- 欄位對照現行後台資料模型；金額公式以 docs/notion-formulas.md（裁決版）為準，由應用層計算。

create table if not exists customers (
  id          bigint generated always as identity primary key,
  notion_key  text unique,                 -- Notion 頁面 32-hex（搬遷對照用）
  name        text not null,               -- 客戶暱稱
  real_name   text,
  line_uid    text unique,                 -- LINE userId（會員登入鍵）
  line_id     text,
  phone       text,
  email       text,
  source_date date,                        -- 獲客日期
  location    text,
  created_at  timestamptz not null default now()
);

create table if not exists batches (
  id            bigint generated always as identity primary key,
  notion_key    text unique,
  name          text not null,             -- 批次名稱（如 20261006）
  actual_weight numeric,                   -- 實際重量 kg
  is_latest     boolean not null default false,
  status        text not null default '進行中',  -- 進行中 / 歸檔
  carrier       text,                      -- 台集運 / 巧巧郎
  total_freight numeric,                   -- 總運費（公式：進位 kg × 73）
  created_at    timestamptz not null default now()
);

create table if not exists orders (
  id           bigint generated always as identity primary key,
  notion_key   text unique,
  oid          integer,                    -- 原後台訂單編號（YYYYMMDD 序號顯示另計）
  customer_id  bigint references customers(id),
  title        text not null,              -- 商品名稱
  platform     text,                       -- 淘寶/閑魚/拼多多/微店/抖音/摩點/拼團呀/小紅書/B站…
  url          text,
  price        numeric,                    -- 代購單價（RMB 計價欄位依來源）
  weight_kg    numeric,                    -- 包裹重量
  debt         numeric not null default 0, -- 欠款（二補拉取）
  status       text not null default '待處理', -- 未付款/待處理/未發貨/在倉庫/已抵台/已寄出/取消・退款
  order_date   date,
  batch_id     bigint references batches(id),
  shipment_id  bigint,                     -- FK 待 shipments 建表後補（見下方）
  purchased    boolean not null default false,
  stocked      boolean not null default false,
  arrived      boolean not null default false,
  shipped      boolean not null default false,
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists shipments (
  id            bigint generated always as identity primary key,
  notion_key    text unique,
  order_no      text,                      -- 訂單編號（出貨單標題）
  customer_id   bigint references customers(id),
  parcel_count  integer,                   -- 實際包裹數量（手填）
  total_weight  numeric,
  labor_fee     numeric,                   -- 辛苦費（級距公式）
  base_freight  numeric,                   -- 基礎運費
  total_due     numeric,                   -- 總二補（公式，無條件進位，賣貨便≥20/好賣+≥25）
  channel       text,                      -- 賣貨便 / 好賣+
  paid          boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table orders
  add constraint orders_shipment_fk foreign key (shipment_id) references shipments(id);

create table if not exists payments (
  id             bigint generated always as identity primary key,
  kind           text not null,            -- order / supplement（二補）
  ref_id         bigint not null,          -- orders.id 或 shipments.id
  merchant_order_no text unique not null,  -- 藍新訂單編號
  amount         integer not null,         -- TWD 整數（已含通路手續費）
  method         text,                     -- ATM / CVS / CREDIT …
  status         text not null default 'pending', -- pending / paid / failed
  trade_no       text,                     -- 藍新交易編號
  paid_at        timestamptz,
  raw_notify     jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists flex_templates (
  id         bigint generated always as identity primary key,
  name       text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages_library (
  id            bigint generated always as identity primary key,
  name          text not null,
  type          text not null,             -- text/image/imagemap/video/youtube/flex/carousel/template
  payload       jsonb not null,
  quick_reply   jsonb,
  attached_text text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists welcome_flows (
  id         bigint generated always as identity primary key,
  slots      jsonb not null default '[]',  -- 最多 3 則訊息庫 id 排序＋啟停
  updated_at timestamptz not null default now()
);

create table if not exists richmenu_projects (
  id         bigint generated always as identity primary key,
  name       text not null,
  payload    jsonb not null,               -- 多頁選單＋格子動作（含 alias 切換）
  schedule   jsonb,                        -- 預約上/下架時間
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_idx on orders(customer_id);
create index if not exists orders_status_idx on orders(status);
create index if not exists payments_ref_idx on payments(kind, ref_id);
