import Link from 'next/link';
import type { OrderStatus } from '@/lib/types';

export const ntd = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : 'NT$' + Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const fmt = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d });
export const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');

export function StatusTag({ s }: { s: OrderStatus | string }) {
  return <span className={`tag s-${s}`}>{s}</span>;
}

export function Head({ title, sub, crumb, children }: { title: string; sub?: React.ReactNode; crumb?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <div className="head">
      <div>
        {crumb && <div className="crumb"><Link href={crumb.href}>← {crumb.label}</Link></div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Flash({ msg }: { msg?: string }) {
  return msg ? <div className="flash">{msg}</div> : null;
}

export function Who({ name }: { name: string }) {
  return <span className="who"><span className="avatar">{name.slice(0, 1)}</span>{name}</span>;
}

export function Empty({ icon = '🌸', children }: { icon?: string; children: React.ReactNode }) {
  return <div className="empty"><b>{icon}</b>{children}</div>;
}
