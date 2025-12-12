Page({
  data: {
    toggles: {
      enableForbidden: false,
      sound: true,
      highlight: true
    },
    ruleSections: [
      {
        title: '基本规则',
        expanded: false,
        items: [
          '五子棋使用15×15的棋盘，共有225个交叉点。',
          '黑棋先行，黑白双方交替在空交叉点上落子，每次仅下一子。',
          '先在横、竖或斜方向上连续形成五个己方棋子的一方获胜。'
        ]
      },
      {
        title: '禁手规则（仅针对黑方）',
        expanded: false,
        items: [
          '三三禁手：黑方一子落下后，同时形成两个或两个以上的"活三"（指该子落点后，这条线能在下一步形成"活四"的三子连线）。',
          '四四禁手：黑方一子落下后，同时形成两个或两个以上的"四"（包括"活四"和"冲四"）。',
          '长连禁手：黑方一子落下后，形成六个或六个以上棋子的连续连线。',
          '注：若"长连"禁手中同时包含了五连，则禁手失效，判黑棋直接胜利。'
        ]
      },
      {
        title: '胜利条件',
        expanded: false,
        items: [
          '白棋获胜：在棋盘上率先连成五子。',
          '白棋获胜：指出并判定黑棋的禁手，黑棋即告负。',
          '黑棋获胜：在棋盘上率先连成五子，且未形成任何禁手。'
        ]
      },
      {
        title: '结束与判定',
        expanded: false,
        items: [
          '和棋：当棋盘完全下满，且双方均未达成胜利条件时，判定为和棋。',
          '认输：一方主动认输，则另一方获胜。',
          '超时负：在采用计时规则的比赛中，一方思考时间用完则判负。',
          '黑方禁手负：黑方落子形成禁手且被白方正确指出，立即判黑方负。'
        ]
      }
    ]
  },

  onLoad() {
    // 读取已保存的设置
    const settings = wx.getStorageSync('gameSettings') || {};
    this.setData({
      toggles: {
        enableForbidden: settings.enableForbidden !== undefined ? settings.enableForbidden : false,
        sound: settings.sound !== undefined ? settings.sound : true,
        highlight: settings.highlight !== undefined ? settings.highlight : true
      }
    });
  },

  onShow() {
    // 每次显示页面时也读取设置（确保从其他页面返回时能获取最新设置）
    const settings = wx.getStorageSync('gameSettings') || {};
    this.setData({
      toggles: {
        enableForbidden: settings.enableForbidden !== undefined ? settings.enableForbidden : false,
        sound: settings.sound !== undefined ? settings.sound : true,
        highlight: settings.highlight !== undefined ? settings.highlight : true
      }
    });
  },

  onSwitchChange(e: WechatMiniprogram.SwitchChange) {
    const key = e.currentTarget.dataset.key as keyof typeof this.data.toggles;
    const newValue = e.detail.value;
    
    // 计算新的 toggles 值（在 setData 之前计算，避免异步问题）
    const newToggles = {
      ...this.data.toggles,
      [key]: newValue
    };
    
    // 更新界面
    this.setData({ [`toggles.${key}`]: newValue });
    
    // 保存设置（保存整个 toggles 对象以确保一致性）
    const settings = wx.getStorageSync('gameSettings') || {};
    settings.enableForbidden = newToggles.enableForbidden;
    settings.sound = newToggles.sound;
    settings.highlight = newToggles.highlight;
    wx.setStorageSync('gameSettings', settings);
  },

  toggleRule(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number;
    const ruleSections = this.data.ruleSections;
    ruleSections[index].expanded = !ruleSections[index].expanded;
    this.setData({ ruleSections });
  }
});
