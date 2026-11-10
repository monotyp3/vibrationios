// Haptic Link relay server
// Pairs two phones in a "room" and forwards press-down / press-up events
// between them as fast as possible. The server does no timing work itself,
// it just relays. Timing is preserved by the timestamps the sender attaches.

const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 2;
const MAX_EVENTS_PER_SEC = 60; // basic flood protection per socket

// Plain HTTP handler so hosts like Render can health-check the service.
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('haptic-link relay ok\n');
});

// Turn off Nagle's algorithm so tiny packets go out immediately.
httpServer.on('connection', (sock) => sock.setNoDelay(true));

const io = new Server(httpServer, {
  transports: ['websocket'],   // skip HTTP long-polling entirely
  perMessageDeflate: false,    // compression adds CPU time for tiny messages
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 8000,
});

const cleanRoom = (r) => String(r || '').trim().toUpperCase();

io.on('connection', (socket) => {
  let windowStart = Date.now();
  let count = 0;

  const rateOk = () => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    return ++count <= MAX_EVENTS_PER_SEC;
  };

  const leaveCurrent = () => {
    const old = socket.data.room;
    if (!old) return;
    socket.leave(old);
    socket.to(old).emit('peer', { online: false });
    socket.data.room = null;
  };

  // Join a room by code. Replies with ok/error through the ack callback.
  socket.on('join', (rawRoom, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = cleanRoom(rawRoom);
    if (!/^[A-Z0-9]{3,16}$/.test(room)) {
      return reply({ ok: false, error: 'Room code must be 3 to 16 letters or numbers' });
    }
    if (socket.data.room === room) {
      const size = io.sockets.adapter.rooms.get(room)?.size || 1;
      return reply({ ok: true, room, peerOnline: size > 1 });
    }
    const members = io.sockets.adapter.rooms.get(room);
    if (members && members.size >= MAX_PER_ROOM) {
      return reply({ ok: false, error: 'That room already has 2 people in it' });
    }
    leaveCurrent();
    socket.join(room);
    socket.data.room = room;
    const peerOnline = (io.sockets.adapter.rooms.get(room)?.size || 1) > 1;
    reply({ ok: true, room, peerOnline });
    socket.to(room).emit('peer', { online: true });
  });

  // Haptic event: { t: 'd' | 'u', s: sequence number, at: sender timestamp ms }
  socket.on('h', (msg) => {
    const room = socket.data.room;
    if (!room || !msg || (msg.t !== 'd' && msg.t !== 'u') || !rateOk()) return;
    socket.to(room).emit('h', {
      t: msg.t,
      s: Number(msg.s) | 0,
      at: Number(msg.at) || 0,
    });
  });

  // Latency check: client sends, server immediately acks.
  socket.on('p', (ack) => { if (typeof ack === 'function') ack(); });

  socket.on('disconnect', leaveCurrent);
});

httpServer.listen(PORT, () => {
  console.log(`haptic-link relay listening on port ${PORT}`);
});
