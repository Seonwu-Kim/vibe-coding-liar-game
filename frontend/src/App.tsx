import React, { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, useParams, useNavigate, useLocation } from "react-router-dom";
import io from "socket.io-client";
import "./App.css";

// Type definitions
interface Player {
  id: string;
  persistentId: string;
  name: string;
  score: number;
}
interface Hint {
  player: Player;
  type: "text" | "drawing";
  content: string;
}
interface VoteResult {
  mostVotedPlayer: Player;
  isLiar: boolean;
}
interface LiarGuessResult {
  guess: string;
  correct: boolean;
}

interface ChatMessage {
  sender: string;
  message: string;
  timestamp: string;
}

interface Room {
  roomId: string;
  players: Player[];
  hostId: string;
  selectedCategories: string[];
  currentCategory: string | null;
  targetScore: number;
  gameMode: "normal" | "fool";
  liarGuessType: "text" | "card";
  hintType: "text" | "drawing";
  liarGuessCards: string[];
  messages: ChatMessage[];
  gameState:
    | "waiting"
    | "playing"
    | "voting"
    | "liarGuess"
    | "roundOver"
    | "finished";
  word: string | null;
  liarId: string | null;
  turn: string | null;
  hints: Hint[];
  votes?: { [key: string]: string };
  voteResult: VoteResult | null;
  liarGuessResult: LiarGuessResult | null;
  timer: number | null;
}

interface GameStartPayload {
  role: "Liar" | "Citizen";
  category: string;
  word?: string | null;
}

const socket = io("https://liar-game-zno1.onrender.com");
// const socket = io("http://localhost:3001");
const ALL_CATEGORIES = [
  "영화",
  "음식",
  "동물",
  "IT용어",
  "롤 챔피언",
  "게임",
  "연예인",
  "직업",
];

// --- NEW DRAWING CANVAS COMPONENT ---
interface DrawingCanvasProps {
  onSubmit: (dataUrl: string) => void;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ onSubmit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("black");

