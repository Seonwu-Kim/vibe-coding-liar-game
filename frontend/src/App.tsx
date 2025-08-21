import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Type definitions
interface Player {
  id: string;
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
  gameState: 'waiting' | 'playing' | 'voting' | 'liarGuess' | 'finished';
  word: string | null;
  liarId: string | null;
  turn: string | null;
  hints: Hint[];
  votes?: { [key: string]: string }; // Make votes optional to prevent crash
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
        socket.on('connect', () => console.log('Socket connected!', socket.id));
        socket.on('updateRoom', (updatedRoom: Room) => {
            console.log('✅ [RECEIVE] updateRoom:', updatedRoom);
            setRoom(updatedRoom);
            if (updatedRoom.gameState === 'waiting') {
                setPlayerInfo(null); // Reset player info for new game
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

    const handleCreateRoom = () => {
        if (!playerName) { alert('Please enter your name.'); return; }
        socket.emit('createRoom', { playerName, category });
    };

    const handleJoinRoom = () => {
        if (!playerName || !roomId) { alert('Please enter your name and a room ID.'); return; }
        socket.emit('joinRoom', { playerName, roomId });
    };

    return (
        <div className="container text-center"> 
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <h1 className="my-4">Liar Game</h1>
                    <div className="card p-4">
                        <h2 className="mb-4">Join a Game</h2>
                        <input type="text" className="form-control mb-3" placeholder="Enter your name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
                        <div className="card-body">
                            <h5 className="card-title">Create a New Room</h5>
                            <div className="input-group mb-3">
                                <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                                    <option value="영화">영화</option>
                                    <option value="음식">음식</option>
                                    <option value="동물">동물</option>
                                    <option value="IT용어">IT용어</option>
                                </select>
                                <button className="btn btn-primary" onClick={handleCreateRoom}>Create</button>
                            </div>
                        </div>
                        <hr />
                        <div className="card-body">
                            <h5 className="card-title">Join an Existing Room</h5>
                            <div className="input-group mb-3">
                                <input type="text" className="form-control" placeholder="Enter Room ID" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} />
                                <button className="btn btn-secondary" onClick={handleJoinRoom}>Join</button>
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

    useEffect(() => {
        if (chatBodyRef.current) {
            chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
        }
    }, [room.hints, room.voteResult, room.liarGuessResult]);

    const handleStartGame = () => {
        console.log('▶️ [EMIT] startGame:', { roomId: room.roomId });
        socket.emit('startGame', { roomId: room.roomId });
    };
    const handleSubmitHint = () => {
        if (!hint.trim()) return alert('Please enter a hint.');
        socket.emit('submitHint', { roomId: room.roomId, hint });
        setHint('');
    };
    const handleVote = (votedPlayerId: string) => socket.emit('submitVote', { roomId: room.roomId, votedPlayerId });
    const handleLiarGuess = () => {
        if (!liarGuess.trim()) return alert('Please enter your guess.');
        socket.emit('submitLiarGuess', { roomId: room.roomId, guess: liarGuess });
        setLiarGuess('');
    };

    const turnPlayer = room.players.find(p => p.id === room.turn);

    return (
        <div className="container mt-4">
            <div className="row">
                <div className="col-md-8">
                    {/* Role and Word Display */}
                    {room.gameState !== 'waiting' && playerInfo && (
                        <div className="card mb-3">
                            <div className="card-header"><h2>Your Role</h2></div>
                            <div className="card-body">
                                <h3 className="card-title">You are a <span className={playerInfo.role === 'Liar' ? 'text-danger' : 'text-success'}>{playerInfo.role}</span></h3>
                                <p className="card-text fs-4">Category: {playerInfo.category}</p>
                                {playerInfo.role === 'Citizen' && <p className="card-text fs-4">Word: <strong>{playerInfo.word}</strong></p>}
                            </div>
                        </div>
                    )}

                    {/* Main Display Area */}
                    <div className="card">
                        <div className="card-header"><h4>Game Board</h4></div>
                        <div className="card-body chat-box" ref={chatBodyRef}>
                            {room.hints.map((h, index) => <p key={index} className="card-text"><strong>{h.player.name}:</strong> {h.hint}</p>)}
                            {room.gameState === 'playing' && turnPlayer && <p className='text-muted'><em>It's {turnPlayer.name}'s turn...</em></p>}
                            {room.gameState === 'voting' && <p className='text-primary'><em>All hints are in! Please vote for the player you think is the Liar.</em></p>}
                            {room.voteResult && (
                                <div className={`alert mt-3 ${room.voteResult.isLiar ? 'alert-success' : 'alert-danger'}`}>
                                    <h5>Vote Result</h5>
                                    <p>{room.voteResult.mostVotedPlayer.name} was voted out.</p>
                                    <p><strong>They were {room.voteResult.isLiar ? 'the LIAR!' : 'a CITIZEN.'}</strong></p>
                                </div>
                            )}
                            {room.liarGuessResult && (
                                <div className={`alert mt-3 ${room.liarGuessResult.correct ? 'alert-success' : 'alert-danger'}`}>
                                    <h5>Liar's Guess</h5>
                                    <p>The Liar guessed: "{room.liarGuessResult.guess}"</p>
                                    <p><strong>The guess was {room.liarGuessResult.correct ? 'CORRECT!' : 'INCORRECT.'}</strong></p>
                                </div>
                            )}
                             {room.gameState === 'finished' && (
                                <div className="alert alert-info mt-3">
                                    <h4>Game Over!</h4>
                                    <p>The correct word was: <strong>{room.word}</strong></p>
                                </div>
                            )}
                        </div>
                        {/* Action Footer */}
                        {room.gameState === 'playing' && myTurn && (
                            <div className="card-footer"><div className="input-group"><input type="text" className="form-control" placeholder="Enter your hint" value={hint} onChange={e => setHint(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmitHint()} /><button className="btn btn-primary" onClick={handleSubmitHint}>Submit</button></div></div>
                        )}
                        {room.gameState === 'liarGuess' && amLiar && (
                            <div className="card-footer"><div className="input-group"><input type="text" className="form-control" placeholder="Guess the word!" value={liarGuess} onChange={e => setLiarGuess(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleLiarGuess()} /><button className="btn btn-danger" onClick={handleLiarGuess}>Final Guess</button></div></div>
                        )}
                    </div>
                </div>

                <div className="col-md-4">
                    {/* Player List and Controls */}
                    <div className="card">
                        <div className="card-header d-flex justify-content-between align-items-center"><h3>Room: {room.roomId}</h3><span>Scores</span></div>
                        <div className="card-body">
                            <ul className="list-group mb-3">
                                {room.players.map((player) => (
                                    <li key={player.id} className={`list-group-item d-flex justify-content-between align-items-center ${room.turn === player.id ? 'active' : ''}`}>
                                        <div>
                                            {player.name}
                                            {room.hostId === player.id && <span className="badge bg-primary ms-2">Host</span>}
                                            {room.votes && Object.values(room.votes).includes(player.id) && <span className="badge bg-danger ms-2">Voted Against</span>}
                                        </div>
                                        <span className="badge bg-info">{player.score}</span>
                                        {room.gameState === 'voting' && (
                                            <button className="btn btn-sm btn-warning" onClick={() => handleVote(player.id)} disabled={hasVoted || player.id === socket.id}>
                                                Vote
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {isHost && (room.gameState === 'waiting' || room.gameState === 'finished') && (
                                <button className="btn btn-success w-100" onClick={handleStartGame} disabled={room.players.length < 2}>
                                    {room.gameState === 'finished' ? 'Play Again' : 'Start Game'} ({room.players.length < 2 ? `Need more players` : 'Ready'})
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