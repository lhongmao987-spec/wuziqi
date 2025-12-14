Page({
  data: {
    ranks: [] as any[], // 排行榜列表
    loading: true, // 加载状态
    currentUser: null as any, // 当前用户信息
    currentUserOpenId: '', // 当前用户openid（用于判断）
    total: 0 // 总上榜人数
  },

  onLoad() {
    this.loadLeaderboard();
  },

  onShow() {
    // 每次显示页面时重新加载排行榜（可能有更新）
    this.loadLeaderboard();
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadLeaderboard().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 加载排行榜
  loadLeaderboard() {
    this.setData({ loading: true });
    
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getLeaderboard',
          limit: 50,
          skip: 0
        },
        success: (res: any) => {
          if (res.result.success && res.result.data) {
            const { list, total, currentUser } = res.result.data;
            
            // 获取当前用户openid（用于判断当前用户）
            const currentUserOpenId = currentUser && currentUser.stats ? 
              (currentUser.stats.openid || '') : '';
            
            // 处理排行榜数据：标记当前用户，确保所有字段都有默认值
            const processedRanks = (list || []).map((item: any) => {
              // 判断是否是当前用户（通过openid比较）
              const isCurrentUser = item.openid && currentUserOpenId && 
                                    item.openid === currentUserOpenId;
              
              // 计算胜率百分比（云函数返回的是小数，需要转换为百分比）
              // 如果winRate不存在，从winCount和totalGames计算
              let winRatePercent = 0;
              if (item.winRate !== undefined && item.winRate !== null) {
                winRatePercent = Math.round(item.winRate * 100);
              } else if (item.totalGames > 0) {
                winRatePercent = Math.round(((item.winCount || 0) / item.totalGames) * 100);
              }
              
              return {
                ...item,
                name: item.nickName || '未命名', // 兼容旧字段名
                wins: item.winCount || 0,
                loses: item.loseCount || 0,
                streak: item.maxStreak || 0,
                totalGames: item.totalGames || 0,
                winRate: winRatePercent, // 转换为百分比（0-100）
                avatarUrl: item.avatarUrl || '/images/avatar.png',
                isCurrentUser: isCurrentUser
              };
            });
            
            this.setData({
              ranks: processedRanks,
              currentUser: currentUser,
              currentUserOpenId: currentUserOpenId,
              total: total || 0,
              loading: false
            });
            resolve(res.result);
          } else {
            console.error('获取排行榜失败:', res.result.errMsg);
            this.setData({
              ranks: [],
              loading: false
            });
            wx.showToast({
              title: res.result.errMsg || '获取排行榜失败',
              icon: 'none'
            });
            reject(new Error(res.result.errMsg || '获取排行榜失败'));
          }
        },
        fail: (err) => {
          console.error('获取排行榜失败:', err);
          this.setData({
            ranks: [],
            loading: false
          });
          wx.showToast({
            title: '加载失败，请重试',
            icon: 'none'
          });
          reject(err);
        }
      });
    });
  }
});
