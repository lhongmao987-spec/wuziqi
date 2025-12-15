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
    console.log('GameCore.init 被调用', config);
    const boardSize = config.boardSize || 15;
    const board = Array(boardSize).fill(null).map(() => 
      Array(boardSize).fill(CellState.Empty)
    );

    const timeState = {
      blackRemain: config.timeLimitPerPlayer || 0,
      whiteRemain: config.timeLimitPerPlayer || 0,
      currentStartTs: Date.now(),
      currentMoveRemain: config.timeLimitPerMove ? config.timeLimitPerMove : undefined
    };

    console.log('初始化 timeState:', timeState);

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

    console.log('初始化完成，触发更新，state.config.timeLimitPerMove:', this.state.config.timeLimitPerMove);
    this.triggerBoardUpdate();
  }

  restoreState(state) {
    // 深拷贝状态，防止外部修改影响内部
    this.state = JSON.parse(JSON.stringify(state));
    
    // 如果游戏还在进行中，需要重新设置计时起点
    if (this.state.phase === GamePhase.Playing) {
      this.state.timeState.currentStartTs = Date.now();
      // 如果有每步计时，确保 currentMoveRemain 被正确初始化
      if (this.state.config.timeLimitPerMove) {
        if (this.state.timeState.currentMoveRemain === undefined || this.state.timeState.currentMoveRemain <= 0) {
          this.state.timeState.currentMoveRemain = this.state.config.timeLimitPerMove;
        }
      }
    }
    
    // 触发更新，让UI层刷新界面
    this.triggerBoardUpdate();
  }

  getState() {
    // 深拷贝，确保所有属性都被包含，特别是 winningPositions
    const state = {
      board: this.state.board.map(row => [...row]),
      currentPlayer: this.state.currentPlayer,
      moves: [...this.state.moves],
      result: this.state.result,
      winner: this.state.winner,
      phase: this.state.phase,
      config: Object.assign({}, this.state.config),
      timeState: Object.assign({}, this.state.timeState),
      lastMove: this.state.lastMove ? Object.assign({}, this.state.lastMove) : undefined,
      winningPositions: this.state.winningPositions ? this.state.winningPositions.map(p => ({ x: p.x, y: p.y })) : undefined
    };
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
      // 保存获胜的五子位置
      if (judgment.winningPositions && judgment.winningPositions.length > 0) {
        this.state.winningPositions = judgment.winningPositions;
      } else {
        this.state.winningPositions = undefined;
      }
      // 立即结束游戏，先触发boardUpdate确保winningPositions传递到UI
      this.endGame(judgment.result, judgment.winner);
      return;
    }
    
    // 游戏继续，清除之前的获胜位置
    this.state.winningPositions = undefined;

    this.state.currentPlayer = player === Player.Black ? Player.White : Player.Black;

    // 切换回合后重置计时起点
    this.state.timeState.currentStartTs = Date.now();
    // 重置每步计时
    if (this.state.config.timeLimitPerMove) {
      this.state.timeState.currentMoveRemain = this.state.config.timeLimitPerMove;
    }

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

    // 重置计时
    this.state.timeState.currentStartTs = Date.now();
    if (this.state.config.timeLimitPerMove) {
      this.state.timeState.currentMoveRemain = this.state.config.timeLimitPerMove;
    }

    this.triggerBoardUpdate();
  }

  handleResign(player) {
    console.log('handleResign 被调用，player:', player, 'phase:', this.state.phase);
    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束');
      return;
    }

    const winner = player === Player.Black ? Player.White : Player.Black;
    console.log('认输，winner:', winner);
    this.endGame(GameResult.Resign, winner);
  }

  tick(deltaMs) {
    if (this.state.phase !== GamePhase.Playing) {
      // 游戏已结束，不再打印日志，避免控制台刷屏
      return;
    }

    const now = Date.now();
    // 允许外部传入deltaMs；若未提供则用时间戳差
    const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0
      ? deltaMs
      : (this.state.timeState.currentStartTs ? now - this.state.timeState.currentStartTs : 0);
    const elapsed = elapsedMs / 1000;
    
    // 每步计时模式（本机对战）
    if (this.state.config.timeLimitPerMove) {
      console.log('每步计时模式，timeLimitPerMove:', this.state.config.timeLimitPerMove, 'currentMoveRemain:', this.state.timeState.currentMoveRemain);
      // 如果 currentMoveRemain 未初始化，进行初始化
      if (this.state.timeState.currentMoveRemain === undefined) {
        this.state.timeState.currentMoveRemain = this.state.config.timeLimitPerMove;
        this.state.timeState.currentStartTs = now;
        this.triggerBoardUpdate();
        return;
      }
      
      // 如果已经到0，保持为0并等待外部（例如在线对战超时换手）处理
      if (this.state.timeState.currentMoveRemain <= 0) {
        this.state.timeState.currentMoveRemain = 0;
        this.state.timeState.currentStartTs = now;
        this.triggerBoardUpdate();
        return;
      }

      this.state.timeState.currentMoveRemain -= elapsed;
      if (this.state.timeState.currentMoveRemain <= 0) {
        this.state.timeState.currentMoveRemain = 0;
        // 本机对战模式下，超时后自动跳过到对方
        if (this.state.config.mode === GameMode.PVP_LOCAL) {
          // 自动跳过：切换玩家并重置计时
          this.state.currentPlayer = this.state.currentPlayer === Player.Black ? Player.White : Player.Black;
          this.state.timeState.currentStartTs = now;
          this.state.timeState.currentMoveRemain = this.state.config.timeLimitPerMove;
          this.triggerBoardUpdate();
          return;
        } else if (this.state.config.mode === GameMode.PVP_ONLINE) {
          // 在线对战不在本地判负或自动切换，交给云函数处理
          this.triggerBoardUpdate();
          this.state.timeState.currentStartTs = now;
          return;
        } else {
          // 其他模式下，超时判负
          const winner = this.state.currentPlayer === Player.Black ? Player.White : Player.Black;
          this.endGame(GameResult.Timeout, winner);
          return;
        }
      }
      // 更新时间后触发UI更新
      this.triggerBoardUpdate();
      // 重置计时起点
      this.state.timeState.currentStartTs = now;
      return;
    }
    
    // 总时间计时模式（原有逻辑）
    if (this.state.config.timeLimitPerPlayer) {
      // 更新当前玩家剩余时间
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

      // 重置计时起点
      this.state.timeState.currentStartTs = now;
    }
  }

  restart() {
    this.init(this.state.config);
  }

  endGame(result, winner) {
    console.log('endGame 被调用，result:', result, 'winner:', winner);
    this.state.result = result;
    this.state.winner = winner;
    this.state.phase = GamePhase.Ended;
    this.state.timeState.currentStartTs = undefined;
    this.state.timeState.currentMoveRemain = undefined;

    // 先触发一次boardUpdate，确保winningPositions等状态更新到UI
    this.triggerBoardUpdate();

    console.log('触发 triggerGameOver');
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
      // 使用 setTimeout 避免阻塞
      setTimeout(() => {
        this.onBoardUpdateCallback(this.getState());
      }, 0);
    }
  }

  triggerGameOver() {
    console.log('triggerGameOver 被调用，是否有回调:', !!this.onGameOverCallback);
    if (this.onGameOverCallback) {
      // 立即触发，不延迟，确保快速响应
      const state = this.getState();
      console.log('调用游戏结束回调，state:', state);
      this.onGameOverCallback(state);
    }
  }

  triggerError(message) {
    if (this.onErrorCallback) {
      this.onErrorCallback(new Error(message));
    }
  }
}

module.exports = { GameCore };

