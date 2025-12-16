// 玩家身份
const Player = {
  Black: 'BLACK',
  White: 'WHITE',
  None: 'NONE',
};

// 棋盘格子状态
const CellState = {
  Empty: 0,
  Black: 1,
  White: 2,
};

// 对局结果
const GameResult = {
  Ongoing: 'ONGOING',
  BlackWin: 'BLACK_WIN',
  WhiteWin: 'WHITE_WIN',
  Draw: 'DRAW',
  BlackLoseForbidden: 'BLACK_LOSE_FORBIDDEN',
  Resign: 'RESIGN',
  Timeout: 'TIMEOUT',
};

// 游戏模式
const GameMode = {
  PVP_LOCAL: 'PVP_LOCAL',
  PVE: 'PVE',
  PVP_ONLINE: 'PVP_ONLINE',
};

// 游戏阶段
const GamePhase = {
  NotStarted: 'NOT_STARTED',
  Playing: 'PLAYING',
  Ended: 'ENDED',
};

module.exports = {
  Player,
  CellState,
  GameResult,
  GameMode,
  GamePhase
};

