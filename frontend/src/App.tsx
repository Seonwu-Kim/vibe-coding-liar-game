import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Type definitions
interface Player {
  id: string; // socket.id - can change on refresh
  persistentId: string; // permanent id for the player
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
  category: string;
  targetScore: number;
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

function App() {
    const [room, setRoom] = useState<Room | null>(null);
    const [playerInfo, setPlayerInfo] = useState<GameStartPayload | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        // Attempt to reconnect if session data exists in localStorage
        const persistentId = localStorage.getItem('liarGamePlayerId');
        const roomId = localStorage.getItem('liarGameRoomId');
        if (persistentId && roomId) {
            console.log(`Found session data, attempting to reconnect... pId: ${persistentId}, rId: ${roomId}`);
            socket.emit('reconnectPlayer', { persistentId, roomId });
        }

        socket.on('connect', () => console.log('Socket connected!', socket.id));
        socket.on('updateRoom', (updatedRoom: Room) => {
            console.log('✅ [RECEIVE] updateRoom:', updatedRoom);
            setRoom(updatedRoom);

            // Find my player data to store persistentId
            const me = updatedRoom.players.find(p => p.id === socket.id);
            if (me) {
                localStorage.setItem('liarGamePlayerId', me.persistentId);
                localStorage.setItem('liarGameRoomId', updatedRoom.roomId);
            }

            if (updatedRoom.gameState === 'waiting') {
                setPlayerInfo(null);
            }
            setError('');
        });
        socket.on('gameStarted', (payload: GameStartPayload) => {
            console.log('✅ [RECEIVE] gameStarted:', payload);
            setPlayerInfo(payload);
        });
        socket.on('error', (error: { message: string }) => {
            console.error('❌ [RECEIVE] error:', error.message);
            setError(error.message);
        });

        return () => {
            socket.off('connect');
            socket.off('updateRoom');
            socket.off('gameStarted');
            socket.off('error');
        };
    }, []);

    if (!room) {
        return <Lobby />;
    }

    return <GameRoom room={room} playerInfo={playerInfo} />;
}

const Lobby = () => {
    const [playerName, setPlayerName] = useState('');
    const [roomId, setRoomId] = useState('');
    const [category, setCategory] = useState('영화');
    const [targetScore, setTargetScore] = useState(5);

    const handleCreateRoom = () => {
        if (!playerName) { alert('이름을 입력해주세요.'); return; }
        socket.emit('createRoom', { playerName, category, targetScore });
    };

    const handleJoinRoom = () => {
        if (!playerName || !roomId) { alert('이름과 방 ID를 입력해주세요.'); return; }
        socket.emit('joinRoom', { playerName, roomId });
    };

    return (
        <div className="container text-center"> 
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <h1 className="my-4">라이어 게임</h1>
                    <div className="card p-4">
                        <h2 className="mb-4">게임 참가하기</h2>
                        <input type="text" className="form-control mb-3" placeholder="이름을 입력하세요" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
                        <div className="card-body">
                            <h5 className="card-title">새로운 방 만들기</h5>
                            <div className="input-group mb-3">
                                <label className="input-group-text">주제</label>
                                <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                                    <option value="영화">영화</option>
                                    <option value="음식">음식</option>
                                    <option value="동물">동물</option>
                                    <option value="IT용어">IT용어</option>
                                    <option value="롤 챔피언">롤 챔피언</option>
                                    <option value="게임">게임</option>
                                    <option value="연예인">연예인</option>
                                    <option value="직업">직업</option>
                                </select>
                            </div>
                            <div className="input-group mb-3">
                                <label className="input-group-text">목표 점수</label>
                                <input type="number" className="form-control" value={targetScore} onChange={e => setTargetScore(parseInt(e.target.value, 10))} min="1" />
                                <button className="btn btn-primary" onClick={handleCreateRoom}>만들기</button>
                            </div>
                        </div>
                        <hr />
                        <div className="card-body">
                            <h5 className="card-title">기존 방에 참가하기</h5>
                            <div className="input-group mb-3">
                                <input type="text" className="form-control" placeholder="방 ID를 입력하세요" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} />
                                <button className="btn btn-secondary" onClick={handleJoinRoom}>참가</button>
                            </div>
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
}

