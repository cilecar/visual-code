// Snapshot-based undo/redo. Every committed edit pushes a serialized copy of
// the document; identical consecutive snapshots are ignored.
export class History<T> {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;

  constructor(
    initial: T,
    private limit = 200
  ) {
    this.current = JSON.stringify(initial);
  }

  reset(state: T) {
    this.past = [];
    this.future = [];
    this.current = JSON.stringify(state);
  }

  /** Records `state` as a new step. Returns false if nothing changed. */
  commit(state: T): boolean {
    const snap = JSON.stringify(state);
    if (snap === this.current) return false;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = snap;
    this.future = [];
    return true;
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return JSON.parse(prev);
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return JSON.parse(next);
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
