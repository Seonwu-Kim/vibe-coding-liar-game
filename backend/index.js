const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // In a production environment, you should restrict this to your frontend's domain
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

const wordsData = JSON.parse(fs.readFileSync('./words.json', 'utf8'));
const rooms = {};

const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const resetRoomForNewGame = (room) => {
    room.gameState = 'waiting';
    room.word = null;
    room.liarId = null;
    room.turn = null;
    room.hints = [];
    room.votes = {};
    room.voteResult = null;
    room.liarGuessResult = null;
    // Scores are intentionally not reset to accumulate over rounds
    return room;
}

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  socket.on('createRoom', ({ playerName, category }) => {
    const roomId = generateRoomId();
    const player = { id: socket.id, name: playerName, score: 0 };
    rooms[roomId] = {
      roomId,
      players: [player],
      hostId: socket.id,
      category,
      ...resetRoomForNewGame({})
    };
    socket.join(roomId);
    io.to(roomId).emit('updateRoom', rooms[roomId]);
  });

  socket.on('joinRoom', ({ playerName, roomId }) => {
    if (!rooms[roomId]) return socket.emit('error', { message: 'Room not found' });
    if (rooms[roomId].gameState !== 'waiting') return socket.emit('error', { message: 'Game has already started' });
    const player = { id: socket.id, name: playerName, score: 0 };
    rooms[roomId].players.push(player);
    socket.join(roomId);
    io.to(roomId).emit('updateRoom', rooms[roomId]);
  });

  socket.on('startGame', ({ roomId }) => {
    console.log(`[RECEIVE] startGame event for room: ${roomId} from host: ${socket.id}`);
    let room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return socket.emit('error', { message: 'Only the host can start the game.' });
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players to start.' });

    // Reset state for a new round, but keep players and scores
    room = resetRoomForNewGame(room);
    room.gameState = 'playing';

    const liarIndex = Math.floor(Math.random() * room.players.length);
    room.liarId = room.players[liarIndex].id;
    const categoryWords = wordsData[room.category];
    const wordIndex = Math.floor(Math.random() * categoryWords.length);
    room.word = categoryWords[wordIndex];
    const firstTurnIndex = Math.floor(Math.random() * room.players.length);
    room.turn = room.players[firstTurnIndex].id;

    room.players.forEach(player => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (!playerSocket) return;
        const isLiar = player.id === room.liarId;
        playerSocket.emit('gameStarted', {
            role: isLiar ? 'Liar' : 'Citizen',
            category: room.category,
            word: isLiar ? null : room.word,
        });
    });
    io.to(roomId).emit('updateRoom', room);
  });

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
        } else {
            const liar = room.players.find(p => p.id === room.liarId);
            if(liar) liar.score += 1;
            room.gameState = 'finished';
        }
    }
    io.to(roomId).emit('updateRoom', room);
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
    room.gameState = 'finished';
    io.to(roomId).emit('updateRoom', room);
  });

  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    const roomId = Object.keys(rooms).find(key => rooms[key] && rooms[key].players.some(p => p.id === socket.id));
    if (!roomId || !rooms[roomId]) return;
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
