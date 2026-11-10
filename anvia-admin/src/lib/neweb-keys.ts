import 'server-only';
import { getSecret } from './secrets';
import type { NewebKeys } from './newebpay';

export async function newebKeys(): Promise<NewebKeys | null> {
  const [merchantId, hashKey, hashIV] = await Promise.all([getSecret('NEWEBPAY_MERCHANT_ID'), getSecret('NEWEBPAY_HASH_KEY'), getSecret('NEWEBPAY_HASH_IV')]);
  if (!merchantId || !hashKey || !hashIV) return null;
  return { merchantId, hashKey, hashIV, env: process.env.NEWEBPAY_ENV === 'production' ? 'production' : 'sandbox' };
}
