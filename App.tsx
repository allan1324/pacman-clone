import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Direction, CellType, GameState, Position, Pacman, Ghost } from './types';
import { TILE_SIZE, GAME_SPEED, FRIGHTENED_DURATION, BOARD_WIDTH, BOARD_HEIGHT, INITIAL_BOARD, TOTAL_PELLETS } from './constants';

const INITIAL_PACMAN_POSITION: Position = { x: 13, y: 19 };
const INITIAL_GHOSTS: Ghost[] = [
  // id: 1 => Blinky (Red) - The Chaser
  { id: 1, position: { x: 13, y: 9 }, direction: Direction.LEFT, state: 'normal', color: 'bg-red-500', spawn: { x: 13, y: 9 }, scatterTarget: { x: BOARD_WIDTH - 2, y: 1 } },
  // id: 2 => Pinky (Pink) - The Ambusher
  { id: 2, position: { x: 13, y: 12 }, direction: Direction.UP, state: 'normal', color: 'bg-pink-500', spawn: { x: 13, y: 12 }, scatterTarget: { x: 1, y: 1 } },
  // id: 3 => Inky (Cyan) - The Flanker
  { id: 3, position: { x: 11, y: 12 }, direction: Direction.UP, state: 'normal', color: 'bg-cyan-500', spawn: { x: 11, y: 12 }, scatterTarget: { x: BOARD_WIDTH - 2, y: BOARD_HEIGHT - 2 } },
  // id: 4 => Clyde (Orange) - The Feigner
  { id: 4, position: { x: 15, y: 12 }, direction: Direction.UP, state: 'normal', color: 'bg-orange-500', spawn: { x: 15, y: 12 }, scatterTarget: { x: 1, y: BOARD_HEIGHT - 2 } },
];

// Defines the duration and order of ghost AI modes
const GHOST_MODE_SCHEDULE = [
    { mode: 'scatter', duration: 7 * 1000 },
    { mode: 'chase', duration: 20 * 1000 },
    { mode: 'scatter', duration: 7 * 1000 },
    { mode: 'chase', duration: 20 * 1000 },
    { mode: 'scatter', duration: 5 * 1000 },
    { mode: 'chase', duration: 20 * 1000 },
    { mode: 'scatter', duration: 5 * 1000 },
    { mode: 'chase', duration: Infinity },
];

const getNextPosition = (pos: Position, dir: Direction): Position => {
    let { x, y } = pos;
    switch (dir) {
        case Direction.UP: y--; break;
        case Direction.DOWN: y++; break;
        case Direction.LEFT: x--; break;
        case Direction.RIGHT: x++; break;
    }
    // Tunnel logic
    if (x < 0) x = BOARD_WIDTH - 1;
    if (x >= BOARD_WIDTH) x = 0;
    if (y < 0) y = BOARD_HEIGHT - 1;
    if (y >= BOARD_HEIGHT) y = 0;
    return { x, y };
};

const isWall = (pos: Position, board: CellType[][]): boolean => {
    const cell = board[pos.y]?.[pos.x];
    return cell === CellType.WALL || cell === CellType.GHOST_HOME || cell === CellType.GHOST_HOME_DOOR;
};

// BFS pathfinding function to find the next best move
const findNextMove = (board: CellType[][], start: Position, end: Position, ghostState: Ghost['state']): Direction | null => {
    const queue: { pos: Position, firstStep: Direction }[] = [];
    const visited = new Set<string>();
    const stringify = (p: Position) => `${p.x},${p.y}`;
    
    visited.add(stringify(start));

    for (const dir of [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]) {
        const nextPos = getNextPosition(start, dir);
        if (nextPos.y < 0 || nextPos.y >= BOARD_HEIGHT) continue;
        
        const cell = board[nextPos.y]?.[nextPos.x];
        if (cell === CellType.WALL) continue;
        if (cell === CellType.GHOST_HOME && ghostState !== 'eaten') continue;
        
        if (stringify(nextPos) === stringify(end)) return dir;
        queue.push({ pos: nextPos, firstStep: dir });
        visited.add(stringify(nextPos));
    }

    let head = 0;
    while (head < queue.length) {
        const { pos, firstStep } = queue[head++];
        for (const dir of [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]) {
            const nextPos = getNextPosition(pos, dir);
            if (visited.has(stringify(nextPos))) continue;

            const cell = board[nextPos.y]?.[nextPos.x];
            if (cell === CellType.WALL) continue;
            if (cell === CellType.GHOST_HOME && ghostState !== 'eaten') continue;
            
            if (stringify(nextPos) === stringify(end)) return firstStep;
            
            visited.add(stringify(nextPos));
            queue.push({ pos: nextPos, firstStep });
        }
    }
    return null; // No path found
};

