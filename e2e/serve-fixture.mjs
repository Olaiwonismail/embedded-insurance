// Serves e2e/fixtures as a stand-in for a merchant's shop, so the widget's call to
// the API is genuinely cross-origin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = path.join(import.meta.dirname, 'fixtures');

createServer(async (req, res) => {
  const requested = new URL(req.url, `http://localhost:${port}`).pathname;
  const file = path.join(root, requested === '/' ? 'product.html' : requested);

  // Never serve outside the fixtures directory.
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => {
  console.log(`fixtures on http://localhost:${port}`);
});
