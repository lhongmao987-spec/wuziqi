"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const gameCore_1 = require("../../core/gameCore");
const types_1 = require("../../core/types");
const core = new gameCore_1.GameCore();
Page({
    data: {
        board: [],
        gridCount: 15,
        boardSizePx: 320,
        lastMove: null,
        currentPlayer: types_1.Player.Black,
        players: types_1.Player,
        modeLabel: '人机对战 - 中级',
        opponentLabel: 'AI 对手',
        timerDisplay: '∞',
    },
    onLoad(query) {
        // 构造配置：从 query 读取模式/难度，否则使用默认
        const config = {
            boardSize: 15,
            ruleSet: 'STANDARD',
            enableForbidden: false,
            allowUndo: true,
            mode: query.mode || types_1.GameMode.PVE,
            aiLevel: query.aiLevel || 'MEDIUM',
            timeLimitPerPlayer: query.timeLimit ? Number(query.timeLimit) : undefined,
        };
        this.setData({
            modeLabel: config.mode === types_1.GameMode.PVE
                ? `人机对战 - ${config.aiLevel === 'HARD' ? '高级' : config.aiLevel === 'MEDIUM' ? '中级' : '初级'}`
                : '本机对战',
            opponentLabel: config.mode === types_1.GameMode.PVE ? 'AI 对手' : '玩家 2',
            timerDisplay: config.timeLimitPerPlayer ? this.formatTime(config.timeLimitPerPlayer) : '∞'
        });
        core.onBoardUpdate((state) => this.updateState(state));
        core.onGameOver((state) => this.handleGameOver(state));
        core.onError((err) => wx.showToast({ title: err.message, icon: 'none' }));
        core.init(config);
        this.startTick();
    },
    onUnload() {
        this.stopTick();
    },
    tickTimer: 0,
    startTick() {
        this.stopTick();
        this.tickTimer = setInterval(() => core.tick(1000), 1000);
    },
    stopTick() {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = 0;
        }
    },
    updateState(state) {
        this.setData({
            board: state.board,
            lastMove: state.lastMove || null,
            currentPlayer: state.currentPlayer,
            timerDisplay: state.config.timeLimitPerPlayer
                ? this.formatTime(state.currentPlayer === types_1.Player.Black
                    ? state.timeState.blackRemain
                    : state.timeState.whiteRemain)
                : '∞'
        });
    },
    handleGameOver(state) {
        wx.setStorageSync('lastConfig', state.config);
        const params = `result=${state.result}&winner=${state.winner || ''}&moves=${state.moves.length}`;
        wx.navigateTo({ url: `/pages/result/index?${params}` });
    },
    handleCellTap(e) {
        const { x, y } = e.detail;
        core.handlePlayerMove(Number(x), Number(y));
    },
    handleUndo() {
        core.handleUndo();
    },
    handleResign() {
        core.handleResign(this.data.currentPlayer);
    },
    backHome() {
        wx.navigateBack({ delta: 1 });
    },
    formatTime(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `${mm}:${ss}`;
    }
});
