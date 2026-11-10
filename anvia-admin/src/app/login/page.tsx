import { login } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; next?: string }> }) {
  const sp = await searchParams;
  const configured = !!process.env.ADMIN_PASSWORD;
  return (
    <div className="center">
      <form action={login} className="card login">
        <div className="brand-mark">安</div>
        <h1>予安所託後台</h1>
        <p>ANVIA YUAN · ADMIN</p>
        {!configured && <div className="note" style={{ marginBottom: 14, textAlign: 'left' }}>尚未設定 <span className="code">ADMIN_PASSWORD</span>，請在 .env.local 填入後重新啟動。</div>}
        {sp.err && <div className="note pink" style={{ marginBottom: 14 }}>密碼不正確</div>}
        <input type="hidden" name="next" value={sp.next ?? '/admin'} />
        <label className="field" style={{ textAlign: 'left', marginBottom: 14 }}>
          <span>管理密碼</span>
          <input type="password" name="password" autoFocus required />
        </label>
        <button className="btn primary">登入</button>
      </form>
    </div>
  );
}
