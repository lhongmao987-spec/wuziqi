"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameCore = void 0;
// @ts-nocheck
const types_1 = require("./types");
const ruleEngine_1 = require("./ruleEngine");
const aiEngine_1 = require("./aiEngine");
class GameCore {
    constructor() {
        this.ruleEngine = new ruleEngine_1.RuleEngine();
        this.aiEngine = new aiEngine_1.AIEngine(this.ruleEngine);
        // 初始化空状态
        this.state = this.createInitialState();
    }
    /**
     * 创建初始状态
     */
    createInitialState() {
        const boardSize = 15;
        const board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(types_1.CellState.Empty));
        return {
            board,
            currentPlayer: types_1.Player.Black,
            moves: [],
            result: types_1.GameResult.Ongoing,
            phase: types_1.GamePhase.NotStarted,
            config: {
                boardSize,
                ruleSet: 'STANDARD',
                enableForbidden: false, // 默认关闭禁手，降低初期复杂度
                allowUndo: true,
                mode: types_1.GameMode.PVP_LOCAL
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
    init(config) {
        const boardSize = config.boardSize || 15;
        const board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(types_1.CellState.Empty));
        const timeState = {
            blackRemain: config.timeLimitPerPlayer || 0,
            whiteRemain: config.timeLimitPerPlayer || 0
        };
        this.state = {
            board,
            currentPlayer: types_1.Player.Black,
            moves: [],
            result: types_1.GameResult.Ongoing,
            winner: undefined,
            phase: types_1.GamePhase.Playing,
            config,
            timeState
        };
        this.triggerBoardUpdate();
    }
    /**
     * 获取当前状态（供UI层渲染）
     */
    getState() {
        return JSON.parse(JSON.stringify(this.state)); // 深拷贝，防止外部修改
    }
    /**
     * 处理玩家落子
     */
    handlePlayerMove(x, y) {
        // 阶段检查
        if (this.state.phase !== types_1.GamePhase.Playing) {
            this.triggerError('对局未开始或已结束');
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
    executeMove(x, y, player) {
        const cellValue = player === types_1.Player.Black ? types_1.CellState.Black : types_1.CellState.White;
        // 更新棋盘
        this.state.board[x][y] = cellValue;
        // 记录走子
        const move = {
            x, y, player,
            timestamp: Date.now()
        };
        this.state.moves.push(move);
        this.state.lastMove = move;
        // 规则判定
        const judgment = this.ruleEngine.applyMoveAndJudge(this.state.board, move, this.state.config);
        // 处理结果
        if (judgment.result !== types_1.GameResult.Ongoing) {
            this.endGame(judgment.result, judgment.winner);
            return;
        }
        // 切换玩家
        this.state.currentPlayer = player === types_1.Player.Black ? types_1.Player.White : types_1.Player.Black;
        // 切换回合后重置计时起点
        this.state.timeState.currentStartTs = Date.now();
        // 触发更新
        this.triggerBoardUpdate();
        // 如果是人机模式且轮到AI
        if (this.state.config.mode === types_1.GameMode.PVE && this.state.currentPlayer === types_1.Player.White) {
            // 延迟500ms模拟思考，提升用户体验
            setTimeout(() => {
                this.makeAIMove();
            }, 500);
        }
    }
    /**
     * AI落子
     */
    makeAIMove() {
        if (this.state.phase !== types_1.GamePhase.Playing)
            return;
        const aiLevel = this.state.config.aiLevel || 'EASY';
        const move = this.aiEngine.getNextMove(this.state.board, types_1.Player.White, aiLevel);
        this.executeMove(move.x, move.y, types_1.Player.White);
    }
    /**
     * 悔棋
     */
    handleUndo() {
        if (!this.state.config.allowUndo) {
            this.triggerError('本局不允许悔棋');
            return;
        }
        if (this.state.phase !== types_1.GamePhase.Playing) {
            this.triggerError('对局未开始或已结束，无法悔棋');
            return;
        }
        // 根据模式确定悔棋步数
        let stepsToUndo = 1;
        if (this.state.config.mode === types_1.GameMode.PVE) {
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
                this.state.board[lastMove.x][lastMove.y] = types_1.CellState.Empty;
            }
        }
        // 更新当前玩家
        if (this.state.moves.length > 0) {
            this.state.lastMove = this.state.moves[this.state.moves.length - 1];
            this.state.currentPlayer = this.state.lastMove.player === types_1.Player.Black ? types_1.Player.White : types_1.Player.Black;
        }
        else {
            this.state.lastMove = undefined;
            this.state.currentPlayer = types_1.Player.Black;
        }
        this.triggerBoardUpdate();
    }
    /**
     * 认输
     */
    handleResign(player) {
        if (this.state.phase !== types_1.GamePhase.Playing) {
            this.triggerError('对局未开始或已结束');
            return;
        }
        const winner = player === types_1.Player.Black ? types_1.Player.White : types_1.Player.Black;
        this.endGame(types_1.GameResult.Resign, winner);
    }
    /**
     * 计时心跳
     */
    tick(deltaMs) {
        if (this.state.phase !== types_1.GamePhase.Playing || !this.state.config.timeLimitPerPlayer) {
            return;
        }
        const now = Date.now();
        // 允许外部传入deltaMs；若未提供则用时间戳差
        const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0
            ? deltaMs
            : (this.state.timeState.currentStartTs ? now - this.state.timeState.currentStartTs : 0);
        const elapsed = elapsedMs / 1000;
        // 更新当前玩家剩余时间
        if (this.state.currentPlayer === types_1.Player.Black) {
            this.state.timeState.blackRemain -= elapsed;
            if (this.state.timeState.blackRemain <= 0) {
                this.state.timeState.blackRemain = 0;
                this.endGame(types_1.GameResult.Timeout, types_1.Player.White);
                return;
            }
        }
        else {
            this.state.timeState.whiteRemain -= elapsed;
            if (this.state.timeState.whiteRemain <= 0) {
                this.state.timeState.whiteRemain = 0;
                this.endGame(types_1.GameResult.Timeout, types_1.Player.Black);
                return;
            }
        }
        // 重置计时起点
        this.state.timeState.currentStartTs = now;
    }
    /**
     * 重新开始（使用当前配置）
     */
    restart() {
        this.init(this.state.config);
    }
    /**
     * 结束对局
     */
    endGame(result, winner) {
        this.state.result = result;
        this.state.winner = winner;
        this.state.phase = types_1.GamePhase.Ended;
        this.state.timeState.currentStartTs = undefined;
        // 触发游戏结束回调
        this.triggerGameOver();
        // TODO: 调用RecordService上报战绩（后续对接）
        // 示例：RecordService.reportResult({...})
    }
    /**
     * 事件订阅
     */
    onBoardUpdate(cb) {
        this.onBoardUpdateCallback = cb;
    }
    onGameOver(cb) {
        this.onGameOverCallback = cb;
    }
    onError(cb) {
        this.onErrorCallback = cb;
    }
    /**
     * 触发回调
     */
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
exports.GameCore = GameCore;
