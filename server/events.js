const clients = new Set();

function closeClient(client) {
  clearInterval(client.heartbeat);
  clients.delete(client);
}

function safeWrite(client, chunk) {
  if (client.res.destroyed || client.res.writableEnded) {
    closeClient(client);
    return;
  }
  try {
    client.res.write(chunk);
  } catch {
    closeClient(client);
  }
}

export function openEventStream(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const client = { res, heartbeat: null };
  client.heartbeat = setInterval(() => {
    safeWrite(client, ': keepalive\n\n');
  }, 25000);
  clients.add(client);
  req.on('close', () => {
    closeClient(client);
  });
}

export function publishWorkspaceEvent(event) {
  const payload = JSON.stringify({
    ...event,
    at: new Date().toISOString(),
  });
  for (const client of clients) {
    safeWrite(client, `event: workspace.changed\ndata: ${payload}\n\n`);
  }
}
