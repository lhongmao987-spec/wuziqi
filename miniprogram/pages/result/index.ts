import { GameResult, Player } from '../../core/types';

const resultTextMap: Record<GameResult, string> = {
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
    badges: [] as string[],
    hasReported: false // 防重复上报标记
  },

  onLoad(query: Record<string, string>) {
    const result = (query.result as GameResult) || GameResult.Ongoing;
    const winner = query.winner as Player | undefined;
    const moves = Number(query.moves || 0);

    const highlight = winner === Player.Black
      ? '恭喜，黑棋执先取得胜利'
      : winner === Player.White
        ? '白棋后手反击成功'
        : '再来一局试试吧';

    const badges: string[] = [];
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
    const dedupeKey = query.dedupeKey;
    
    // 第一道保险：检查是否已上报过
    if (this.data.hasReported) {
      console.log('已上报过，跳过重复上报');
      return;
    }
    
    if (playerResult && mode && mode !== 'PVP_LOCAL' && dedupeKey) {
      // 检查用户是否已登录
      const userInfo = wx.getStorageSync('userInfo');
      if (userInfo && userInfo.nickName && userInfo.nickName.trim() !== '') {
        // 设置标记，防止重复上报
        this.setData({ hasReported: true });
        
        // 用户已登录，上报战绩
        this.reportGameResult({
          result: playerResult,
          moves: moves,
          mode: mode,
          opponentType: query.opponentType || 'AI',
          opponentName: query.opponentName || 'AI',
          difficulty: query.difficulty || '',
          duration: Number(query.duration || 0),
          dedupeKey: dedupeKey // 传递去重键
        });
      } else {
        // 用户未登录，不保存战绩
        console.log('用户未登录，不保存战绩');
      }
    }
  },

  // 上报对局结果
  reportGameResult(gameData: any) {
    // 第二道保险：再次检查标记
    if (this.data.hasReported && gameData.dedupeKey) {
      // 检查本地存储中是否已记录该dedupeKey
      const reportedKeys = wx.getStorageSync('reportedDedupeKeys') || [];
      if (reportedKeys.includes(gameData.dedupeKey)) {
        console.log('该对局已上报过（本地检查）');
        return;
      }
    }
    
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'reportResult',
        data: gameData
      },
      success: (res: any) => {
        if (res.result.success) {
          console.log('战绩上报成功', res.result.data.alreadyReported ? '（已上报过）' : '');
          
          // 如果上报成功，记录dedupeKey到本地存储（最多保存100个）
          if (gameData.dedupeKey) {
            const reportedKeys = wx.getStorageSync('reportedDedupeKeys') || [];
            reportedKeys.push(gameData.dedupeKey);
            // 只保留最近100个
            if (reportedKeys.length > 100) {
              reportedKeys.shift();
            }
            wx.setStorageSync('reportedDedupeKeys', reportedKeys);
          }
        } else {
          console.error('战绩上报失败:', res.result.errMsg);
          // 如果失败，重置标记，允许重试
          if (res.result.errMsg && res.result.errMsg.indexOf('dedupeKey') === -1) {
            this.setData({ hasReported: false });
          }
        }
      },
      fail: (err) => {
        console.error('战绩上报失败:', err);
        // 网络失败，重置标记，允许重试
        this.setData({ hasReported: false });
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