  const colors = ["black", "red", "blue", "green", "yellow", "orange", "purple", "white"];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Ensure canvas size is set after it has been rendered in the DOM
    setTimeout(() => {
      if (canvas.offsetWidth > 0) {
        canvas.width = canvas.offsetWidth;
        canvas.height = 300;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.lineCap = "round";
        context.strokeStyle = color;
        context.lineWidth = 3;
        contextRef.current = context;
      }
    }, 0);
  }, []);

  useEffect(() => {
    if (contextRef.current) {
      contextRef.current.strokeStyle = color;
    }
  }, [color]);

  const startDrawing = ({
    nativeEvent,
  }: React.MouseEvent<HTMLCanvasElement>) => {
    const { offsetX, offsetY } = nativeEvent;
    contextRef.current?.beginPath();
    contextRef.current?.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const stopDrawing = () => {
    contextRef.current?.closePath();
    setIsDrawing(false);
  };

  const draw = ({ nativeEvent }: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = nativeEvent;
    contextRef.current?.lineTo(offsetX, offsetY);
    contextRef.current?.stroke();
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas && contextRef.current) {
      contextRef.current.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleSubmit = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL("image/png");
      onSubmit(dataUrl);
    }
  };

  return (
    <div className="w-100">
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseMove={draw}
        onMouseLeave={stopDrawing}
        className="border border-dark w-100 bg-white"
      />
      <div className="d-flex justify-content-between align-items-center mt-2">
        <div className="d-flex gap-2">
          {colors.map((c) => (
            <button
              key={c}
              className="btn btn-sm"
              style={{ backgroundColor: c, width: "30px", height: "30px" }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-secondary" onClick={() => setColor("white")}>
            지우개
          </button>
          <button className="btn btn-secondary" onClick={handleClear}>
            전체 지우기
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            힌트 제출
          </button>
        </div>
      </div>
    </div>
  );
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/room/:roomId" element={<Game />} />
      </Routes>
    </BrowserRouter>
  );
}

function Game() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [room, setRoom] = useState<Room | null>(location.state?.room || null);
  const [playerInfo, setPlayerInfo] = useState<GameStartPayload | null>(null);
  const [wasLiar, setWasLiar] = useState(false);
  const [timer, setTimer] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sounds, setSounds] = useState<{
    [key: string]: HTMLAudioElement;
  }>({});

  useEffect(() => {
    const soundFiles = {
      gameStart: "https://assets.mixkit.co/sfx/preview/mixkit-video-game-win-2016.mp3",
      hintSubmitted: "https://assets.mixkit.co/sfx/preview/mixkit-quick-win-video-game-2010.mp3",
      votingStarts: "https://assets.mixkit.co/sfx/preview/mixkit-arcade-retro-game-over-213.mp3",
      liarRevealedCorrect: "https://assets.mixkit.co/sfx/preview/mixkit-positive-interface-beep-221.mp3",
      liarRevealedIncorrect: "https://assets.mixkit.co/sfx/preview/mixkit-game-show-wrong-answer-950.mp3",
      roundEnd: "https://assets.mixkit.co/sfx/preview/mixkit-video-game-treasure-2066.mp3",
      gameEnd: "https://assets.mixkit.co/sfx/preview/mixkit-video-game-level-complete-2059.mp3",
    };

    const audioElements: { [key: string]: HTMLAudioElement } = {};
    Object.keys(soundFiles).forEach((key) => {
      audioElements[key] = new Audio(soundFiles[key as keyof typeof soundFiles]);
    });
    setSounds(audioElements);
  }, []);

  const playSound = (soundName: string) => {
    if (sounds[soundName]) {
      sounds[soundName].play();
    }
  };

  useEffect(() => {
    if (!room) return;

    switch (room.gameState) {
      case "playing":
        playSound("gameStart");
        break;
      case "voting":
        playSound("votingStarts");
        break;
      case "liarGuess":
        if (room.voteResult?.isLiar) {
          playSound("liarRevealedCorrect");
        } else {
          playSound("liarRevealedIncorrect");
        }
        break;
      case "roundOver":
        playSound("roundEnd");
        break;
      case "finished":
        playSound("gameEnd");
        break;
      default:
        break;
    }
  }, [room?.gameState]);

  useEffect(() => {
    const persistentId = localStorage.getItem("liarGamePlayerId");
    const storedRoomId = localStorage.getItem("liarGameRoomId");

    if (persistentId && roomId === storedRoomId) {
      socket.emit("reconnectPlayer", { persistentId, roomId });
    }

    socket.on("updateRoom", (updatedRoom: Room) => {
      if (updatedRoom.roomId !== roomId) return;
      setRoom(updatedRoom);
      setMessages(updatedRoom.messages || []);
      const me = updatedRoom.players.find((p) => p.id === socket.id);
      if (me) {
        localStorage.setItem("liarGamePlayerId", me.persistentId);
        localStorage.setItem("liarGameRoomId", updatedRoom.roomId);
      }
      if (updatedRoom.gameState === "waiting") {
        setPlayerInfo(null);
        setWasLiar(false);
      }
    });

    socket.on("gameStarted", (payload: GameStartPayload) => {
      setPlayerInfo(payload);
      setWasLiar(payload.role === "Liar");
    });

    socket.on("youWereTheLiar", () => {
      setWasLiar(true);
    });

    socket.on("timerUpdate", (newTime: number | null) => {
      setTimer(newTime);
    });

    socket.on("newMessage", (message: ChatMessage) => {
      setMessages((prevMessages) => [...prevMessages, message]);
    });

    socket.on("error", (error: { message: string }) => {
      alert(error.message);
      navigate("/");
    });

    return () => {
      socket.off("updateRoom");
      socket.off("gameStarted");
      socket.off("youWereTheLiar");
      socket.off("timerUpdate");
      socket.off("newMessage");
      socket.off("error");
    };
  }, [roomId, navigate]);

  if (!room) {
    return <JoinRoom />;
  }

  return (
    <GameRoom
      room={room}
      playerInfo={playerInfo}
      wasLiar={wasLiar}
      timer={timer}
      messages={messages}
      playSound={playSound}
    />
  );
}

