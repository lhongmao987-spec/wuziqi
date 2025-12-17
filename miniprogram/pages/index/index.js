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
    timeOptions: ['不限时', '每方 5 分钟', '每方 10 分钟'],
    showJoinModal: false,
    roomIdInput: '',
    keyboardHeight: 0, // 键盘高度（px）
    safeAreaBottom: 0, // 安全区域底部高度（px）
    screenHeight: 0, // 屏幕高度（px）
    modalHeight: 0, // 弹窗高度（px）
    modalPosition: 'center', // 弹窗定位方式：'center' | 'bottom' | 'top'
    modalBottom: 0 // 弹窗 bottom 值（px，仅在 modalPosition === 'bottom' 时使用）
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
  onLoad(options) {
    if (options.invite === 'true') {
      // 显示邀请提示
      wx.showModal({
        title: '好友邀请',
        content: '你的好友邀请你一起下五子棋！在线对战功能正在开发中，敬请期待。',
        showCancel: false,
        confirmText: '知道了'
      });
    }
    
    // 初始化键盘监听
    this.initKeyboardListener();
  },

  // 初始化键盘监听
  initKeyboardListener() {
    // 获取系统信息，计算安全区域底部高度和屏幕高度
    try {
      const systemInfo = wx.getSystemInfoSync();
      const safeArea = systemInfo.safeArea;
      const screenHeight = systemInfo.screenHeight;
      // safeAreaBottom = 屏幕高度 - 安全区域底部
      const safeAreaBottom = screenHeight - (safeArea ? safeArea.bottom : screenHeight);
      
      this.setData({
        safeAreaBottom: safeAreaBottom || 0,
        screenHeight: screenHeight || 0
      });
      
      console.log('[initKeyboardListener] safeAreaBottom:', safeAreaBottom, 'px', 'screenHeight:', screenHeight, 'px');
    } catch (error) {
      console.error('[initKeyboardListener] 获取系统信息失败:', error);
      this.setData({
        safeAreaBottom: 0,
        screenHeight: 0
      });
    }
    
    // 防止重复注册监听
    if (this.keyboardHeightChangeHandler) {
      wx.offKeyboardHeightChange(this.keyboardHeightChangeHandler);
    }
    
    // 上一次的键盘高度（用于防抖）
    let lastKeyboardHeight = this.data.keyboardHeight || 0;
    
    // 键盘高度变化监听（带防抖）
    this.keyboardHeightChangeHandler = (res) => {
      const keyboardHeight = res.height || 0;
      const currentHeight = this.data.keyboardHeight || 0;
      const heightDiff = Math.abs(keyboardHeight - lastKeyboardHeight);
      
      // 防抖：高度变化小于 2px 且当前 data 中的值已等于新值，不更新（避免抖动）
      // 但如果是从 0 到非 0 或从非 0 到 0，即使变化小也要更新
      const isZeroTransition = (currentHeight === 0 && keyboardHeight > 0) || 
                               (currentHeight > 0 && keyboardHeight === 0);
      
      if (heightDiff < 2 && keyboardHeight === currentHeight && !isZeroTransition) {
        return;
      }
      
      lastKeyboardHeight = keyboardHeight;
      
      // 更新键盘高度并计算弹窗位置
      this.setData({
        keyboardHeight: keyboardHeight
      }, () => {
        // setData 回调后计算弹窗位置
        this.updateModalPosition(keyboardHeight);
      });
      
      console.log('[键盘高度变化]', keyboardHeight, 'px', 'safeAreaBottom:', this.data.safeAreaBottom, 'px');
    };
    
    wx.onKeyboardHeightChange(this.keyboardHeightChangeHandler);
  },

  // 更新弹窗位置（键盘避让 + 上边界夹紧）
  updateModalPosition(keyboardHeight) {
    // 如果弹窗未显示，不计算
    if (!this.data.showJoinModal) {
      return;
    }
    
    // 键盘收起时，恢复居中
    if (keyboardHeight === 0) {
      this.setData({
        modalPosition: 'center'
      });
      return;
    }
    
    // 获取弹窗高度（如果未获取过，先获取）
    const modalHeight = this.data.modalHeight;
    const screenHeight = this.data.screenHeight;
    const safeAreaBottom = this.data.safeAreaBottom;
    const gap = 16; // 安全间距（px）
    const minTop = 24; // 最小顶部间距（px）
    
    // 如果弹窗高度未获取，先获取
    if (modalHeight === 0 || screenHeight === 0) {
      this.getModalHeight().then(() => {
        // 获取到高度后重新计算
        this.updateModalPosition(keyboardHeight);
      });
      return;
    }
    
    // 默认使用 bottom 定位
    const bottom = keyboardHeight + safeAreaBottom + gap;
    const topIfBottom = screenHeight - bottom - modalHeight;
    
    // 如果使用 bottom 定位会导致弹窗顶部距离屏幕顶部小于 minTop，改用 top 定位
    if (topIfBottom < minTop) {
      this.setData({
        modalPosition: 'top'
      });
      console.log('[updateModalPosition] 使用 top 定位，top:', minTop, 'px', 'topIfBottom:', topIfBottom, 'px');
    } else {
      this.setData({
        modalPosition: 'bottom',
        modalBottom: bottom
      });
      console.log('[updateModalPosition] 使用 bottom 定位，bottom:', bottom, 'px', 'topIfBottom:', topIfBottom, 'px');
    }
  },

  // 获取弹窗高度
  getModalHeight() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.modal-content').boundingClientRect((res) => {
        if (res && res.height) {
          this.setData({
            modalHeight: res.height
          });
          console.log('[getModalHeight] 弹窗高度:', res.height, 'px');
        }
        resolve();
      }).exec();
    });
  },

  // 销毁键盘监听
  destroyKeyboardListener() {
    if (this.keyboardHeightChangeHandler) {
      wx.offKeyboardHeightChange(this.keyboardHeightChangeHandler);
      this.keyboardHeightChangeHandler = null;
    }
  },

  // 创建房间
  async createRoom() {
    try {
      wx.showLoading({ title: '创建中...' });

      // 获取用户信息
      const userInfo = wx.getStorageSync('userInfo') || {};
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'createRoom',
          data: {
            nickName: userInfo.nickName || '',
            avatarFileId: userInfo.avatarFileId || ''
          }
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        const room = result.result.data;
        // 跳转到房间页面
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
      roomIdInput: '',
      modalPosition: 'center'
    }, () => {
      // 弹窗显示后，获取弹窗高度
      setTimeout(() => {
        this.getModalHeight();
      }, 100);
    });
  },

  // 隐藏加入房间弹窗
  hideJoinRoomModal() {
    this.setData({
      showJoinModal: false,
      roomIdInput: '',
      modalPosition: 'center'
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止点击弹窗内容时关闭弹窗
  },

  // 房间号输入
  onRoomIdInput(e) {
    const value = e.detail.value.replace(/\D/g, ''); // 只保留数字
    this.setData({
      roomIdInput: value.slice(0, 4) // 最多4位
    });
  },

  // 加入房间
  async joinRoom() {
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

      // 获取用户信息
      const userInfo = wx.getStorageSync('userInfo') || {};

      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'joinRoom',
          roomId: roomId,
          data: {
            nickName: userInfo.nickName || '',
            avatarFileId: userInfo.avatarFileId || ''
          }
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        const room = result.result.data;
        // 跳转到房间页面
        wx.navigateTo({
          url: `/pages/room/index?roomId=${room.roomId}&roomDocId=${room._id}&isCreator=${result.result.isCreator ? 'true' : 'false'}`
        });
        // 关闭弹窗
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
  },

  onHide() {
    // 页面隐藏时取消监听
    this.destroyKeyboardListener();
  },

  onUnload() {
    // 页面卸载时取消监听
    this.destroyKeyboardListener();
  }
});
