const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;
const HINT_TIMER_DURATION = 30;
const VOTE_TIMER_DURATION = 20;

const wordsData = JSON.parse(fs.readFileSync("./words.json", "utf8"));
const rooms = {};
const activeTimers = {};

function startTimer(roomId, duration, onEnd) {
  if (activeTimers[roomId]) {
    clearInterval(activeTimers[roomId]);
  }
  const room = rooms[roomId];
  if (!room) return;
  room.timer = duration;
  io.to(roomId).emit("timerUpdate", room.timer);
  activeTimers[roomId] = setInterval(() => {
    if (rooms[roomId]) {
      rooms[roomId].timer -= 1;
      io.to(roomId).emit("timerUpdate", rooms[roomId].timer);
      if (rooms[roomId].timer <= 0) {
        clearInterval(activeTimers[roomId]);
        delete activeTimers[roomId];
        onEnd();
      }
    }
  }, 1000);
}

function stopTimer(roomId) {
  if (activeTimers[roomId]) {
    clearInterval(activeTimers[roomId]);
    delete activeTimers[roomId];
    if (rooms[roomId]) {
      rooms[roomId].timer = null;
      io.to(roomId).emit("timerUpdate", null);
    }
  }
}

const generateRoomId = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();
const generatePersistentId = () => crypto.randomUUID();

const getDefaultRoomSettings = () => ({
  selectedCategories: ["영화"],
  targetScore: 5,
  gameMode: "normal",
  liarGuessType: "text",
  hintType: "text",
});

const resetRoundState = (room) => {
  room.gameState = "waiting";
  room.word = null;
  room.liarId = null;
  room.turn = null;
  room.hints = [];
  room.votes = {};
  room.voteResult = null;
  room.liarGuessResult = null;
  room.currentCategory = null;
  room.liarGuessCards = [];
  room.messages = [];
  if (room.roomId) stopTimer(room.roomId);
  return room;
};

const endRound = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;
  const winner = room.players.find((p) => p.score >= room.targetScore);
  if (winner) room.gameState = "finished";
  else room.gameState = "roundOver";
  io.to(roomId).emit("updateRoom", room);
};

const tallyVotes = (roomId) => {
  const room = rooms[roomId];
  if (!room || room.gameState !== "voting") return;

  const voteCounts = {};
  const allPlayers = room.players.map((p) => p.id);
  const votedPlayers = Object.values(room.votes);

  const votesToTally =
    votedPlayers.length > 0
      ? votedPlayers
      : [allPlayers[Math.floor(Math.random() * allPlayers.length)]];

  votesToTally.forEach((vote) => {
    voteCounts[vote] = (voteCounts[vote] || 0) + 1;
  });

  const mostVotedId = Object.keys(voteCounts).reduce((a, b) =>
    voteCounts[a] > voteCounts[b] ? a : b
  );
  const mostVotedPlayer = room.players.find((p) => p.id === mostVotedId);
  const isLiar = mostVotedId === room.liarId;
  room.voteResult = { mostVotedPlayer, isLiar };

  room.gameState = "liarGuess";
  if (isLiar) {
    room.players.forEach((p) => {
      if (p.id !== room.liarId) p.score += 1;
    });
  } else {
    const liar = room.players.find((p) => p.id === room.liarId);
    if (liar) liar.score += 1;
  }

  if (room.liarGuessType === "card") {
    const correctWord = room.word;
    const categoryWords = wordsData[room.currentCategory];
    const decoys = categoryWords.filter((w) => w !== correctWord);
    const shuffledDecoys = decoys.sort(() => 0.5 - Math.random());
    const selectedDecoys = shuffledDecoys.slice(0, 5);
    const cards = [...selectedDecoys, correctWord];
    room.liarGuessCards = cards.sort(() => 0.5 - Math.random());
  }

  const liarSocket = io.sockets.sockets.get(room.liarId);
  if (liarSocket) liarSocket.emit("youWereTheLiar");
  io.to(roomId).emit("updateRoom", room);
};

