import { store, storeKind } from '@/lib/store';
import { secretStatus } from '@/lib/secrets';
import * as F from '@/lib/formulas';
import { saveSettings } from '../actions';
import { Head, Flash } from '@/components/ui';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const biz = (await store().getSetting<{ mid_rate?: number; admin_line_uid?: string }>('business')) ?? {};
  const secrets = await secretStatus();
  return (
    <>
      <Head title="設定" sub={`資料庫：${storeKind()}`} />
      <Flash msg={sp.msg} />
      <form action={saveSettings} className="split">
        <div className="card">
          <div className="card-h"><h2>金鑰</h2><span className="r small muted">只顯示末 4 碼；環境變數優先</span></div>
          <div className="pad form">
            {secrets.map((s) => (
              <label key={s.key} className="field">
                <span>{s.label} {s.source ? <span className="tag ok">{s.source} ••••{s.tail}</span> : <span className="tag">未設定</span>}</span>
                <input type="password" name={s.key} placeholder={s.source === '環境變數' ? '已由環境變數設定' : '留空＝不變更'} disabled={s.source === '環境變數'} autoComplete="off" />
                {s.source === '後台設定' && <small><label style={{ display: 'inline-flex', gap: 5 }}><input type="checkbox" name={`clear_${s.key}`} />清除</label></small>}
              </label>
            ))}
            <div className="note">藍新 HashKey/HashIV、LINE token 只存在資料庫或部署平台環境變數，不會寫進程式碼或 repo。</div>
          </div>
        </div>
        <div className="grid">
          <div className="card">
            <div className="card-h"><h2>營運參數</h2></div>
            <div className="pad form">
              <label className="field"><span>台銀人民幣中間價</span><input type="number" step="0.0001" name="mid_rate" defaultValue={biz.mid_rate ?? ''} />
                <small>計算匯率＝中間價 × 1.08{biz.mid_rate ? `＝${F.round2(F.exchangeRate(biz.mid_rate))}` : ''}</small></label>
              <label className="field"><span>管理員 LINE userId</span><input name="admin_line_uid" defaultValue={biz.admin_line_uid ?? ''} /><small>用於「傳給自己」測試發送</small></label>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>公式（唯讀）</h2></div>
            <dl className="pad kv small">
              <dt>國際運費基礎</dt><dd>每 kg NT${F.PER_KG}</dd>
              <dt>單位利潤</dt><dd>代購單價 × 6.5%</dd>
              <dt>二補包裝手續費</dt><dd>NT${F.PACKING_FEE}</dd>
              <dt>二補最低</dt><dd>賣貨便 20 / 好賣+ 25</dd>
              <dt>藍新手續費</dt><dd>ATM +15 / 超商 +25</dd>
            </dl>
          </div>
          <button className="btn primary">儲存設定</button>
        </div>
      </form>
    </>
  );
}
