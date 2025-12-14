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
    
    // 上报战绩（只在人机对战模式下上报，且用户已登录）
    const playerResult = query.playerResult;
    const mode = query.mode;
    
    // 按优先级获取 dedupeKey：1. query参数 2. storage 3. 生成新的（兜底）
    let dedupeKey = query.dedupeKey || '';
    if (!dedupeKey) {
      dedupeKey = wx.getStorageSync('dedupeKey') || '';
    }
    if (!dedupeKey) {
      // 如果仍然为空，立即生成一个新的并写入 storage（兜底）
      dedupeKey = 'g_' + Date.now() + '_' + Math.random().toString(16).slice(2);
      console.warn('[FINAL] result页面兜底生成 dedupeKey=', dedupeKey);
      wx.setStorageSync('dedupeKey', dedupeKey);
    }
    console.log('[FINAL] dedupeKey=', dedupeKey);
    
    if (playerResult && mode && mode !== 'PVP_LOCAL' && dedupeKey) {
      // 检查用户是否已登录
      const userInfo = wx.getStorageSync('userInfo');
      if (userInfo && userInfo.nickName && userInfo.nickName.trim() !== '') {
        // 用户已登录，上报战绩（必须传递 dedupeKey）
        this.reportGameResult({
          result: playerResult,
          moves: moves,
          mode: mode,
          opponentType: query.opponentType || 'AI',
          opponentName: query.opponentName || 'AI',
          difficulty: query.difficulty || '',
          duration: Number(query.duration || 0),
          dedupeKey: dedupeKey // 必须传递 dedupeKey
        });
      } else {
        // 用户未登录，不保存战绩
        console.log('用户未登录，不保存战绩');
      }
    } else if (playerResult && mode && mode !== 'PVP_LOCAL' && !dedupeKey) {
      console.error('[FINAL] 错误：dedupeKey 为空，无法上报战绩');
    }
  },

  // 上报对局结果
  reportGameResult(gameData) {
    // 确保 dedupeKey 存在
    if (!gameData.dedupeKey) {
      console.error('[FINAL] 错误：reportGameResult 时 dedupeKey 为空');
      // 尝试从 storage 获取
      gameData.dedupeKey = wx.getStorageSync('dedupeKey') || '';
      if (!gameData.dedupeKey) {
        // 如果仍然为空，生成新的
        gameData.dedupeKey = 'g_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        console.warn('[FINAL] reportGameResult 兜底生成 dedupeKey=', gameData.dedupeKey);
        wx.setStorageSync('dedupeKey', gameData.dedupeKey);
      }
    }
    console.log('[FINAL] 上报 dedupeKey=', gameData.dedupeKey);
    
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'reportResult',
        data: gameData
      },
      success: (res) => {
        if (res.result.success) {
          console.log('战绩上报成功', res.result.data && res.result.data.alreadyReported ? '（已上报过）' : '');
        } else {
          console.error('战绩上报失败:', res.result.errMsg);
          // 如果是未登录导致的失败，不显示错误提示（因为这是预期的行为）
          if (res.result.errMsg && res.result.errMsg.indexOf('未登录') === -1) {
            // 其他错误可以在这里处理
          }
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
