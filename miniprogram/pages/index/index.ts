// @ts-nocheck
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
  }
});
