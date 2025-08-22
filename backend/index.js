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
    gameMode: 'normal' // normal, fool
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
    return room;
}

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

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

    io.to(roomId).emit('updateRoom', room);
  });

  socket.on('joinRoom', ({ playerName, roomId }) => {
    if (!rooms[roomId]) return socket.emit('error', { message: 'Room not found' });
    if (rooms[roomId].gameState !== 'waiting') return socket.emit('error', { message: 'Game has already started' });
    const player = createPlayer(playerName);
    rooms[roomId].players.push(player);
    socket.join(roomId);
    io.to(roomId).emit('updateRoom', rooms[roomId]);
  });

  socket.on('reconnectPlayer', ({ persistentId, roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.persistentId === persistentId);
    if (player) {
        player.id = socket.id;
        socket.join(roomId);
        io.to(roomId).emit('updateRoom', room);
    } else {
        socket.emit('error', { message: 'Could not reconnect. Player not found.' });
    }
  });

  socket.on('startGame', ({ roomId }) => {
    let room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players to start.' });

    room = resetRoundState(room);
    room.gameState = 'playing';

    const randomCategoryIndex = Math.floor(Math.random() * room.selectedCategories.length);
    const currentCategory = room.selectedCategories[randomCategoryIndex];
    room.currentCategory = currentCategory;

    const liarIndex = Math.floor(Math.random() * room.players.length);
    room.liarId = room.players[liarIndex].id;
    const categoryWords = wordsData[currentCategory];

    let citizenWord, liarWord;

    if (room.gameMode === 'fool' && categoryWords.length > 1) {
        const wordIndex1 = Math.floor(Math.random() * categoryWords.length);
        citizenWord = categoryWords[wordIndex1];
        
        let wordIndex2 = Math.floor(Math.random() * categoryWords.length);
        while (wordIndex1 === wordIndex2) {
            wordIndex2 = Math.floor(Math.random() * categoryWords.length);
        }
        liarWord = categoryWords[wordIndex2];
    } else {
        const wordIndex = Math.floor(Math.random() * categoryWords.length);
        citizenWord = categoryWords[wordIndex];
        liarWord = null;
    }

    room.word = citizenWord;

    const firstTurnIndex = Math.floor(Math.random() * room.players.length);
    room.turn = room.players[firstTurnIndex].id;

    room.players.forEach(player => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (!playerSocket) return;
        const isLiar = player.id === room.liarId;
        playerSocket.emit('gameStarted', {
            role: isLiar ? 'Liar' : 'Citizen',
            category: currentCategory,
            word: isLiar ? liarWord : citizenWord,
        });
    });
    io.to(roomId).emit('updateRoom', room);
  });

  const endRound = (roomId) => {
    const room = rooms[roomId];
    const winner = room.players.find(p => p.score >= room.targetScore);
    if (winner) room.gameState = 'finished';
    else room.gameState = 'roundOver';
    io.to(roomId).emit('updateRoom', room);
  }

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
    }
    io.to(roomId).emit('updateRoom', room);
  });

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
        if (isLiar) {
            room.players.forEach(p => { if (p.id !== room.liarId) p.score += 1; });
            room.gameState = 'liarGuess';
            io.to(roomId).emit('updateRoom', room);
        } else {
            const liar = room.players.find(p => p.id === room.liarId);
            if(liar) liar.score += 1;
            endRound(roomId);
        }
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

  socket.on('restartGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    room.players.forEach(p => p.score = 0);
    rooms[roomId] = { ...room, ...resetRoundState({}), ...getDefaultRoomSettings() };
    io.to(roomId).emit('updateRoom', rooms[roomId]);
  });

  socket.on('disconnect', ({ reason }) => {
    const roomId = Object.keys(rooms).find(key => rooms[key] && rooms[key].players.some(p => p.id === socket.id));
    if (!roomId || !rooms[roomId]) return;
    const player = rooms[roomId].players.find(p => p.id === socket.id);
    if (!player) return;
    rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
    if (rooms[roomId].players.length === 0) {
        delete rooms[roomId];
        return;
    }
    if (rooms[roomId].hostId === socket.id) {
        rooms[roomId].hostId = rooms[roomId].players[0].id;
    }
    io.to(roomId).emit('updateRoom', rooms[roomId]);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});