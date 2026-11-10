import Nav from '@/components/Nav';
import { logout } from '../login/actions';
import { store, storeKind } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [orders, payments] = await Promise.all([store().list('orders'), store().list('payments')]);
  const badges = {
    '/admin/orders': orders.filter((o) => o.status === '待處理' || o.status === '未付款').length,
    '/admin/payments': payments.filter((p) => p.status === 'pending').length,
  };
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">安</div>
          <div><b>予安所託</b><small>ADMIN</small></div>
        </div>
        <Nav badges={badges} />
        <div className="side-foot">
          <div>資料庫：{storeKind()}</div>
          <form action={logout}><button>登出 ↗</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
