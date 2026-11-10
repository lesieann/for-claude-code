import Link from 'next/link';
import { loadAll, isOpen, orderNo, monthKey } from '@/lib/data';
import * as F from '@/lib/formulas';
import { ORDER_STATUSES } from '@/lib/types';
import { Head, StatusTag, Who, ntd, day, Empty } from '@/components/ui';

export default async function Dashboard() {
  const { customers, orders, batches, shipments, payments } = await loadAll();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthOrders = orders.filter((o) => monthKey(o.order_date || o.created_at) === thisMonth && o.status !== '取消・退款');
  const newCustomers = customers.filter((c) => monthKey(c.source_date || c.created_at) === thisMonth).length;
  const amount = monthOrders.reduce((s, o) => s + (o.price || 0), 0);
  const profit = monthOrders.reduce((s, o) => s + F.unitProfit(o.price || 0), 0);
  const open = orders.filter(isOpen);
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]));
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const latest = batches.find((b) => b.is_latest) ?? batches.at(-1);
  const unpaidShip = shipments.filter((s) => !s.paid);
  const pending = payments.filter((p) => p.status === 'pending');
  const recent = [...orders].sort((a, b) => b.id - a.id).slice(0, 8);
  const arrivedByCustomer = new Map<number, number>();
  for (const o of orders) if (o.status === '已抵台' && !o.shipment_id && o.customer_id) arrivedByCustomer.set(o.customer_id, (arrivedByCustomer.get(o.customer_id) ?? 0) + 1);

  return (
    <>
      <Head title="總覽" sub={`${now.getFullYear()} 年 ${now.getMonth() + 1} 月 · 今天也辛苦了 ✦`}>
        <Link className="btn" href="/admin/customers/new">＋ 新客戶</Link>
        <Link className="btn primary" href="/admin/orders/new">＋ 新訂單</Link>
      </Head>

      <div className="grid g4">
        <div className="card stat hero"><div className="k">本月訂單金額</div><div className="v">{ntd(amount)}</div><div className="d">{monthOrders.length} 筆訂單</div></div>
        <div className="card stat dark"><div className="k">本月利潤（約）</div><div className="v">{ntd(profit)}</div><div className="d">單位利潤 6.5% 加總</div></div>
        <div className="card stat"><div className="k">本月新客戶</div><div className="v">{newCustomers}<small>位</small></div><div className="d">累計 {customers.length} 位</div></div>
        <div className="card stat"><div className="k">進行中訂單</div><div className="v">{open.length}<small>筆</small></div><div className="d">全部 {orders.length} 筆</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>訂單狀態</h2><span className="r small muted">點擊查看該狀態訂單</span></div>
        <div className="pad pipeline">
          {ORDER_STATUSES.map((s) => (
            <Link key={s} className="pipe" href={`/admin/orders?status=${encodeURIComponent(s)}`}>
              <b>{byStatus[s]}</b><StatusTag s={s} />
            </Link>
          ))}
        </div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-h"><h2>最新訂單</h2><div className="r"><Link className="btn sm" href="/admin/orders">全部訂單</Link></div></div>
          {recent.length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>編號</th><th>客戶</th><th>商品</th><th className="num">單價</th><th>狀態</th></tr></thead>
              <tbody>{recent.map((o) => (
                <tr key={o.id}>
                  <td className="nowrap"><Link href={`/admin/orders/${o.id}`}>{orderNo(o)}</Link></td>
                  <td className="nowrap">{o.customer_id ? cname.get(o.customer_id) : '—'}</td>
                  <td><span className="title">{o.title}</span></td>
                  <td className="num">{ntd(o.price)}</td>
                  <td><StatusTag s={o.status} /></td>
                </tr>))}
              </tbody>
            </table></div>
          ) : <Empty>還沒有訂單。可執行 <span className="code">npm run seed:demo</span> 產生示範資料。</Empty>}
        </div>

        <div className="grid">
          <div className="card">
            <div className="card-h"><h2>最新抵台批次</h2><div className="r"><Link className="btn sm" href="/admin/batches">全部</Link></div></div>
            {latest ? (
              <div className="pad">
                <div className="serif" style={{ fontSize: '1.3rem', fontWeight: 700 }}><Link href={`/admin/batches/${latest.id}`}>{latest.name}</Link></div>
                <div className="small muted">{latest.carrier ?? '—'} · {latest.actual_weight ?? '—'} kg · {latest.status}</div>
                <div className="small" style={{ marginTop: 8 }}>
                  每 kg 分攤 <b>{latest.actual_weight ? ntd(F.batchPerKg(latest.actual_weight, latest.carrier)) : '—'}</b>，
                  共 {orders.filter((o) => o.batch_id === latest.id).length} 件
                </div>
              </div>
            ) : <Empty icon="✈">尚無批次</Empty>}
          </div>
          <div className="card">
            <div className="card-h"><h2>待辦</h2></div>
            <div className="pad" style={{ display: 'grid', gap: 10, fontSize: '.9rem' }}>
              <Link href="/admin/orders?status=待處理">📋 待處理訂單 <b>{byStatus['待處理']}</b> 筆</Link>
              <Link href="/admin/shipments">📦 二補未付出貨單 <b>{unpaidShip.length}</b> 張</Link>
              <Link href="/admin/payments">💳 等待付款連結 <b>{pending.length}</b> 筆</Link>
              {[...arrivedByCustomer].slice(0, 5).map(([cid, n]) => (
                <Link key={cid} href={`/admin/customers/${cid}`}><Who name={cname.get(cid) ?? '?'} /> 已抵台未出貨 {n} 件</Link>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>最近更新：{day(new Date().toISOString())}</p>
    </>
  );
}
