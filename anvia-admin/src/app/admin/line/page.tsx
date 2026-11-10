import { loadAll } from '@/lib/data';
import { store } from '@/lib/store';
import { getSecret } from '@/lib/secrets';
import { sendLine } from '../actions';
import { Head, Flash } from '@/components/ui';

const SAMPLE = JSON.stringify({
  type: 'flex', altText: '予安所託通知',
  contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
    { type: 'text', text: '{{name}} 您好', weight: 'bold', size: 'lg', color: '#c23f5d' },
    { type: 'text', text: '您的商品已抵台，請留意二補通知 ✦', wrap: true, margin: 'md' },
  ] } },
}, null, 2);

export default async function LinePage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const { customers } = await loadAll();
  const linked = customers.filter((c) => c.line_uid);
  const token = await getSecret('LINE_CHANNEL_ACCESS_TOKEN');
  const biz = await store().getSetting<{ admin_line_uid?: string }>('business');
  return (
    <>
      <Head title="LINE 訊息中心" sub="推播文字或 Flex 訊息給單一客戶；{{name}} 會換成客戶暱稱" />
      <Flash msg={sp.msg} />
      {!token && <div className="note" style={{ marginBottom: 16 }}>尚未設定 LINE Channel Access Token，請到「設定」頁填入後才能傳送。</div>}
      <div className="split">
        <form action={sendLine} className="card">
          <div className="card-h"><h2>傳送訊息</h2></div>
          <div className="pad form">
            <label className="field"><span>收件人</span>
              <select name="target" defaultValue="">
                <option value="" disabled>選擇客戶…</option>
                {biz?.admin_line_uid && <option value="me">🧪 測試：傳給自己（管理員）</option>}
                {linked.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <small>只列出已綁定 LINE userId 的客戶（{linked.length} 位）</small>
            </label>
            <label className="field"><span>純文字</span><textarea name="text" placeholder="{{name}} 您好～" style={{ fontFamily: 'inherit' }} /></label>
            <details className="more"><summary>改用 Flex / 進階 JSON（填了會取代純文字）</summary>
              <label className="field" style={{ marginTop: 10 }}><span>Messaging API message JSON（單則物件或陣列）</span><textarea name="json" placeholder={SAMPLE} style={{ minHeight: 240 }} /></label>
            </details>
            <button className="btn primary">傳送</button>
          </div>
        </form>
        <div className="grid">
          <div className="card">
            <div className="card-h"><h2>範例 Flex</h2></div>
            <div className="pad"><textarea readOnly defaultValue={SAMPLE} style={{ minHeight: 260 }} /></div>
          </div>
          <div className="note pink">8 種訊息編輯器、圖文選單、歡迎流程（LINE 工具 A 期）會接在這一頁擴充，見 docs/line-boost-phase-a-spec.md。</div>
        </div>
      </div>
    </>
  );
}
