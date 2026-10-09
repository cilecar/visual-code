<script lang="ts">
  import {
    SvelteFlow,
    Background,
    BackgroundVariant,
    MiniMap,
    Controls,
    ConnectionLineType,
    useSvelteFlow,
    type Node as FlowNode,
    type OnConnectEnd
  } from '@xyflow/svelte';
  import { untrack } from 'svelte';
  import type { GNode } from '../types';
  import { isBlockNode, isCommentNode } from '../types';
  import { editor } from '../stores/editor.svelte';
  import { ui } from '../stores/ui.svelte';
  import { run } from '../runtime/run.svelte';
  import { categoryColor, getBlock } from '../blocks/registry';
  import { toggleBreakpoint } from '../commands';
  import BlockNode from './BlockNode.svelte';
  import RerouteNode from './RerouteNode.svelte';
  import CommentNode from './CommentNode.svelte';
  import WireEdge from './WireEdge.svelte';
  import PulseOverlay from './PulseOverlay.svelte';

  const flow = useSvelteFlow();
  editor.flow = flow as never;

  const nodeTypes = { block: BlockNode, reroute: RerouteNode, comment: CommentNode } as never;
  const edgeTypes = { wire: WireEdge } as never;

  let vp = $state({ x: 0, y: 0, zoom: 1 });
  let zoomPct = $derived(Math.round(vp.zoom * 100));

  // ---------------------------------------------------- comment frames drag their content
  let frameDrag: { frameId: string; start: { x: number; y: number }; children: Map<string, { x: number; y: number }> } | null = null;

  function contained(frame: GNode, n: GNode) {
    const w = frame.width ?? frame.measured?.width ?? 0;
    const h = frame.height ?? frame.measured?.height ?? 0;
    const nw = n.measured?.width ?? 0;
    const nh = n.measured?.height ?? 0;
    return (
      n.position.x >= frame.position.x &&
      n.position.y >= frame.position.y &&
      n.position.x + nw <= frame.position.x + w &&
      n.position.y + nh <= frame.position.y + h
    );
  }

  function onDragStart({ targetNode }: { targetNode: FlowNode | null }) {
    frameDrag = null;
    if (!targetNode || targetNode.type !== 'comment') return;
    const frame = editor.nodes.find((n) => n.id === targetNode.id);
    if (!frame) return;
    const children = new Map<string, { x: number; y: number }>();
    for (const n of editor.nodes) if (n.id !== frame.id && !n.selected && !isCommentNode(n) && contained(frame, n)) children.set(n.id, { ...n.position });
    frameDrag = { frameId: frame.id, start: { ...frame.position }, children };
  }

  function onDrag({ targetNode }: { targetNode: FlowNode | null }) {
    if (!frameDrag || !targetNode || targetNode.id !== frameDrag.frameId || !frameDrag.children.size) return;
    const dx = targetNode.position.x - frameDrag.start.x;
    const dy = targetNode.position.y - frameDrag.start.y;
    const ch = frameDrag.children;
    editor.nodes = editor.nodes.map((n) => {
      const p = ch.get(n.id);
      return p ? { ...n, position: { x: p.x + dx, y: p.y + dy } } : n;
    });
  }

  function onDragStop() {
    frameDrag = null;
    editor.commit();
  }

  // ---------------------------------------------------- wire dropped on empty canvas → block search
  function onConnectEnd(event: MouseEvent | TouchEvent, state: Parameters<OnConnectEnd>[1]) {
    if (state.isValid || state.toHandle || !state.fromHandle) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
    const from = state.fromHandle;
    const portType = editor.portType(from.nodeId, from.id ?? '');
    if (!portType) return;
    ui.search = {
      x: pt.clientX,
      y: pt.clientY,
      flow: flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }),
      from: { nodeId: from.nodeId, handleId: from.id ?? '', type: from.type, portType }
    };
  }

  // ---------------------------------------------------- palette drag & drop
  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/x-nodus-block')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function onDrop(e: DragEvent) {
    const raw = e.dataTransfer?.getData('application/x-nodus-block');
    if (!raw) return;
    e.preventDefault();
    const { block, data } = JSON.parse(raw);
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    editor.addBlock(block, { x: p.x - 80, y: p.y - 20 }, data);
  }

  // ---------------------------------------------------- misc
  let rightDown: { x: number; y: number } | null = null;

  function onPointerMove(e: PointerEvent) {
    ui.pointer.x = e.clientX;
    ui.pointer.y = e.clientY;
    ui.pointer.overCanvas = true;
  }

  function onPaneContext({ event }: { event: MouseEvent }) {
    event.preventDefault();
    if (rightDown && Math.hypot(event.clientX - rightDown.x, event.clientY - rightDown.y) > 4) return;
    ui.search = { x: event.clientX, y: event.clientY, flow: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) };
  }

  function onNodeClick({ node, event }: { node: FlowNode; event: MouseEvent | TouchEvent }) {
    if ('altKey' in event && event.altKey && node.type === 'block') toggleBreakpoint(node.id);
  }

  function minimapColor(n: FlowNode) {
    if (n.type === 'comment') return 'rgba(124, 140, 255, 0.08)';
    if (n.type === 'reroute') return '#666';
    if (run.activeNode === n.id) return '#7c8cff';
    const d = n.data as { block?: string };
    return d.block ? categoryColor(getBlock(d.block)?.category ?? 'custom') : '#555';
  }

  // run highlighting: bring the active node into view in step mode
  $effect(() => {
    const id = run.activeNode;
    if (!id || run.status !== 'paused') return;
    untrack(() => reveal(id));
  });

  function reveal(id: string) {
    const n = editor.nodes.find((x) => x.id === id);
    if (!n) return;
    const el = document.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
    const wrap = document.querySelector('.canvas-wrap');
    if (!el || !wrap) return;
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    if (r.left < w.left || r.right > w.right || r.top < w.top || r.bottom > w.bottom) {
      const W = n.measured?.width ?? 200;
      const H = n.measured?.height ?? 80;
      flow.setCenter(n.position.x + W / 2, n.position.y + H / 2, { zoom: flow.getZoom(), duration: 250 });
    }
  }

  let breadcrumbs = $derived(editor.graphId === 'main' ? null : editor.currentFn);
  let activeElsewhere = $derived(
    run.live && run.activeNode && run.sourceMap?.graphOf[run.activeNode] && run.sourceMap.graphOf[run.activeNode] !== editor.graphId
      ? run.sourceMap.graphOf[run.activeNode]
      : null
  );
  void isBlockNode;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="canvas-wrap"
  style="background-position: {vp.x * 0.35}px {vp.y * 0.35}px, {vp.x * 0.6}px {vp.y * 0.6}px"
  onpointermove={onPointerMove}
  onpointerleave={() => (ui.pointer.overCanvas = false)}
  onpointerdown={(e) => {
    if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
  }}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  <SvelteFlow
    bind:nodes={editor.nodes}
    bind:edges={editor.edges}
    {nodeTypes}
    {edgeTypes}
    defaultEdgeOptions={{ type: 'wire' }}
    minZoom={0.1}
    maxZoom={4}
    snapGrid={editor.snapToGrid ? [16, 16] : undefined}
    deleteKey={null}
    selectionKey={null}
    multiSelectionKey={['Control', 'Meta', 'Shift']}
    panOnDrag={[1, 2]}
    selectionOnDrag={true}
    zoomOnDoubleClick={false}
    elevateNodesOnSelect={false}
    elevateEdgesOnSelect={false}
    connectionRadius={28}
    connectionLineType={ConnectionLineType.Bezier}
    isValidConnection={editor.isValidConnection}
    onbeforeconnect={editor.connect}
    onconnectend={onConnectEnd}
    onnodedragstart={onDragStart}
    onnodedrag={onDrag}
    onnodedragstop={onDragStop}
    onselectiondragstop={() => editor.commit()}
    onnodeclick={onNodeClick}
    onpaneclick={() => (ui.search = null)}
    onpanecontextmenu={onPaneContext}
    onmove={(_, v) => (vp = v)}
    oninit={() => (vp = flow.getViewport())}
    attributionPosition="top-right"
  >
    <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} patternColor="rgba(255,255,255,0.10)" />
    <Controls position="bottom-left" showLock={false} fitViewOptions={{ padding: 0.2, duration: 250 }}>
      {#snippet after()}
        <div class="zoom-readout mono">{zoomPct}%</div>
      {/snippet}
    </Controls>
    <MiniMap position="bottom-right" pannable zoomable nodeColor={minimapColor} nodeBorderRadius={6} width={180} height={120} />
    <PulseOverlay />
  </SvelteFlow>

  {#if breadcrumbs}
    <div class="crumbs glass">
      <button class="btn ghost" onclick={() => editor.switchGraph('main')}>Основной граф</button>
      <span class="sep">/</span>
      <span class="fn mono">ƒ {breadcrumbs.name}</span>
    </div>
  {/if}
  {#if activeElsewhere}
    <button class="elsewhere glass" onclick={() => editor.switchGraph(activeElsewhere!)}>
      ● Выполнение в «{activeElsewhere === 'main' ? 'основной граф' : editor.doc.functions.find((f) => f.id === activeElsewhere)?.name}» — перейти
    </button>
  {/if}
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--bg);
    /* parallax layers: soft glows + sparse large dots that move slower than the grid */
    background-image:
      radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.05) 1.5px, transparent 2px),
      radial-gradient(ellipse 60% 50% at 30% 20%, rgba(124, 140, 255, 0.06), transparent 70%);
    background-size:
      120px 120px,
      1400px 1000px;
  }
  .crumbs {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 4px;
    border-radius: 10px;
    z-index: 6;
    animation: drop 220ms var(--ease);
  }
  .crumbs .sep {
    color: var(--muted);
  }
  .crumbs .fn {
    color: #c4b5fd;
  }
  .elsewhere {
    position: absolute;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 10px;
    color: var(--accent);
    cursor: pointer;
    z-index: 6;
  }
  .zoom-readout {
    font-size: 10px;
    text-align: center;
    padding: 4px 0;
    color: var(--muted);
    background: var(--panel-solid);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translate(-50%, -8px);
    }
  }
</style>
