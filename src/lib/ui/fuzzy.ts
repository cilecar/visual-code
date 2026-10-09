/** Small fuzzy scorer: prefix > word start > substring > subsequence. 0 = no match. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length * 0.01;
  const words = t.split(/[\s._-]+/);
  if (words.some((w) => w.startsWith(q))) return 80;
  const i = t.indexOf(q);
  if (i >= 0) return 60 - i;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, ti);
    if (j < 0) return 0;
    gaps += j - ti;
    ti = j + 1;
  }
  return Math.max(1, 40 - gaps);
}
