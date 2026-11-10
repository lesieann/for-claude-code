import Link from 'next/link';
import { loadAll, orderNo, batchPerKgMap, orderFreight } from '@/lib/data';
import { ORDER_STATUSES, PLATFORMS } from '@/lib/types';
import { bulkOrders, createShipment } from '../actions';
import { Head, StatusTag, Flash, ntd, fmt, Empty } from '@/components/ui';

type SP = { status?: string; q?: string; batch?: string; platform?: string; msg?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { customers, orders, batches } = await loadAll();
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const bname = new Map(batches.map((b) => [b.id, b.name]));
  const perKg = batchPerKgMap(batches);
  const q = (sp.q ?? '').trim().toLowerCase();

  const rows = orders
    .filter((o) => (sp.status ? o.status === sp.status : true))
    .filter((o) => (sp.batch ? String(o.batch_id ?? 'none') === sp.batch : true))
    .filter((o) => (sp.platform ? o.platform === sp.platform : true))
    .filter((o) => !q || [o.title, o.note, cname.get(o.customer_id ?? 0), orderNo(o)].some((v) => (v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => b.id - a.id);

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, msg: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return `/admin/orders${s ? '?' + s : ''}`;
  };
  const ret = qs({});
  const sum = rows.reduce((s, o) => s + (o.price || 0), 0);
  const kg = rows.reduce((s, o) => s + (o.weight_kg || 0), 0);

  return (
    <>
      <Head title="訂單" sub={`共 ${orders.length} 筆 · 目前顯示 ${rows.length} 筆`}>
        <Link className="btn primary" href="/admin/orders/new">＋ 新訂單</Link>
      </Head>
      <Flash msg={sp.msg} />

      <div className="card">
        <div className="toolbar">
          <div className="seg">
            <Link className={!sp.status ? 'on' : ''} href={qs({ status: undefined })}>全部<small>{orders.length}</small></Link>
            {ORDER_STATUSES.map((s) => (
              <Link key={s} className={sp.status === s ? 'on' : ''} href={qs({ status: s })}>{s}<small>{orders.filter((o) => o.status === s).length}</small></Link>
            ))}
          </div>
        </div>
        <form className="toolbar" method="get">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <input type="search" name="q" defaultValue={sp.q} placeholder="搜尋商品、客戶、編號、備註…" />
          <select name="batch" defaultValue={sp.batch ?? ''}>
            <option value="">所有批次</option>
            <option value="none">未入批次</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select name="platform" defaultValue={sp.platform ?? ''}>
            <option value="">所有平台</option>
            {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <button className="btn sm">篩選</button>
          {(sp.q || sp.batch || sp.platform) && <Link className="btn sm ghost" href={qs({ q: undefined, batch: undefined, platform: undefined })}>清除</Link>}
        </form>

        <form id="bulk">
          <input type="hidden" name="return" value={ret} />
          <div className="toolbar">
            <span className="small muted">勾選後：</span>
            <select name="status" defaultValue=""><option value="">改狀態…</option>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <select name="batch_id" defaultValue=""><option value="">放進批次…</option><option value="none">移出批次</option>{batches.filter((b) => b.status === '進行中').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <button className="btn sm" formAction={bulkOrders}>套用</button>
            <span className="sep" />
            <select name="channel" defaultValue="賣貨便"><option>賣貨便</option><option>好賣+</option></select>
            <button className="btn sm dark" formAction={createShipment}>併成出貨單</button>
          </div>

          {rows.length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th className="chk"></th><th>編號</th><th>客戶</th><th>商品</th><th>平台</th><th className="num">單價</th><th className="num">重量</th><th className="num">應A運費</th><th>批次</th><th>狀態</th></tr></thead>
              <tbody>{rows.map((o) => (
                <tr key={o.id}>
                  <td className="chk"><input type="checkbox" name="ids" value={o.id} /></td>
                  <td className="nowrap"><Link href={`/admin/orders/${o.id}`}>{orderNo(o)}</Link></td>
                  <td className="nowrap">{o.customer_id ? <Link href={`/admin/customers/${o.customer_id}`}>{cname.get(o.customer_id)}</Link> : '—'}</td>
                  <td><span className="title" title={o.title}>{o.title}</span>{o.debt > 0 && <span className="tag warn">欠 {o.debt}</span>}</td>
                  <td className="nowrap small">{o.platform ?? '—'}</td>
                  <td className="num">{ntd(o.price)}</td>
                  <td className="num">{o.weight_kg ? `${fmt(o.weight_kg)} kg` : '—'}</td>
                  <td className="num">{o.batch_id ? ntd(orderFreight(o, perKg)) : '—'}</td>
                  <td className="nowrap small">{o.batch_id ? bname.get(o.batch_id) : <span className="muted">—</span>}{o.shipment_id ? <> · <Link href={`/admin/shipments/${o.shipment_id}`}>出貨單</Link></> : null}</td>
                  <td><StatusTag s={o.status} /></td>
                </tr>))}
              </tbody>
              <tfoot><tr><td></td><td colSpan={4}>合計 {rows.length} 筆</td><td className="num">{ntd(sum)}</td><td className="num">{fmt(kg)} kg</td><td colSpan={3}></td></tr></tfoot>
            </table></div>
          ) : <Empty>沒有符合條件的訂單</Empty>}
        </form>
      </div>
    </>
  );
}
