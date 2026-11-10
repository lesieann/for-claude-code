import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAll, orderNo, batchPerKgMap, orderFreight } from '@/lib/data';
import * as F from '@/lib/formulas';
import { ORDER_STATUSES, PLATFORMS } from '@/lib/types';
import { saveOrder, deleteOrder, createPayment } from '../../actions';
import { Head, Flash, StatusTag, ntd, day } from '@/components/ui';

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; customer?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { customers, orders, batches, payments } = await loadAll();
  const isNew = id === 'new';
  const o = isNew ? null : orders.find((x) => x.id === Number(id));
  if (!isNew && !o) notFound();
  const perKg = batchPerKgMap(batches);
  const pays = o ? payments.filter((p) => p.kind === 'order' && p.ref_id === o.id) : [];
  const base = process.env.PUBLIC_BASE_URL ?? '';

  return (
    <>
      <Head title={o ? o.title : '新增訂單'} sub={o ? <>{orderNo(o)} · <StatusTag s={o.status} /></> : '每件代購商品一筆'} crumb={{ href: '/admin/orders', label: '訂單' }} />
      <Flash msg={sp.msg} />
      <div className="split">
        <form action={saveOrder} className="card">
          <div className="card-h"><h2>訂單資料</h2></div>
          <div className="pad form">
            {o && <input type="hidden" name="id" value={o.id} />}
            <div className="row">
              <label className="field"><span>客戶</span>
                <select name="customer_id" defaultValue={o?.customer_id ?? sp.customer ?? ''}>
                  <option value="">—</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="field"><span>狀態</span>
                <select name="status" defaultValue={o?.status ?? '待處理'}>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <label className="field"><span>下單日期</span><input type="date" name="order_date" defaultValue={o?.order_date ?? new Date().toISOString().slice(0, 10)} /></label>
            </div>
            <label className="field"><span>商品名稱 *</span><input name="title" defaultValue={o?.title} required /></label>
            <div className="row">
              <label className="field"><span>平台</span>
                <select name="platform" defaultValue={o?.platform ?? '淘寶'}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
              </label>
              <label className="field"><span>代購單價（NT$）</span><input type="number" step="0.01" name="price" defaultValue={o?.price ?? ''} /></label>
              <label className="field"><span>包裹重量（kg）</span><input type="number" step="0.01" name="weight_kg" defaultValue={o?.weight_kg ?? ''} /></label>
              <label className="field"><span>欠款（二補拉取）</span><input type="number" step="1" name="debt" defaultValue={o?.debt ?? 0} /></label>
            </div>
            <label className="field"><span>賣場連結</span><input type="url" name="url" defaultValue={o?.url ?? ''} /></label>
            <div className="row">
              <label className="field"><span>抵台批次</span>
                <select name="batch_id" defaultValue={o?.batch_id ?? ''}><option value="">未入批次</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
            </div>
            <div className="checks">
              <label><input type="checkbox" name="purchased" defaultChecked={o?.purchased} />已下單</label>
              <label><input type="checkbox" name="stocked" defaultChecked={o?.stocked} />已入倉</label>
              <label><input type="checkbox" name="arrived" defaultChecked={o?.arrived} />已抵台</label>
              <label><input type="checkbox" name="shipped" defaultChecked={o?.shipped} />已寄出</label>
            </div>
            <label className="field"><span>備註</span><textarea name="note" defaultValue={o?.note ?? ''} style={{ fontFamily: 'inherit', minHeight: 70 }} /></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary">{o ? '儲存' : '新增訂單'}</button>
              {o && <button className="btn danger" formAction={deleteOrder} formNoValidate>刪除</button>}
            </div>
          </div>
        </form>

        {o && (
          <div className="grid">
            <div className="card">
              <div className="card-h"><h2>計算</h2></div>
              <dl className="pad kv">
                <dt>代購單價</dt><dd>{ntd(o.price)}</dd>
                <dt>單位利潤（6.5%）</dt><dd>{ntd(F.unitProfit(o.price || 0), 2)}</dd>
                <dt>批次每 kg 分攤</dt><dd>{o.batch_id ? ntd(perKg.get(o.batch_id)) : '—'}</dd>
                <dt>應A運費</dt><dd>{o.batch_id ? ntd(orderFreight(o, perKg)) : '未入批次'}</dd>
                <dt>欠款拉取</dt><dd>{ntd(F.debtPull(o.debt))}</dd>
              </dl>
            </div>
            <div className="card">
              <div className="card-h"><h2>藍新付款連結</h2></div>
              <form action={createPayment} className="pad form">
                <input type="hidden" name="kind" value="order" />
                <input type="hidden" name="ref_id" value={o.id} />
                <input type="hidden" name="return" value={`/admin/orders/${o.id}`} />
                <div className="row">
                  <label className="field"><span>金額（未含手續費）</span><input type="number" name="base" defaultValue={o.price ?? ''} required /></label>
                  <label className="field"><span>方式</span><select name="method"><option value="ATM">ATM +15</option><option value="CVS">超商代碼 +25</option></select></label>
                </div>
                <button className="btn">產生付款連結</button>
              </form>
              {pays.length > 0 && (
                <table className="tbl"><tbody>{pays.map((p) => (
                  <tr key={p.id}><td><span className="code">{base}/pay/{p.merchant_order_no}</span><div className="small muted">{p.method} · {ntd(p.amount)} · {day(p.created_at)}</div></td><td><span className={`tag s-${p.status}`}>{p.status === 'paid' ? '已付款' : '待付款'}</span></td></tr>
                ))}</tbody></table>
              )}
            </div>
            {o.url && <a className="btn" href={o.url} target="_blank" rel="noreferrer">開啟賣場 ↗</a>}
            {o.shipment_id && <Link className="btn" href={`/admin/shipments/${o.shipment_id}`}>查看出貨單</Link>}
          </div>
        )}
      </div>
    </>
  );
}
