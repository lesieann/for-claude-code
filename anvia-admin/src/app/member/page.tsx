import MemberClient from './MemberClient';
export const metadata = { title: '我的訂單｜予安所託' };
export const dynamic = 'force-dynamic';
export default function MemberPage() {
  const dev = process.env.NODE_ENV !== 'production' && !!process.env.MEMBER_DEV_UID;
  return <MemberClient liffId={process.env.NEXT_PUBLIC_LIFF_ID ?? ''} dev={dev} />;
}
