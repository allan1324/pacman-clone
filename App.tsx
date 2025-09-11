
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Direction, CellType, GameState, Position, Pacman, Ghost } from './types';
import { TILE_SIZE, GAME_SPEED, FRIGHTENED_DURATION, BOARD_WIDTH, BOARD_HEIGHT, INITIAL_BOARD, TOTAL_PELLETS } from './constants';
import { GoogleGenAI, Type } from "@google/genai";

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

// A cell is blocked for a ghost depending on state.
const isBlockedForGhost = (currentPos: Position, nextPos: Position, board: CellType[][], state: Ghost['state']): boolean => {
  const nextCell = board[nextPos.y]?.[nextPos.x];
  // Fix: Explicitly check for 'undefined' for out-of-bounds positions. The previous '!nextCell' check incorrectly treated 'CellType.WALL' (value 0) as falsy, causing a type error.
  if (nextCell === undefined) return true; // Out of bounds
  if (nextCell === CellType.WALL) return true;

  const currentCell = board[currentPos.y]?.[currentPos.x];

  // Ghosts can't enter the ghost home from outside, unless eaten.
  const isEnteringGhostHome = 
      (nextCell === CellType.GHOST_HOME || nextCell === CellType.GHOST_HOME_DOOR) &&
      currentCell !== CellType.GHOST_HOME &&
      currentCell !== CellType.GHOST_HOME_DOOR;
      
  if (isEnteringGhostHome && state !== 'eaten') return true;
  
  return false;
};

// Safe one-tile step with validation. Returns new position + direction if allowed, else null.
const safeGhostStep = (
  pos: Position,
  dir: Direction,
  board: CellType[][],
  state: Ghost['state']
): { pos: Position; dir: Direction } | null => {
  if (dir === Direction.NONE) return null;
  const nxt = getNextPosition(pos, dir);
  if (isBlockedForGhost(pos, nxt, board, state)) return null;
  return { pos: nxt, dir };
};

// Try a list of candidate directions in order and take the first legal step.
const tryGhostMoves = (
  pos: Position,
  candidates: Direction[],
  board: CellType[][],
  state: Ghost['state']
): { pos: Position; dir: Direction } | null => {
  for (const d of candidates) {
    const step = safeGhostStep(pos, d, board, state);
    if (step) return step;
  }
  return null;
};

