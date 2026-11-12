// Tap Sprint server: zero dependencies, Node 18+.
// Static files + a tiny real-time API (Server-Sent Events down, POST up).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MAX_ROOMS = 200;
const MAX_PLAYERS = 16;
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function newCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let t = 0; t < 50; t++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += L[crypto.randomInt(L.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function createRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = newCode();
  if (!code) return null;
  const room = {
    code,
    token: crypto.randomBytes(12).toString("hex"),
    phase: "lobby", // lobby | count | run | done
    n: 0,
    epoch: 0,
    winner: null,
    players: new Map(), // id -> {id,name,ci,pos,inRace,conns,lastSeen}
    clients: new Set(), // {res,id}
    dirty: true,
    timer: null,
    last: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function snapshot(room) {
  return {
    phase: room.phase,
    n: room.n,
    epoch: room.epoch,
    winner: room.winner,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      ci: p.ci,
      pos: p.pos,
      inRace: p.inRace,
    })),
  };
}

function broadcast(room) {
  const data = `event: state\ndata: ${JSON.stringify(snapshot(room))}\n\n`;
  for (const c of room.clients) {
    try {
      c.res.write(data);
    } catch (_) {}
  }
}

function startRace(room) {
  room.epoch++;
  room.phase = "count";
  room.n = 3;
  room.winner = null;
  for (const p of room.players.values()) {
    p.pos = 0;
    p.inRace = true;
  }
  room.dirty = true;
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.n--;
    if (room.n <= 0) {
      clearInterval(room.timer);
      room.n = 0;
      room.phase = "run";
    }
    room.dirty = true;
  }, 900);
}

function clean(s) {
  return String(s == null ? "" : s)
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .slice(0, 12)
    .trim();
}

function readJson(req, res, cb) {
  let body = "";
  let dead = false;
  req.on("data", (d) => {
    body += d;
    if (body.length > 2048 && !dead) {
      dead = true;
      res.writeHead(413).end();
      req.destroy();
    }
  });
  req.on("end", () => {
    if (dead) return;
    let j = null;
    try {
      j = JSON.parse(body || "{}");
    } catch (_) {}
    if (!j || typeof j !== "object") {
      res.writeHead(400).end();
      return;
    }
    cb(j);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function api(req, res, url) {
  const p = url.pathname;

  if (p === "/api/create" && req.method === "GET") {
    const room = createRoom();
    if (!room) return sendJson(res, 503, { error: "busy" });
    return sendJson(res, 200, { code: room.code, token: room.token });
  }

  if (p === "/api/events" && req.method === "GET") {
    const room = rooms.get((url.searchParams.get("room") || "").toUpperCase());
    if (!room) return sendJson(res, 404, { error: "no such room" });
    const id = String(url.searchParams.get("id") || "").slice(0, 40);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1500\n\n");
    const client = { res, id };
    room.clients.add(client);
    const pl = room.players.get(id);
    if (pl) pl.conns++;
    res.write(`event: state\ndata: ${JSON.stringify(snapshot(room))}\n\n`);
    req.on("close", () => {
      room.clients.delete(client);
      const q = room.players.get(id);
      if (q) {
        q.conns = Math.max(0, q.conns - 1);
        q.lastSeen = Date.now();
      }
      room.last = Date.now();
    });
    return;
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "method" });

  readJson(req, res, (b) => {
    const room = rooms.get(String(b.room || "").toUpperCase());
    if (!room) return sendJson(res, 404, { error: "no such room" });
    room.last = Date.now();

    if (p === "/api/join") {
      const id = String(b.id || "").slice(0, 40);
      if (!id) return sendJson(res, 400, { error: "id" });
      let pl = room.players.get(id);
      if (!pl) {
        if (room.players.size >= MAX_PLAYERS)
          return sendJson(res, 409, { error: "room full" });
        pl = {
          id,
          name: "Runner",
          ci: 0,
          pos: 0,
          inRace: room.phase === "lobby" || room.phase === "done",
          conns: 0,
          lastSeen: Date.now(),
        };
        room.players.set(id, pl);
      }
      pl.name = clean(b.name) || "Runner";
      const ci = Number(b.ci);
      pl.ci = ci >= 0 && ci < 8 ? Math.floor(ci) : 0;
      room.dirty = true;
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/pos") {
      const pl = room.players.get(String(b.id || ""));
      if (!pl || room.phase !== "run" || !pl.inRace)
        return sendJson(res, 200, { ok: false });
      let pos = Number(b.pos);
      if (!isFinite(pos)) return sendJson(res, 400, { error: "pos" });
      pos = Math.max(0, Math.min(100, pos));
      if (pos > pl.pos) {
        pl.pos = pos;
        room.dirty = true;
      }
      if (pl.pos >= 100 && !room.winner) {
        room.winner = pl.id;
        room.phase = "done";
        room.dirty = true;
      }
      return sendJson(res, 200, { ok: true });
    }

    if (p === "/api/start") {
      if (b.token !== room.token) return sendJson(res, 403, { error: "token" });
      if (room.phase === "count" || room.phase === "run")
        return sendJson(res, 200, { ok: false });
      if (room.players.size === 0) return sendJson(res, 200, { ok: false });
      startRace(room);
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { error: "not found" });
  });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch (_) {
    res.writeHead(400).end();
    return;
  }
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res, url);
});

// Broadcast changes ~12 times a second.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.dirty) {
      room.dirty = false;
      broadcast(room);
    }
  }
}, 80);

// Keep SSE connections alive through proxies.
setInterval(() => {
  for (const room of rooms.values())
    for (const c of room.clients) {
      try {
        c.res.write(": ping\n\n");
      } catch (_) {}
    }
}, 15000);

// Housekeeping: drop players who left and rooms nobody uses.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const [id, p] of room.players) {
      if (p.conns === 0 && now - p.lastSeen > 30000) {
        room.players.delete(id);
        room.dirty = true;
      }
    }
    if (room.clients.size === 0 && now - room.last > 10 * 60 * 1000) {
      clearInterval(room.timer);
      rooms.delete(code);
    }
  }
}, 5000);

server.listen(PORT, () => console.log("Tap Sprint running on port " + PORT));
