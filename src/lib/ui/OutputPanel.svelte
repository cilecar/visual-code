<script lang="ts">
  import { tick } from 'svelte';
  import { run } from '../runtime/run.svelte';
  import Icon from './Icon.svelte';

  let box: HTMLDivElement;
  let inputEl: HTMLInputElement | undefined = $state();
  let text = $state('');
  let stick = true;

  $effect(() => {
    void run.output;
    if (stick) tick().then(() => box && (box.scrollTop = box.scrollHeight));
  });

  $effect(() => {
    if (run.status === 'input') tick().then(() => inputEl?.focus());
  });

  function onScroll() {
    stick = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  }

  function submit(e: Event) {
    e.preventDefault();
    void run.sendInput(text);
    text = '';
  }
</script>

<div class="output">
  <div class="log mono" bind:this={box} onscroll={onScroll}>
    {#each run.output as chunk, i (i)}<span class={chunk.kind}>{chunk.text}</span>{/each}
    {#if !run.output.length}
      <div class="placeholder">Вывод программы появится здесь. Запуск — <span class="kbd">F5</span>, по шагам — <span class="kbd">F10</span>.</div>
    {/if}
  </div>
  {#if run.status === 'input'}
    <form class="input-row" onsubmit={submit}>
      <Icon name="chevron-right" size={14} />
      <input bind:this={inputEl} bind:value={text} class="field mono" placeholder={run.inputPrompt || 'Введите значение и нажмите Enter'} spellcheck="false" />
      <button class="btn primary" type="submit">Отправить</button>
    </form>
  {/if}
</div>

<style>
  .output {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .log {
    flex: 1;
    overflow: auto;
    padding: 10px 14px;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }
  .out {
    color: #e6e8ef;
  }
  .err {
    color: #ff8a96;
  }
  .sys {
    display: block;
    color: var(--muted);
    font-style: italic;
  }
  .placeholder {
    color: var(--muted);
    font-family: var(--font);
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    color: var(--accent);
    animation: slide 200ms var(--ease);
  }
  .input-row .field {
    flex: 1;
    height: 30px;
    border-color: rgba(124, 140, 255, 0.45);
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
