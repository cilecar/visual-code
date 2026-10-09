// Dev-only Vite plugin: lets the UI run programs when opened in a plain
// browser (`npm run dev`), mirroring the Rust runner (src-tauri/src/runner.rs)
// over HTTP + Server-Sent Events. Not part of production builds.
import type { Plugin } from 'vite';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerResponse, IncomingMessage } from 'node:http';

interface Run {
  id: number;
  child: ChildProcess;
  events: string[];
  clients: Set<ServerResponse>;
  done: boolean;
  dir: string;
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, err) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => ok(s));
    req.on('error', err);
  });
}

export function devRunner(): Plugin {
  let current: Run | null = null;
  let seq = 0;

  const push = (run: Run, line: string) => {
    run.events.push(line);
    for (const c of run.clients) c.write(`data: ${line}\n\n`);
  };

  const kill = (run: Run | null) => {
    if (!run || run.done) return;
    try {
      process.kill(-run.child.pid!, 'SIGKILL');
    } catch {
      run.child.kill('SIGKILL');
    }
  };

  return {
    name: 'nodus-dev-runner',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__nodus', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        try {
          if (url.pathname === '/run' && req.method === 'POST') {
            kill(current);
            const r = JSON.parse(await body(req));
            const dir = mkdtempSync(join(tmpdir(), 'nodus-dev-'));
            const program = join(dir, 'program.py');
            writeFileSync(program, r.code);
            const cfg = join(dir, 'config.json');
            writeFileSync(
              cfg,
              JSON.stringify({ program, sourcemap: r.sourcemap, mode: r.mode, delay_ms: r.delay_ms, breakpoints: r.breakpoints, cpu_limit_s: r.cpu_limit_s, output_limit: r.output_limit })
            );
            const child = spawn(r.python || 'python3', ['-u', '-X', 'utf8', resolve('runner/trace.py'), cfg], {
              cwd: r.cwd || dir,
              detached: true,
              env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
            });
            const run: Run = { id: ++seq, child, events: [], clients: new Set(), done: false, dir };
            current = run;
            let buf = '';
            child.stdout!.on('data', (d) => {
              buf += d.toString();
              let i;
              while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line) push(run, line.startsWith('{') ? line : JSON.stringify({ type: 'stdout', text: line + '\n' }));
              }
            });
            child.stderr!.on('data', (d) => push(run, JSON.stringify({ type: 'stderr', text: d.toString() })));
            child.on('close', (code) => {
              run.done = true;
              push(run, JSON.stringify({ type: 'exit', code }));
              for (const c of run.clients) c.end();
              rmSync(dir, { recursive: true, force: true });
            });
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ id: run.id }));
            return;
          }
          if (url.pathname === '/events') {
            const id = Number(url.searchParams.get('id'));
            const run = current?.id === id ? current : null;
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            if (!run) {
              res.end();
              return;
            }
            for (const e of run.events) res.write(`data: ${e}\n\n`);
            if (run.done) {
              res.end();
              return;
            }
            run.clients.add(res);
            req.on('close', () => run.clients.delete(res));
            return;
          }
          if (url.pathname === '/cmd' && req.method === 'POST') {
            const cmd = await body(req);
            current?.child.stdin?.write(cmd.trim() + '\n');
            res.end('{}');
            return;
          }
          if (url.pathname === '/stop' && req.method === 'POST') {
            kill(current);
            res.end('{}');
            return;
          }
          res.statusCode = 404;
          res.end();
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    }
  };
}
