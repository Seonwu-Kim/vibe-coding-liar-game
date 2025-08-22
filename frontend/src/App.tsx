import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Type definitions
interface Player {
  id: string;
  persistentId: string;
  name: string;
  score: number;
}
interface Hint { player: Player; hint: string; }
interface VoteResult { mostVotedPlayer: Player; isLiar: boolean; }
interface LiarGuessResult { guess: string; correct: boolean; }

interface Room {
  roomId: string;
  players: Player[];
  hostId: string;
  selectedCategories: string[];
  currentCategory: string | null;
  targetScore: number;
  gameMode: 'normal' | 'fool';
  gameState: 'waiting' | 'playing' | 'voting' | 'liarGuess' | 'roundOver' | 'finished';
  word: string | null;
  liarId: string | null;
  turn: string | null;
  hints: Hint[];
  votes?: { [key: string]: string };
  voteResult: VoteResult | null;
  liarGuessResult: LiarGuessResult | null;
}

interface GameStartPayload {
    role: 'Liar' | 'Citizen';
    category: string;
    word?: string | null;
}

const socket = io('https://liar-game-zno1.onrender.com');
const ALL_CATEGORIES = ['영화', '음식', '동물', 'IT용어', '롤 챔피언', '게임', '연예인', '직업'];

function App() {
    const [room, setRoom] = useState<Room | null>(null);
    const [playerInfo, setPlayerInfo] = useState<GameStartPayload | null>(null);
    const [wasLiar, setWasLiar] = useState(false);

    useEffect(() => {
        const persistentId = localStorage.getItem('liarGamePlayerId');
        const roomId = localStorage.getItem('liarGameRoomId');
        if (persistentId && roomId) {
            socket.emit('reconnectPlayer', { persistentId, roomId });
        }

        socket.on('connect', () => console.log('Socket connected!', socket.id));
        socket.on('updateRoom', (updatedRoom: Room) => {
            setRoom(updatedRoom);
            const me = updatedRoom.players.find(p => p.id === socket.id);
            if (me) {
                localStorage.setItem('liarGamePlayerId', me.persistentId);
                localStorage.setItem('liarGameRoomId', updatedRoom.roomId);
            }
            if (updatedRoom.gameState === 'waiting') {
                setPlayerInfo(null);
                setWasLiar(false);
            }
        });
        socket.on('gameStarted', (payload: GameStartPayload) => {
            setPlayerInfo(payload);
            setWasLiar(payload.role === 'Liar');
        });
        socket.on('youWereTheLiar', () => {
            setWasLiar(true);
        });
        socket.on('error', (error: { message: string }) => {
            alert(error.message);
        });

        return () => {
            socket.off('connect');
            socket.off('updateRoom');
            socket.off('gameStarted');
            socket.off('youWereTheLiar');
            socket.off('error');
        };
    }, []);

    if (!room) {
        return <Lobby />;
    }

    return <GameRoom room={room} playerInfo={playerInfo} wasLiar={wasLiar} />;
}

const Lobby = ({...}) // Omitted for brevity

interface GameRoomProps {
  room: Room;
  playerInfo: GameStartPayload | null;
  wasLiar: boolean;
}

const GameSettings = ({...}) // Omitted for brevity

const GameRoom: React.FC<GameRoomProps> = ({ room, playerInfo, wasLiar }) => {
    const isHost = socket.id === room.hostId;
    const myTurn = socket.id === room.turn;
    const hasVoted = socket.id && room.votes ? !!room.votes[socket.id] : false;
    
    const [hint, setHint] = useState('');
    const [liarGuess, setLiarGuess] = useState('');
    const [showCopyMessage, setShowCopyMessage] = useState(false);
    const chatBodyRef = useRef<HTMLDivElement>(null);

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

    const handleStartNextRound = () => socket.emit('startGame', { roomId: room.roomId });
    const handleRestartGame = () => socket.emit('restartGame', { roomId: room.roomId });
    const handleSubmitHint = () => {
        if (!hint.trim()) return alert('힌트를 입력해주세요.');
        socket.emit('submitHint', { roomId: room.roomId, hint });
        setHint('');
    };
    const handleVote = (votedPlayerId: string) => socket.emit('submitVote', { roomId: room.roomId, votedPlayerId });
    const handleLiarGuess = () => {
        if (!liarGuess.trim()) return alert('추측 단어를 입력해주세요.');
        socket.emit('submitLiarGuess', { roomId: room.roomId, guess: liarGuess });
        setLiarGuess('');
    };
    const handleLeaveRoom = () => {
        localStorage.removeItem('liarGamePlayerId');
        localStorage.removeItem('liarGameRoomId');
        window.location.reload();
    };
    const handleCopyRoomId = () => {
        navigator.clipboard.writeText(room.roomId).then(() => {
            setShowCopyMessage(true);
            setTimeout(() => setShowCopyMessage(false), 2000);
        });
    };

    const turnPlayer = room.players.find(p => p.id === room.turn);
    const winner = room.players.find(p => p.score >= room.targetScore);
    const showLiarGuessInput = room.gameState === 'liarGuess' && wasLiar;

    return (
        <div className="container mt-4">
            <div className="row">
                <div className="col-md-8">{/* Omitted for brevity */}</div>
                <div className="col-md-4">
                    <div className="card">
                        <div className="card-header d-flex justify-content-between align-items-center">
                            <div className="d-flex align-items-center position-relative">
                                <h3>방: {room.roomId}</h3>
                                <button className="btn btn-sm btn-outline-secondary ms-2" onClick={handleCopyRoomId} title="방 ID 복사">
                                    <i className="bi bi-clipboard"></i>
                                </button>
                                {showCopyMessage && <span className="copy-tooltip">복사 완료!</span>}
                            </div>
                            <button className="btn btn-sm btn-outline-danger" onClick={handleLeaveRoom}>방 나가기</button>
                        </div>
                        <div className="card-body">{/* Omitted for brevity */}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// The rest of the file is omitted for brevity as it is unchanged.
// I will need to add the CSS for the tooltip.
