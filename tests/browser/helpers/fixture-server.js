const http = require('node:http');

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function closeFixtureServer(server) {
  const closing = closeServer(server);
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await closing;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function safeFixturePath(requestUrl) {
  try {
    const encodedPath = requestUrl.split('?', 1)[0];
    const decodedPath = decodeURIComponent(encodedPath).replaceAll('\\', '/');
    if (!decodedPath.startsWith('/') || decodedPath.split('/').includes('..')) {
      return null;
    }
    return decodedPath;
  } catch {
    return null;
  }
}

async function withFixtureServer(fixtures, callback) {
  const server = http.createServer((request, response) => {
    const fixturePath = safeFixturePath(request.url);
    if (fixturePath === null) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Invalid fixture path');
      return;
    }

    const fixture = fixtures[fixturePath];
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': fixture.contentType + '; charset=utf-8'
    });
    response.end(fixture.body);
  });

  await listen(server);
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(Object.freeze({ origin, port: address.port }));
  } finally {
    await closeFixtureServer(server);
  }
}

module.exports = Object.freeze({ withFixtureServer });
