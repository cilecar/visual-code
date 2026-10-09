<script lang="ts">
  import { editor } from '../stores/editor.svelte';
  import { ui } from '../stores/ui.svelte';
  import { run } from '../runtime/run.svelte';
  import { EXAMPLES } from '../examples';
  import Icon from './Icon.svelte';

  let menu = $state<null | 'file'>(null);

  const statusText: Record<string, string> = {
    idle: 'Готов',
    running: 'Выполняется',
    paused: 'Пауза',
    input: 'Ждёт ввода',
    done: 'Завершено',
    error: 'Ошибка',
    stopped: 'Остановлено'
  };

  function close() {
    menu = null;
  }

  async function openExample(text: string) {
    close();
    if (await editor.confirmDiscard()) editor.openText(text);
  }

  const fileName = (p: string) => p.split('/').pop();
</script>

<svelte:window onclick={(e) => menu && !(e.target as HTMLElement).closest('.menu-wrap') && close()} />

<header class="toolbar glass">
  <div class="brand">
    <div class="logo">
      <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="3" fill="#7c8cff" /><circle cx="19" cy="6" r="3" fill="#f472b6" /><circle cx="19" cy="18" r="3" fill="#4fc3f7" /><path d="M8 12 C 12 12, 12 6, 16 6 M8 12 C 12 12, 12 18, 16 18" stroke="#e6e8ef" stroke-width="1.6" fill="none" /></svg>
    </div>
    <span class="name">Nodus</span>
  </div>

  <div class="menu-wrap">
    <button class="btn ghost" class:active={menu === 'file'} onclick={() => (menu = menu === 'file' ? null : 'file')}>Файл <Icon name="chevron-down" size={12} /></button>
    {#if menu === 'file'}
      <div class="menu glass">
        <button onclick={() => (close(), editor.newFile())}><Icon name="file-plus" /> Новый <span class="kbd">Ctrl+N</span></button>
        <button onclick={() => (close(), editor.open())}><Icon name="folder-open" /> Открыть… <span class="kbd">Ctrl+O</span></button>
        <button onclick={() => (close(), editor.save())}><Icon name="save" /> Сохранить <span class="kbd">Ctrl+S</span></button>
        <button onclick={() => (close(), editor.save(true))}><Icon name="save-all" /> Сохранить как… <span class="kbd">Ctrl+Shift+S</span></button>
        <div class="sep">Недавние</div>
        {#each editor.recent as p (p)}
          <button title={p} onclick={() => (close(), editor.open(p))}><Icon name="history" /> {fileName(p)}</button>
        {:else}
          <div class="none">Пока пусто</div>
        {/each}
        <div class="sep">Примеры</div>
        {#each EXAMPLES as ex (ex.id)}
          <button onclick={() => openExample(ex.text)}><Icon name="book-open" /> {ex.name}</button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="history">
    <button class="btn icon ghost" title="Отменить (Ctrl+Z)" disabled={!editor.canUndo} onclick={() => editor.undo()}><Icon name="undo-2" /></button>
    <button class="btn icon ghost" title="Повторить (Ctrl+Shift+Z)" disabled={!editor.canRedo} onclick={() => editor.redo()}><Icon name="redo-2" /></button>
  </div>

  <div class="doc">
    <span class="doc-name">{editor.doc.name}</span>
    {#if editor.dirty}<span class="dirty" title="Есть несохранённые изменения"></span>{/if}
    {#if editor.filePath}<span class="path mono" title={editor.filePath}>{editor.filePath}</span>{/if}
  </div>

  <div class="run">
    <button class="btn primary" title="Запустить (F5)" disabled={run.live && run.status !== 'paused'} onclick={() => run.start('run')}>
      <Icon name="play" /> {run.status === 'paused' ? 'Продолжить' : 'Run'}
    </button>
    <div class="slow" class:on={run.mode === 'slow'}>
      <button class="btn" title="Медленный запуск" onclick={() => (run.live ? run.setMode(run.mode === 'slow' ? 'run' : 'slow') : run.start('slow'))}>
        <Icon name="snail" /> Slow
      </button>
      <input
        type="range"
        min="0"
        max="2000"
        step="50"
        value={run.delayMs}
        oninput={(e) => run.setDelay(Number(e.currentTarget.value))}
        title="Задержка на шаг"
      />
      <span class="mono ms">{(run.delayMs / 1000).toFixed(2)} с</span>
    </div>
    <button class="btn" title="Шаг (F10)" disabled={run.status === 'input'} onclick={() => run.step()}><Icon name="step-forward" /> Step</button>
    <button class="btn" title="Продолжить (F8)" disabled={run.status !== 'paused'} onclick={() => run.continue()}><Icon name="fast-forward" /></button>
    <button class="btn danger" title="Остановить (Shift+F5)" disabled={!run.live} onclick={() => run.stop()}><Icon name="square" /> Stop</button>
    <span class="status s-{run.status}">
      <span class="led"></span>
      {statusText[run.status]}{#if run.status === 'paused' && run.pauseReason === 'breakpoint'}&nbsp;· breakpoint{/if}
      {#if run.status !== 'idle'}<span class="mono t">{(run.elapsed / 1000).toFixed(1)} с</span>{/if}
    </span>
  </div>

  <div class="right">
    <button class="btn ghost" class:active={editor.snapToGrid} title="Привязка к сетке (G)" onclick={() => (editor.snapToGrid = !editor.snapToGrid)}><Icon name="grid-3x3" /></button>
    <button class="btn ghost cmdk" onclick={() => (ui.commandPalette = true)}><Icon name="command" /> <span class="kbd">Ctrl+K</span></button>
  </div>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    padding: 0 10px;
    border-radius: 14px;
    position: relative;
    z-index: 20;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 4px;
  }
  .logo {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, rgba(124, 140, 255, 0.25), rgba(244, 114, 182, 0.15));
    border: 1px solid var(--border);
  }
  .name {
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    top: 36px;
    left: 0;
    min-width: 280px;
    padding: 6px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    animation: menu 180ms var(--ease);
    background: rgba(20, 24, 34, 0.97);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 9px;
    border: none;
    border-radius: 7px;
    background: none;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu button:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .menu .kbd {
    margin-left: auto;
  }
  .menu .sep {
    padding: 8px 9px 4px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
  }
  .menu .none {
    padding: 4px 9px;
    color: var(--muted);
  }
  .history {
    display: flex;
  }
  .doc {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .doc-name {
    font-weight: 600;
    white-space: nowrap;
  }
  .dirty {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
    flex: none;
  }
  .path {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
  .run {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slow {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 8px;
    border-radius: 8px;
    border: 1px solid transparent;
    transition: border-color var(--dur) var(--ease);
  }
  .slow.on {
    border-color: rgba(124, 140, 255, 0.4);
  }
  .slow input {
    width: 90px;
    accent-color: var(--accent);
  }
  .ms {
    font-size: 11px;
    color: var(--muted);
    width: 44px;
    white-space: nowrap;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .status .t {
    color: var(--muted);
    font-size: 11px;
  }
  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    transition:
      background var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .s-running .led {
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
    animation: blink 700ms ease-in-out infinite alternate;
  }
  .s-paused .led,
  .s-input .led {
    background: var(--warn);
    box-shadow: 0 0 8px var(--warn);
  }
  .s-done .led {
    background: var(--ok);
  }
  .s-error .led {
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger);
  }
  .right {
    display: flex;
    gap: 4px;
  }
  @keyframes menu {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
  }
  @keyframes blink {
    to {
      opacity: 0.4;
    }
  }
  @media (max-width: 1280px) {
    .path,
    .slow .ms {
      display: none;
    }
  }
</style>
