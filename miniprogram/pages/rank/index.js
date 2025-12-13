Page({
  data: {
    ranks: [],
    loading: true
  },

  onLoad() {
    this.loadRankList();
  },

  onShow() {
    // 每次显示页面时重新加载排行榜（可能有更新）
    this.loadRankList();
  },

  // 加载排行榜
  loadRankList() {
    this.setData({ loading: true });
    
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'getRankList',
        rankType: 'GLOBAL', // 全服榜
        period: 'ALL', // 全部时间
        limit: 100
      },
      success: (res) => {
        if (res.result.success && res.result.data) {
          this.setData({
            ranks: res.result.data,
            loading: false
          });
        } else {
          console.error('获取排行榜失败:', res.result.errMsg);
          this.setData({
            ranks: [],
            loading: false
          });
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
      }
    });
  }
});
