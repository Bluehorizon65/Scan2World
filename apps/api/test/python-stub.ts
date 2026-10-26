import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';

type Handler = (
  body: any,
  req: IncomingMessage,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** In-process stand-in for the Python services: route "POST /analyze" -> handler. Records calls. */
export class PythonStub {
  private server!: Server;
  handlers = new Map<string, Handler>();
  calls: { route: string; body: any; token?: string }[] = [];

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        void (async () => {
          const route = `${req.method} ${req.url}`;
          const body = raw ? JSON.parse(raw) : undefined;
          this.calls.push({ route, body, token: req.headers['x-service-token'] as string });
          const handler =
            this.handlers.get(route) ??
            (route.startsWith('GET /health') ? (): ReturnType<Handler> => ({ body: { status: 'ok' } }) : undefined);
          const out = handler
            ? await handler(body, req)
            : { status: 404, body: { error: { code: 'not_found', message: route } } };
          res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out.body));
        })();
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  on(route: string, handler: Handler) {
    this.handlers.set(route, handler);
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }
}
