<script lang="ts">
  import type { BlockData, CommentData, CustomPort, DataType, GNode } from '../types';
  import { DATA_TYPES, isBlockNode, isCommentNode } from '../types';
  import { categoryColor, getBlock, PORT_COLORS } from '../blocks/registry';
  import { nodeTitle, resolvePorts } from '../blocks/ports';
  import { editor } from '../stores/editor.svelte';
  import { run } from '../runtime/run.svelte';
  import { toggleBreakpoint } from '../commands';
  import { pyIdent } from '../codegen/python';
  import Icon from './Icon.svelte';
  import InlineValue from './InlineValue.svelte';

  let sel = $derived(editor.selectedNodes);
  let node = $derived(sel.length === 1 ? sel[0] : null);
  let block = $derived(node && isBlockNode(node) ? (node as GNode<BlockData>) : null);
  let def = $derived(block ? (editor.blocksVersion, getBlock(block.data.block)) : undefined);
  let ports = $derived(block ? resolvePorts(block, editor.portCtx) : null);
  let problems = $derived(node ? (editor.validation?.byNode.get(node.id) ?? []) : []);
  let lines = $derived(node ? (editor.validation?.result.sourceMap.nodeLines[node.id] ?? []) : []);
  let conns = $derived(node ? editor.connected.get(node.id) : undefined);
  let fn = $derived(editor.currentFn);

  function setPyPorts(kind: 'pyInputs' | 'pyOutputs', list: CustomPort[]) {
    if (!block) return;
    editor.updateNodeData(block.id, { [kind]: list } as Partial<BlockData>, true);
    editor.pruneInvalidEdges();
  }

  function addPyPort(kind: 'pyInputs' | 'pyOutputs') {
    if (!block) return;
    const list = [...((block.data[kind] as CustomPort[]) ?? [])];
    const taken = [...(block.data.pyInputs ?? []), ...(block.data.pyOutputs ?? [])].map((p) => p.name);
    let name = kind === 'pyInputs' ? 'x' : 'out';
    for (let i = 2; taken.includes(name); i++) name = `${kind === 'pyInputs' ? 'x' : 'out'}${i}`;
    list.push({ name, type: 'any' });
    setPyPorts(kind, list);
  }

  function editPyPort(kind: 'pyInputs' | 'pyOutputs', i: number, patch: Partial<CustomPort> | null) {
    if (!block) return;
    const list = [...((block.data[kind] as CustomPort[]) ?? [])];
    const old = list[i];
    if (patch === null) list.splice(i, 1);
    else list[i] = { ...old, ...patch, name: patch.name !== undefined ? pyIdent(patch.name, 'x') : old.name };
    // keep wires attached on rename
    if (patch?.name !== undefined && list[i].name !== old.name) {
      const prefix = kind === 'pyInputs' ? 'in:' : 'out:';
      const side = kind === 'pyInputs' ? 'target' : 'source';
      const key = kind === 'pyInputs' ? 'targetHandle' : 'sourceHandle';
      editor.edges = editor.edges.map((e) => (e[side] === block!.id && e[key] === prefix + old.name ? { ...e, [key]: prefix + list[i].name } : e));
    }
    setPyPorts(kind, list);
  }
</script>

