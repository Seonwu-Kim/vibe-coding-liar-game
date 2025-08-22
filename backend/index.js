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

const wordsData = JSON.parse(fs.readFileSync('./words.json', 'utf8'));
const rooms = {};

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const generatePersistentId = () => crypto.randomUUID();

const getDefaultRoomSettings = () => ({
    selectedCategories: ['영화'],
    targetScore: 5,
    gameMode: 'normal',
    liarGuessType: 'text' // text, card
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
      ...resetRoundState({})
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

    io.to(roomId).emit('updateRoom', room);
  });

  // ... other handlers like joinRoom, reconnectPlayer ...

  socket.on('startGame', ({ roomId }) => {
    // ... startGame logic ...
  });

  const endRound = (roomId) => {
    // ... endRound logic ...
  }

  socket.on('submitHint', ({ roomId, hint }) => {
    // ... submitHint logic ...
  });

  const generateLiarGuessCards = (room) => {
    const correctWord = room.word;
    const categoryWords = wordsData[room.currentCategory];
    const decoys = categoryWords.filter(w => w !== correctWord);
    
    // Shuffle decoys and pick 5
    const shuffledDecoys = decoys.sort(() => 0.5 - Math.random());
    const selectedDecoys = shuffledDecoys.slice(0, 5);

    const cards = [...selectedDecoys, correctWord];
    // Shuffle the final cards
    room.liarGuessCards = cards.sort(() => 0.5 - Math.random());
  };

  socket.on('submitVote', ({ roomId, votedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'voting' || room.votes[socket.id]) return;
    room.votes[socket.id] = votedPlayerId;

    if (Object.keys(room.votes).length === room.players.length) {
        const voteCounts = {};
        Object.values(room.votes).forEach(vote => { voteCounts[vote] = (voteCounts[vote] || 0) + 1; });
        const mostVotedId = Object.keys(voteCounts).reduce((a, b) => voteCounts[a] > voteCounts[b] ? a : b);
        const mostVotedPlayer = room.players.find(p => p.id === mostVotedId);
        const isLiar = mostVotedId === room.liarId;
        room.voteResult = { mostVotedPlayer, isLiar };

        room.gameState = 'liarGuess';
        if (isLiar) {
            room.players.forEach(p => { if (p.id !== room.liarId) p.score += 1; });
        } else {
            const liar = room.players.find(p => p.id === room.liarId);
            if(liar) liar.score += 1;
        }

        if (room.liarGuessType === 'card') {
            generateLiarGuessCards(room);
        }

        const liarSocket = io.sockets.sockets.get(room.liarId);
        if (liarSocket) liarSocket.emit('youWereTheLiar');
        io.to(roomId).emit('updateRoom', room);

    } else {
        io.to(roomId).emit('updateRoom', room);
    }
  });

  socket.on('submitLiarGuess', ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'liarGuess' || socket.id !== room.liarId) return;
    const correctGuess = guess.trim().toLowerCase() === room.word.toLowerCase();
    if (correctGuess) {
        const liar = room.players.find(p => p.id === room.liarId);
        if (liar) liar.score += 1;
    }
    room.liarGuessResult = { guess, correct: correctGuess };
    endRound(roomId);
  });

  // ... other handlers like restartGame, disconnect ...
});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
