"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const types_1 = require("../../core/types");
const resultTextMap = {
    [types_1.GameResult.BlackWin]: '黑棋胜利',
    [types_1.GameResult.WhiteWin]: '白棋胜利',
    [types_1.GameResult.Draw]: '平局',
    [types_1.GameResult.BlackLoseForbidden]: '黑棋禁手判负',
    [types_1.GameResult.Resign]: '对局已结束',
    [types_1.GameResult.Timeout]: '超时判负',
    [types_1.GameResult.Ongoing]: '对局进行中'
};
Page({
    data: {
        resultText: '',
        subText: '',
        moves: 0,
        highlight: '',
        badges: []
    },
    onLoad(query) {
        const result = query.result || types_1.GameResult.Ongoing;
        const winner = query.winner;
        const moves = Number(query.moves || 0);
        const highlight = winner === types_1.Player.Black
            ? '恭喜，黑棋执先取得胜利'
            : winner === types_1.Player.White
                ? '白棋后手反击成功'
                : '再来一局试试吧';
        const badges = [];
        if (moves > 0 && moves <= 20)
            badges.push('速战速决');
        if (result === types_1.GameResult.Timeout)
            badges.push('保持专注，留意计时');
        this.setData({
            resultText: resultTextMap[result],
            subText: highlight,
            moves,
            highlight,
            badges
        });
    },
    restart() {
        const config = wx.getStorageSync('lastConfig');
        if (config) {
            const { mode, aiLevel, timeLimitPerPlayer } = config;
            const query = `mode=${mode}&aiLevel=${aiLevel || ''}` +
                (timeLimitPerPlayer ? `&timeLimit=${timeLimitPerPlayer}` : '');
            wx.redirectTo({ url: `/pages/game/index?${query}` });
        }
        else {
            wx.reLaunch({ url: '/pages/index/index' });
        }
    },
    backHome() {
        wx.reLaunch({ url: '/pages/index/index' });
    }
});