const getChaseTarget = (ghost: Ghost, pacman: Pacman, ghosts: Ghost[]): Position => {
    switch (ghost.id) {
        // Blinky (1): Targets Pac-Man's current tile.
        case 1:
            return pacman.position;

        // Pinky (2): Targets 4 tiles ahead of Pac-Man.
        case 2: {
            let target = { ...pacman.position };
            switch (pacman.direction) {
                case Direction.UP: target.y -= 4; break;
                case Direction.DOWN: target.y += 4; break;
                case Direction.LEFT: target.x -= 4; break;
                case Direction.RIGHT: target.x += 4; break;
            }
            return target;
        }

        // Inky (3): Complex targeting based on Blinky and Pac-Man.
        case 3: {
            const blinky = ghosts.find(g => g.id === 1);
            if (!blinky) return pacman.position; // Fallback

            let offset = { x: 0, y: 0 };
            switch (pacman.direction) {
                case Direction.UP: offset.y = -2; break;
                case Direction.DOWN: offset.y = 2; break;
                case Direction.LEFT: offset.x = -2; break;
                case Direction.RIGHT: offset.x = 2; break;
            }
            const pivot = { x: pacman.position.x + offset.x, y: pacman.position.y + offset.y };

            return {
                x: pivot.x + (pivot.x - blinky.position.x),
                y: pivot.y + (pivot.y - blinky.position.y),
            };
        }

        // Clyde (4): Targets Pac-Man, but retreats if too close.
        case 4: {
            const distance = Math.sqrt(
                Math.pow(ghost.position.x - pacman.position.x, 2) +
                Math.pow(ghost.position.y - pacman.position.y, 2)
            );
            return distance > 8 ? pacman.position : ghost.scatterTarget;
        }
        
        default:
            return pacman.position;
    }
};

const GameOverlay: React.FC<{ gameState: GameState; score: number; lives: number; onStart: () => void; }> = ({ gameState, score, lives, onStart }) => {
  const message = useMemo(() => {
    switch (gameState) {
      case GameState.READY: return "Press Enter to Start";
      case GameState.GAME_OVER: return "Game Over! Press Enter to Restart";
      case GameState.LEVEL_WON: return "You Win! Press Enter to Play Again";
      default: return null;
    }
  }, [gameState]);

  return (
    <>
      <div className="absolute top-2 left-2 text-white font-bold text-lg z-20">SCORE: {score}</div>
      <div className="absolute top-2 right-2 text-yellow-400 font-bold text-lg z-20 flex items-center">
        LIVES: 
        {Array.from({ length: lives }).map((_, i) => (
          <div key={i} className="w-5 h-5 bg-yellow-400 rounded-full ml-2 border-2 border-yellow-600"></div>
        ))}
      </div>
      {message && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex justify-center items-center z-30" onClick={onStart}>
          <h2 className="text-4xl text-yellow-400 font-extrabold animate-pulse">{message}</h2>
        </div>
      )}
    </>
  );
};

