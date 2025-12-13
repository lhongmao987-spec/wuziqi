import { GameMode } from '../../core/types';

Page({
  data: {
    GameMode,
    selectedMode: GameMode.PVE,
    selectedAiLevel: 'MEDIUM',
    selectedTimeIndex: 0,
    aiLevels: [
      { label: '初级', value: 'EASY' },
      { label: '中级', value: 'MEDIUM' },
      { label: '高级', value: 'HARD' }
    ],
    timeOptions: ['不限时', '每方 5 分钟', '每方 10 分钟']
  },

  selectPve() {
    this.setData({ selectedMode: GameMode.PVE });
  },

  selectPvp() {
    this.setData({ selectedMode: GameMode.PVP_LOCAL });
  },

  selectAi(e: WechatMiniprogram.BaseEvent) {
    const value = (e.currentTarget.dataset as { value: string }).value;
    this.setData({ selectedAiLevel: value, selectedMode: GameMode.PVE });
  },

  onTimeChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({ selectedTimeIndex: index });
  },

  startGame() {
    const timeLimit = [undefined, 300, 600][this.data.selectedTimeIndex];
    const query = `mode=${this.data.selectedMode}&aiLevel=${this.data.selectedAiLevel}` +
      (timeLimit ? `&timeLimit=${timeLimit}` : '');

    wx.navigateTo({ url: `/pages/game/index?${query}` });
  },

  goRank() {
    wx.navigateTo({ url: '/pages/rank/index' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  // 分享给好友
  onShareAppMessage(options: WechatMiniprogram.Page.IShareAppMessageOption) {
    return {
      title: '来和我一起下五子棋吧！',
      path: '/pages/index/index?invite=true',
      imageUrl: '' // 可以后续添加分享图片
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '来和我一起下五子棋吧！',
      query: 'invite=true',
      imageUrl: '' // 可以后续添加分享图片
    };
  },

  // 处理分享链接进入
  onLoad(options: Record<string, string>) {
    if (options.invite === 'true') {
      // 显示邀请提示
      wx.showModal({
        title: '好友邀请',
        content: '你的好友邀请你一起下五子棋！在线对战功能正在开发中，敬请期待。',
        showCancel: false,
        confirmText: '知道了'
      });
    }
  }
});
