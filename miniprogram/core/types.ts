// 玩家身份
export enum Player {
  Black = 'BLACK',
  White = 'WHITE',
  None  = 'NONE',
}

// 棋盘格子状态
export enum CellState {
  Empty = 0,
  Black = 1,
  White = 2,
}

// 对局结果
export enum GameResult {
  Ongoing = 'ONGOING',
  BlackWin = 'BLACK_WIN',
  WhiteWin = 'WHITE_WIN',
  Draw = 'DRAW',
  BlackLoseForbidden = 'BLACK_LOSE_FORBIDDEN',
  Resign = 'RESIGN',
  Timeout = 'TIMEOUT',
}

// 游戏模式
export enum GameMode {
  PVP_LOCAL = 'PVP_LOCAL',
  PVE = 'PVE',
  PVP_ONLINE = 'PVP_ONLINE',
}

// 游戏阶段
export enum GamePhase {
  NotStarted = 'NOT_STARTED',
  Playing = 'PLAYING',
  Ended = 'ENDED',
}

// 棋盘：15x15 二维数组
export type Board = CellState[][];

// 一步棋记录
export interface Move {
  x: number;          // 行（0-14）
  y: number;          // 列（0-14）
  player: Player;
  timestamp: number;  // 毫秒
}

// 对局配置
export interface GameConfig {
  boardSize: number;
  ruleSet: 'STANDARD' | 'RENJU';
  enableForbidden: boolean;       // 是否启用禁手（黑方）
  timeLimitPerPlayer?: number;    // 单人总时间（秒），0/undefined 为不限时
  timeLimitPerMove?: number;      // 每步时间限制（秒），0/undefined 为不限时
  allowUndo: boolean;             // 是否允许悔棋
  mode: GameMode;
  aiLevel?: 'EASY' | 'MEDIUM' | 'HARD';
}

// 计时状态
export interface TimeState {
  blackRemain: number;        // 黑方剩余时间（秒）
  whiteRemain: number;        // 白方剩余时间（秒）
  currentStartTs?: number;    // 当前回合开始计时的时间戳
  currentMoveRemain?: number; // 当前步剩余时间（秒），用于每步计时模式
}

// 对局状态（UI渲染的唯一数据源）
export interface GameState {
  board: Board;
  currentPlayer: Player;
  moves: Move[];
  result: GameResult;
  winner?: Player;
  phase: GamePhase;
  config: GameConfig;
  timeState: TimeState;
  lastMove?: Move;
  winningPositions?: Array<{ x: number; y: number }>; // 获胜的五子位置
}

// 规则引擎接口（供内部使用）
export interface IRuleEngine {
  isValidMove(board: Board, x: number, y: number): boolean;
  applyMoveAndJudge(
    board: Board,
    move: Move,
    config: GameConfig
  ): {
    winner?: Player;
    result: GameResult;
  };
}

// AI引擎接口（供内部使用）
export interface IAIEngine {
  getNextMove(
    board: Board,
    player: Player,
    level: 'EASY' | 'MEDIUM' | 'HARD'
  ): { x: number, y: number };
}

// GameCore对外接口（UI层唯一调用入口）
export interface IGameCore {
  init(config: GameConfig): void;
  getState(): GameState;
  restoreState(state: GameState): void;
  handlePlayerMove(x: number, y: number): void;
  handleUndo(): void;
  handleResign(player: Player): void;
  tick(deltaMs: number): void;
  restart(): void;

  // 事件订阅（UI层注册回调）
  onBoardUpdate(cb: (state: GameState) => void): void;
  onGameOver(cb: (state: GameState) => void): void;
  onError(cb: (error: Error) => void): void;
}