const GameRoom: React.FC<GameRoomProps> = ({ room, playerInfo }) => {
    const isHost = socket.id === room.hostId;
    const myTurn = socket.id === room.turn;
    const amLiar = socket.id === room.liarId;
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

    const turnPlayer = room.players.find(p => p.id === room.turn);
    const winner = room.players.find(p => p.score >= room.targetScore);

    return (
        <div className="container mt-4">
            <div className="row">
                <div className="col-md-8">
                    {/* Role and Word Display */}
                    {room.gameState !== 'waiting' && playerInfo && (
                        <div className="card mb-3">
                            <div className="card-header"><h2>나의 역할</h2></div>
                            <div className="card-body">
                                <h3 className="card-title">당신은 <span className={playerInfo.role === 'Liar' ? 'text-danger' : 'text-success'}>{playerInfo.role === 'Liar' ? '라이어' : '시민'}</span> 입니다</h3>
                                <p className="card-text fs-4">주제: {playerInfo.category}</p>
                                {playerInfo.role === 'Citizen' && <p className="card-text fs-4">제시어: <strong>{playerInfo.word}</strong></p>}
                            </div>
                        </div>
                    )}

                    {/* Main Display Area */}
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
                        {/* Action Footer */}
                        {room.gameState === 'playing' && myTurn && (
                            <div className="card-footer"><div className="input-group"><input type="text" className="form-control" placeholder="힌트를 입력하세요" value={hint} onChange={e => setHint(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmitHint()} /><button className="btn btn-primary" onClick={handleSubmitHint}>제출</button></div></div>
                        )}
                        {room.gameState === 'liarGuess' && amLiar && (
                            <div className="card-footer"><div className="input-group"><input type="text" className="form-control" placeholder="단어를 맞혀보세요!" value={liarGuess} onChange={e => setLiarGuess(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLiarGuess()} /><button className="btn btn-danger" onClick={handleLiarGuess}>최종 추측</button></div></div>
                        )}
                    </div>
                </div>

                <div className="col-md-4">
                    {/* Player List and Controls */}
                    <div className="card">
                        <div className="card-header d-flex justify-content-between align-items-center"><h3>방: {room.roomId}</h3><button className="btn btn-sm btn-outline-danger" onClick={handleLeaveRoom}>방 나가기</button></div>
                        <div className="card-body">
                            <h5 className="card-title">플레이어 ({room.players.length}) / 목표: {room.targetScore}점</h5>
                            <ul className="list-group mb-3">
                                {room.players.map((player) => {
                                    const count = voteCounts[player.id] || 0;
                                    return (
                                        <li key={player.persistentId} className={`list-group-item d-flex justify-content-between align-items-center ${room.turn === player.id ? 'active' : ''}`}>
                                            <div>
                                                {player.name}
                                                {room.hostId === player.id && <span className="badge bg-primary ms-2">방장</span>}
                                                {count > 0 && <span className="badge bg-danger ms-2">{count} 표</span>}
                                            </div>
                                            <span className="badge bg-info">{player.score}점</span>
                                            {room.gameState === 'voting' && (
                                                <button className="btn btn-sm btn-warning" onClick={() => handleVote(player.id)} disabled={hasVoted || player.id === socket.id}>
                                                    투표
                                                </button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            {isHost && room.gameState === 'waiting' && (
                                <button className="btn btn-success w-100" onClick={handleStartNextRound} disabled={room.players.length < 2}>
                                    게임 시작 ({room.players.length < 2 ? '플레이어 더 필요' : '준비 완료'})
                                </button>
                            )}
                            {isHost && room.gameState === 'roundOver' && (
                                <button className="btn btn-info w-100" onClick={handleStartNextRound}>
                                    다음 라운드 시작
                                </button>
                            )}
                            {isHost && room.gameState === 'finished' && (
                                <button className="btn btn-danger w-100" onClick={handleRestartGame}>
                                    완전히 새로 시작 (점수 초기화)
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;