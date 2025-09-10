export enum Direction {
  UP,
  DOWN,
  LEFT,
  RIGHT,
  NONE,
}

export enum CellType {
  WALL,
  PELLET,
  EMPTY,
  POWER_PELLET,
  GHOST_HOME,
  GHOST_HOME_DOOR,
}

export enum GameState {
  READY,
  PLAYING,
  PAUSED,
  GAME_OVER,
  LEVEL_WON,
}

export type Position = {
  x: number;
  y: number;
};

export type Pacman = {
    position: Position;
    direction: Direction;
    nextDirection: Direction;
    isMouthOpen: boolean;
};

export type Ghost = {
  id: number;
  position: Position;
  direction: Direction;
  state: 'normal' | 'frightened' | 'eaten';
  color: string;
  spawn: Position;
  scatterTarget: Position;
};