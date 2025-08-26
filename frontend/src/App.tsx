import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  useLocation,
} from "react-router-dom";
import io from "socket.io-client";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";

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

// const socket = io("https://liar-game-zno1.onrender.com");
const socket = io("http://localhost:3001");
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
  const [history, setHistory] = useState<ImageData[]>([]);

  const handleUndo = useCallback(() => {
    if (history.length > 1) {
      const newHistory = history.slice(0, -1);
      setHistory(newHistory);
      const lastState = newHistory[newHistory.length - 1];
      if (lastState && contextRef.current) {
        contextRef.current.putImageData(lastState, 0, 0);
      }
    }
  }, [history, contextRef]);

  const colors = [
    "black",
    "red",
    "blue",
    "green",
    "yellow",
    "orange",
    "purple",
    "white",
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);

        saveState();
      }
    }, 0);
  }, []);

  useEffect(() => {
    if (contextRef.current) {
      contextRef.current.strokeStyle = color;
    }
  }, [color]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleUndo]);

  const saveState = () => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (canvas && context) {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      setHistory((prev) => [...prev, imageData]);
    }
  };

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
    saveState();
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
      saveState();
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
    <div className="w-full">
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseMove={draw}
        onMouseLeave={stopDrawing}
        className="border border-gray-300 rounded-lg w-full bg-white"
      />
      <div className="flex justify-between items-center mt-2">
        <div className="flex gap-2">
          {colors.map((c) => (
            <button
              key={c}
              className={`w-8 h-8 rounded-full border-2 ${
                color === c ? "border-blue-500" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-lg text-sm font-medium transition"
            onClick={() => setColor("white")}
          >
            지우개
          </button>
          <button
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-lg text-sm font-medium transition"
            onClick={handleUndo}
            disabled={history.length <= 1}
          >
            되돌리기
          </button>
          <button
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-lg text-sm font-medium transition"
            onClick={handleClear}
          >
            전체 지우기
          </button>
          <button
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            onClick={handleSubmit}
          >
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
      <div className="bg-gray-100 p-4 lg:p-8">
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/room/:roomId" element={<Game />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function Game() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [room, setRoom] = useState<Room | null>(() => {
    const persistentId = localStorage.getItem("liarGamePlayerId");
    const storedRoomId = localStorage.getItem("liarGameRoomId");
    if (persistentId && roomId === storedRoomId) {
      return null; // 재접속 시에는 room을 null로 시작
    }
    return location.state?.room || null;
  });
  const [playerInfo, setPlayerInfo] = useState<GameStartPayload | null>(null);
  const [wasLiar, setWasLiar] = useState(false);
  const [timer, setTimer] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [playerEmojis, setPlayerEmojis] = useState<{ [key: string]: string }>(
    {}
  );
  const [sounds, setSounds] = useState<{
    [key: string]: HTMLAudioElement;
  }>({});

  const isEmojiOnly = (str: string) => {
    const emojiRegex = /^(\p{Emoji_Presentation}|\s)+$/u;
    return emojiRegex.test(str.trim());
  };

  useEffect(() => {
    /*
    const soundFiles = {
      gameStart:
        "https://assets.mixkit.co/sfx/preview/mixkit-video-game-win-2016.mp3",
      hintSubmitted:
        "https://mixkit.co/sfx/preview/mixkit-quick-win-video-game-2010.mp3",
      votingStarts:
        "https://assets.mixkit.co/sfx/preview/mixkit-arcade-retro-game-over-213.mp3",
      liarRevealedCorrect:
        "https://assets.mixkit.co/sfx/preview/mixkit-positive-interface-beep-221.mp3",
      liarRevealedIncorrect:
        "https://assets.mixkit.co/sfx/preview/mixkit-game-show-wrong-answer-950.mp3",
      roundEnd:
        "https://assets.mixkit.co/sfx/preview/mixkit-video-game-treasure-2066.mp3",
      gameEnd:
        "https://assets.mixkit.co/sfx/preview/mixkit-video-game-level-complete-2059.mp3",
    };

    const audioElements: { [key: string]: HTMLAudioElement } = {};
    Object.keys(soundFiles).forEach((key) => {
      audioElements[key] = new Audio(
        soundFiles[key as keyof typeof soundFiles]
      );
    });
    setSounds(audioElements);
    */
  }, []);

  const playSound = useCallback(
    (soundName: string) => {
      if (sounds[soundName]) {
        sounds[soundName].play();
      }
    },
    [sounds]
  );

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
  }, [room?.gameState, playSound, room]);

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    const persistentId = localStorage.getItem("liarGamePlayerId");
    const storedRoomId = localStorage.getItem("liarGameRoomId");

    if (persistentId && roomId === storedRoomId && !room) {
      setReconnecting(true);
      socket.emit("reconnectPlayer", { persistentId, roomId });
    }

    const handleUpdateRoom = (updatedRoom: Room) => {
      if (updatedRoom.roomId !== roomId) return;
      setReconnecting(false);
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
    };

    const handleGameStarted = (payload: GameStartPayload) => {
      setPlayerInfo(payload);
      setWasLiar(payload.role === "Liar");
    };

    const handleYouWereTheLiar = () => {
      setWasLiar(true);
    };

    const handleTimerUpdate = (newTime: number | null) => {
      setTimer(newTime);
    };

    const handleNewMessage = (message: ChatMessage) => {
      setMessages((prevMessages) => [...prevMessages, message]);
      setRoom((prevRoom) => {
        if (prevRoom && isEmojiOnly(message.message)) {
          const sender = prevRoom.players.find((p) => p.name === message.sender);
          if (sender) {
            setPlayerEmojis((prev) => ({
              ...prev,
              [sender.persistentId]: message.message,
            }));
            setTimeout(() => {
              setPlayerEmojis((prev) => {
                const newState = { ...prev };
                delete newState[sender.persistentId];
                return newState;
              });
            }, 5000);
          }
        }
        return prevRoom;
      });
    };

    const handleError = (error: { message: string }) => {
      setReconnecting(false);
      alert(error.message);
      navigate("/");
    };

    socket.on("updateRoom", handleUpdateRoom);
    socket.on("gameStarted", handleGameStarted);
    socket.on("youWereTheLiar", handleYouWereTheLiar);
    socket.on("timerUpdate", handleTimerUpdate);
    socket.on("newMessage", handleNewMessage);
    socket.on("error", handleError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("updateRoom", handleUpdateRoom);
      socket.off("gameStarted", handleGameStarted);
      socket.off("youWereTheLiar", handleYouWereTheLiar);
      socket.off("timerUpdate", handleTimerUpdate);
      socket.off("newMessage", handleNewMessage);
      socket.off("error", handleError);
    };
  }, [roomId, navigate]);

  if (reconnecting || !isConnected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-2xl font-bold text-gray-700">
          {reconnecting ? "재접속 중입니다..." : "연결 중입니다..."}
        </div>
      </div>
    );
  }

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
      playerEmojis={playerEmojis}
    />
  );
}

const Lobby = () => {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem("liarGamePlayerName") || "";
  });

  const handleCreateRoom = () => {
    if (!playerName) {
      alert("이름을 입력해주세요.");
      return;
    }
    localStorage.setItem("liarGamePlayerName", playerName);
    socket.emit("createRoom", { playerName });
  };

  useEffect(() => {
    const handleRoomCreated = ({ room, persistentId }: { room: Room, persistentId: string }) => {
      localStorage.setItem("liarGamePlayerId", persistentId);
      localStorage.setItem("liarGameRoomId", room.roomId);
      navigate(`/room/${room.roomId}`, { state: { room } });
    };
    socket.on("roomCreated", handleRoomCreated);

    return () => {
      socket.off("roomCreated", handleRoomCreated);
    };
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md">
        <div className="bg-white p-8 rounded-xl shadow-lg">
          <h1 className="text-4xl font-bold text-center text-gray-800 mb-6">
            라이어 게임
          </h1>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg p-3 text-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="이름을 입력하세요"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <button
            className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded-lg text-lg font-bold transition"
            onClick={handleCreateRoom}
          >
            방 만들기
          </button>
        </div>
      </div>
    </div>
  );
};

const JoinRoom = () => {
  const { roomId } = useParams();
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem("liarGamePlayerName") || "";
  });

  const handleJoinRoom = () => {
    if (!playerName) {
      alert("이름을 입력해주세요.");
      return;
    }
    localStorage.setItem("liarGamePlayerName", playerName);
    socket.emit("joinRoom", { playerName, roomId });
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md">
        <div className="bg-white p-8 rounded-xl shadow-lg">
          <h1 className="text-4xl font-bold text-center text-gray-800 mb-6">
            라이어 게임
          </h1>
          <h2 className="text-2xl font-semibold text-center text-gray-600 mb-4">
            방 참가하기
          </h2>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg p-3 text-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="이름을 입력하세요"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <button
            className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded-lg text-lg font-bold transition"
            onClick={handleJoinRoom}
          >
            참가하기
          </button>
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
  playerEmojis: { [key: string]: string };
}

const Chat = ({
  roomId,
  messages,
}: {
  roomId: string;
  messages: ChatMessage[];
}) => {
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
      setShowEmojiPicker(false);
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setMessage((prevMessage) => prevMessage + emojiData.emoji);
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-md">
      <h3 className="text-lg font-bold text-gray-800 mb-4">채팅</h3>
      <div
        className="h-96 lg:h-[600px] mb-4 border rounded-lg bg-gray-50 overflow-y-auto p-3 space-y-2"
        ref={chatBodyRef}
      >
        {messages.map((msg, index) => (
          <div key={index}>
            <span className="font-semibold">{msg.sender}:</span> {msg.message}
          </div>
        ))}
      </div>
      <div className="relative">
        {showEmojiPicker && (
          <div className="absolute bottom-full right-0 mb-2">
            <EmojiPicker onEmojiClick={onEmojiClick} />
          </div>
        )}
        <div className="flex items-center">
          <input
            className="flex-grow border border-gray-300 rounded-l-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="메시지를 입력하세요"
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
          />
          <button
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-3 border-t border-b border-gray-300"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            😊
          </button>
          <button
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded-r-lg flex items-center justify-center transition"
            onClick={handleSendMessage}
          >
            <span className="material-symbols-outlined">send</span>
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
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">
          방장이 게임 설정을 변경하고 있습니다. 잠시만 기다려주세요...
        </p>
        <div className="space-y-2 text-left mx-auto max-w-xs">
          <p>
            <span className="font-semibold">선택된 주제:</span>{" "}
            {room.selectedCategories.join(", ")}
          </p>
          <p>
            <span className="font-semibold">목표 점수:</span> {room.targetScore}
          </p>
          <p>
            <span className="font-semibold">게임 모드:</span>{" "}
            {room.gameMode === "fool" ? "바보 모드" : "일반 모드"}
          </p>
          <p>
            <span className="font-semibold">라이어 추측 방식:</span>{" "}
            {room.liarGuessType === "card" ? "카드 선택" : "텍스트 입력"}
          </p>
          <p>
            <span className="font-semibold">힌트 방식:</span>{" "}
            {room.hintType === "drawing" ? "그림판" : "텍스트"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h3 className="text-lg font-bold text-gray-800">게임 설정</h3>
      <div>
        <label className="block font-medium text-gray-700 mb-2">
          주제 선택 (1개 이상)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {ALL_CATEGORIES.map((category) => (
            <label
              key={category}
              className="flex items-center space-x-2 p-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                className="form-checkbox h-5 w-5 text-blue-600"
                value={category}
                checked={settings.selectedCategories.includes(category)}
                onChange={() => handleCategoryChange(category)}
              />
              <span className="text-gray-700">{category}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block font-medium text-gray-700 mb-1">
          목표 점수
        </label>
        <input
          type="number"
          className="w-full border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={settings.targetScore}
          onChange={(e) =>
            handleSettingsChange({
              targetScore: parseInt(e.target.value, 10) || 1,
            })
          }
          min="1"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block font-medium text-gray-700 mb-1">
            게임 모드
          </label>
          <select
            className="w-full border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={settings.gameMode}
            onChange={(e) =>
              handleSettingsChange({
                gameMode: e.target.value as "normal" | "fool",
              })
            }
          >
            <option value="normal">일반 모드</option>
            <option value="fool">바보 모드</option>
          </select>
        </div>
        <div>
          <label className="block font-medium text-gray-700 mb-1">
            라이어 추측
          </label>
          <select
            className="w-full border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={settings.liarGuessType}
            onChange={(e) =>
              handleSettingsChange({
                liarGuessType: e.target.value as "text" | "card",
              })
            }
          >
            <option value="text">텍스트 입력</option>
            <option value="card">카드 선택</option>
          </select>
        </div>
        <div>
          <label className="block font-medium text-gray-700 mb-1">
            힌트 방식
          </label>
          <select
            className="w-full border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={settings.hintType}
            onChange={(e) =>
              handleSettingsChange({
                hintType: e.target.value as "text" | "drawing",
              })
            }
          >
            <option value="text">텍스트</option>
            <option value="drawing">그림판</option>
          </select>
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
    <div className="bg-yellow-100 border border-yellow-200 text-yellow-800 text-center py-3 rounded-lg shadow-sm">
      <p>
        {message} <span className="font-bold">{timer}초</span>
      </p>
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
  playerEmojis,
}) => {
  const navigate = useNavigate();
  const isHost = socket.id === room.hostId;
  const myTurn = socket.id === room.turn;
  const hasVoted = socket.id && room.votes ? !!room.votes[socket.id] : false;

  const [hint, setHint] = useState("");
  const [liarGuess, setLiarGuess] = useState("");
  const [showCopyMessage, setShowCopyMessage] = useState(false);
  const hintInputRef = useRef<HTMLInputElement>(null);

  const [showGameStatus, setShowGameStatus] = useState(true);

  const voteCounts: { [key: string]: number } = {};
  if (room.votes) {
    for (const votedPlayerId of Object.values(room.votes)) {
      voteCounts[votedPlayerId] = (voteCounts[votedPlayerId] || 0) + 1;
    }
  }

  useEffect(() => {
    if (myTurn && room.gameState === "playing" && room.hintType === "drawing") {
      setShowGameStatus(false);
    } else {
      setShowGameStatus(true);
    }
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
    navigator.clipboard
      .writeText(`${window.location.origin}/room/${room.roomId}`)
      .then(() => {
        setShowCopyMessage(true);
        setTimeout(() => setShowCopyMessage(false), 2000);
      });
  };

  const turnPlayer = room.players.find((p) => p.id === room.turn);
  const winner = room.players.find((p) => p.score >= room.targetScore);
  const showLiarGuessInput = room.gameState === "liarGuess" && wasLiar;

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <TimerDisplay timer={timer} gameState={room.gameState} />
        {room.gameState === "waiting" ? (
          <div className="bg-white rounded-xl shadow-md">
            <GameSettings room={room} isHost={isHost} />
          </div>
        ) : (
          <>
            {playerInfo && (
              <div className="bg-white p-6 rounded-xl shadow-md">
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  당신은{" "}
                  <span
                    className={
                      playerInfo.role === "Liar"
                        ? "text-red-500"
                        : "text-green-500"
                    }
                  >
                    {playerInfo.role === "Liar" ? "라이어" : "시민"}
                  </span>{" "}
                  입니다
                </h2>
                <p className="text-gray-600 mb-1">
                  이번 라운드 주제: {playerInfo.category}
                </p>
                {playerInfo.word ? (
                  <p className="text-gray-800 font-semibold">
                    제시어: <strong>{playerInfo.word}</strong>
                  </p>
                ) : (
                  room.gameMode !== "fool" && (
                    <p className="text-red-500 font-semibold">
                      당신은 라이어입니다. 제시어를 추리하세요!
                    </p>
                  )
                )}
              </div>
            )}
            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800">게임 현황</h3>
                <button
                  onClick={() => setShowGameStatus(!showGameStatus)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <span className="material-symbols-outlined">
                    {showGameStatus ? "expand_less" : "expand_more"}
                  </span>
                </button>
              </div>
              {showGameStatus && (
                <div className="h-96 lg:h-[600px] overflow-y-auto p-4 border rounded-lg bg-gray-50 space-y-4">
                  {room.hints.map((h, index) => (
                    <div key={index}>
                      <span className="font-semibold">{h.player.name}:</span>
                      {h.type === "text" ? (
                        <span className="ml-2">{h.content}</span>
                      ) : (
                        <img
                          src={h.content}
                          alt={`${h.player.name}의 힌트`}
                          className="block mt-1 border rounded-md"
                        />
                      )}
                    </div>
                  ))}
                  {room.gameState === "playing" && turnPlayer && (
                    <p className="text-gray-500 italic">
                      {turnPlayer.name}님의 차례입니다...
                    </p>
                  )}
                  {room.gameState === "voting" && (
                    <p className="text-blue-600 font-semibold">
                      모든 힌트가 제출되었습니다! 라이어라고 생각하는 사람에게
                      투표하세요.
                    </p>
                  )}
                  {room.voteResult && (
                    <div
                      className={`p-4 rounded-lg ${
                        room.voteResult.isLiar
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      <h4 className="font-bold">투표 결과</h4>
                      <p>
                        {room.voteResult.mostVotedPlayer.name}님이
                        지목되었습니다.
                      </p>
                      <p>
                        그는{" "}
                        <span className="font-bold">
                          {room.voteResult.isLiar
                            ? "라이어였습니다!"
                            : "시민이었습니다."}
                        </span>
                      </p>
                    </div>
                  )}
                  {room.liarGuessResult && (
                    <div
                      className={`p-4 rounded-lg ${
                        room.liarGuessResult.correct
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      <h4 className="font-bold">라이어의 추측</h4>
                      <p>라이어의 추측: "{room.liarGuessResult.guess}"</p>
                      <p>
                        <span className="font-bold">
                          추측이{" "}
                          {room.liarGuessResult.correct
                            ? "정확했습니다!"
                            : "틀렸습니다."}
                        </span>
                      </p>
                    </div>
                  )}
                  {(room.gameState === "roundOver" ||
                    room.gameState === "finished") && (
                    <div className="p-4 rounded-lg bg-blue-100 text-blue-800">
                      <h4 className="font-bold">
                        {room.gameState === "finished"
                          ? "최종 우승!"
                          : "라운드 종료!"}
                      </h4>
                      {room.gameState === "finished" && winner && (
                        <p>
                          <span className="font-bold">{winner.name}</span> 님이
                          목표 점수 {room.targetScore}점에 도달하여 최종
                          우승했습니다!
                        </p>
                      )}
                      <p>
                        정답은 '<span className="font-bold">{room.word}</span>
                        '였습니다.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {room.gameState === "playing" && myTurn && (
                <div className="mt-4">
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
                    <div className="flex items-center">
                      <input
                        ref={hintInputRef}
                        type="text"
                        className="flex-grow border border-gray-300 rounded-l-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="힌트를 입력하세요"
                        value={hint}
                        onChange={(e) => setHint(e.target.value)}
                        onKeyPress={(e) =>
                          e.key === "Enter" &&
                          handleSubmitHint({ type: "text", content: hint })
                        }
                      />
                      <button
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded-r-lg transition"
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
                <div className="mt-4">
                  {room.liarGuessType === "card" ? (
                    <div>
                      <p className="text-center mb-2 font-semibold">
                        제시어라고 생각되는 카드를 고르세요!
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {room.liarGuessCards.map((cardWord) => (
                          <button
                            key={cardWord}
                            className="bg-white hover:bg-gray-100 text-gray-800 font-semibold py-2 px-4 border border-gray-400 rounded shadow"
                            onClick={() => handleLiarGuess(cardWord)}
                          >
                            {cardWord}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <input
                        type="text"
                        className="flex-grow border border-gray-300 rounded-l-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="단어를 맞혀보세요!"
                        value={liarGuess}
                        onChange={(e) => setLiarGuess(e.target.value)}
                        onKeyPress={(e) =>
                          e.key === "Enter" && handleLiarGuess(liarGuess)
                        }
                      />
                      <button
                        className="bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-r-lg transition"
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

      <div className="space-y-6">
        <div className="bg-white p-6 rounded-xl shadow-md">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center">
              <h2 className="text-2xl font-bold text-gray-800 mr-2 my-0">
                방: {room.roomId}
              </h2>
              <button
                className="text-gray-500 hover:text-gray-700 relative"
                onClick={handleCopyRoomId}
                title="방 ID 복사"
              >
                <span className="material-symbols-outlined">content_copy</span>
                {showCopyMessage && (
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black text-white text-xs rounded py-1 px-2">
                    복사 완료!
                  </span>
                )}
              </button>
            </div>
            <button
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              onClick={handleLeaveRoom}
            >
              방 나가기
            </button>
          </div>
          <div>
            <p className="text-gray-600">
              <span className="font-semibold">
                플레이어 ({room.players.length}) / 목표: {room.targetScore}점
              </span>
            </p>
            <p className="text-gray-600">
              게임 모드: {room.gameMode === "fool" ? "바보 모드" : "일반 모드"}
            </p>
          </div>
          <div className="mt-6 space-y-3">
            {room.players.map((player) => {
              const count = voteCounts[player.id] || 0;
              const emoji = playerEmojis[player.persistentId];
              const isMyTurn = room.turn === player.id;
              return (
                <div
                  key={player.persistentId}
                  className={`flex justify-between items-center p-3 rounded-lg ${
                    isMyTurn ? "bg-blue-500 text-white" : "bg-gray-100"
                  }`}
                >
                  <div className="flex items-center">
                    <span className="font-medium">{player.name}</span>
                    {emoji && <span className="ml-2 text-xl">{emoji}</span>}
                    {room.hostId === player.id && (
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded-full ml-2 ${
                          isMyTurn
                            ? "bg-blue-400 text-white"
                            : "bg-blue-200 text-blue-800"
                        }`}
                      >
                        방장
                      </span>
                    )}
                    {count > 0 && (
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded-full ml-2 ${
                          isMyTurn
                            ? "bg-red-400 text-white"
                            : "bg-red-200 text-red-800"
                        }`}
                      >
                        {count} 표
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-x-2">
                    <span
                      className={`text-sm font-bold px-3 py-1 rounded-full ${
                        isMyTurn
                          ? "bg-white text-blue-500"
                          : "bg-gray-300 text-gray-700"
                      }`}
                    >
                      {player.score}점
                    </span>
                    {room.gameState === "voting" && (
                      <button
                        className="bg-yellow-400 hover:bg-yellow-500 text-white text-xs font-bold py-1 px-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleVote(player.id)}
                        disabled={hasVoted || player.id === socket.id}
                      >
                        투표
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6">
            {isHost && room.gameState === "waiting" && (
              <button
                className="w-full bg-green-500 hover:bg-green-600 text-white px-4 py-3 rounded-lg text-lg font-bold transition disabled:opacity-50"
                onClick={handleStartNextRound}
                disabled={room.players.length < 2}
              >
                {room.players.length < 2 ? "플레이어 더 필요" : "게임 시작"}
              </button>
            )}
            {isHost && room.gameState === "roundOver" && (
              <button
                className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded-lg text-lg font-bold transition"
                onClick={handleStartNextRound}
              >
                다음 라운드 시작
              </button>
            )}
            {isHost && room.gameState === "finished" && (
              <button
                className="w-full bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-lg text-lg font-bold transition"
                onClick={handleRestartGame}
              >
                새 게임 시작 (점수 초기화)
              </button>
            )}
          </div>
        </div>
        <Chat roomId={room.roomId} messages={messages} />
      </div>
    </div>
  );
};

export default App;