const handleTimeout = (roomId, phase) => {
  const room = rooms[roomId];
  if (!room) return;

  if (phase === "hint" && room.gameState === "playing") {
    const currentPlayer = room.players.find((p) => p.id === room.turn);
    if (currentPlayer)
      room.hints.push({ player: currentPlayer, type: "text", content: "" }); // Submit empty hint

    const currentPlayerIndex = room.players.findIndex(
      (p) => p.id === room.turn
    );
    const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    room.turn = room.players[nextPlayerIndex].id;

    if (room.hints.length === room.players.length) {
      room.gameState = "voting";
      room.turn = null;
      startTimer(roomId, VOTE_TIMER_DURATION, () =>
        handleTimeout(roomId, "vote")
      );
    } else {
      startTimer(roomId, HINT_TIMER_DURATION, () =>
        handleTimeout(roomId, "hint")
      );
    }
    io.to(roomId).emit("updateRoom", room);
  } else if (phase === "vote" && room.gameState === "voting") {
    tallyVotes(roomId);
  }
};

io.on("connection", (socket) => {
  const createPlayer = (name) => ({
    id: socket.id,
    persistentId: generatePersistentId(),
    name,
    score: 0,
  });

  socket.on("createRoom", ({ playerName }) => {
    const roomId = generateRoomId();
    const player = createPlayer(playerName);
    rooms[roomId] = {
      roomId,
      players: [player],
      hostId: socket.id,
      ...getDefaultRoomSettings(),
      ...resetRoundState({ roomId }),
    };
    socket.join(roomId);
    socket.emit("roomCreated", rooms[roomId]);
  });

  socket.on("updateSettings", ({ roomId, newSettings }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id || room.gameState !== "waiting")
      return;
    if (newSettings.selectedCategories)
      room.selectedCategories = newSettings.selectedCategories;
    if (newSettings.targetScore) room.targetScore = newSettings.targetScore;
    if (newSettings.gameMode) room.gameMode = newSettings.gameMode;
    if (newSettings.liarGuessType)
      room.liarGuessType = newSettings.liarGuessType;
    if (newSettings.hintType) room.hintType = newSettings.hintType;
    io.to(roomId).emit("updateRoom", room);
  });

  socket.on("joinRoom", ({ playerName, roomId }) => {
    if (!rooms[roomId])
      return socket.emit("error", { message: "방을 찾을 수 없습니다." });
    if (rooms[roomId].gameState !== "waiting")
      return socket.emit("error", { message: "이미 시작된 게임입니다." });
    const player = createPlayer(playerName);
    rooms[roomId].players.push(player);
    socket.join(roomId);
    io.to(roomId).emit("updateRoom", rooms[roomId]);
  });

  socket.on("reconnectPlayer", ({ persistentId, roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const oldPlayer = room.players.find((p) => p.persistentId === persistentId);
    if (oldPlayer) {
      const wasHost = room.hostId === oldPlayer.id;
      oldPlayer.id = socket.id;
      if (wasHost) {
        room.hostId = socket.id;
      }
      socket.join(roomId);
      io.to(roomId).emit("updateRoom", room);
    } else {
      socket.emit("error", {
        message: "재접속에 실패했습니다. 플레이어를 찾을 수 없습니다.",
      });
    }
  });

  socket.on("startGame", ({ roomId }) => {
    let room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2)
      return socket.emit("error", {
        message: "최소 2명의 플레이어가 필요합니다.",
      });
    room = resetRoundState(room);
    room.gameState = "playing";
    const randomCategoryIndex = Math.floor(
      Math.random() * room.selectedCategories.length
    );
    const currentCategory = room.selectedCategories[randomCategoryIndex];
    room.currentCategory = currentCategory;
    const liarIndex = Math.floor(Math.random() * room.players.length);
    room.liarId = room.players[liarIndex].id;
    const categoryWords = wordsData[currentCategory];
    let citizenWord, liarWord;
    if (room.gameMode === "fool" && categoryWords.length > 1) {
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
    room.players.forEach((player) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (!playerSocket) return;
      const isLiar = player.id === room.liarId;
      if (room.gameMode === "fool") {
        playerSocket.emit("gameStarted", {
          role: "Citizen",
          category: currentCategory,
          word: isLiar ? liarWord : citizenWord,
        });
      } else {
        playerSocket.emit("gameStarted", {
          role: isLiar ? "Liar" : "Citizen",
          category: currentCategory,
          word: isLiar ? null : citizenWord,
        });
      }
    });
    startTimer(roomId, HINT_TIMER_DURATION, () =>
      handleTimeout(roomId, "hint")
    );
    io.to(roomId).emit("updateRoom", room);
  });

  socket.on("submitHint", ({ roomId, hintData }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== "playing" || room.turn !== socket.id)
      return;
    const player = room.players.find((p) => p.id === socket.id);
    room.hints.push({ player, type: hintData.type, content: hintData.content });
    const currentPlayerIndex = room.players.findIndex(
      (p) => p.id === socket.id
    );
    const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
    room.turn = room.players[nextPlayerIndex].id;
    if (room.hints.length === room.players.length) {
      room.gameState = "voting";
      room.turn = null;
      stopTimer(roomId);
      startTimer(roomId, VOTE_TIMER_DURATION, () =>
        handleTimeout(roomId, "vote")
      );
    } else {
      startTimer(roomId, HINT_TIMER_DURATION, () =>
        handleTimeout(roomId, "hint")
      );
    }
    io.to(roomId).emit("updateRoom", room);
  });

  socket.on("submitVote", ({ roomId, votedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== "voting" || room.votes[socket.id]) return;
    room.votes[socket.id] = votedPlayerId;
    if (Object.keys(room.votes).length === room.players.length) {
      stopTimer(roomId);
      tallyVotes(roomId);
    } else {
      io.to(roomId).emit("updateRoom", room);
    }
  });

  socket.on("submitLiarGuess", ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== "liarGuess" || socket.id !== room.liarId)
      return;
    const correctGuess = guess.trim().toLowerCase() === room.word.toLowerCase();
    if (correctGuess) {
      const liar = room.players.find((p) => p.id === room.liarId);
      if (liar) liar.score += 1;
    }
    room.liarGuessResult = { guess, correct: correctGuess };
    endRound(roomId);
  });

  socket.on("sendMessage", ({ roomId, message }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    const chatMessage = {
      sender: player.name,
      message,
      timestamp: new Date().toISOString(),
    };
    room.messages.push(chatMessage);
    io.to(roomId).emit("newMessage", chatMessage);
  });

  socket.on("restartGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    room.players.forEach((p) => (p.score = 0));
    rooms[roomId] = {
      ...room,
      ...resetRoundState(room),
      ...getDefaultRoomSettings(),
    };
    io.to(roomId).emit("updateRoom", rooms[roomId]);
  });

  socket.on("disconnect", () => {
    setTimeout(() => {
      const roomId = Object.keys(rooms).find(
        (key) => rooms[key] && rooms[key].players.some((p) => p.id === socket.id)
      );
      if (!roomId || !rooms[roomId]) return;
      const player = rooms[roomId].players.find((p) => p.id === socket.id);
      if (!player) return;
      rooms[roomId].players = rooms[roomId].players.filter(
        (p) => p.id !== socket.id
      );
      if (rooms[roomId].players.length === 0) {
        delete rooms[roomId];
        return;
      }
      if (rooms[roomId].hostId === socket.id) {
        rooms[roomId].hostId = rooms[roomId].players[0].id;
      }
      io.to(roomId).emit("updateRoom", rooms[roomId]);
    }, 5000); // 5초의 유예 시간
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
