import Link from 'next/link';
import { loadAll, orderNo } from '@/lib/data';
import { createShipment } from '../actions';
import { Head, Flash, Who, ntd, fmt, day, Empty } from '@/components/ui';

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const { shipments, customers, orders } = await loadAll();
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const rows = [...shipments].sort((a, b) => b.id - a.id);
  const ready = orders.filter((o) => o.status === '已抵台' && !o.shipment_id);
  const byCust = new Map<number, typeof ready>();
  for (const o of ready) if (o.customer_id) byCust.set(o.customer_id, [...(byCust.get(o.customer_id) ?? []), o]);

  return (
    <>
      <Head title="出貨對帳" sub="已抵台商品併成出貨單，自動算辛苦費與二補" />
      <Flash msg={sp.msg} />

      <div className="card">
        <div className="card-h"><h2>可出貨（已抵台、尚未併單）</h2><span className="r small muted">{ready.length} 件 · {byCust.size} 位客戶</span></div>
        {byCust.size ? (
          <div className="pad grid g3">
            {[...byCust].map(([cid, list]) => (
              <form key={cid} action={createShipment} className="card" style={{ boxShadow: 'none' }}>
                <input type="hidden" name="return" value="/admin/shipments" />
                <div className="card-h"><Who name={cname.get(cid) ?? '?'} /><span className="r small muted">{list.length} 件 · {fmt(list.reduce((s, o) => s + (o.weight_kg || 0), 0))} kg</span></div>
                <div className="pad" style={{ display: 'grid', gap: 6, fontSize: '.86rem' }}>
                  {list.map((o) => (
                    <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" name="ids" value={o.id} defaultChecked />
                      <span className="title" style={{ maxWidth: 230 }}>{o.title}</span>
                      <span className="muted small" style={{ marginLeft: 'auto' }}>{orderNo(o).slice(-3)}</span>
                    </label>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <select name="channel" defaultValue="賣貨便" style={{ width: 'auto' }}><option>賣貨便</option><option>好賣+</option></select>
                    <button className="btn sm dark">併成出貨單</button>
                  </div>
                </div>
              </form>
            ))}
          </div>
        ) : <Empty icon="📦">目前沒有待併單的已抵台商品</Empty>}
      </div>

      <div className="card">
        <div className="card-h"><h2>出貨單</h2><span className="r small muted">{rows.length} 張</span></div>
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>出貨單</th><th>客戶</th><th className="num">件數</th><th className="num">重量</th><th className="num">基礎運費</th><th className="num">辛苦費</th><th>通路</th><th className="num">總二補</th><th>付款</th><th>建立</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td className="nowrap"><Link href={`/admin/shipments/${s.id}`}><b>{s.order_no}</b></Link></td>
                <td className="nowrap">{cname.get(s.customer_id ?? 0) ?? '—'}</td>
                <td className="num">{orders.filter((o) => o.shipment_id === s.id).length}</td>
                <td className="num">{fmt(s.total_weight)} kg</td>
                <td className="num">{ntd(s.base_freight)}</td>
                <td className="num">{ntd(s.labor_fee)}</td>
                <td>{s.channel}</td>
                <td className="num"><b>{ntd(s.total_due)}</b></td>
                <td>{s.paid ? <span className="tag ok">已付</span> : <span className="tag warn">未付</span>}</td>
                <td className="small nowrap">{day(s.created_at)}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty icon="📦">尚無出貨單</Empty>}
      </div>
    </>
  );
}
