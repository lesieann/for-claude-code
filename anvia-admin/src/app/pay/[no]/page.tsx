import { notFound } from 'next/navigation';
import { store } from '@/lib/store';
import { buildMpgForm } from '@/lib/newebpay';
import { newebKeys } from '@/lib/neweb-keys';

export const dynamic = 'force-dynamic';

// 客人看到的專屬付款頁：顯示金額，按下後送往藍新
export default async function PayPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const p = (await store().list('payments')).find((x) => x.merchant_order_no === no);
  if (!p) notFound();
  const keys = await newebKeys();
  const base = process.env.PUBLIC_BASE_URL ?? '';
  const form = keys && p.status !== 'paid'
    ? buildMpgForm(keys, {
        merchantOrderNo: p.merchant_order_no, amount: p.amount, method: (p.method as 'ATM' | 'CVS') ?? 'ATM',
        itemDesc: p.kind === 'order' ? '予安所託 代購訂單' : '予安所託 二補運費',
        notifyUrl: `${base}/api/newebpay/notify`, returnUrl: `${base}/pay/${p.merchant_order_no}`,
      })
    : null;
  return (
    <div className="center">
      <div className="card login">
        <div className="brand-mark">安</div>
        <h1>予安所託</h1>
        <p>{p.kind === 'order' ? '代購訂單付款' : '二補運費付款'} · {p.merchant_order_no}</p>
        <div className="stat dark card" style={{ marginBottom: 18 }}>
          <div className="k">應付金額（已含{p.method === 'CVS' ? '超商代碼 +25' : 'ATM +15'} 手續費）</div>
          <div className="v">NT${p.amount.toLocaleString()}</div>
        </div>
        {p.status === 'paid' ? (
          <div className="note pink">✓ 已完成付款，謝謝您！</div>
        ) : form ? (
          <form method="post" action={form.action}>
            {Object.entries(form.fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <button className="btn primary">前往藍新付款（{p.method === 'CVS' ? '超商代碼' : 'ATM 轉帳'}）</button>
          </form>
        ) : (
          <div className="note">付款功能尚未設定，請聯繫小安。</div>
        )}
      </div>
    </div>
  );
}
