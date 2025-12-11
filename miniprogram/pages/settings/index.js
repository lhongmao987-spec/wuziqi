Page({
  data: {
    toggles: {
      enableForbidden: false,
      sound: true,
      highlight: true
    },
    timeOptions: ['不限时', '每方 5 分钟', '每方 10 分钟'],
    selectedTimeIndex: 0,
    rules: [
      '黑先白后，先连成五子者胜',
      '默认关闭禁手，支持后续开启',
      '人机模式支持悔棋 1 次 / 回合'
    ]
  },

  onLoad() {
    // 从存储中读取设置
    const settings = wx.getStorageSync('gameSettings') || {};
    const timeLimit = settings.timeLimit;
    let selectedTimeIndex = 0;
    if (timeLimit === 300) selectedTimeIndex = 1;
    else if (timeLimit === 600) selectedTimeIndex = 2;
    
    this.setData({ selectedTimeIndex });
  },

  onSwitchChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`toggles.${key}`]: e.detail.value });
    
    // 保存设置
    const settings = wx.getStorageSync('gameSettings') || {};
    settings[key] = e.detail.value;
    wx.setStorageSync('gameSettings', settings);
  },

  onTimeChange(e) {
    const index = Number(e.detail.value);
    this.setData({ selectedTimeIndex: index });
    
    // 保存计时设置
    const timeLimit = [undefined, 300, 600][index];
    const settings = wx.getStorageSync('gameSettings') || {};
    settings.timeLimit = timeLimit;
    wx.setStorageSync('gameSettings', settings);
  }
});
