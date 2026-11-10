// 資料型別：欄位名稱與 db/schema.sql 相同（snake_case）

export const ORDER_STATUSES = ['未付款', '待處理', '未發貨', '在倉庫', '已抵台', '已寄出', '取消・退款'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const CLOSED_STATUSES: OrderStatus[] = ['已寄出', '取消・退款'];

export const PLATFORMS = ['淘寶', '閑魚', '拼多多', '微店', '抖音', '摩點', '拼團呀', '小紅書', 'B站', '其他'];

export interface Customer {
  id: number;
  notion_key?: string | null;
  name: string;
  real_name?: string | null;
  line_uid?: string | null;
  line_id?: string | null;
  phone?: string | null;
  email?: string | null;
  source_date?: string | null;
  location?: string | null;
  created_at: string;
}

export interface Batch {
  id: number;
  notion_key?: string | null;
  name: string;
  actual_weight?: number | null;
  is_latest: boolean;
  status: '進行中' | '歸檔';
  carrier?: '台集運' | '巧巧郎' | null;
  total_freight?: number | null;
  created_at: string;
}

export interface Order {
  id: number;
  notion_key?: string | null;
  oid?: number | null;
  customer_id?: number | null;
  title: string;
  platform?: string | null;
  url?: string | null;
  price?: number | null;
  weight_kg?: number | null;
  debt: number;
  status: OrderStatus;
  order_date?: string | null;
  batch_id?: number | null;
  shipment_id?: number | null;
  purchased: boolean;
  stocked: boolean;
  arrived: boolean;
  shipped: boolean;
  note?: string | null;
  created_at: string;
}

export interface Shipment {
  id: number;
  notion_key?: string | null;
  order_no?: string | null;
  customer_id?: number | null;
  parcel_count?: number | null;
  total_weight?: number | null;
  labor_fee?: number | null;
  base_freight?: number | null;
  total_due?: number | null;
  channel?: '賣貨便' | '好賣+' | null;
  paid: boolean;
  created_at: string;
}

export interface Payment {
  id: number;
  kind: 'order' | 'supplement';
  ref_id: number;
  merchant_order_no: string;
  amount: number;
  method?: 'ATM' | 'CVS' | string | null;
  status: 'pending' | 'paid' | 'failed';
  trade_no?: string | null;
  paid_at?: string | null;
  raw_notify?: unknown;
  created_at: string;
}

export interface Tables {
  customers: Customer;
  batches: Batch;
  orders: Order;
  shipments: Shipment;
  payments: Payment;
}
export type TableName = keyof Tables;
