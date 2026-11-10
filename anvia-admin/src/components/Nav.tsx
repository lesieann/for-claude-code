'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const groups = [
  { label: '營運', items: [
    { href: '/admin', ico: '◎', label: '總覽' },
    { href: '/admin/orders', ico: '▤', label: '訂單' },
    { href: '/admin/customers', ico: '☺', label: '客戶' },
    { href: '/admin/batches', ico: '✈', label: '抵台批次' },
    { href: '/admin/shipments', ico: '⇪', label: '出貨對帳' },
    { href: '/admin/payments', ico: '¤', label: '付款' },
  ] },
  { label: 'LINE', items: [{ href: '/admin/line', ico: '✉', label: '訊息中心' }] },
  { label: '系統', items: [{ href: '/admin/settings', ico: '⚙', label: '設定' }] },
];

export default function Nav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="nav">
          <div className="nav-label">{g.label}</div>
          {g.items.map((i) => {
            const on = i.href === '/admin' ? path === '/admin' : path.startsWith(i.href);
            return (
              <Link key={i.href} href={i.href} className={on ? 'on' : ''}>
                <span className="ico">{i.ico}</span>{i.label}
                {badges[i.href] ? <span className="badge">{badges[i.href]}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
