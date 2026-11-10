import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAll, orderNo, batchPerKgMap, orderFreight } from '@/lib/data';
import * as F from '@/lib/formulas';
import { ORDER_STATUSES } from '@/lib/types';
import { saveBatch, bulkOrders } from '../../actions';
import { Head, Flash, StatusTag, ntd, fmt, Empty } from '@/components/ui';

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { batches, orders, customers } = await loadAll();
  const b = batches.find((x) => x.id === Number(id));
  if (!b) notFound();
  const mine = orders.filter((o) => o.batch_id === b.id);
  const perKg = batchPerKgMap(batches);
  const cname = new Map(customers.map((c) => [c.id, c.name]));
  const c = b.actual_weight ? F.batchCalc(b.actual_weight) : null;
  const goods = mine.reduce((s, o) => s + (o.weight_kg || 0), 0);
  const allocated = mine.reduce((s, o) => s + orderFreight(o, perKg), 0);
  const total = c ? (b.carrier === '台集運' ? c.freightTaiji : c.freightQiao) : 0;
  const ret = `/admin/batches/${b.id}`;

  return (
    <>
      <Head title={b.name} sub={`${b.carrier ?? '—'} · ${b.status}${b.is_latest ? ' · 最新批次' : ''}`} crumb={{ href: '/admin/batches', label: '抵台批次' }} />
      <Flash msg={sp.msg} />
      <div className="grid g4">
        <div className="card stat dark"><div className="k">總運費</div><div className="v">{ntd(total)}</div><div className="d">{b.actual_weight ?? '—'} kg · {b.carrier}</div></div>
        <div className="card stat hero"><div className="k">每 kg 分攤</div><div className="v">{c ? ntd(b.carrier === '台集運' ? c.perKgTaiji : c.perKgQiao) : '—'}</div><div className="d">無條件進位</div></div>
        <div className="card stat"><div className="k">商品件數</div><div className="v">{mine.length}<small>件</small></div><div className="d">商品重量合計 {fmt(goods)} kg</div></div>
        <div className="card stat"><div className="k">已分攤運費</div><div className="v">{ntd(allocated)}</div><div className="d">與總運費差 {ntd(allocated - total)}</div></div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <form className="card">
          <input type="hidden" name="return" value={ret} />
          <div className="card-h"><h2>批次內商品</h2>
            <div className="r">
              <select name="status" defaultValue=""><option value="">改狀態…</option>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <button className="btn sm" formAction={bulkOrders}>套用</button>
            </div>
          </div>
          {mine.length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th className="chk"></th><th>編號</th><th>客戶</th><th>商品</th><th className="num">重量</th><th className="num">應A運費</th><th>狀態</th></tr></thead>
              <tbody>{mine.map((o) => (
                <tr key={o.id}>
                  <td className="chk"><input type="checkbox" name="ids" value={o.id} /></td>
                  <td className="nowrap"><Link href={`/admin/orders/${o.id}`}>{orderNo(o)}</Link></td>
                  <td className="nowrap">{cname.get(o.customer_id ?? 0) ?? '—'}</td>
                  <td><span className="title">{o.title}</span></td>
                  <td className="num">{fmt(o.weight_kg)} kg</td>
                  <td className="num">{ntd(orderFreight(o, perKg))}</td>
                  <td><StatusTag s={o.status} /></td>
                </tr>))}
              </tbody>
            </table></div>
          ) : <Empty icon="✈">還沒有商品。到「訂單」勾選後選「放進批次」。</Empty>}
        </form>

        <form action={saveBatch} className="card">
          <div className="card-h"><h2>批次設定</h2></div>
          <div className="pad form">
            <input type="hidden" name="id" value={b.id} />
            <label className="field"><span>名稱</span><input name="name" defaultValue={b.name} required /></label>
            <div className="row">
              <label className="field"><span>實際重量（kg）</span><input type="number" step="0.01" name="actual_weight" defaultValue={b.actual_weight ?? ''} /></label>
              <label className="field"><span>集運商</span><select name="carrier" defaultValue={b.carrier ?? '巧巧郎'}><option>巧巧郎</option><option>台集運</option></select></label>
            </div>
            <label className="field"><span>狀態</span><select name="status" defaultValue={b.status}><option>進行中</option><option>歸檔</option></select></label>
            <div className="checks"><label><input type="checkbox" name="is_latest" defaultChecked={b.is_latest} />最新批次</label></div>
            <button className="btn primary">儲存</button>
            {c && (
              <dl className="kv small">
                <dt>巧巧郎運費</dt><dd>{ntd(c.freightQiao)}（{ntd(c.perKgQiao)}/kg）</dd>
                <dt>台集運運費</dt><dd>{ntd(c.freightTaiji)}（{ntd(c.perKgTaiji)}/kg）</dd>
              </dl>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
