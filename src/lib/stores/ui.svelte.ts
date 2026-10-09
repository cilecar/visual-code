// Transient UI state: toasts, popups, panels.
import type { PortType } from '../types';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface SearchRequest {
  /** screen position of the popup */
  x: number;
  y: number;
  /** flow position where the block will be created */
  flow: { x: number; y: number };
  /** set when a wire was dropped on empty canvas */
  from?: { nodeId: string; handleId: string; type: 'source' | 'target'; portType: PortType };
}

class UiStore {
  toasts = $state<Toast[]>([]);
  search = $state<SearchRequest | null>(null);
  commandPalette = $state(false);
  dockTab = $state<'output' | 'code' | 'variables' | 'problems'>('output');
  dockHeight = $state(260);
  dockOpen = $state(true);
  sideTab = $state<'blocks' | 'variables' | 'functions'>('blocks');
  /** last pointer position over the canvas (screen coords) */
  pointer = { x: 0, y: 0, overCanvas: false };
  reducedMotion = $state(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  private seq = 0;

  constructor() {
    if (typeof matchMedia !== 'undefined')
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (this.reducedMotion = e.matches));
  }

  toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
    const id = ++this.seq;
    this.toasts = [...this.toasts, { id, text, kind }].slice(-5);
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? ms * 2 : ms);
  }
}

export const ui = new UiStore();
export const toast = (text: string, kind: Toast['kind'] = 'info') => ui.toast(text, kind);
