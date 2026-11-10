'use client';
import { useEffect, useState } from 'react';
import Script from 'next/script';

type Data = { name: string; orders: { no: string; title: string; platform: string | null; price: number | null; status: string; batch: string | null; date: string | null }[]; payments: { no: string; kind: string; amount: number; method: string; status: string; url: string }[] };
declare global { interface Window { liff?: { init(o: { liffId: string }): Promise<void>; isLoggedIn(): boolean; login(): void; getIDToken(): string | null } } }

const FILTERS = ['全部', '進行中', '已寄出'] as const;

export default function MemberClient({ liffId, dev }: { liffId: string; dev: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [sdk, setSdk] = useState(false);
  const [f, setF] = useState<(typeof FILTERS)[number]>('全部');

  async function load(idToken: string) {
    const r = await fetch('/api/member/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
    const j = await r.json();
    if (!r.ok) setErr(j.error ?? '讀取失敗'); else setData(j);
  }

  useEffect(() => {
    if (dev) { load('dev'); return; }
    if (!sdk || !window.liff) return;
    if (!liffId) { setErr('尚未設定 LIFF ID'); return; }
    window.liff.init({ liffId }).then(() => {
      if (!window.liff!.isLoggedIn()) return window.liff!.login();
      const t = window.liff!.getIDToken();
      if (t) load(t); else setErr('無法取得 LINE 登入資訊');
    }).catch(() => setErr('LINE 初始化失敗'));
  }, [sdk, liffId, dev]);

  const orders = (data?.orders ?? []).filter((o) => f === '全部' ? true : f === '已寄出' ? o.status === '已寄出' : !['已寄出', '取消・退款'].includes(o.status));
  const due = (data?.payments ?? []).filter((p) => p.status !== 'paid');

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 60px' }}>
      {!dev && <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" onLoad={() => setSdk(true)} />}
      <div className="card stat hero" style={{ marginBottom: 16 }}>
        <div className="k">予安所託 · 會員專區</div>
        <div className="v" style={{ fontSize: '1.5rem' }}>{data ? `${data.name} 您好` : '載入中…'}</div>
        <div className="d">{data ? `共 ${data.orders.length} 筆委託` : ''}</div>
      </div>
      {err && <div className="note pink">{err}</div>}
      {data && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-h"><h2>我的付款</h2><span className="r small muted">{due.length} 筆待付</span></div>
            {data.payments.length ? data.payments.map((p) => (
              <div key={p.no} className="pad" style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1 }}><b>{p.kind === 'order' ? '代購訂單' : '二補運費'}</b><div className="small muted">{p.method} · {p.no}</div></div>
                <b>NT${p.amount}</b>
                {p.status === 'paid' ? <span className="tag ok">已付款</span> : <a className="btn sm primary" href={p.url}>去付款</a>}
              </div>
            )) : <div className="pad small muted">目前沒有付款項目</div>}
          </div>
          <div className="card">
            <div className="card-h"><h2>我的訂單</h2><div className="r seg">{FILTERS.map((x) => <a key={x} className={f === x ? 'on' : ''} onClick={() => setF(x)} style={{ cursor: 'pointer' }}>{x}</a>)}</div></div>
            {orders.map((o) => (
              <div key={o.no} className="pad" style={{ borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="small muted">{o.no}</span><span className={`tag s-${o.status}`} style={{ marginLeft: 'auto' }}>{o.status}</span></div>
                <div style={{ fontWeight: 500, margin: '4px 0' }}>{o.title}</div>
                <div className="small muted">{o.platform ?? ''}{o.batch ? ` · 批次 ${o.batch}` : ''}{o.date ? ` · ${o.date}` : ''}</div>
              </div>
            ))}
            {!orders.length && <div className="empty">沒有訂單</div>}
          </div>
        </>
      )}
    </div>
  );
}
