const { RuleEngine } = require('./ruleEngine');
const { AIEngine } = require('./aiEngine');
const { 
  GameResult, GamePhase, Player, Move, CellState, GameMode 
} = require('./types');

class GameCore {
  constructor() {
    this.ruleEngine = new RuleEngine();
    this.aiEngine = new AIEngine(this.ruleEngine);
    this.state = this.createInitialState();
    this.onBoardUpdateCallback = null;
    this.onGameOverCallback = null;
    this.onErrorCallback = null;
  }

  createInitialState() {
    const boardSize = 15;
    const board = Array(boardSize).fill(null).map(() => 
      Array(boardSize).fill(CellState.Empty)
    );

    return {
      board,
      currentPlayer: Player.Black,
      moves: [],
      result: GameResult.Ongoing,
      phase: GamePhase.NotStarted,
      config: {
        boardSize,
        ruleSet: 'STANDARD',
        enableForbidden: false,
        allowUndo: true,
        mode: GameMode.PVP_LOCAL
      },
      timeState: {
        blackRemain: 0,
        whiteRemain: 0
      }
    };
  }

  init(config) {
    const boardSize = config.boardSize || 15;
    const board = Array(boardSize).fill(null).map(() => 
      Array(boardSize).fill(CellState.Empty)
    );

    const timeState = {
      blackRemain: config.timeLimitPerPlayer || 0,
      whiteRemain: config.timeLimitPerPlayer || 0
    };

    this.state = {
      board,
      currentPlayer: Player.Black,
      moves: [],
      result: GameResult.Ongoing,
      winner: undefined,
      phase: GamePhase.Playing,
      config,
      timeState,
      winningPositions: undefined
    };

    this.triggerBoardUpdate();
  }

  getState() {
    const state = JSON.parse(JSON.stringify(this.state));
    // 确保 winningPositions 被包含
    if (this.state.winningPositions) {
      state.winningPositions = this.state.winningPositions;
    }
    return state;
  }

  handlePlayerMove(x, y) {
    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束');
      return;
    }

    const isValid = this.ruleEngine.isValidMove(this.state.board, x, y);
    
    if (!isValid) {
      this.triggerError('非法落子：位置已被占用或超出边界');
      return;
    }

    this.executeMove(x, y, this.state.currentPlayer);
  }

  executeMove(x, y, player) {
    const cellValue = player === Player.Black ? CellState.Black : CellState.White;
    
    this.state.board[x][y] = cellValue;

    const move = {
      x, y, player,
      timestamp: Date.now()
    };
    this.state.moves.push(move);
    this.state.lastMove = move;

    const judgment = this.ruleEngine.applyMoveAndJudge(this.state.board, move, this.state.config);
    
    if (judgment.result !== GameResult.Ongoing) {
      // 如果有连成五子，先标记位置，延迟跳转
      if (judgment.winningPositions) {
        this.state.winningPositions = judgment.winningPositions;
        this.triggerBoardUpdate();
        // 延迟1.5秒后跳转
        setTimeout(() => {
          this.endGame(judgment.result, judgment.winner);
        }, 1500);
      } else {
        this.endGame(judgment.result, judgment.winner);
      }
      return;
    }

    this.state.currentPlayer = player === Player.Black ? Player.White : Player.Black;
    this.state.timeState.currentStartTs = Date.now();

    this.triggerBoardUpdate();

    if (this.state.config.mode === GameMode.PVE && this.state.currentPlayer === Player.White) {
      setTimeout(() => {
        this.makeAIMove();
      }, 500);
    }
  }

  makeAIMove() {
    if (this.state.phase !== GamePhase.Playing) return;

    const aiLevel = this.state.config.aiLevel || 'EASY';
    const move = this.aiEngine.getNextMove(this.state.board, Player.White, aiLevel);
    
    this.executeMove(move.x, move.y, Player.White);
  }

  handleUndo() {
    if (!this.state.config.allowUndo) {
      this.triggerError('本局不允许悔棋');
      return;
    }

    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束，无法悔棋');
      return;
    }

    let stepsToUndo = 1;
    if (this.state.config.mode === GameMode.PVE) {
      stepsToUndo = 2;
    }

    if (this.state.moves.length < stepsToUndo) {
      this.triggerError('没有可悔的棋步');
      return;
    }

    for (let i = 0; i < stepsToUndo; i++) {
      const lastMove = this.state.moves.pop();
      if (lastMove) {
        this.state.board[lastMove.x][lastMove.y] = CellState.Empty;
      }
    }

    if (this.state.moves.length > 0) {
      this.state.lastMove = this.state.moves[this.state.moves.length - 1];
      this.state.currentPlayer = this.state.lastMove.player === Player.Black ? Player.White : Player.Black;
    } else {
      this.state.lastMove = undefined;
      this.state.currentPlayer = Player.Black;
    }

    this.triggerBoardUpdate();
  }

  handleResign(player) {
    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束');
      return;
    }

    const winner = player === Player.Black ? Player.White : Player.Black;
    this.endGame(GameResult.Resign, winner);
  }

  tick(deltaMs) {
    if (this.state.phase !== GamePhase.Playing || !this.state.config.timeLimitPerPlayer) {
      return;
    }

    const now = Date.now();
    const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0
      ? deltaMs
      : (this.state.timeState.currentStartTs ? now - this.state.timeState.currentStartTs : 0);
    const elapsed = elapsedMs / 1000;
    
    if (this.state.currentPlayer === Player.Black) {
      this.state.timeState.blackRemain -= elapsed;
      if (this.state.timeState.blackRemain <= 0) {
        this.state.timeState.blackRemain = 0;
        this.endGame(GameResult.Timeout, Player.White);
        return;
      }
    } else {
      this.state.timeState.whiteRemain -= elapsed;
      if (this.state.timeState.whiteRemain <= 0) {
        this.state.timeState.whiteRemain = 0;
        this.endGame(GameResult.Timeout, Player.Black);
        return;
      }
    }

    this.state.timeState.currentStartTs = now;
  }

  restart() {
    this.init(this.state.config);
  }

  endGame(result, winner) {
    this.state.result = result;
    this.state.winner = winner;
    this.state.phase = GamePhase.Ended;
    this.state.timeState.currentStartTs = undefined;

    this.triggerGameOver();
  }

  onBoardUpdate(cb) {
    this.onBoardUpdateCallback = cb;
  }

  onGameOver(cb) {
    this.onGameOverCallback = cb;
  }

  onError(cb) {
    this.onErrorCallback = cb;
  }

  triggerBoardUpdate() {
    if (this.onBoardUpdateCallback) {
      this.onBoardUpdateCallback(this.getState());
    }
  }

  triggerGameOver() {
    if (this.onGameOverCallback) {
      this.onGameOverCallback(this.getState());
    }
  }

  triggerError(message) {
    if (this.onErrorCallback) {
      this.onErrorCallback(new Error(message));
    }
  }
}

module.exports = { GameCore };

