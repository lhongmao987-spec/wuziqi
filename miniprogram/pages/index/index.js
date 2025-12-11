const { GameMode } = require('../../core/types');

Page({
  data: {
    GameMode,
    selectedMode: GameMode.PVE,
    selectedAiLevel: 'MEDIUM',
    aiLevels: [
      { label: '初级', value: 'EASY' },
      { label: '中级', value: 'MEDIUM' },
      { label: '高级', value: 'HARD' }
    ]
  },

  selectPve() {
    this.setData({ selectedMode: GameMode.PVE });
  },

  selectPvp() {
    this.setData({ selectedMode: GameMode.PVP_LOCAL });
  },

  selectAi(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ selectedAiLevel: value, selectedMode: GameMode.PVE });
  },

  startGame() {
    // 从设置中读取计时模式
    const settings = wx.getStorageSync('gameSettings') || {};
    const timeLimit = settings.timeLimit;
    
    const query = `mode=${this.data.selectedMode}&aiLevel=${this.data.selectedAiLevel}` +
      (timeLimit ? `&timeLimit=${timeLimit}` : '');

    console.log('开始对局，参数：', query);
    wx.navigateTo({ 
      url: `/pages/game/index?${query}`,
      success: () => {
        console.log('导航成功');
      },
      fail: (err) => {
        console.error('导航失败：', err);
        wx.showToast({ title: '无法进入游戏', icon: 'none' });
      }
    });
  }
});
