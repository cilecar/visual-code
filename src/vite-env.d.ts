/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.blk?raw' {
  const text: string;
  export default text;
}
