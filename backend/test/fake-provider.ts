import * as http from 'http';

export interface FakeProvider {
  server: http.Server;
  close: () => Promise<void>;
  reset: () => void;
  /** Force the next N POST calls to 503 and NOT save the operation (GET → 404). */
  failAll: (count?: number) => void;
}

export async function createFakeProvider(port = 8092): Promise<FakeProvider> {
  const ops = new Map<string, any>();
  let failRemaining = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);

    if (req.method === 'POST' && url.pathname === '/renewals') {
      const key = req.headers['idempotency-key'] as string;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        // If in fail-all mode, do NOT save the operation → GET returns 404
        if (failRemaining > 0) {
          failRemaining--;
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
          return;
        }

        // Normal behavior: save on first call, return 503; subsequent calls return 200
        if (!ops.has(key)) {
          ops.set(key, {
            status: 'completed',
            operation_id: `op-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            started_count: 0,
          });
        }
        const op = ops.get(key)!;
        op.started_count = (op.started_count || 0) + 1;

        if (op.started_count === 1) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(op));
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/renewals/')) {
      const key = decodeURIComponent(url.pathname.replace('/renewals/', ''));
      const op = ops.get(key);
      if (!op) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(op));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    server,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
    reset: () => {
      ops.clear();
      failRemaining = 0;
    },
    failAll: (count = 10) => {
      failRemaining = count;
    },
  };
}
