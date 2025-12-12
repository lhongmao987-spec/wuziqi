import { 
  IGameCore, GameState, GameConfig, GameResult, GamePhase, Player, Move, TimeState,
  IRuleEngine, IAIEngine, Board, CellState, GameMode 
} from './types';
import { RuleEngine } from './ruleEngine';
import { AIEngine } from './aiEngine';

export class GameCore implements IGameCore {
  private state: GameState;
  private ruleEngine: IRuleEngine;
  private aiEngine: IAIEngine;

  // 事件回调
  private onBoardUpdateCallback?: (state: GameState) => void;
  private onGameOverCallback?: (state: GameState) => void;
  private onErrorCallback?: (error: Error) => void;

  constructor() {
    this.ruleEngine = new RuleEngine();
    this.aiEngine = new AIEngine(this.ruleEngine);
    
    // 初始化空状态
    this.state = this.createInitialState();
  }

  /**
   * 创建初始状态
   */
  private createInitialState(): GameState {
    const boardSize = 15;
    const board: Board = Array(boardSize).fill(null).map(() => 
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
        enableForbidden: false, // 默认关闭禁手，降低初期复杂度
        allowUndo: true,
        mode: GameMode.PVP_LOCAL
      },
      timeState: {
        blackRemain: 0,
        whiteRemain: 0
      }
    };
  }

  /**
   * 初始化新棋局
   */
  init(config: GameConfig): void {
    console.log('GameCore.init 被调用', config);
    const boardSize = config.boardSize || 15;
    const board: Board = Array(boardSize).fill(null).map(() => 
      Array(boardSize).fill(CellState.Empty)
    );

    const timeState: TimeState = {
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

  /**
   * 获取当前状态（供UI层渲染）
   */
  getState(): GameState {
    // 深拷贝，确保所有属性都被包含
    const stateCopy: GameState = {
      board: this.state.board.map(row => [...row]),
      currentPlayer: this.state.currentPlayer,
      moves: [...this.state.moves],
      result: this.state.result,
      winner: this.state.winner,
      phase: this.state.phase,
      config: { ...this.state.config },
      timeState: { ...this.state.timeState },
      lastMove: this.state.lastMove ? { ...this.state.lastMove } : undefined,
      winningPositions: this.state.winningPositions ? this.state.winningPositions.map(p => ({ ...p })) : undefined
    };
    // 添加调试日志
    if (this.state.winningPositions) {
      console.log('getState: state.winningPositions存在，值为:', this.state.winningPositions);
      console.log('getState: stateCopy.winningPositions为:', stateCopy.winningPositions);
    } else {
      console.log('getState: state.winningPositions不存在');
    }
    return stateCopy;
  }

  /**
   * 恢复游戏状态（用于继续未完成的游戏）
   */
  restoreState(state: GameState): void {
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

  /**
   * 处理玩家落子
   */
  handlePlayerMove(x: number, y: number): void {
    // 阶段检查
    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束');
      return;
    }

    // 在人机模式下，如果当前不是玩家回合，不允许玩家落子
    if (this.state.config.mode === GameMode.PVE && this.state.currentPlayer !== Player.Black) {
      this.triggerError('当前是AI回合，请等待AI落子');
      return;
    }

    // 合法性检查
    if (!this.ruleEngine.isValidMove(this.state.board, x, y)) {
      this.triggerError('非法落子：位置已被占用或超出边界');
      return;
    }

    // 执行落子
    this.executeMove(x, y, this.state.currentPlayer);
  }

  /**
   * 执行落子（内部方法）
   */
  private executeMove(x: number, y: number, player: Player): void {
    const cellValue = player === Player.Black ? CellState.Black : CellState.White;
    
    // 更新棋盘
    this.state.board[x][y] = cellValue;

    // 记录走子
    const move: Move = {
      x, y, player,
      timestamp: Date.now()
    };
    this.state.moves.push(move);
    this.state.lastMove = move;

    // 规则判定
    const judgment = this.ruleEngine.applyMoveAndJudge(this.state.board, move, this.state.config);
    console.log('executeMove: judgment结果:', judgment);
    
    // 处理结果
    if (judgment.result !== GameResult.Ongoing) {
      // 保存获胜的五子位置
      if (judgment.winningPositions && judgment.winningPositions.length > 0) {
        this.state.winningPositions = judgment.winningPositions;
        console.log('executeMove: 游戏结束，保存winningPositions到state:', this.state.winningPositions);
        console.log('executeMove: state.winningPositions现在为:', this.state.winningPositions);
      } else {
        this.state.winningPositions = undefined;
        console.log('executeMove: 游戏结束，但judgment中没有winningPositions，judgment:', judgment);
      }
      this.endGame(judgment.result, judgment.winner);
      return;
    }
    
    // 游戏继续，清除之前的获胜位置
    this.state.winningPositions = undefined;

    // 切换玩家
    this.state.currentPlayer = player === Player.Black ? Player.White : Player.Black;

    // 切换回合后重置计时起点
    this.state.timeState.currentStartTs = Date.now();
    // 重置每步计时
    if (this.state.config.timeLimitPerMove) {
      this.state.timeState.currentMoveRemain = this.state.config.timeLimitPerMove;
    }

    // 触发更新
    this.triggerBoardUpdate();

    // 如果是人机模式且轮到AI
    if (this.state.config.mode === GameMode.PVE && this.state.currentPlayer === Player.White) {
      // 延迟500ms模拟思考，提升用户体验
      setTimeout(() => {
        this.makeAIMove();
      }, 500);
    }
  }

  /**
   * AI落子
   */
  private makeAIMove(): void {
    if (this.state.phase !== GamePhase.Playing) return;

    const aiLevel = this.state.config.aiLevel || 'EASY';
    const move = this.aiEngine.getNextMove(this.state.board, Player.White, aiLevel);
    
    this.executeMove(move.x, move.y, Player.White);
  }

  /**
   * 悔棋
   */
  handleUndo(): void {
    if (!this.state.config.allowUndo) {
      this.triggerError('本局不允许悔棋');
      return;
    }

    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束，无法悔棋');
      return;
    }

    // 根据模式确定悔棋步数
    let stepsToUndo = 1;
    if (this.state.config.mode === GameMode.PVE) {
      // 人机模式需要悔两步（玩家+AI）
      stepsToUndo = 2;
    }

    if (this.state.moves.length < stepsToUndo) {
      this.triggerError('没有可悔的棋步');
      return;
    }

    // 移除指定步数
    for (let i = 0; i < stepsToUndo; i++) {
      const lastMove = this.state.moves.pop();
      if (lastMove) {
        this.state.board[lastMove.x][lastMove.y] = CellState.Empty;
      }
    }

    // 更新当前玩家
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

    // 清除获胜位置（悔棋后游戏继续）
    this.state.winningPositions = undefined;

    this.triggerBoardUpdate();
  }

  /**
   * 认输
   */
  handleResign(player: Player): void {
    if (this.state.phase !== GamePhase.Playing) {
      this.triggerError('对局未开始或已结束');
      return;
    }

    const winner = player === Player.Black ? Player.White : Player.Black;
    this.endGame(GameResult.Resign, winner);
  }

  /**
   * 计时心跳
   */
  tick(deltaMs: number): void {
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

  /**
   * 重新开始（使用当前配置）
   */
  restart(): void {
    this.init(this.state.config);
  }

  /**
   * 结束对局
   */
  private endGame(result: GameResult, winner?: Player): void {
    this.state.result = result;
    this.state.winner = winner;
    this.state.phase = GamePhase.Ended;
    this.state.timeState.currentStartTs = undefined;
    this.state.timeState.currentMoveRemain = undefined;

    // 先触发一次boardUpdate，确保winningPositions等状态更新到UI
    this.triggerBoardUpdate();

    // 触发游戏结束回调
    this.triggerGameOver();

    // TODO: 调用RecordService上报战绩（后续对接）
    // 示例：RecordService.reportResult({...})
  }

  /**
   * 事件订阅
   */
  onBoardUpdate(cb: (state: GameState) => void): void {
    this.onBoardUpdateCallback = cb;
  }

  onGameOver(cb: (state: GameState) => void): void {
    this.onGameOverCallback = cb;
  }

  onError(cb: (error: Error) => void): void {
    this.onErrorCallback = cb;
  }

  /**
   * 触发回调
   */
  private triggerBoardUpdate(): void {
    if (this.onBoardUpdateCallback) {
      this.onBoardUpdateCallback(this.getState());
    }
  }

  private triggerGameOver(): void {
    if (this.onGameOverCallback) {
      this.onGameOverCallback(this.getState());
    }
  }

  private triggerError(message: string): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(new Error(message));
    }
  }
}

