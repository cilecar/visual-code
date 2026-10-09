const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function uid(prefix = 'n'): string {
  let s = '';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}
