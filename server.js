const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.role = null;
  if (!room) return;
  if (room.hostId === socket.id) {
    io.to(code).emit('peer-left');
    rooms.delete(code);
  } else if (room.guestId === socket.id) {
    room.guestId = null;
    room.ready[2] = false;
    io.to(room.hostId).emit('peer-left');
  }
}

io.on('connection', socket => {
  socket.on('create-room', () => {
    leaveRoom(socket);
    const code = makeCode();
    rooms.set(code, { hostId: socket.id, guestId: null, ready: { 1: false, 2: false } });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 1;
    socket.emit('room-created', { code, role: 1 });
  });

  socket.on('join-room', rawCode => {
    const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return socket.emit('room-error', 'Ийм өрөө олдсонгүй. Кодоо шалгана уу.');
    if (room.guestId && room.guestId !== socket.id) return socket.emit('room-error', 'Энэ өрөөнд аль хэдийн 2 тоглогч орсон байна.');
    leaveRoom(socket);
    room.guestId = socket.id;
    room.ready = { 1: false, 2: false };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 2;
    socket.emit('room-joined', { code, role: 2 });
    io.to(room.hostId).emit('peer-joined');
    io.to(code).emit('ready-status', room.ready);
    io.to(room.hostId).emit('request-state');
  });

  socket.on('ready', () => {
    const room = rooms.get(socket.data.roomCode);
    const role = socket.data.role;
    if (!room || !role || (role === 2 && room.guestId !== socket.id)) return;
    room.ready[role] = true;
    io.to(socket.data.roomCode).emit('ready-status', room.ready);
  });

  socket.on('countdown-start', () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.hostId === socket.id && room.ready[1] && room.ready[2]) {
      socket.to(socket.data.roomCode).emit('countdown-start');
    }
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.hostId === socket.id) socket.to(socket.data.roomCode).emit('start-game');
  });

  socket.on('player-input', action => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 2 || room.guestId !== socket.id) return;
    const allowed = new Set(['left', 'right', 'rotate', 'down', 'drop', 'hold']);
    if (allowed.has(action)) io.to(room.hostId).emit('remote-input', action);
  });

  socket.on('game-state', state => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.hostId === socket.id && room.guestId) socket.to(socket.data.roomCode).emit('game-state', state);
  });

  socket.on('request-state', () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.guestId === socket.id) io.to(room.hostId).emit('request-state');
  });

  socket.on('reset-game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.hostId === socket.id) {
      room.ready = { 1: false, 2: false };
      socket.to(socket.data.roomCode).emit('reset-game');
    }
  });

  socket.on('reset-request', () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.guestId === socket.id) io.to(room.hostId).emit('reset-request');
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Online Tetris listening on ${port}`));
