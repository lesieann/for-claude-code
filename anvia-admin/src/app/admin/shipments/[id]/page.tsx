import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAll, orderNo, batchPerKgMap, orderFreight, calcShipment } from '@/lib/data';
import { saveShipment, removeFromShipment, markShipped, createPayment } from '../../actions';
import { Head, Flash, StatusTag, ntd, fmt, day } from '@/components/ui';

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { shipments, orders, batches, customers, payments } = await loadAll();
  const sh = shipments.find((x) => x.id === Number(id));
  if (!sh) notFound();
  const perKg = batchPerKgMap(batches);
  const { orders: mine, calc } = calcShipment(sh, orders, perKg);
  const cust = customers.find((c) => c.id === sh.customer_id);
  const channel = sh.channel ?? '賣貨便';
  const pays = payments.filter((p) => p.kind === 'supplement' && p.ref_id === sh.id);
  const base = process.env.PUBLIC_BASE_URL ?? '';

  // 給客人的明細文字
  const copy = [
    `【予安所託 出貨明細】${sh.order_no}`,
    `${cust?.name ?? ''} 您好，以下商品已抵台準備寄出：`,
    ...mine.map((o, i) => `${i + 1}. ${o.title}（${fmt(o.weight_kg)} kg）`),
    `基礎運費 NT$${calc.baseFreight}`,
    `辛苦費 NT$${calc.labor}`,
    `包裝手續費 NT$15`,
    ...(calc.debtSum ? [`欠款 NT$${calc.debtSum}`] : []),
    `二補合計（${channel}）：NT$${calc.due[channel]}`,
  ].join('\n');

  return (
    <>
      <Head title={`出貨單 ${sh.order_no}`} sub={<>{cust ? <Link href={`/admin/customers/${cust.id}`}>{cust.name}</Link> : '—'} · {day(sh.created_at)} · {sh.paid ? <span className="tag ok">二補已付</span> : <span className="tag warn">二補未付</span>}</>} crumb={{ href: '/admin/shipments', label: '出貨對帳' }}>
        <form action={markShipped}><input type="hidden" name="id" value={sh.id} /><button className="btn">全部標記已寄出</button></form>
      </Head>
      <Flash msg={sp.msg} />

      <div className="split">
        <div className="grid">
          <div className="card">
            <div className="card-h"><h2>商品</h2><span className="r small muted">{mine.length} 件</span></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>編號</th><th>商品</th><th className="num">單價</th><th className="num">重量</th><th className="num">應A運費</th><th className="num">欠款</th><th>狀態</th><th></th></tr></thead>
              <tbody>{mine.map((o) => (
                <tr key={o.id}>
                  <td className="nowrap"><Link href={`/admin/orders/${o.id}`}>{orderNo(o)}</Link></td>
                  <td><span className="title">{o.title}</span></td>
                  <td className="num">{ntd(o.price)}</td>
                  <td className="num">{fmt(o.weight_kg)} kg</td>
                  <td className="num">{o.batch_id ? ntd(orderFreight(o, perKg)) : <span className="tag warn">未入批次</span>}</td>
                  <td className="num">{o.debt ? ntd(o.debt) : '—'}</td>
                  <td><StatusTag s={o.status} /></td>
                  <td><form action={removeFromShipment}><input type="hidden" name="id" value={sh.id} /><input type="hidden" name="order_id" value={o.id} /><button className="btn sm ghost">移出</button></form></td>
                </tr>))}
              </tbody>
            </table></div>
          </div>
          <div className="card">
            <div className="card-h"><h2>複製給客人</h2></div>
            <div className="pad"><textarea readOnly defaultValue={copy} style={{ minHeight: 200, fontFamily: 'inherit' }} /></div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="card-h"><h2>二補計算</h2></div>
            <div className="pad" style={{ display: 'grid', gap: 14 }}>
              <div className="due">
                {(['賣貨便', '好賣+'] as const).map((ch) => (
                  <div key={ch} className={ch === channel ? 'on' : ''}><span>{ch}{ch === channel ? ' · 目前' : ''}</span><b>{ntd(calc.due[ch])}</b><span>最低 {ch === '賣貨便' ? 20 : 25}</span></div>
                ))}
              </div>
              <dl className="kv">
                <dt>物品重量</dt><dd>{fmt(calc.weightKg)} kg</dd>
                <dt>包裹數量</dt><dd>{calc.parcels}{sh.parcel_count ? '（手填）' : '（依商品名稱）'}</dd>
                <dt>基礎運費（Σ應A運費）</dt><dd>{ntd(calc.baseFreight)}</dd>
                <dt>辛苦費（件數＋重量級距）</dt><dd>{ntd(calc.labor)}</dd>
                <dt>包裝手續費</dt><dd>NT$15</dd>
                <dt>欠款</dt><dd>{ntd(calc.debtSum)}</dd>
                <dt className="total">本單利潤（約）</dt><dd className="total">{ntd(calc.profit, 2)}</dd>
              </dl>
            </div>
          </div>
          <form action={saveShipment} className="card">
            <div className="card-h"><h2>設定</h2></div>
            <div className="pad form">
              <input type="hidden" name="id" value={sh.id} />
              <div className="row">
                <label className="field"><span>實際包裹數量</span><input type="number" name="parcel_count" defaultValue={sh.parcel_count ?? ''} placeholder="留空＝依商品名稱計" /></label>
                <label className="field"><span>寄送通路</span><select name="channel" defaultValue={channel}><option>賣貨便</option><option>好賣+</option></select></label>
              </div>
              <div className="checks"><label><input type="checkbox" name="paid" defaultChecked={sh.paid} />二補已付款</label></div>
              <button className="btn primary">儲存並重算</button>
            </div>
          </form>
          <div className="card">
            <div className="card-h"><h2>二補付款連結</h2></div>
            <form action={createPayment} className="pad form">
              <input type="hidden" name="kind" value="supplement" />
              <input type="hidden" name="ref_id" value={sh.id} />
              <input type="hidden" name="base" value={calc.due[channel]} />
              <input type="hidden" name="return" value={`/admin/shipments/${sh.id}`} />
              <div className="row">
                <label className="field"><span>方式</span><select name="method"><option value="ATM">ATM +15</option><option value="CVS">超商代碼 +25</option></select></label>
              </div>
              <button className="btn">產生 {ntd(calc.due[channel])} 付款連結</button>
            </form>
            {pays.length > 0 && <table className="tbl"><tbody>{pays.map((p) => (
              <tr key={p.id}><td><span className="code">{base}/pay/{p.merchant_order_no}</span><div className="small muted">{p.method} · {ntd(p.amount)}</div></td><td><span className={`tag s-${p.status}`}>{p.status === 'paid' ? '已付款' : '待付款'}</span></td></tr>
            ))}</tbody></table>}
          </div>
        </div>
      </div>
    </>
  );
}