// BFS pathfinding function to find the next best move
const findNextMove = (board: CellType[][], start: Position, end: Position, ghostState: Ghost['state']): Direction | null => {
    const queue: { pos: Position, firstStep: Direction }[] = [];
    const visited = new Set<string>();
    const stringify = (p: Position) => `${p.x},${p.y}`;
    
    visited.add(stringify(start));

    for (const dir of [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]) {
        const nextPos = getNextPosition(start, dir);
        if (isBlockedForGhost(start, nextPos, board, ghostState)) continue;
        
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

            if (isBlockedForGhost(pos, nextPos, board, ghostState)) continue;
            
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

type HiveMindStatus = 'offline' | 'thinking' | 'active' | 'error';

const GameOverlay: React.FC<{ gameState: GameState; score: number; lives: number; onStart: () => void; hiveMindStatus: HiveMindStatus; }> = ({ gameState, score, lives, onStart, hiveMindStatus }) => {
  const message = useMemo(() => {
    switch (gameState) {
      case GameState.READY: return "Press Enter to Start";
      case GameState.GAME_OVER: return "Game Over! Press Enter to Restart";
      case GameState.LEVEL_WON: return "You Win! Press Enter to Play Again";
      default: return null;
    }
  }, [gameState]);

  const hiveMindColor = useMemo(() => {
    switch (hiveMindStatus) {
      case 'active': return 'text-purple-400';
      case 'thinking': return 'text-yellow-400 animate-pulse';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  }, [hiveMindStatus]);

  return (
    <>
      <div className="absolute top-2 left-2 text-white font-bold text-lg z-20">SCORE: {score}</div>
      <div className="absolute top-8 left-2 text-white font-bold text-sm z-20">
        HIVE-MIND: <span className={hiveMindColor}>{hiveMindStatus.toUpperCase()}</span>
      </div>
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

const Character: React.FC<{
  type: 'pacman' | 'ghost';
  data: Pacman | Ghost;
  isFrightened?: boolean;
  isHiveMindControlled?: boolean;
}> = ({ type, data, isFrightened, isHiveMindControlled }) => {
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
    
    const colorClass = isFrightened
        ? 'bg-blue-700 animate-pulse'
        : isHiveMindControlled
        ? 'bg-purple-600 animate-pulse'
        : ghostData.color;

    return (
        <div className="absolute w-6 h-6 transition-all duration-100 ease-linear" style={{ top: position.y * TILE_SIZE, left: position.x * TILE_SIZE }}>
            {isEaten ? (
                <div className="relative w-full h-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full mr-1"></div>
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                </div>
            ) : (
                <div className={`w-full h-full rounded-t-full relative ${colorClass}`}>
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

  const [hiveMindStatus, setHiveMindStatus] = useState<HiveMindStatus>('offline');
  const [geminiTargets, setGeminiTargets] = useState<Record<number, Position> | null>(null);
  const [geminiAi, setGeminiAi] = useState<GoogleGenAI | null>(null);
  
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    try {
      if (typeof process === 'object' && process?.env?.API_KEY) {
        setGeminiAi(new GoogleGenAI({ apiKey: process.env.API_KEY }));
      }
    } catch (e) {
      console.error("Failed to initialize GoogleGenAI, Hive-Mind will be disabled:", e);
      setGeminiAi(null);
    }
  }, []);

  const pacmanRef = useRef(pacman);
  pacmanRef.current = pacman;
  const ghostsRef = useRef(ghosts);
  ghostsRef.current = ghosts;

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
    setHiveMindStatus('offline');
    setGeminiTargets(null);
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
  
  const callHiveMind = useCallback(async () => {
    if (!geminiAi || ghostMode !== 'chase') return;
    setHiveMindStatus('thinking');

    const currentPacman = pacmanRef.current;
    const currentGhosts = ghostsRef.current;

    const prompt = `You are a master strategist for the ghosts in Pac-Man. Your goal is to coordinate the 4 ghosts to trap and capture Pac-Man. The maze is ${BOARD_WIDTH}x${BOARD_HEIGHT} (x from 0 to ${BOARD_WIDTH - 1}, y from 0 to ${BOARD_HEIGHT - 1}). Pac-Man is at (${currentPacman.position.x}, ${currentPacman.position.y}). The ghosts are at: Blinky (ID 1): (${currentGhosts[0].position.x}, ${currentGhosts[0].position.y}), Pinky (ID 2): (${currentGhosts[1].position.x}, ${currentGhosts[1].position.y}), Inky (ID 3): (${currentGhosts[2].position.x}, ${currentGhosts[2].position.y}), Clyde (ID 4): (${currentGhosts[3].position.x}, ${currentGhosts[3].position.y}). Provide the optimal target coordinates (x, y) for each ghost to move towards. Your response MUST be a valid JSON object with keys "1", "2", "3", "4", where each key corresponds to a ghost ID and the value is an object with "x" and "y" properties.`;

    try {
        const response = await geminiAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        "1": { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["x", "y"] },
                        "2": { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["x", "y"] },
                        "3": { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["x", "y"] },
                        "4": { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["x", "y"] },
                    },
                    required: ["1", "2", "3", "4"],
                },
            },
        });

        const text = response.text.trim();
        if (!text) {
          throw new Error("API returned an empty response.");
        }
        const targets = JSON.parse(text);
        
        if (targets && typeof targets === 'object' && Object.keys(targets).length === 4) {
            setGeminiTargets(targets);
            setHiveMindStatus('active');
        } else {
            throw new Error("Invalid target data structure from API");
        }
    } catch (e) {
        console.error("Hive-Mind Error:", e);
        setHiveMindStatus('error');
        setGeminiTargets(null);
    }
  }, [geminiAi, ghostMode]);

  // Hive-Mind trigger effect
  useEffect(() => {
    if (gameState === GameState.PLAYING && ghostMode === 'chase' && geminiAi) {
      const interval = setInterval(callHiveMind, 15000); // Call every 15 seconds
      callHiveMind(); // Initial call
      return () => clearInterval(interval);
    }
  }, [gameState, ghostMode, geminiAi, callHiveMind]);
  
  const movePacman = useCallback(() => {
    setPacman(p => {
        let currentDirection = p.direction;
        const nextPosWithNextDir = getNextPosition(p.position, p.nextDirection);
        
        if (!isWall(nextPosWithNextDir, board)) {
            currentDirection = p.nextDirection;
        }

        const newPosition = getNextPosition(p.position, currentDirection);
        // Guard: if somehow blocked (edge wrapping weirdness), don't move this tick
        if (isWall(newPosition, board)) {
          return { ...p, isMouthOpen: !p.isMouthOpen };
        }
        return { ...p, position: newPosition, direction: currentDirection, isMouthOpen: !p.isMouthOpen };
    });
  }, [board]);

  const moveGhosts = useCallback(() => {
    setGhosts(currentGhosts => currentGhosts.map(ghost => {
      const opposite: Record<Direction, Direction> = {
        [Direction.UP]: Direction.DOWN,
        [Direction.DOWN]: Direction.UP,
        [Direction.LEFT]: Direction.RIGHT,
        [Direction.RIGHT]: Direction.LEFT,
        [Direction.NONE]: Direction.NONE
      };
  
      // 1) Returning home (eaten) — path to spawn
      if (ghost.state === 'eaten') {
        if (ghost.position.x === ghost.spawn.x && ghost.position.y === ghost.spawn.y) {
          return { ...ghost, state: 'normal', direction: Direction.UP };
        }
        const nextDir = findNextMove(board, ghost.position, ghost.spawn, ghost.state);
        const step = nextDir
          ? safeGhostStep(ghost.position, nextDir, board, ghost.state)
          : tryGhostMoves(ghost.position, [opposite[ghost.direction], ghost.direction].filter(d => d !== Direction.NONE), board, ghost.state);
        return step ? { ...ghost, position: step.pos, direction: step.dir } : ghost;
      }
  
      // 2) Frightened — random move, but don't reverse if possible
      if (ghost.state === 'frightened') {
        const dirs: Direction[] = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
        const allowedDirs = dirs.filter(dir => !isBlockedForGhost(ghost.position, getNextPosition(ghost.position, dir), board, ghost.state));
        const nonReversingDirs = allowedDirs.filter(d => d !== opposite[ghost.direction]);

        const moveCandidates = nonReversingDirs.length > 0 ? nonReversingDirs : allowedDirs;
        const randomDir = moveCandidates[Math.floor(Math.random() * moveCandidates.length)] ?? Direction.NONE;
        
        const step = safeGhostStep(ghost.position, randomDir, board, ghost.state);
        return step ? { ...ghost, position: step.pos, direction: step.dir } : ghost;
      }
  
      // 3) Normal (chase or scatter) — compute target, then pathfind
      const targetPos = (ghostMode === 'chase' && geminiTargets && geminiTargets[ghost.id])
        ? geminiTargets[ghost.id]
        : (ghostMode === 'chase' ? getChaseTarget(ghost, pacman, currentGhosts) : ghost.scatterTarget);
  
      const bestDir = findNextMove(board, ghost.position, targetPos, ghost.state);
  
      // Don't allow reversing direction
      const candidates: Direction[] = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]
        .filter(d => d !== opposite[ghost.direction]);

      if (bestDir && candidates.includes(bestDir)) {
          // If best direction is valid (not reverse), move there.
          const step = safeGhostStep(ghost.position, bestDir, board, ghost.state);
          if (step) return { ...ghost, position: step.pos, direction: step.dir };
      }
      
      // If bestDir is not an option, find any valid (non-reversing) move.
      // Prioritize current direction to keep moving straight.
      const moveOrder = [ghost.direction, ...candidates.filter(d => d !== ghost.direction)];
      const step = tryGhostMoves(ghost.position, moveOrder, board, ghost.state);
      return step ? { ...ghost, position: step.pos, direction: step.dir } : ghost;

    }));
  }, [board, pacman, ghostMode, geminiTargets]);
  
  // Game Loop
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;

    const gameTick = setInterval(() => {
      // 1. Move Pac-Man
      movePacman();
      
      // 2. Move Ghosts
      moveGhosts();
      
      // 3. Update ghost mode (chase/scatter)
      setModeTicks(prev => {
        if (prev <= 1) {
            const newIndex = (scheduleIndex + 1) % GHOST_MODE_SCHEDULE.length;
            setScheduleIndex(newIndex);
            const newMode = GHOST_MODE_SCHEDULE[newIndex].mode as 'chase' | 'scatter';
            setGhostMode(newMode);
            return GHOST_MODE_SCHEDULE[newIndex].duration / GAME_SPEED;
        }
        return prev - 1;
      });

      // 4. Update frightened state
      if (frightenedTicks > 0) {
          setFrightenedTicks(t => t - 1);
          if (frightenedTicks === 1) { // When it's about to end
              setGhosts(gs => gs.map(g => g.state === 'frightened' ? { ...g, state: 'normal' } : g));
              setGeminiTargets(null); // Clear Gemini targets when frightened mode ends
          }
      }

    }, GAME_SPEED);

    return () => clearInterval(gameTick);
  }, [gameState, movePacman, moveGhosts, scheduleIndex, frightenedTicks]);

  // Collision Detection and Pellet Eating
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;

    const { x, y } = pacman.position;
    const cell = board[y][x];

    if (cell === CellType.PELLET || cell === CellType.POWER_PELLET) {
      const newBoard = board.map(row => [...row]);
      newBoard[y][x] = CellType.EMPTY;
      setBoard(newBoard);
      
      const points = cell === CellType.PELLET ? 10 : 50;
      setScore(s => s + points);
      const newEatenPellets = eatenPellets + 1;
      setEatenPellets(newEatenPellets);

      if (cell === CellType.POWER_PELLET) {
          setFrightenedTicks(FRIGHTENED_DURATION);
          setGhosts(gs => gs.map(g => g.state !== 'eaten' ? { ...g, state: 'frightened' } : g));
          setGeminiTargets(null); // Disable hive-mind when Pac-Man is powered up
      }
      
      if (newEatenPellets === TOTAL_PELLETS) {
        setGameState(GameState.LEVEL_WON);
      }
    }

    // Ghost collision
    for (const ghost of ghosts) {
      if (ghost.position.x === x && ghost.position.y === y) {
        if (ghost.state === 'frightened') {
          setScore(s => s + 200);
          setGhosts(gs => gs.map(g => g.id === ghost.id ? { ...g, state: 'eaten' } : g));
        } else if (ghost.state === 'normal' && gameStateRef.current === GameState.PLAYING) {
          setGameState(GameState.PAUSED); // Pause to prevent multiple life losses
          setLives(l => l - 1);
          if (lives - 1 <= 0) {
            setGameState(GameState.GAME_OVER);
          } else {
            setTimeout(() => {
                resetLevel();
                setGameState(GameState.PLAYING);
            }, 2000); // 2-second pause before resuming
          }
          break; // Exit loop after first collision
        }
      }
    }

  }, [pacman.position, board, eatenPellets, ghosts, lives, resetLevel, gameState]);


  return (
    <div className="flex flex-col justify-center items-center min-h-screen bg-black text-white p-4">
      <h1 className="text-4xl font-bold text-yellow-400 mb-4 font-mono">React Pac-Man</h1>
      <div 
        className="relative bg-blue-900 border-4 border-blue-500"
        style={{ width: BOARD_WIDTH * TILE_SIZE, height: BOARD_HEIGHT * TILE_SIZE }}
      >
        <GameOverlay gameState={gameState} score={score} lives={lives} onStart={startGame} hiveMindStatus={hiveMindStatus} />
        {board.map((row, y) => (
          <div key={y} className="flex">
            {row.map((cell, x) => (
              <div key={`${x}-${y}`} style={{ width: TILE_SIZE, height: TILE_SIZE }}>
                <BoardCell cellType={cell} />
              </div>
            ))}
          </div>
        ))}

        <Character type="pacman" data={pacman} />
        {ghosts.map(ghost => (
          <Character 
            key={ghost.id} 
            type="ghost" 
            data={ghost} 
            isFrightened={frightenedTicks > 0 && ghost.state !== 'eaten'}
            isHiveMindControlled={ghostMode === 'chase' && !!geminiTargets?.[ghost.id]}
          />
        ))}
      </div>
    </div>
  );
};

export default App;
