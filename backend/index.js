const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;
const HINT_TIMER_DURATION = 30; // seconds
const VOTE_TIMER_DURATION = 20; // seconds

const wordsData = JSON.parse(fs.readFileSync('./words.json', 'utf8'));
const rooms = {};

// --- Timer Management ---
const activeTimers = {};

function startTimer(roomId, duration, onEnd) {
    if (activeTimers[roomId]) {
        clearInterval(activeTimers[roomId]);
    }

    const room = rooms[roomId];
    if (!room) return;

    room.timer = duration;
    io.to(roomId).emit('timerUpdate', room.timer);

    activeTimers[roomId] = setInterval(() => {
        room.timer -= 1;
        io.to(roomId).emit('timerUpdate', room.timer);

        if (room.timer <= 0) {
            clearInterval(activeTimers[roomId]);
            delete activeTimers[roomId];
            onEnd();
        }
    }, 1000);
}

function stopTimer(roomId) {
    if (activeTimers[roomId]) {
        clearInterval(activeTimers[roomId]);
        delete activeTimers[roomId];
        if(rooms[roomId]) rooms[roomId].timer = null;
        io.to(roomId).emit('timerUpdate', null);
    }
}

// --- Game Logic ---

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const generatePersistentId = () => crypto.randomUUID();

const getDefaultRoomSettings = () => ({ /* ...omitted... */ });
const resetRoundState = (room) => { /* ...omitted... */ return room; };

io.on('connection', (socket) => {
  const createPlayer = (name) => ({ id: socket.id, persistentId: generatePersistentId(), name, score: 0 });

  socket.on('createRoom', ({ playerName }) => {
    // ... (create room logic)
  });

  socket.on('updateSettings', ({ roomId, newSettings }) => {
    // ... (update settings logic)
  });

  socket.on('joinRoom', ({ playerName, roomId }) => {
    // ... (join room logic)
  });

  socket.on('reconnectPlayer', ({ persistentId, roomId }) => {
    // ... (reconnect logic)
  });

  socket.on('startGame', ({ roomId }) => {
    let room = rooms[roomId];
    // ... (start game setup)

    // Start hint timer for the first player
    startTimer(roomId, HINT_TIMER_DURATION, () => handleTimeout(roomId, 'hint'));

    io.to(roomId).emit('updateRoom', room);
  });

  const endRound = (roomId) => { /* ...omitted... */ };

  socket.on('submitHint', ({ roomId, hint }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing' || room.turn !== socket.id) return;
    
    const player = room.players.find(p => p.id === socket.id);
    room.hints.push({ player, hint });

    const currentPlayerIndex = room.players.findIndex(p => p.id === socket.id);
    const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    room.turn = room.players[nextPlayerIndex].id;

    if (room.hints.length === room.players.length) {
        room.gameState = 'voting';
        room.turn = null;
        stopTimer(roomId);
        startTimer(roomId, VOTE_TIMER_DURATION, () => handleTimeout(roomId, 'vote'));
    } else {
        // Reset timer for the next player
        startTimer(roomId, HINT_TIMER_DURATION, () => handleTimeout(roomId, 'hint'));
    }

    io.to(roomId).emit('updateRoom', room);
  });

  socket.on('submitVote', ({ roomId, votedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'voting' || room.votes[socket.id]) return;
    room.votes[socket.id] = votedPlayerId;

    if (Object.keys(room.votes).length === room.players.length) {
        stopTimer(roomId);
        tallyVotes(roomId);
    } else {
        io.to(roomId).emit('updateRoom', room);
    }
  });

  const tallyVotes = (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    // ... (vote tallying logic)
  };

  const handleTimeout = (roomId, phase) => {
    const room = rooms[roomId];
    if (!room) return;

    if (phase === 'hint' && room.gameState === 'playing') {
        console.log(`Room ${roomId}: Hint timer expired for ${room.turn}`);
        // Pass the turn to the next player
        const currentPlayerIndex = room.players.findIndex(p => p.id === room.turn);
        const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
        room.turn = room.players[nextPlayerIndex].id;

        if (room.hints.length === room.players.length) { // Should not happen, but as a safeguard
            room.gameState = 'voting';
            room.turn = null;
            startTimer(roomId, VOTE_TIMER_DURATION, () => handleTimeout(roomId, 'vote'));
        } else {
            startTimer(roomId, HINT_TIMER_DURATION, () => handleTimeout(roomId, 'hint'));
        }
        io.to(roomId).emit('updateRoom', room);
    }
    else if (phase === 'vote' && room.gameState === 'voting') {
        console.log(`Room ${roomId}: Vote timer expired.`);
        tallyVotes(roomId);
    }
  };

  // ... other handlers (submitLiarGuess, restartGame, disconnect)
});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});