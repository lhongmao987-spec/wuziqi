import { GameResult, Player } from '../../core/types';

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
    badges: [],
    hasReported: false, // 防重复上报标记
    mode: '', // 游戏模式
    roomId: '', // 房间号（用于在线对战）
    roomDocId: '', // 房间文档ID（用于在线对战，调用 leaveRoom 必需）
    gameId: '' // 游戏ID（用于在线对战）
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

    const mode = query.mode || '';
    const roomId = query.roomId || '';
    const roomDocId = query.roomDocId || wx.getStorageSync('currentRoomDocId') || '';
    const gameId = query.gameId || '';
    
    // 如果从 query 获取到 roomDocId，同时写入 storage 作为兜底
    if (query.roomDocId) {
      wx.setStorageSync('currentRoomDocId', query.roomDocId);
    }
    // 如果从 query 获取到 roomId，同时写入 storage 作为兜底
    if (query.roomId) {
      wx.setStorageSync('currentRoomId', query.roomId);
    }
    
    this.setData({
      resultText: resultTextMap[result],
      subText: highlight,
      moves,
      highlight,
      badges,
      mode: mode,
      roomId: roomId,
      roomDocId: roomDocId,
      gameId: gameId
    });
    
    // 上报战绩（只在人机对战模式下上报，且用户已登录）
    const playerResult = query.playerResult;
    // 优先从 query 获取 dedupeKey，如果缺失则从 storage 获取
    let dedupeKey = query.dedupeKey;
    if (!dedupeKey) {
      dedupeKey = wx.getStorageSync('currentDedupeKey') || '';
      console.log('从 storage 获取 dedupeKey:', dedupeKey);
    }
    
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
  reportGameResult(gameData) {
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
      success: (res) => {
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

  // 在线对战再来一局
  async playAgainOnline() {
    const roomId = this.data.roomId;
    const gameId = this.data.gameId;
    
    if (!roomId) {
      wx.showToast({
        title: '房间信息缺失',
        icon: 'none'
      });
      return;
    }
    
    // 生成 token：使用 gameId 或当前时间戳
    const token = gameId || Date.now().toString();
    
    try {
      wx.showLoading({ title: '准备中...' });
      
      // 先获取房间信息，获取 roomDocId
      const roomInfoResult = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: roomId
        }
      });
      
      if (!roomInfoResult.result.success || !roomInfoResult.result.data) {
        wx.hideLoading();
        wx.showToast({
          title: roomInfoResult.result.errMsg || '获取房间信息失败',
          icon: 'none'
        });
        return;
      }
      
      const room = roomInfoResult.result.data;
      const roomDocId = room._id;
      
      // 调用 rematchReady 云函数
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'rematchReady',
          roomDocId: roomDocId,
          token: token
        }
      });
      
      wx.hideLoading();
      
      if (result.result.success) {
        // 跳转到房间页（使用 roomId）
        wx.redirectTo({
          url: `/pages/room/index?roomId=${roomId}`
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '准备再来一局失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '准备再来一局失败',
        icon: 'none'
      });
    }
  },

  restart() {
    // 在线对战模式：调用 playAgainOnline
    if (this.data.mode === 'PVP_ONLINE') {
      this.playAgainOnline();
      return;
    }
    
    // 非在线对战模式：使用原有逻辑（PVE/PVP_LOCAL）
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

  async backHome() {
    // 在线对战模式：必须调用 leaveRoom 退出房间
    if (this.data.mode === 'PVP_ONLINE' && this.data.roomDocId) {
      try {
        wx.showLoading({ title: '退出中...' });
        
        // 调用 leaveRoom 云函数
        const result = await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: {
            type: 'leaveRoom',
            roomDocId: this.data.roomDocId
          }
        });
        
        wx.hideLoading();
        
        // 无论成功或失败，都清理本地缓存并跳转首页
        // 清理房间相关缓存
        wx.removeStorageSync('currentRoomDocId');
        wx.removeStorageSync('currentRoomId');
        // 清理游戏相关缓存（如果有）
        wx.removeStorageSync('currentGameState_PVP_ONLINE');
        
        if (result.result && result.result.success) {
          console.log('[backHome] 退出房间成功');
        } else {
          console.warn('[backHome] 退出房间失败，但继续跳转:', result.result?.errMsg || '未知错误');
        }
      } catch (error) {
        wx.hideLoading();
        console.error('[backHome] 调用 leaveRoom 失败，但继续跳转:', error);
        
        // 即使调用失败，也清理本地缓存
        wx.removeStorageSync('currentRoomDocId');
        wx.removeStorageSync('currentRoomId');
        wx.removeStorageSync('currentGameState_PVP_ONLINE');
      }
    } else {
      // 非在线对战模式：直接清理缓存
      wx.removeStorageSync('currentRoomDocId');
      wx.removeStorageSync('currentRoomId');
    }
    
    // 跳转首页
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
