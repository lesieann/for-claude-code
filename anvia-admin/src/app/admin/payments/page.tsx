import Link from 'next/link';
import { loadAll, orderNo } from '@/lib/data';
import { markPaymentPaid } from '../actions';
import { Head, Flash, ntd, day, Empty } from '@/components/ui';

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const { payments, orders, shipments } = await loadAll();
  const rows = [...payments].sort((a, b) => b.id - a.id);
  const base = process.env.PUBLIC_BASE_URL ?? '';
  const paid = payments.filter((p) => p.status === 'paid');
  return (
    <>
      <Head title="付款" sub="藍新 NewebPay 專屬付款連結；付款完成由 NotifyURL 自動回寫" />
      <Flash msg={sp.msg} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card stat hero"><div className="k">已收款</div><div className="v">{ntd(paid.reduce((s, p) => s + p.amount, 0))}</div><div className="d">{paid.length} 筆</div></div>
        <div className="card stat"><div className="k">待付款</div><div className="v">{payments.length - paid.length}<small>筆</small></div><div className="d">{ntd(payments.filter((p) => p.status !== 'paid').reduce((s, p) => s + p.amount, 0))}</div></div>
        <div className="card stat dark"><div className="k">手續費</div><div className="v">ATM +15</div><div className="d">超商代碼 +25（含在金額內）</div></div>
      </div>
      <div className="card">
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>藍新編號</th><th>類型</th><th>對象</th><th>方式</th><th className="num">金額</th><th>狀態</th><th>建立</th><th></th></tr></thead>
            <tbody>{rows.map((p) => {
              const o = p.kind === 'order' ? orders.find((x) => x.id === p.ref_id) : null;
              const s = p.kind === 'supplement' ? shipments.find((x) => x.id === p.ref_id) : null;
              return (
                <tr key={p.id}>
                  <td><a href={`${base}/pay/${p.merchant_order_no}`} target="_blank" rel="noreferrer" className="code">{p.merchant_order_no}</a></td>
                  <td>{p.kind === 'order' ? '訂單' : '二補'}</td>
                  <td className="nowrap">{o ? <Link href={`/admin/orders/${o.id}`}>{orderNo(o)}</Link> : s ? <Link href={`/admin/shipments/${s.id}`}>{s.order_no}</Link> : '—'}</td>
                  <td>{p.method}</td>
                  <td className="num"><b>{ntd(p.amount)}</b></td>
                  <td><span className={`tag s-${p.status}`}>{p.status === 'paid' ? '已付款' : p.status === 'failed' ? '失敗' : '待付款'}</span>{p.trade_no && <div className="small muted">{p.trade_no}</div>}</td>
                  <td className="small nowrap">{day(p.created_at)}{p.paid_at && <div className="muted">付 {day(p.paid_at)}</div>}</td>
                  <td>{p.status !== 'paid' && <form action={markPaymentPaid}><input type="hidden" name="id" value={p.id} /><button className="btn sm">手動標記已付</button></form>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty icon="💳">尚無付款連結。在訂單或出貨單頁產生。</Empty>}
      </div>
    </>
  );
}
