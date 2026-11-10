import Link from 'next/link';
import { loadAll } from '@/lib/data';
import * as F from '@/lib/formulas';
import { saveBatch } from '../actions';
import { Head, Flash, ntd, fmt, Empty } from '@/components/ui';

export default async function BatchesPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const { batches, orders } = await loadAll();
  const rows = [...batches].sort((a, b) => b.id - a.id);
  return (
    <>
      <Head title="抵台批次" sub="集運包：實際重量 × NT$73 計算運費，依重量分攤到每件商品" />
      <Flash msg={sp.msg} />
      <div className="split">
        <div className="card">
          {rows.length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>批次</th><th>集運</th><th className="num">實際重量</th><th className="num">總運費</th><th className="num">每 kg 分攤</th><th className="num">件數</th><th className="num">商品重量</th><th>狀態</th></tr></thead>
              <tbody>{rows.map((b) => {
                const mine = orders.filter((o) => o.batch_id === b.id);
                const c = b.actual_weight ? F.batchCalc(b.actual_weight) : null;
                const goods = mine.reduce((s, o) => s + (o.weight_kg || 0), 0);
                return (
                  <tr key={b.id}>
                    <td><Link href={`/admin/batches/${b.id}`}><b>{b.name}</b></Link>{b.is_latest && <span className="tag s-已抵台" style={{ marginLeft: 6 }}>最新</span>}</td>
                    <td>{b.carrier ?? '—'}</td>
                    <td className="num">{b.actual_weight ? `${fmt(b.actual_weight)} kg` : '—'}</td>
                    <td className="num">{c ? ntd(b.carrier === '台集運' ? c.freightTaiji : c.freightQiao) : '—'}</td>
                    <td className="num">{c ? ntd(b.carrier === '台集運' ? c.perKgTaiji : c.perKgQiao) : '—'}</td>
                    <td className="num">{mine.length}</td>
                    <td className="num">{fmt(goods)} kg</td>
                    <td><span className={`tag ${b.status === '進行中' ? 'warn' : ''}`}>{b.status}</span></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <Empty icon="✈">尚無批次</Empty>}
        </div>
        <form action={saveBatch} className="card">
          <div className="card-h"><h2>新增批次</h2></div>
          <div className="pad form">
            <label className="field"><span>批次名稱 *</span><input name="name" placeholder="例：20261110" required /></label>
            <div className="row">
              <label className="field"><span>實際重量（kg）</span><input type="number" step="0.01" name="actual_weight" /></label>
              <label className="field"><span>集運商</span><select name="carrier"><option>巧巧郎</option><option>台集運</option></select></label>
            </div>
            <input type="hidden" name="status" value="進行中" />
            <div className="checks"><label><input type="checkbox" name="is_latest" defaultChecked />設為最新批次</label></div>
            <button className="btn primary">新增</button>
            <p className="small muted">巧巧郎：整 kg 進位 × 73；台集運：0.5 kg 進位 × 73。每 kg 分攤＝總運費 ÷ 實際重量，無條件進位。</p>
          </div>
        </form>
      </div>
    </>
  );
}
