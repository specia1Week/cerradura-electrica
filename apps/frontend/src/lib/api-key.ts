import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

export function generateApiKey() {
  const plain = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(plain, 'utf8').digest('hex');
  return { plain, hash };
}