<aside class="inspector glass">
  {#if block && def}
    <header style="--cat:{categoryColor(def.category)}">
      <span class="ico"><Icon name={def.icon} size={16} /></span>
      <div class="ttl">
        <strong>{nodeTitle(block, editor.portCtx)}</strong>
        <span class="mono sub">{def.id}</span>
      </div>
      {#if def.kind !== 'pure'}
        <button class="btn icon ghost" class:bp-on={block.data.breakpoint} title="Точка останова (F9)" onclick={() => toggleBreakpoint(block!.id)}>
          <span class="bp"></span>
        </button>
      {/if}
    </header>

    <div class="scroll">
      {#if def.description}<p class="desc">{def.description}</p>{/if}

      {#if problems.length}
        <div class="problems">
          {#each problems as p, i (i)}
            <div class="problem {p.severity}"><Icon name={p.severity === 'error' ? 'circle-alert' : 'triangle-alert'} size={13} /> {p.msg}</div>
          {/each}
        </div>
      {/if}

      {#if def.params.length}
        <h4>Параметры</h4>
        {#each def.params as p (p.id)}
          <label class="prop">
            <span>{p.label ?? p.id}</span>
            {#if p.type === 'code'}
              <textarea
                class="field code"
                rows="8"
                spellcheck="false"
                value={String(block.data.params?.[p.id] ?? p.default ?? '')}
                oninput={(e) => editor.setParam(block!.id, p.id, e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const t = e.currentTarget;
                    const s = t.selectionStart;
                    t.setRangeText('    ', s, t.selectionEnd, 'end');
                    editor.setParam(block!.id, p.id, t.value);
                  }
                }}
              ></textarea>
            {:else if p.type === 'var'}
              <select class="field" value={String(block.data.params?.var ?? '')} onchange={(e) => editor.setParam(block!.id, 'var', e.currentTarget.value, true)}>
                <option value="" disabled>— выберите —</option>
                {#each editor.doc.variables as v (v.name)}<option value={v.name}>{v.name}: {v.type}</option>{/each}
              </select>
            {:else if p.type === 'string' && def.dynamic === 'function'}
              <select class="field" value={String(block.data.params?.fn ?? '')} onchange={(e) => editor.setParam(block!.id, 'fn', e.currentTarget.value, true)}>
                {#each editor.doc.functions as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
              </select>
            {:else}
              <InlineValue
                type={p.type}
                options={p.options}
                value={block.data.params?.[p.id] ?? p.default}
                onchange={(v) => editor.setParam(block!.id, p.id, v, p.type === 'select')}
              />
            {/if}
          </label>
        {/each}
      {/if}

      {#if def.dynamic === 'python'}
        {#each [['pyInputs', 'Входы'], ['pyOutputs', 'Выходы']] as [kind, label] (kind)}
          <h4>
            {label}
            <button class="btn icon ghost" onclick={() => addPyPort(kind as 'pyInputs')}><Icon name="plus" size={13} /></button>
          </h4>
          {#each (block.data[kind] as CustomPort[]) ?? [] as port, i (i)}
            <div class="portrow" style="--pc:{PORT_COLORS[port.type]}">
              <span class="dot"></span>
              <input class="field mono" value={port.name} onchange={(e) => editPyPort(kind as 'pyInputs', i, { name: e.currentTarget.value })} />
              <select class="field" value={port.type} onchange={(e) => editPyPort(kind as 'pyInputs', i, { type: e.currentTarget.value as DataType })}>
                {#each DATA_TYPES as t (t)}<option value={t}>{t}</option>{/each}
              </select>
              <button class="btn icon ghost" onclick={() => editPyPort(kind as 'pyInputs', i, null)}><Icon name="x" size={13} /></button>
            </div>
          {/each}
        {/each}
        <p class="hint">Входы доступны в коде как переменные, выходы — присвойте им значения.</p>
      {/if}

      {#if ports && ports.inputs.some((p) => p.type !== 'exec')}
        <h4>Входы</h4>
        {#each ports.inputs.filter((p) => p.type !== 'exec') as p (p.id)}
          <div class="prop">
            <span class="plabel" style="--pc:{PORT_COLORS[p.type]}"><span class="dot"></span>{p.label} <em>{p.type}</em></span>
            {#if conns?.has(`in:${p.id}`)}
              <span class="linked"><Icon name="link" size={12} /> подключён</span>
            {:else if p.required}
              <span class="need">требует подключения</span>
            {:else}
              <InlineValue type={p.type} value={block.data.inputs?.[p.id] ?? p.default} onchange={(v) => editor.setInput(block!.id, p.id, v)} />
            {/if}
          </div>
        {/each}
      {/if}

      {#if def.dynamic === 'function' && block.data.params?.fn}
        <button class="btn wide" onclick={() => editor.switchGraph(String(block!.data.params.fn))}><Icon name="external-link" /> Открыть функцию</button>
      {/if}

      <h4>Заметка</h4>
      <textarea
        class="field"
        rows="2"
        placeholder="Комментарий к блоку…"
        value={block.data.comment ?? ''}
        oninput={(e) => editor.updateNodeData(block!.id, { comment: e.currentTarget.value })}
      ></textarea>

      {#if lines.length}
        <p class="hint">Строки кода: <span class="mono">{lines.length > 1 ? `${lines[0]}–${lines.at(-1)}` : lines[0]}</span></p>
      {/if}
      {#if run.error?.nodeId === block.id}
        <pre class="tb mono">{run.error.traceback || run.error.msg}</pre>
      {/if}
    </div>
  {:else if node && isCommentNode(node)}
    <header><span class="ico"><Icon name="frame" size={16} /></span><div class="ttl"><strong>Комментарий-фрейм</strong></div></header>
    <div class="scroll">
      <label class="prop col">
        <span>Заголовок</span>
        <input class="field" value={(node.data as CommentData).title} oninput={(e) => editor.updateNodeData(node!.id, { title: e.currentTarget.value })} />
      </label>
      <p class="hint">Перетаскивание фрейма двигает блоки внутри него. Двойной клик по заголовку — переименовать.</p>
    </div>
  {:else if sel.length > 1}
    <header><span class="ico"><Icon name="boxes" size={16} /></span><div class="ttl"><strong>Выделено: {sel.length}</strong></div></header>
    <div class="scroll">
      <h4>Выравнивание</h4>
      <div class="grid">
        <button class="btn" title="По левому краю" onclick={() => editor.alignSelection('left')}><Icon name="align-start-vertical" /></button>
        <button class="btn" title="По центру" onclick={() => editor.alignSelection('hcenter')}><Icon name="align-center-vertical" /></button>
        <button class="btn" title="По правому краю" onclick={() => editor.alignSelection('right')}><Icon name="align-end-vertical" /></button>
        <button class="btn" title="По верху" onclick={() => editor.alignSelection('top')}><Icon name="align-start-horizontal" /></button>
        <button class="btn" title="По середине" onclick={() => editor.alignSelection('vcenter')}><Icon name="align-center-horizontal" /></button>
        <button class="btn" title="По низу" onclick={() => editor.alignSelection('bottom')}><Icon name="align-end-horizontal" /></button>
      </div>
      <h4>Распределение</h4>
      <div class="grid two">
        <button class="btn" disabled={sel.length < 3} onclick={() => editor.distributeSelection('x')}><Icon name="align-horizontal-distribute-center" /> По горизонтали</button>
        <button class="btn" disabled={sel.length < 3} onclick={() => editor.distributeSelection('y')}><Icon name="align-vertical-distribute-center" /> По вертикали</button>
      </div>
      <h4>Действия</h4>
      <div class="col-btns">
        <button class="btn" onclick={() => editor.collapseSelection()}><Icon name="package" /> Свернуть в функцию <span class="kbd">Ctrl+G</span></button>
        <button class="btn" onclick={() => editor.addComment()}><Icon name="frame" /> Обвести фреймом <span class="kbd">C</span></button>
        <button class="btn" onclick={() => editor.duplicate()}><Icon name="copy" /> Дублировать <span class="kbd">Ctrl+D</span></button>
        <button class="btn danger" onclick={() => editor.deleteSelection()}><Icon name="trash-2" /> Удалить <span class="kbd">Del</span></button>
      </div>
    </div>
  {:else if fn}
    <header style="--cat:#8e4ec6"><span class="ico"><Icon name="square-function" size={16} /></span><div class="ttl"><strong>Функция</strong><span class="mono sub">{fn.name}</span></div></header>
    <div class="scroll">
      <label class="prop col">
        <span>Имя</span>
        <input class="field mono" value={fn.name} onchange={(e) => editor.renameFunction(fn!.id, e.currentTarget.value)} />
      </label>
      {#each [['inputs', 'Параметры'], ['outputs', 'Возвращаемые значения']] as [dir, label] (dir)}
        <h4>
          {label}
          <button class="btn icon ghost" onclick={() => editor.editFnPort(fn!.id, dir as 'inputs', 0, 'add')}><Icon name="plus" size={13} /></button>
        </h4>
        {#each fn[dir as 'inputs'] as port, i (port.name)}
          <div class="portrow" style="--pc:{PORT_COLORS[port.type]}">
            <span class="dot"></span>
            <input class="field mono" value={port.name} onchange={(e) => editor.editFnPort(fn!.id, dir as 'inputs', i, { name: e.currentTarget.value })} />
            <select class="field" value={port.type} onchange={(e) => editor.editFnPort(fn!.id, dir as 'inputs', i, { type: e.currentTarget.value as DataType })}>
              {#each DATA_TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </select>
            <button class="btn icon ghost" onclick={() => editor.editFnPort(fn!.id, dir as 'inputs', i, 'delete')}><Icon name="x" size={13} /></button>
          </div>
        {/each}
      {/each}
      <p class="hint">Блок «Inputs» — вход функции, «Return» — выход. Изменения портов применяются ко всем вызовам.</p>
    </div>
  {:else}
    <header><span class="ico"><Icon name="file-code-2" size={16} /></span><div class="ttl"><strong>{editor.doc.name}</strong><span class="sub">Документ</span></div></header>
    <div class="scroll">
      <label class="prop col">
        <span>Название</span>
        <input class="field" value={editor.doc.name} onchange={(e) => ((editor.doc.name = e.currentTarget.value), editor.commit())} />
      </label>
      <label class="prop col">
        <span>Описание</span>
        <textarea class="field" rows="3" value={editor.doc.description ?? ''} oninput={(e) => ((editor.doc.description = e.currentTarget.value), editor.commitSoon())}></textarea>
      </label>
      <div class="stats">
        <div><strong>{editor.nodes.filter((n) => n.type === 'block').length}</strong><span>блоков</span></div>
        <div><strong>{editor.edges.length}</strong><span>связей</span></div>
        <div><strong>{editor.doc.variables.length}</strong><span>переменных</span></div>
        <div><strong>{editor.doc.functions.length}</strong><span>функций</span></div>
      </div>
      <h4>Подсказки</h4>
      <ul class="tips">
        <li><span class="kbd">Space</span> или ПКМ — добавить блок</li>
        <li>Отпустите провод в пустоте — блок подключится сам</li>
        <li>Двойной клик по проводу — reroute-точка</li>
        <li><span class="kbd">Alt</span>+клик или <span class="kbd">F9</span> — точка останова</li>
        <li><span class="kbd">Ctrl+K</span> — все команды</li>
      </ul>
    </div>
  {/if}
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-radius: 14px;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(100deg, color-mix(in srgb, var(--cat, #7c8cff) 22%, transparent), transparent 80%);
    animation: fade 200ms var(--ease);
  }
  .ico {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--cat, #7c8cff) 40%, transparent);
  }
  .ttl {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ttl strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 10.5px;
    color: var(--muted);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 6px 12px 16px;
    animation: fade 220ms var(--ease);
  }
  .desc {
    color: var(--text-2);
    line-height: 1.5;
    margin: 6px 0 4px;
  }
  h4 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 16px 0 8px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
  }
  h4 .btn {
    height: 20px;
    width: 20px;
  }
  .prop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
    color: var(--text-2);
  }
  .prop.col {
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
    margin-top: 10px;
  }
  .prop textarea,
  .scroll > textarea {
    width: 100%;
  }
  .prop:has(textarea.code) {
    flex-direction: column;
    align-items: stretch;
  }
  textarea.code {
    min-height: 140px;
    color: #c9d1ff;
    tab-size: 4;
  }
  .plabel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .plabel em {
    font-style: normal;
    font-size: 10.5px;
    color: var(--muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pc);
    flex: none;
  }
  .linked {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    font-size: 11.5px;
  }
  .need {
    color: var(--warn);
    font-size: 11.5px;
  }
  .portrow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .portrow input {
    flex: 1;
    color: var(--pc);
  }
  .portrow select {
    width: 76px;
  }
  .problems {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }
  .problem {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
  }
  .problem.error {
    background: rgba(255, 159, 67, 0.1);
    color: #ffc58f;
  }
  .problem.warning {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-2);
  }
  .hint {
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.5;
  }
  .wide {
    width: 100%;
    justify-content: center;
    margin-top: 10px;
  }
  .bp {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--danger);
  }
  .bp-on .bp {
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .grid.two {
    grid-template-columns: 1fr 1fr;
  }
  .grid .btn {
    justify-content: center;
  }
  .col-btns {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .col-btns .kbd {
    margin-left: auto;
  }
  .tb {
    margin-top: 10px;
    padding: 8px;
    border-radius: 8px;
    background: rgba(255, 90, 106, 0.08);
    color: #ffc2c9;
    font-size: 11px;
    white-space: pre-wrap;
    user-select: text;
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 14px;
  }
  .stats div {
    padding: 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .stats strong {
    font-size: 18px;
  }
  .stats span {
    color: var(--muted);
    font-size: 11px;
  }
  .tips {
    margin: 0;
    padding-left: 16px;
    color: var(--text-2);
    line-height: 1.9;
    font-size: 12px;
  }
  @keyframes fade {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
