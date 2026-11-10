import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMpgForm, encryptTradeInfo, decryptTradeInfo, parseNotify, tradeSha, newMerchantOrderNo } from '../src/lib/newebpay.ts';

// 測試用假金鑰（32 / 16 字元），非真實商店金鑰
const k = { merchantId: 'MS000000000', hashKey: '12345678901234567890123456789012', hashIV: '1234567890123456', env: 'sandbox' as const };

test('TradeInfo 加解密往返', () => {
  const hex = encryptTradeInfo({ Amt: 515, ItemDesc: '測試商品' }, k);
  assert.equal(decryptTradeInfo(hex, k), 'Amt=515&ItemDesc=%E6%B8%AC%E8%A9%A6%E5%95%86%E5%93%81');
});

test('MPG 表單：ATM 帶 VACC、TradeSha 大寫 64 碼', () => {
  const f = buildMpgForm(k, { merchantOrderNo: 'AV1', amount: 515, itemDesc: 'x', method: 'ATM', notifyUrl: 'https://a/n', returnUrl: 'https://a/r' });
  assert.match(f.fields.TradeSha, /^[0-9A-F]{64}$/);
  assert.match(decryptTradeInfo(f.fields.TradeInfo, k), /VACC=1/);
  assert.equal(f.action, 'https://ccore.newebpay.com/MPG/mpg_gateway');
});

test('Notify 驗章與解析；竄改則拒絕', () => {
  const payload = JSON.stringify({ Status: 'SUCCESS', Message: 'ok', Result: { MerchantOrderNo: 'AV1', Amt: 515, TradeNo: 'T1' } });
  const crypto = require('node:crypto');
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(k.hashKey), Buffer.from(k.hashIV));
  const TradeInfo = c.update(payload, 'utf8', 'hex') + c.final('hex');
  const r = parseNotify({ TradeInfo, TradeSha: tradeSha(TradeInfo, k) }, k);
  assert.equal(r.Result.MerchantOrderNo, 'AV1');
  assert.throws(() => parseNotify({ TradeInfo, TradeSha: 'BAD' }, k));
});

test('藍新訂單編號格式', () => {
  assert.match(newMerchantOrderNo(), /^AV\d{12}[0-9A-F]{4}$/);
});
