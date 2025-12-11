// @ts-nocheck
Page({
  data: {
    toggles: {
      enableForbidden: false,
      sound: true,
      highlight: true
    },
    rules: [
      '黑先白后，先连成五子者胜',
      '默认关闭禁手，支持后续开启',
      '人机模式支持悔棋 1 次 / 回合'
    ]
  },

  onSwitchChange(e: WechatMiniprogram.SwitchChange) {
    const key = e.currentTarget.dataset.key as keyof typeof this.data.toggles;
    this.setData({ [`toggles.${key}`]: e.detail.value });
  }
});
