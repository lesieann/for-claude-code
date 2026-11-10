import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAll, customerSummary, orderNo } from '@/lib/data';
import { saveCustomer, deleteCustomer } from '../../actions';
import { Head, Flash, StatusTag, ntd, Empty } from '@/components/ui';

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { customers, orders, shipments } = await loadAll();
  const isNew = id === 'new';
  const c = isNew ? null : customers.find((x) => x.id === Number(id));
  if (!isNew && !c) notFound();
  const mine = c ? orders.filter((o) => o.customer_id === c.id).sort((a, b) => b.id - a.id) : [];
  const ships = c ? shipments.filter((s) => s.customer_id === c.id) : [];
  const s = c ? customerSummary(c, orders) : null;

  return (
    <>
      <Head title={c ? c.name : '新增客戶'} sub={s ? `獲利 ${ntd(s.profit)} / ${s.open} 筆未出貨 / 寄出 ${s.shipped} 筆 / 最後交易 ${s.last ?? '—'}` : undefined} crumb={{ href: '/admin/customers', label: '客戶' }}>
        {c && <Link className="btn primary" href={`/admin/orders/new?customer=${c.id}`}>＋ 幫他新增訂單</Link>}
      </Head>
      <Flash msg={sp.msg} />
      <div className="split">
        <div className="grid">
          {c && (
            <div className="card">
              <div className="card-h"><h2>訂單</h2><span className="r small muted">{mine.length} 筆</span></div>
              {mine.length ? (
                <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>編號</th><th>商品</th><th className="num">單價</th><th>狀態</th></tr></thead>
                  <tbody>{mine.map((o) => (
                    <tr key={o.id}><td className="nowrap"><Link href={`/admin/orders/${o.id}`}>{orderNo(o)}</Link></td><td><span className="title">{o.title}</span></td><td className="num">{ntd(o.price)}</td><td><StatusTag s={o.status} /></td></tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty>尚無訂單</Empty>}
            </div>
          )}
          {ships.length > 0 && (
            <div className="card">
              <div className="card-h"><h2>出貨單</h2></div>
              <table className="tbl"><tbody>{ships.map((x) => (
                <tr key={x.id}><td><Link href={`/admin/shipments/${x.id}`}>{x.order_no}</Link></td><td className="num">{ntd(x.total_due)}</td><td>{x.paid ? <span className="tag ok">二補已付</span> : <span className="tag warn">未付</span>}</td></tr>
              ))}</tbody></table>
            </div>
          )}
        </div>

        <form action={saveCustomer} className="card">
          <div className="card-h"><h2>客戶資料</h2></div>
          <div className="pad form">
            {c && <input type="hidden" name="id" value={c.id} />}
            <label className="field"><span>暱稱 *</span><input name="name" defaultValue={c?.name} required /></label>
            <div className="row">
              <label className="field"><span>真實姓名</span><input name="real_name" defaultValue={c?.real_name ?? ''} /></label>
              <label className="field"><span>手機</span><input name="phone" defaultValue={c?.phone ?? ''} /></label>
            </div>
            <div className="row">
              <label className="field"><span>LINE ID</span><input name="line_id" defaultValue={c?.line_id ?? ''} /></label>
              <label className="field"><span>Email</span><input type="email" name="email" defaultValue={c?.email ?? ''} /></label>
            </div>
            <label className="field"><span>LINE userId</span><input name="line_uid" defaultValue={c?.line_uid ?? ''} placeholder="U 開頭 33 碼" /><small>會員頁用此欄對應客人的全部訂單</small></label>
            <div className="row">
              <label className="field"><span>獲客日期</span><input type="date" name="source_date" defaultValue={c?.source_date ?? ''} /></label>
              <label className="field"><span>地區</span><input name="location" defaultValue={c?.location ?? ''} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary">{c ? '儲存' : '新增客戶'}</button>
              {c && <button className="btn danger" formAction={deleteCustomer} formNoValidate>刪除</button>}
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
