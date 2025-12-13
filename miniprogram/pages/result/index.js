const { GameResult, Player } = require('../../core/types');

const resultTextMap = {
  [GameResult.BlackWin]: '黑棋胜利',
  [GameResult.WhiteWin]: '白棋胜利',
  [GameResult.Draw]: '平局',
  [GameResult.BlackLoseForbidden]: '黑棋禁手判负',
  [GameResult.Resign]: '对局已结束',
  [GameResult.Timeout]: '超时判负',
  [GameResult.Ongoing]: '对局进行中'
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
    const result = query.result || GameResult.Ongoing;
    const winner = query.winner;
    const moves = Number(query.moves || 0);

    const highlight = winner === Player.Black
      ? '恭喜，黑棋执先取得胜利'
      : winner === Player.White
        ? '白棋后手反击成功'
        : '再来一局试试吧';

    const badges = [];
    if (moves > 0 && moves <= 20) badges.push('速战速决');
    if (result === GameResult.Timeout) badges.push('保持专注，留意计时');

    this.setData({
      resultText: resultTextMap[result],
      subText: highlight,
      moves,
      highlight,
      badges
    });
    
    // 上报战绩（只在人机对战模式下上报）
    const playerResult = query.playerResult;
    const mode = query.mode;
    if (playerResult && mode && mode !== 'PVP_LOCAL') {
      // 本机对战不记录战绩
      this.reportGameResult({
        result: playerResult,
        moves: moves,
        mode: mode,
        opponentType: query.opponentType || 'AI',
        opponentName: query.opponentName || 'AI',
        difficulty: query.difficulty || '',
        duration: Number(query.duration || 0)
      });
    }
  },

  // 上报对局结果
  reportGameResult(gameData) {
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'reportResult',
        data: gameData
      },
      success: (res) => {
        if (res.result.success) {
          console.log('战绩上报成功');
        } else {
          console.error('战绩上报失败:', res.result.errMsg);
        }
      },
      fail: (err) => {
        console.error('战绩上报失败:', err);
      }
    });
  },

  restart() {
    const config = wx.getStorageSync('lastConfig');
    if (config) {
      const { mode, aiLevel, timeLimitPerPlayer } = config;
      const query = `mode=${mode}&aiLevel=${aiLevel || ''}` +
        (timeLimitPerPlayer ? `&timeLimit=${timeLimitPerPlayer}` : '');
      wx.redirectTo({ url: `/pages/game/index?${query}` });
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  backHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
