const { GameMode } = require('../../core/types');

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
    timeOptions: ['不限时', '每方 5 分钟', '每方 10 分钟'],
    showJoinModal: false,
    roomIdInput: ''
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

  onTimeChange(e) {
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
  onShareAppMessage(options) {
    return {
      title: '来和我一起下五子棋吧！',
      path: '/pages/index/index?invite=true',
      imageUrl: ''
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '来和我一起下五子棋吧！',
      query: 'invite=true',
      imageUrl: ''
    };
  },

  // 处理分享链接进入
  onLoad(options) {
    if (options.invite === 'true') {
      wx.showModal({
        title: '好友邀请',
        content: '你的好友邀请你一起下五子棋！在线对战功能正在开发中，敬请期待。',
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  // 创建房间
  async createRoom() {
    // 检查用户是否已登录
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (!userInfo.nickName || userInfo.nickName.trim() === '') {
      wx.showModal({
        title: '提示',
        content: '请先完善个人信息（设置昵称和头像）才能创建房间',
        showCancel: false,
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: '/pages/profile/index'
            });
          }
        }
      });
      return;
    }

    try {
      wx.showLoading({ title: '创建中...' });
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'createRoom',
          data: {
            nickName: userInfo.nickName || '',
            avatarUrl: userInfo.avatarUrl || ''
          }
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        const room = result.result.data;
        console.log('创建房间成功，房间信息:', room);
        if (!room.roomId || !room._id) {
          wx.showToast({
            title: '房间信息不完整',
            icon: 'none'
          });
          return;
        }
        wx.navigateTo({
          url: `/pages/room/index?roomId=${room.roomId}&roomDocId=${room._id}&isCreator=true`
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '创建房间失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '创建房间失败',
        icon: 'none'
      });
    }
  },

  // 显示加入房间弹窗
  showJoinRoomModal() {
    this.setData({
      showJoinModal: true,
      roomIdInput: ''
    });
  },

  // 隐藏加入房间弹窗
  hideJoinRoomModal() {
    this.setData({
      showJoinModal: false,
      roomIdInput: ''
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止点击弹窗内容时关闭弹窗
  },

  // 房间号输入
  onRoomIdInput(e) {
    const value = e.detail.value.replace(/\D/g, '');
    this.setData({
      roomIdInput: value.slice(0, 4)
    });
  },

  // 加入房间
  async joinRoom() {
    // 检查用户是否已登录
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (!userInfo.nickName || userInfo.nickName.trim() === '') {
      wx.showModal({
        title: '提示',
        content: '请先完善个人信息（设置昵称和头像）才能加入房间',
        showCancel: false,
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: '/pages/profile/index'
            });
          }
        }
      });
      return;
    }

    const roomId = this.data.roomIdInput.trim();
    
    if (!roomId || roomId.length !== 4) {
      wx.showToast({
        title: '请输入4位房间号',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({ title: '加入中...' });

      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'joinRoom',
          roomId: roomId,
          data: {
            nickName: userInfo.nickName || '',
            avatarUrl: userInfo.avatarUrl || ''
          }
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        const room = result.result.data;
        wx.navigateTo({
          url: `/pages/room/index?roomId=${room.roomId}&roomDocId=${room._id}&isCreator=${result.result.isCreator ? 'true' : 'false'}`
        });
        this.setData({
          showJoinModal: false,
          roomIdInput: ''
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '加入房间失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '加入房间失败',
        icon: 'none'
      });
    }
  }
});
