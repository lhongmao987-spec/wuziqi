"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GamePhase = exports.GameMode = exports.GameResult = exports.CellState = exports.Player = void 0;
// @ts-nocheck
// 玩家身份
var Player;
(function (Player) {
    Player["Black"] = "BLACK";
    Player["White"] = "WHITE";
    Player["None"] = "NONE";
})(Player || (exports.Player = Player = {}));
// 棋盘格子状态
var CellState;
(function (CellState) {
    CellState[CellState["Empty"] = 0] = "Empty";
    CellState[CellState["Black"] = 1] = "Black";
    CellState[CellState["White"] = 2] = "White";
})(CellState || (exports.CellState = CellState = {}));
// 对局结果
var GameResult;
(function (GameResult) {
    GameResult["Ongoing"] = "ONGOING";
    GameResult["BlackWin"] = "BLACK_WIN";
    GameResult["WhiteWin"] = "WHITE_WIN";
    GameResult["Draw"] = "DRAW";
    GameResult["BlackLoseForbidden"] = "BLACK_LOSE_FORBIDDEN";
    GameResult["Resign"] = "RESIGN";
    GameResult["Timeout"] = "TIMEOUT";
})(GameResult || (exports.GameResult = GameResult = {}));
// 游戏模式
var GameMode;
(function (GameMode) {
    GameMode["PVP_LOCAL"] = "PVP_LOCAL";
    GameMode["PVE"] = "PVE";
    GameMode["PVP_ONLINE"] = "PVP_ONLINE";
})(GameMode || (exports.GameMode = GameMode = {}));
// 游戏阶段
var GamePhase;
(function (GamePhase) {
    GamePhase["NotStarted"] = "NOT_STARTED";
    GamePhase["Playing"] = "PLAYING";
    GamePhase["Ended"] = "ENDED";
})(GamePhase || (exports.GamePhase = GamePhase = {}));
