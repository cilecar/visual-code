// Example graphs bundled with the app (from /examples).
const files = import.meta.glob<string>('../../examples/*.blk', { query: '?raw', import: 'default', eager: true });

const ORDER = ['hello-world', 'fizzbuzz', 'guess-the-number', 'expense-tracker'];

export const EXAMPLES = Object.entries(files)
  .map(([path, text]) => {
    const id = path.split('/').pop()!.replace(/\.blk$/, '');
    let name = id;
    try {
      name = JSON.parse(text).name ?? id;
    } catch {
      /* keep id */
    }
    return { id, name, text };
  })
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
