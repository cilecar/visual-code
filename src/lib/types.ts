// Core model types shared by the editor, validation and codegen.

export type DataType = 'number' | 'string' | 'bool' | 'list' | 'any';
export type PortType = DataType | 'exec';

export const DATA_TYPES: DataType[] = ['number', 'string', 'bool', 'list', 'any'];

export type Category =
  | 'events'
  | 'flow'
  | 'variables'
  | 'math'
  | 'logic'
  | 'strings'
  | 'lists'
  | 'io'
  | 'functions'
  | 'python'
  | 'custom';

export interface PortDef {
  id: string;
  type: PortType;
  label?: string;
  default?: unknown;
  /** Input must be connected (no inline literal makes sense, e.g. a list that gets mutated). */
  required?: boolean;
  /** Output of an exec block: preferred variable name in generated code. */
  varName?: string;
  /** Output of an exec block computed by expression instead of a variable. */
  expr?: string;
  /** Output is known to hold an int (`true`) or holds one when `param=value`. */
  int?: boolean | string;
}

export interface ParamDef {
  id: string;
  type: 'number' | 'string' | 'bool' | 'select' | 'var' | 'code';
  label?: string;
  default?: unknown;
  options?: string[];
}

export type BlockKind = 'event' | 'exec' | 'pure';

export interface BlockDef {
  id: string;
  title: string;
  category: Category;
  icon: string;
  kind: BlockKind;
  description?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** exec/event blocks: statement template. */
  code?: string;
  /** pure blocks: output id → expression template. */
  expr?: Record<string, string>;
  imports?: string[];
  /** Expression has side effects (never evaluated by the debugger for value popups). */
  impure?: boolean;
  dynamic?: 'var-get' | 'var-set' | 'python' | 'function' | 'fn-entry' | 'fn-return';
  variadic?: { param: string; prefix: string; type: DataType; label: string };
  event?: { name: string; timer?: string };
  hidden?: boolean;
  /** Where the definition came from: builtin or the user blocks directory. */
  source?: 'builtin' | 'user';
}

/** A resolved port on a concrete node. */
export interface Port {
  id: string;
  dir: 'in' | 'out';
  type: PortType;
  label: string;
  default?: unknown;
  required?: boolean;
  varName?: string;
  expr?: string;
  int?: boolean;
}

export interface CustomPort {
  name: string;
  type: DataType;
}

export interface BlockData {
  [key: string]: unknown;
  block: string;
  params: Record<string, unknown>;
  /** Inline literal values for unconnected data inputs. */
  inputs: Record<string, unknown>;
  /** Python Code block: user-defined ports. */
  pyInputs?: CustomPort[];
  pyOutputs?: CustomPort[];
  breakpoint?: boolean;
  comment?: string;
}

export interface RerouteData {
  [key: string]: unknown;
  portType: PortType;
}

export interface CommentData {
  [key: string]: unknown;
  title: string;
  color: string;
}

export type NodeKind = 'block' | 'reroute' | 'comment';

export interface GNode<D = BlockData | RerouteData | CommentData> {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: D;
  width?: number;
  height?: number;
  selected?: boolean;
  zIndex?: number;
  measured?: { width?: number; height?: number };
}

export interface GEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type?: string;
  selected?: boolean;
  data?: Record<string, unknown>;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export interface VarDef {
  name: string;
  type: DataType;
  value: unknown;
}

export interface FnPort {
  name: string;
  type: DataType;
}

export interface FnDef {
  id: string;
  name: string;
  inputs: FnPort[];
  outputs: FnPort[];
  graph: Graph;
}

export interface Doc {
  format: 'nodus';
  schemaVersion: number;
  name: string;
  description?: string;
  variables: VarDef[];
  functions: FnDef[];
  main: Graph;
  viewport?: { x: number; y: number; zoom: number };
}

export const SCHEMA_VERSION = 1;

export function isBlockNode(n: GNode): n is GNode<BlockData> {
  return n.type === 'block';
}
export function isRerouteNode(n: GNode): n is GNode<RerouteData> {
  return n.type === 'reroute';
}
export function isCommentNode(n: GNode): n is GNode<CommentData> {
  return n.type === 'comment';
}

/** Handle ids: inputs are `in:<port>`, outputs are `out:<port>`. */
export const inHandle = (port: string) => `in:${port}`;
export const outHandle = (port: string) => `out:${port}`;
export const portOfHandle = (handle: string | null | undefined) => (handle ?? '').replace(/^(in|out):/, '');