const Lobby = () => {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState(
    localStorage.getItem("liarGamePlayerName") || ""
  );

  useEffect(() => {
    localStorage.setItem("liarGamePlayerName", playerName);
  }, [playerName]);

  const handleCreateRoom = () => {
    if (!playerName) {
      alert("이름을 입력해주세요.");
      return;
    }
    socket.emit("createRoom", { playerName });
  };

  useEffect(() => {
    const handleRoomCreated = (room: Room) => {
      navigate(`/room/${room.roomId}`, { state: { room } });
    };
    socket.on("roomCreated", handleRoomCreated);

    return () => {
      socket.off("roomCreated", handleRoomCreated);
    };
  }, [navigate]);

  return (
    <div className="container text-center">
      <div className="row justify-content-center">
        <div className="col-md-6">
          <h1 className="my-4">라이어 게임</h1>
          <div className="card p-4">
            <h2 className="mb-4">새로운 게임 시작</h2>
            <input
              type="text"
              className="form-control mb-3"
              placeholder="이름을 입력하세요"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
            />
            <div className="d-grid gap-2">
              <button className="btn btn-primary" onClick={handleCreateRoom}>
                방 만들기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const JoinRoom = () => {
  const { roomId } = useParams();
  const [playerName, setPlayerName] = useState(
    localStorage.getItem("liarGamePlayerName") || ""
  );

  useEffect(() => {
    localStorage.setItem("liarGamePlayerName", playerName);
  }, [playerName]);

  const handleJoinRoom = () => {
    if (!playerName) {
      alert("이름을 입력해주세요.");
      return;
    }
    socket.emit("joinRoom", { playerName, roomId });
  };

  return (
    <div className="container text-center">
      <div className="row justify-content-center">
        <div className="col-md-6">
          <h1 className="my-4">라이어 게임</h1>
          <div className="card p-4">
            <h2 className="mb-4">게임에 참가하기</h2>
            <input
              type="text"
              className="form-control mb-3"
              placeholder="이름을 입력하세요"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
            />
            <div className="d-grid gap-2">
              <button className="btn btn-primary" onClick={handleJoinRoom}>
                참가하기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface GameRoomProps {
  room: Room;
  playerInfo: GameStartPayload | null;
  wasLiar: boolean;
  timer: number | null;
  messages: ChatMessage[];
  playSound: (soundName: string) => void;
}

const Chat = ({ roomId, messages }: { roomId: string; messages: ChatMessage[] }) => {
  const [message, setMessage] = useState("");
  const chatBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = () => {
    if (message.trim()) {
      socket.emit("sendMessage", { roomId, message });
      setMessage("");
    }
  };

  return (
    <div className="card mt-3">
      <div className="card-header">채팅</div>
      <div className="card-body chat-box" ref={chatBodyRef}>
        {messages.map((msg, index) => (
          <div key={index} className="mb-2">
            <strong>{msg.sender}:</strong> {msg.message}
          </div>
        ))}
      </div>
      <div className="card-footer">
        <div className="input-group">
          <input
            type="text"
            className="form-control"
            placeholder="메시지를 입력하세요"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
          />
          <button className="btn btn-primary" onClick={handleSendMessage}>
            전송
          </button>
        </div>
      </div>
    </div>
  );
};

const GameSettings = ({ room, isHost }: { room: Room; isHost: boolean }) => {
  const [settings, setSettings] = useState({
    selectedCategories: room.selectedCategories,
    targetScore: room.targetScore,
    gameMode: room.gameMode,
    liarGuessType: room.liarGuessType,
    hintType: room.hintType,
  });

  useEffect(() => {
    setSettings({
      selectedCategories: room.selectedCategories,
      targetScore: room.targetScore,
      gameMode: room.gameMode,
      liarGuessType: room.liarGuessType,
      hintType: room.hintType,
    });
  }, [room]);

  const handleSettingsChange = (newSettings: Partial<typeof settings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    socket.emit("updateSettings", {
      roomId: room.roomId,
      newSettings: updatedSettings,
    });
  };

  const handleCategoryChange = (category: string) => {
    const newCategories = settings.selectedCategories.includes(category)
      ? settings.selectedCategories.filter((c) => c !== category)
      : [...settings.selectedCategories, category];

    if (newCategories.length === 0) {
      alert("최소 1개의 주제는 선택해야 합니다.");
      return;
    }
    handleSettingsChange({ selectedCategories: newCategories });
  };

  if (!isHost) {
    return (
      <div className="card-body text-center py-2">
        <p className="text-muted mb-1">
          방장이 게임 설정을 변경하고 있습니다. 잠시만 기다려주세요...
        </p>
        <div className="mt-2">
          <h6 className="mb-1">선택된 주제: {room.selectedCategories.join(", ")}</h6>
          <h6 className="mb-1">목표 점수: {room.targetScore}</h6>
          <h6 className="mb-1">
            게임 모드: {room.gameMode === "fool" ? "바보 모드" : "일반 모드"}
          </h6>
          <h6 className="mb-1">
            라이어 추측 방식:{" "}
            {room.liarGuessType === "card" ? "카드 선택" : "텍스트 입력"}
          </h6>
          <h6>
            힌트 방식: {room.hintType === "drawing" ? "그림판" : "텍스트"}
          </h6>
        </div>
      </div>
    );
  }

  return (
    <div className="card-body py-2">
      <h5 className="card-title">게임 설정</h5>
      <div className="mb-3">
        <label className="form-label">주제 선택 (1개 이상)</label>
        <div className="d-flex flex-wrap">
          {ALL_CATEGORIES.map((category) => (
            <div key={category} className="form-check form-check-inline">
              <input
                className="form-check-input"
                type="checkbox"
                id={`category-${category}`}
                value={category}
                checked={settings.selectedCategories.includes(category)}
                onChange={() => handleCategoryChange(category)}
              />
              <label
                className="form-check-label"
                htmlFor={`category-${category}`}
              >
                {category}
              </label>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <label className="form-label">목표 점수</label>
        <input
          type="number"
          className="form-control"
          value={settings.targetScore}
          onChange={(e) =>
            handleSettingsChange({
              targetScore: parseInt(e.target.value, 10) || 1,
            })
          }
          min="1"
        />
      </div>
      <div className="mb-3">
        <label className="form-label">게임 모드</label>
        <div className="d-flex">
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="gameMode"
              id="normalMode"
              value="normal"
              checked={settings.gameMode === "normal"}
              onChange={(e) =>
                handleSettingsChange({
                  gameMode: e.target.value as "normal" | "fool",
                })
              }
            />
            <label className="form-check-label" htmlFor="normalMode">
              일반 모드
            </label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="gameMode"
              id="foolMode"
              value="fool"
              checked={settings.gameMode === "fool"}
              onChange={(e) =>
                handleSettingsChange({
                  gameMode: e.target.value as "normal" | "fool",
                })
              }
            />
            <label className="form-check-label" htmlFor="foolMode">
              바보 모드
            </label>
          </div>
        </div>
      </div>
      <div className="mb-3">
        <label className="form-label">라이어 추측 방식</label>
        <div className="d-flex">
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="liarGuessType"
              id="textGuess"
              value="text"
              checked={settings.liarGuessType === "text"}
              onChange={(e) =>
                handleSettingsChange({
                  liarGuessType: e.target.value as "text" | "card",
                })
              }
            />
            <label className="form-check-label" htmlFor="textGuess">
              텍스트 입력
            </label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="liarGuessType"
              id="cardGuess"
              value="card"
              checked={settings.liarGuessType === "card"}
              onChange={(e) =>
                handleSettingsChange({
                  liarGuessType: e.target.value as "text" | "card",
                })
              }
            />
            <label className="form-check-label" htmlFor="cardGuess">
              카드 선택
            </label>
          </div>
        </div>
      </div>
      <div className="mb-3">
        <label className="form-label">힌트 방식</label>
        <div className="d-flex">
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="hintType"
              id="textHint"
              value="text"
              checked={settings.hintType === "text"}
              onChange={(e) =>
                handleSettingsChange({
                  hintType: e.target.value as "text" | "drawing",
                })
              }
            />
            <label className="form-check-label" htmlFor="textHint">
              텍스트
            </label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="hintType"
              id="drawingHint"
              value="drawing"
              checked={settings.hintType === "drawing"}
              onChange={(e) =>
                handleSettingsChange({
                  hintType: e.target.value as "text" | "drawing",
                })
              }
            />
            <label className="form-check-label" htmlFor="drawingHint">
              그림판
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

const TimerDisplay = ({
  timer,
  gameState,
}: {
  timer: number | null;
  gameState: Room["gameState"];
}) => {
  if (timer === null || (gameState !== "playing" && gameState !== "voting")) {
    return null;
  }
  const message = gameState === "playing" ? "힌트 제출까지" : "투표 마감까지";
  return (
    <div className="timer-display alert alert-warning text-center py-2">
      <span className="me-2">{message}</span>
      <strong>{timer}초</strong>
    </div>
  );
};

const GameRoom: React.FC<GameRoomProps> = ({
  room,
  playerInfo,
  wasLiar,
  timer,
  messages,
  playSound,
}) => {
  const navigate = useNavigate();
  const isHost = socket.id === room.hostId;
  const myTurn = socket.id === room.turn;
  const hasVoted = socket.id && room.votes ? !!room.votes[socket.id] : false;

  const [hint, setHint] = useState("");
  const [liarGuess, setLiarGuess] = useState("");
  const [showCopyMessage, setShowCopyMessage] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const hintInputRef = useRef<HTMLInputElement>(null);

  const voteCounts: { [key: string]: number } = {};
  if (room.votes) {
    for (const votedPlayerId of Object.values(room.votes)) {
      voteCounts[votedPlayerId] = (voteCounts[votedPlayerId] || 0) + 1;
    }
  }

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [room.hints, room.voteResult, room.liarGuessResult]);

  useEffect(() => {
    if (myTurn && room.gameState === "playing" && room.hintType === "text") {
      hintInputRef.current?.focus();
    }
  }, [myTurn, room.gameState, room.hintType]);

  const handleStartNextRound = () =>
    socket.emit("startGame", { roomId: room.roomId });
  const handleRestartGame = () =>
    socket.emit("restartGame", { roomId: room.roomId });
  const handleSubmitHint = (hintData: {
    type: "text" | "drawing";
    content: string;
  }) => {
    if (!hintData.content.trim()) return alert("힌트를 입력해주세요.");
    socket.emit("submitHint", { roomId: room.roomId, hintData });
    setHint("");
    playSound("hintSubmitted");
  };
  const handleVote = (votedPlayerId: string) =>
    socket.emit("submitVote", { roomId: room.roomId, votedPlayerId });
  const handleLiarGuess = (guess: string) => {
    if (!guess.trim()) return alert("추측 단어를 입력해주세요.");
    socket.emit("submitLiarGuess", { roomId: room.roomId, guess });
    setLiarGuess("");
  };
  const handleLeaveRoom = () => {
    localStorage.removeItem("liarGamePlayerId");
    localStorage.removeItem("liarGameRoomId");
    navigate("/");
  };
  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${room.roomId}`).then(() => {
      setShowCopyMessage(true);
      setTimeout(() => setShowCopyMessage(false), 2000);
    });
  };

  const turnPlayer = room.players.find((p) => p.id === room.turn);
  const winner = room.players.find((p) => p.score >= room.targetScore);
  const showLiarGuessInput = room.gameState === "liarGuess" && wasLiar;

  return (
    <div className="container mt-4">
      <div className="row">
        <div className="col-md-8">
          <TimerDisplay timer={timer} gameState={room.gameState} />
          {room.gameState === "waiting" ? (
            <div className="card">
              <div className="card-header">
                <h4>게임 설정</h4>
              </div>
              <GameSettings room={room} isHost={isHost} />
            </div>
          ) : (
            <>
              {playerInfo && (
                <div className="card mb-2">
                  <div className="card-body py-2">
                    <h5 className="card-title">
                      당신은{" "}
                      <span
                        className={
                          playerInfo.role === "Liar"
                            ? "text-danger"
                            : "text-success"
                        }
                      >
                        {playerInfo.role === "Liar" ? "라이어" : "시민"}
                      </span>{" "}
                      입니다
                    </h5>
                    <p className="card-text mb-0">
                      이번 라운드 주제: {playerInfo.category}
                    </p>
                    {playerInfo.word ? (
                      <p className="card-text mb-0">
                        제시어: <strong>{playerInfo.word}</strong>
                      </p>
                    ) : (
                      room.gameMode !== "fool" && (
                        <p className="card-text mb-0 text-danger">
                          당신은 라이어입니다. 제시어를 추리하세요!
                        </p>
                      )
                    )}
                  </div>
                </div>
              )}
              <div className={`card ${myTurn && room.gameState === "playing" ? "current-turn-highlight" : ""}`}>
                <div className="card-header">
                  <h4>게임 현황</h4>
                </div>
                <div className="card-body chat-box" ref={chatBodyRef} style={{ height: "400px", overflowY: "auto" }}>
                  {room.hints.map((h, index) => (
                    <div key={index} className="mb-2">
                      <strong>{h.player.name}:</strong>
                      {h.type === "text" ? (
                        <p className="card-text d-inline ms-2">{h.content}</p>
                      ) : (
                        <img
                          src={h.content}
                          alt={`${h.player.name}의 힌트`}
                          className="img-fluid border rounded mt-1"
                        />
                      )}
                    </div>
                  ))}
                  {room.gameState === "playing" && turnPlayer && (
                    <p className="text-muted">
                      <em>{turnPlayer.name}님의 차례입니다...</em>
                    </p>
                  )}
                  {room.gameState === "voting" && (
                    <p className="text-primary">
                      <em>
                        모든 힌트가 제출되었습니다! 라이어라고 생각하는 사람에게
                        투표하세요.
                      </em>
                    </p>
                  )}
                  {room.voteResult && (
                    <div
                      className={`alert mt-3 ${
                        room.voteResult.isLiar
                          ? "alert-success"
                          : "alert-danger"
                      }`}
                    >
                      <h5>투표 결과</h5>
                      <p>
                        {room.voteResult.mostVotedPlayer.name}님이
                        지목되었습니다.
                      </p>
                      <p>
                        <strong>
                          그는{" "}
                          {room.voteResult.isLiar
                            ? "라이어였습니다!"
                            : "시민이었습니다."}
                        </strong>
                      </p>
                    </div>
                  )}
                  {room.liarGuessResult && (
                    <div
                      className={`alert mt-3 ${
                        room.liarGuessResult.correct
                          ? "alert-success"
                          : "alert-danger"
                      }`}
                    >
                      <h5>라이어의 추측</h5>
                      <p>라이어의 추측: "{room.liarGuessResult.guess}"</p>
                      <p>
                        <strong>
                          추측이{" "}
                          {room.liarGuessResult.correct
                            ? "정확했습니다!"
                            : "틀렸습니다."}
                        </strong>
                      </p>
                    </div>
                  )}
                  {(room.gameState === "roundOver" ||
                    room.gameState === "finished") && (
                    <div className="alert alert-info mt-3">
                      <h4>
                        {room.gameState === "finished"
                          ? "최종 우승!"
                          : "라운드 종료!"}
                      </h4>
                      {room.gameState === "finished" && winner && (
                        <p>
                          <strong>{winner.name}</strong> 님이 목표 점수{" "}
                          {room.targetScore}점에 도달하여 최종 우승했습니다!
                        </p>
                      )}
                      <p>
                        정답은 '<strong>{room.word}</strong>'였습니다.
                      </p>
                    </div>
                  )}
                </div>
                {room.gameState === "playing" && myTurn && (
                  <div className="card-footer">
                    {room.hintType === "drawing" ? (
                      <DrawingCanvas
                        onSubmit={(dataUrl) =>
                          handleSubmitHint({
                            type: "drawing",
                            content: dataUrl,
                          })
                        }
                      />
                    ) : (
                      <div className="input-group">
                        <input
                          ref={hintInputRef}
                          type="text"
                          className="form-control"
                          placeholder="힌트를 입력하세요"
                          value={hint}
                          onChange={(e) => setHint(e.target.value)}
                          onKeyPress={(e) =>
                            e.key === "Enter" &&
                            handleSubmitHint({ type: "text", content: hint })
                          }
                        />
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            handleSubmitHint({ type: "text", content: hint })
                          }
                        >
                          제출
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {showLiarGuessInput && (
                  <div className="card-footer">
                    {room.liarGuessType === "card" ? (
                      <div>
                        <p className="text-center mb-2">
                          제시어라고 생각되는 카드를 고르세요!
                        </p>
                        <div className="d-flex flex-wrap justify-content-center gap-2">
                          {room.liarGuessCards.map((cardWord) => (
                            <button
                              key={cardWord}
                              className="btn btn-outline-primary"
                              onClick={() => handleLiarGuess(cardWord)}
                            >
                              {cardWord}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="input-group">
                        <input
                          type="text"
                          className="form-control"
                          placeholder="단어를 맞혀보세요!"
                          value={liarGuess}
                          onChange={(e) => setLiarGuess(e.target.value)}
                          onKeyPress={(e) =>
                            e.key === "Enter" && handleLiarGuess(liarGuess)
                          }
                        />
                        <button
                          className="btn btn-danger"
                          onClick={() => handleLiarGuess(liarGuess)}
                        >
                          최종 추측
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="col-md-4">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center position-relative">
                <h3>방: {room.roomId}</h3>
                <button
                  className="btn btn-sm btn-outline-secondary ms-2"
                  onClick={handleCopyRoomId}
                  title="방 ID 복사"
                >
                  <i className="bi bi-clipboard"></i>
                </button>
                {showCopyMessage && (
                  <span className="copy-tooltip">복사 완료!</span>
                )}
              </div>
              <button
                className="btn btn-sm btn-outline-danger"
                onClick={handleLeaveRoom}
              >
                방 나가기
              </button>
            </div>
            <div className="card-body">
              <h5 className="card-title">
                플레이어 ({room.players.length}) / 목표: {room.targetScore}점
              </h5>
              <p className="card-subtitle mb-2 text-muted">
                게임 모드:{" "}
                {room.gameMode === "fool" ? "바보 모드" : "일반 모드"}
              </p>
              <ul className="list-group mb-3">
                {room.players.map((player) => {
                  const count = voteCounts[player.id] || 0;
                  return (
                    <li
                      key={player.persistentId}
                      className={`list-group-item d-flex justify-content-between align-items-center ${
                        room.turn === player.id ? "active" : ""
                      }`}
                    >
                      <div>
                        {player.name}
                        {room.hostId === player.id && (
                          <span className="badge bg-primary ms-2">방장</span>
                        )}
                        {count > 0 && (
                          <span className="badge bg-danger ms-2">
                            {count} 표
                          </span>
                        )}
                      </div>
                      <span className="badge bg-info">{player.score}점</span>
                      {room.gameState === "voting" && (
                        <button
                          className="btn btn-sm btn-warning"
                          onClick={() => handleVote(player.id)}
                          disabled={hasVoted || player.id === socket.id}
                        >
                          투표
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {isHost && room.gameState === "waiting" && (
                <button
                  className="btn btn-success w-100"
                  onClick={handleStartNextRound}
                  disabled={room.players.length < 2}
                >
                  게임 시작 (
                  {room.players.length < 2 ? "플레이어 더 필요" : "준비 완료"})
                </button>
              )}
              {isHost && room.gameState === "roundOver" && (
                <button
                  className="btn btn-info w-100"
                  onClick={handleStartNextRound}
                >
                  다음 라운드 시작
                </button>
              )}
              {isHost && room.gameState === "finished" && (
                <button
                  className="btn btn-danger w-100"
                  onClick={handleRestartGame}
                >
                  완전히 새로 시작 (점수 초기화)
                </button>
              )}
            </div>
          </div>
          <Chat roomId={room.roomId} messages={messages} />
        </div>
      </div>
    </div>
  );
};

export default App;