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
    const [wasLiar, setWasLiar] = useState(false); // For fool mode

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
                setWasLiar(false); // Reset for new game
            }
        });
        socket.on('gameStarted', (payload: GameStartPayload) => {
            setPlayerInfo(payload);
            setWasLiar(payload.role === 'Liar'); // Set initial liar status for normal mode
        });
        socket.on('youWereTheLiar', () => {
            console.log('Secret event received: You were the liar!');
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

const Lobby = ({...}) // Lobby component remains the same, omitted for brevity

interface GameRoomProps {
  room: Room;
  playerInfo: GameStartPayload | null;
  wasLiar: boolean;
}

const GameSettings = ({...}) // GameSettings component remains the same, omitted for brevity

const GameRoom: React.FC<GameRoomProps> = ({ room, playerInfo, wasLiar }) => {
    const isHost = socket.id === room.hostId;
    const myTurn = socket.id === room.turn;
    const hasVoted = socket.id && room.votes ? !!room.votes[socket.id] : false;
    
    const [hint, setHint] = useState('');
    const [liarGuess, setLiarGuess] = useState('');
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
            alert('방 ID가 복사되었습니다!');
        });
    };

    const turnPlayer = room.players.find(p => p.id === room.turn);
    const winner = room.players.find(p => p.score >= room.targetScore);

    // Determine if the guess input should be shown
    const showLiarGuessInput = room.gameState === 'liarGuess' && wasLiar;

    return (
        <div className="container mt-4">
            <div className="row">
                <div className="col-md-8">
                    {room.gameState === 'waiting' ? <div className="card"><div className="card-header"><h4>게임 설정</h4></div><GameSettings room={room} isHost={isHost} /></div> : (
                        <>
                            {playerInfo && (
                                <div className="card mb-3">
                                    <div className="card-header"><h2>나의 역할</h2></div>
                                    <div className="card-body">
                                        <h3 className="card-title">당신은 <span className={playerInfo.role === 'Liar' ? 'text-danger' : 'text-success'}>{playerInfo.role === 'Liar' ? '라이어' : '시민'}</span> 입니다</h3>
                                        <p className="card-text fs-4">이번 라운드 주제: {playerInfo.category}</p>
                                        {playerInfo.word ? 
                                            <p className="card-text fs-4">제시어: <strong>{playerInfo.word}</strong></p> : 
                                            (room.gameMode !== 'fool' && <p className="card-text fs-4 text-danger">당신은 라이어입니다. 제시어를 추리하세요!</p>)}
                                    </div>
                                </div>
                            )}
                            <div className="card">
                                <div className="card-header"><h4>게임 현황</h4></div>
                                <div className="card-body chat-box" ref={chatBodyRef}>
                                    {room.hints.map((h, index) => <p key={index} className="card-text"><strong>{h.player.name}:</strong> {h.hint}</p>)}
                                    {room.gameState === 'playing' && turnPlayer && <p className='text-muted'><em>{turnPlayer.name}님의 차례입니다...</em></p>}
                                    {room.gameState === 'voting' && <p className='text-primary'><em>모든 힌트가 제출되었습니다! 라이어라고 생각하는 사람에게 투표하세요.</em></p>}
                                    {room.voteResult && (
                                        <div className={`alert mt-3 ${room.voteResult.isLiar ? 'alert-success' : 'alert-danger'}`}>
                                            <h5>투표 결과</h5>
                                            <p>{room.voteResult.mostVotedPlayer.name}님이 지목되었습니다.</p>
                                            <p><strong>그는 {room.voteResult.isLiar ? '라이어였습니다!' : '시민이었습니다.'}</strong></p>
                                        </div>
                                    )}
                                    {room.liarGuessResult && (
                                        <div className={`alert mt-3 ${room.liarGuessResult.correct ? 'alert-success' : 'alert-danger'}`}>
                                            <h5>라이어의 추측</h5>
                                            <p>라이어의 추측: "{room.liarGuessResult.guess}"</p>
                                            <p><strong>추측이 {room.liarGuessResult.correct ? '정확했습니다!' : '틀렸습니다.'}</strong></p>
                                        </div>
                                    )}
                                    {(room.gameState === 'roundOver' || room.gameState === 'finished') && (
                                        <div className="alert alert-info mt-3">
                                            <h4>{room.gameState === 'finished' ? '최종 우승!' : '라운드 종료!'}</h4>
                                            {room.gameState === 'finished' && winner && <p><strong>{winner.name}</strong> 님이 목표 점수 {room.targetScore}점에 도달하여 최종 우승했습니다!</p>}
                                            <p>정답은 '<strong>{room.word}</strong>'였습니다.</p>
                                        </div>
                                    )}
                                </div>
                                {room.gameState === 'playing' && myTurn && (
                                    <div className="card-footer"><div className="input-group"><input type="text" className="form-control" placeholder="힌트를 입력하세요" value={hint} onChange={e => setHint(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmitHint()} /><button className="btn btn-primary" onClick={handleSubmitHint}>제출</button></div></div>
                                )}
                                {showLiarGuessInput && (
                                    <div className="card-footer"><div className="input-group"><input type="text" className="form-control" placeholder="단어를 맞혀보세요!" value={liarGuess} onChange={e => setLiarGuess(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLiarGuess()} /><button className="btn btn-danger" onClick={handleLiarGuess}>최종 추측</button></div></div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="col-md-4">{/* ...omitted for brevity... */}</div>
            </div>
        </div>
    );
};

// The rest of the file is omitted for brevity as it is unchanged.