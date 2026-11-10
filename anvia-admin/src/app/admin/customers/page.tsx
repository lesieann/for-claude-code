import Link from 'next/link';
import { loadAll, customerSummary } from '@/lib/data';
import { Head, Flash, Who, ntd, Empty } from '@/components/ui';

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string; f?: string }> }) {
  const sp = await searchParams;
  const { customers, orders } = await loadAll();
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = customers
    .map((c) => ({ c, s: customerSummary(c, orders) }))
    .filter(({ c }) => !q || [c.name, c.real_name, c.phone, c.line_id, c.email].some((v) => (v ?? '').toLowerCase().includes(q)))
    .filter(({ s }) => (sp.f === 'open' ? s.open > 0 : sp.f === 'arrived' ? s.arrived > 0 : true))
    .sort((a, b) => (b.s.last ?? '').localeCompare(a.s.last ?? ''));
  const linked = customers.filter((c) => c.line_uid).length;

  return (
    <>
      <Head title="客戶" sub={`共 ${customers.length} 位 · LINE 已綁定 ${linked} 位`}>
        <Link className="btn primary" href="/admin/customers/new">＋ 新客戶</Link>
      </Head>
      <Flash msg={sp.msg} />
      <div className="card">
        <form className="toolbar" method="get">
          <input type="search" name="q" defaultValue={sp.q} placeholder="搜尋暱稱、姓名、手機、LINE ID…" />
          <div className="seg">
            <Link className={!sp.f ? 'on' : ''} href="/admin/customers">全部</Link>
            <Link className={sp.f === 'open' ? 'on' : ''} href="/admin/customers?f=open">有進行中</Link>
            <Link className={sp.f === 'arrived' ? 'on' : ''} href="/admin/customers?f=arrived">有已抵台</Link>
          </div>
          <button className="btn sm">搜尋</button>
        </form>
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>客戶</th><th>手機</th><th>LINE</th><th className="num">進行中</th><th className="num">已抵台</th><th className="num">已寄出</th><th className="num">累計獲利</th><th>最後交易</th></tr></thead>
            <tbody>{rows.map(({ c, s }) => (
              <tr key={c.id}>
                <td><Link href={`/admin/customers/${c.id}`}><Who name={c.name} /></Link>{c.real_name && <span className="small muted"> · {c.real_name}</span>}</td>
                <td className="nowrap">{c.phone ?? '—'}</td>
                <td>{c.line_uid ? <span className="tag ok">已綁定</span> : <span className="tag">未綁定</span>}</td>
                <td className="num">{s.open || '—'}</td>
                <td className="num">{s.arrived ? <b style={{ color: 'var(--pink-dark)' }}>{s.arrived}</b> : '—'}</td>
                <td className="num">{s.shipped || '—'}</td>
                <td className="num">{ntd(s.profit)}</td>
                <td className="nowrap small">{s.last ?? '—'}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>沒有符合的客戶</Empty>}
      </div>
    </>
  );
}
