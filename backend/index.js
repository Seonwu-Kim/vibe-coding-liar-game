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
const HINT_TIMER_DURATION = 30;
const VOTE_TIMER_DURATION = 20;

const wordsData = JSON.parse(fs.readFileSync('./words.json', 'utf8'));
const rooms = {};

// --- Timer Management ---
const activeTimers = {};
function startTimer(roomId, duration, onEnd) { /* ...omitted... */ }
function stopTimer(roomId) { /* ...omitted... */ }

// --- Game Logic ---

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const generatePersistentId = () => crypto.randomUUID();

const getDefaultRoomSettings = () => ({
    selectedCategories: ['영화'],
    targetScore: 5,
    gameMode: 'normal',
    liarGuessType: 'text',
    hintType: 'text' // text, drawing
});

const resetRoundState = (room) => {
    room.gameState = 'waiting';
    room.word = null;
    room.liarId = null;
    room.turn = null;
    room.hints = [];
    room.votes = {};
    room.voteResult = null;
    room.liarGuessResult = null;
    room.currentCategory = null;
    room.liarGuessCards = [];
    stopTimer(room.roomId);
    return room;
}

io.on('connection', (socket) => {
  const createPlayer = (name) => ({ id: socket.id, persistentId: generatePersistentId(), name, score: 0 });

  socket.on('createRoom', ({ playerName }) => {
    const roomId = generateRoomId();
    const player = createPlayer(playerName);
    rooms[roomId] = {
      roomId,
      players: [player],
      hostId: socket.id,
      ...getDefaultRoomSettings(),
      ...resetRoundState({ roomId })
    };
    socket.join(roomId);
    io.to(roomId).emit('updateRoom', rooms[roomId]);
  });

  socket.on('updateSettings', ({ roomId, newSettings }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id || room.gameState !== 'waiting') return;

    if (newSettings.selectedCategories) room.selectedCategories = newSettings.selectedCategories;
    if (newSettings.targetScore) room.targetScore = newSettings.targetScore;
    if (newSettings.gameMode) room.gameMode = newSettings.gameMode;
    if (newSettings.liarGuessType) room.liarGuessType = newSettings.liarGuessType;
    if (newSettings.hintType) room.hintType = newSettings.hintType;

    io.to(roomId).emit('updateRoom', room);
  });

  // ... other handlers ...

  socket.on('submitHint', ({ roomId, hintData }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing' || room.turn !== socket.id) return;
    
    const player = room.players.find(p => p.id === socket.id);
    room.hints.push({ 
        player, 
        type: hintData.type, // 'text' or 'drawing'
        content: hintData.content // a string or a data URL
    });

    const currentPlayerIndex = room.players.findIndex(p => p.id === socket.id);
    const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    room.turn = room.players[nextPlayerIndex].id;

    if (room.hints.length === room.players.length) {
        room.gameState = 'voting';
        room.turn = null;
        stopTimer(roomId);
        startTimer(roomId, VOTE_TIMER_DURATION, () => handleTimeout(roomId, 'vote'));
    } else {
        startTimer(roomId, HINT_TIMER_DURATION, () => handleTimeout(roomId, 'hint'));
    }

    io.to(roomId).emit('updateRoom', room);
  });

  // ... other handlers ...
});

// ... server.listen ...