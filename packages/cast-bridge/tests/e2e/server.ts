import * as http from 'http';

const HTML = `<!DOCTYPE html><html><head><title>cast-bridge test</title></head><body></body></html>`;

let server: http.Server | null = null;

export async function startTestServer(port = 3791): Promise<string> {
  return new Promise((resolve, reject) => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    });
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`));
    server.on('error', reject);
  });
}

export async function stopTestServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}