const Character: React.FC<{ type: 'pacman' | 'ghost'; data: Pacman | Ghost; isFrightened?: boolean; }> = ({ type, data, isFrightened }) => {
    const { position, direction } = data;

    const rotationClass = useMemo(() => {
        switch (direction) {
            case Direction.UP: return '-rotate-90';
            case Direction.DOWN: return 'rotate-90';
            case Direction.LEFT: return 'scale-x-[-1]';
            default: return '';
        }
    }, [direction]);

    if (type === 'pacman') {
        const pacmanData = data as Pacman;
        return (
            <div className={`absolute w-6 h-6 transition-transform duration-100 ease-linear ${rotationClass}`} style={{ top: position.y * TILE_SIZE, left: position.x * TILE_SIZE }}>
                <div className="relative w-full h-full">
                    <div className="w-full h-full bg-yellow-400 rounded-full" style={{ clipPath: pacmanData.isMouthOpen ? 'polygon(0% 0%, 100% 0, 100% 40%, 50% 50%, 100% 60%, 100% 100%, 0 100%)' : 'none' }}></div>
                </div>
            </div>
        );
    }

    const ghostData = data as Ghost;
    const isEaten = ghostData.state === 'eaten';
    
    return (
        <div className="absolute w-6 h-6 transition-all duration-100 ease-linear" style={{ top: position.y * TILE_SIZE, left: position.x * TILE_SIZE }}>
            {isEaten ? (
                <div className="relative w-full h-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full mr-1"></div>
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                </div>
            ) : (
                <div className={`w-full h-full rounded-t-full relative ${isFrightened ? 'bg-blue-700 animate-pulse' : ghostData.color}`}>
                    <div className="absolute flex w-full justify-center top-1/4">
                        <div className="w-2 h-2 bg-white rounded-full mr-0.5 relative"><div className="w-1 h-1 bg-black rounded-full absolute top-0.5 left-0.5"></div></div>
                        <div className="w-2 h-2 bg-white rounded-full ml-0.5 relative"><div className="w-1 h-1 bg-black rounded-full absolute top-0.5 left-0.5"></div></div>
                    </div>
                </div>
            )}
        </div>
    );
};


const BoardCell: React.FC<{ cellType: CellType }> = React.memo(({ cellType }) => {
  if (cellType === CellType.WALL) {
    return null; // Wall is the blue background of the container
  }

  let content = null;
  if (cellType === CellType.PELLET) {
    content = <div className="w-1.5 h-1.5 bg-yellow-200 rounded-full"></div>;
  } else if (cellType === CellType.POWER_PELLET) {
    content = <div className="w-3 h-3 bg-yellow-200 rounded-full animate-pulse"></div>;
  }

  // Paths are black, with pellets/power-pellets inside
  return (
    <div className="w-full h-full bg-black flex justify-center items-center">
      {content}
    </div>
  );
});

const App = () => {
  const [board, setBoard] = useState<CellType[][]>(INITIAL_BOARD);
  const [pacman, setPacman] = useState<Pacman>({ position: INITIAL_PACMAN_POSITION, direction: Direction.RIGHT, nextDirection: Direction.RIGHT, isMouthOpen: true });
  const [ghosts, setGhosts] = useState<Ghost[]>(JSON.parse(JSON.stringify(INITIAL_GHOSTS)));
  const [gameState, setGameState] = useState<GameState>(GameState.READY);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [eatenPellets, setEatenPellets] = useState(0);
  const [frightenedTicks, setFrightenedTicks] = useState(0);

  const [ghostMode, setGhostMode] = useState<'chase' | 'scatter'>('scatter');
  const [modeTicks, setModeTicks] = useState(GHOST_MODE_SCHEDULE[0].duration / GAME_SPEED);
  const [scheduleIndex, setScheduleIndex] = useState(0);

  const resetLevel = useCallback(() => {
    setPacman({ position: INITIAL_PACMAN_POSITION, direction: Direction.RIGHT, nextDirection: Direction.RIGHT, isMouthOpen: true });
    setGhosts(JSON.parse(JSON.stringify(INITIAL_GHOSTS)));
  }, []);

  const resetGame = useCallback(() => {
    setBoard(INITIAL_BOARD);
    setScore(0);
    setLives(3);
    setEatenPellets(0);
    setFrightenedTicks(0);
    resetLevel();
    setScheduleIndex(0);
    setGhostMode(GHOST_MODE_SCHEDULE[0].mode as 'chase' | 'scatter');
    setModeTicks(GHOST_MODE_SCHEDULE[0].duration / GAME_SPEED);
    setGameState(GameState.READY);
  }, [resetLevel]);
  
  const startGame = useCallback(() => {
    if (gameState === GameState.READY || gameState === GameState.GAME_OVER || gameState === GameState.LEVEL_WON) {
      if (gameState === GameState.GAME_OVER || gameState === GameState.LEVEL_WON) {
          resetGame();
      }
      setGameState(GameState.PLAYING);
    }
  }, [gameState, resetGame]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let newNextDir: Direction | null = null;
      switch (e.key) {
        case 'ArrowUp': case 'w': newNextDir = Direction.UP; break;
        case 'ArrowDown': case 's': newNextDir = Direction.DOWN; break;
        case 'ArrowLeft': case 'a': newNextDir = Direction.LEFT; break;
        case 'ArrowRight': case 'd': newNextDir = Direction.RIGHT; break;
        case 'Enter': startGame(); break;
      }
      if (newNextDir !== null) {
        setPacman(p => ({ ...p, nextDirection: newNextDir as Direction }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startGame]);

  const movePacman = useCallback(() => {
    setPacman(p => {
        let currentDirection = p.direction;
        let nextPos = getNextPosition(p.position, p.nextDirection);
        if (!isWall(nextPos, board)) {
            currentDirection = p.nextDirection;
        } else {
            nextPos = getNextPosition(p.position, currentDirection);
            if (isWall(nextPos, board)) {
                return { ...p, isMouthOpen: !p.isMouthOpen }; // Stop and chomp
            }
        }
        
        const newPosition = getNextPosition(p.position, currentDirection);
        return { ...p, position: newPosition, direction: currentDirection, isMouthOpen: !p.isMouthOpen };
    });
  }, [board]);

  const moveGhosts = useCallback(() => {
    setGhosts(currentGhosts => currentGhosts.map(ghost => {
        const oppositeDirection = {
            [Direction.UP]: Direction.DOWN, [Direction.DOWN]: Direction.UP,
            [Direction.LEFT]: Direction.RIGHT, [Direction.RIGHT]: Direction.LEFT,
            [Direction.NONE]: Direction.NONE,
        };

        if (ghost.state === 'eaten') {
            if (ghost.position.x === ghost.spawn.x && ghost.position.y === ghost.spawn.y) {
                return { ...ghost, state: 'normal', direction: Direction.UP };
            }
            let nextDir = findNextMove(board, ghost.position, ghost.spawn, ghost.state);
            
            if (nextDir === null) { /* Fallback movement */ }
            const newPosition = getNextPosition(ghost.position, nextDir ?? oppositeDirection[ghost.direction]);
            return { ...ghost, position: newPosition, direction: nextDir ?? oppositeDirection[ghost.direction] };
        }

        if (ghost.state === 'frightened') {
            const validDirections: Direction[] = [];
            [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT].forEach(dir => {
                if (dir === oppositeDirection[ghost.direction]) return;
                const nextPos = getNextPosition(ghost.position, dir);
                const cell = board[nextPos.y]?.[nextPos.x];
                if (cell !== CellType.WALL && cell !== CellType.GHOST_HOME) {
                    validDirections.push(dir);
                }
            });
            let nextDir = validDirections.length > 0
                ? validDirections[Math.floor(Math.random() * validDirections.length)]
                : oppositeDirection[ghost.direction];
            const newPosition = getNextPosition(ghost.position, nextDir);
            return { ...ghost, position: newPosition, direction: nextDir };
        }

        // NORMAL mode (Chase or Scatter)
        let targetPos = ghostMode === 'chase'
            ? getChaseTarget(ghost, pacman, currentGhosts)
            : ghost.scatterTarget;
        
        let bestDir = findNextMove(board, ghost.position, targetPos, ghost.state);

        if (bestDir === null) { /* Fallback movement */ }

        const newPosition = getNextPosition(ghost.position, bestDir ?? ghost.direction);
        return { ...ghost, position: newPosition, direction: bestDir ?? ghost.direction };
    }));
  }, [board, pacman, ghostMode]);
  
  const handleCollisions = useCallback(() => {
    ghosts.forEach(ghost => {
        if (ghost.position.x === pacman.position.x && ghost.position.y === pacman.position.y) {
            if (ghost.state === 'frightened') {
                setScore(s => s + 200);
                setGhosts(gs => gs.map(g => g.id === ghost.id ? { ...g, state: 'eaten' } : g));
            } else if(ghost.state === 'normal') {
                setLives(l => l - 1);
                if (lives - 1 > 0) {
                    resetLevel();
                    setGameState(GameState.PAUSED);
                    setTimeout(() => setGameState(GameState.PLAYING), 1000);
                } else {
                    setGameState(GameState.GAME_OVER);
                }
            }
        }
    });

    const cellUnderPacman = board[pacman.position.y]?.[pacman.position.x];
    if (cellUnderPacman === CellType.PELLET || cellUnderPacman === CellType.POWER_PELLET) {
        if (cellUnderPacman === CellType.PELLET) {
            setScore(s => s + 10);
        } else {
            setScore(s => s + 50);
            setFrightenedTicks(FRIGHTENED_DURATION);
            setGhosts(gs => gs.map(g => {
                if (g.state !== 'eaten') {
                    const oppositeDirection = {
                        [Direction.UP]: Direction.DOWN, [Direction.DOWN]: Direction.UP,
                        [Direction.LEFT]: Direction.RIGHT, [Direction.RIGHT]: Direction.LEFT,
                        [Direction.NONE]: Direction.UP,
                    };
                    return {...g, state: 'frightened', direction: oppositeDirection[g.direction]};
                }
                return g;
            }));
        }
        setEatenPellets(p => p + 1);
        const newBoard = board.map(row => [...row]);
        newBoard[pacman.position.y][pacman.position.x] = CellType.EMPTY;
        setBoard(newBoard);
    }
  }, [pacman.position, ghosts, board, lives, resetLevel]);

  useEffect(() => {
    if (eatenPellets > 0 && eatenPellets === TOTAL_PELLETS) {
      setGameState(GameState.LEVEL_WON);
    }
  }, [eatenPellets]);

  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;
    
    const gameTick = () => {
        movePacman();
        moveGhosts();
        handleCollisions();
        
        if (frightenedTicks > 0) {
            const newTicks = frightenedTicks - 1;
            setFrightenedTicks(newTicks);
            if (newTicks === 0) {
                setGhosts(gs => gs.map(g => g.state === 'frightened' ? { ...g, state: 'normal' } : g));
            }
        } else {
            setModeTicks(t => {
                const newTicks = t - 1;
                if (newTicks <= 0) {
                    const newIndex = (scheduleIndex + 1) % GHOST_MODE_SCHEDULE.length;
                    setScheduleIndex(newIndex);
                    const nextEntry = GHOST_MODE_SCHEDULE[newIndex];
                    setGhostMode(nextEntry.mode as 'chase' | 'scatter');
                    return isFinite(nextEntry.duration) ? nextEntry.duration / GAME_SPEED : Infinity;
                }
                return newTicks;
            });
        }
    };
    const timerId = setInterval(gameTick, GAME_SPEED);
    return () => clearInterval(timerId);
  }, [gameState, movePacman, moveGhosts, handleCollisions, frightenedTicks, scheduleIndex]);


  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4 font-mono">
        <h1 className="text-4xl font-bold mb-4 text-yellow-400" style={{ fontFamily: "'Press Start 2P', cursive" }}>REACT PAC-MAN</h1>
        <div
            className="relative bg-blue-900 border-4 border-blue-500 rounded-lg overflow-hidden box-content"
            style={{ width: BOARD_WIDTH * TILE_SIZE, height: BOARD_HEIGHT * TILE_SIZE }}
        >
            <GameOverlay gameState={gameState} score={score} lives={lives} onStart={startGame} />

            <div className="absolute top-0 left-0">
                {board.map((row, y) =>
                    row.map((cell, x) => (
                        <div
                            key={`${x}-${y}`}
                            className="absolute"
                            style={{ top: y * TILE_SIZE, left: x * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE }}
                        >
                            <BoardCell cellType={cell} />
                        </div>
                    ))
                )}
            </div>

            <Character type="pacman" data={pacman} />
            {ghosts.map(ghost => (
                <Character key={ghost.id} type="ghost" data={ghost} isFrightened={ghost.state === 'frightened'} />
            ))}
        </div>
    </div>
  );
};

export default App;