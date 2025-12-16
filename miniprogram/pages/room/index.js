Page({
  data: {
    roomId: '',
    roomDocId: '',
    isCreator: false,
    roomStatus: 'waiting', // waiting / ready / playing / ended
    creatorInfo: {
      openid: '',
      nickName: '',
      avatarUrl: ''
    },
    player2Info: null,
    statusText: '等待玩家加入...',
    roomWatcher: null
  },

  onLoad(options) {
    const roomId = options.roomId;
    const roomDocId = options.roomDocId;
    const isCreator = options.isCreator === 'true';

    if (!roomId && !roomDocId) {
      wx.showToast({
        title: '房间信息错误',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
      return;
    }

    // 立即设置房间号，确保能立即显示
    this.setData({
      roomId: roomId || '',
      roomDocId: roomDocId || '',
      isCreator: isCreator
    });

    // 先加载房间信息，加载完成后再开始监听
    this.loadRoomInfo();
  },

  onUnload() {
    // 停止监听
    if (this.data.roomWatcher) {
      this.data.roomWatcher.close();
    }
  },

  // 加载房间信息
  async loadRoomInfo() {
    try {
      wx.showLoading({ title: '加载中...' });
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId,
          roomDocId: this.data.roomDocId
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        const room = result.result.data;
        this.updateRoomData(room);
        // 加载完房间信息后再开始监听
        this.watchRoom();
      } else {
        wx.showToast({
          title: result.result.errMsg || '加载房间失败',
          icon: 'none'
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '加载房间失败',
        icon: 'none'
      });
    }
  },

  // 更新房间数据
  updateRoomData(room) {
    // 通过云函数获取当前用户的openid来判断是否是创建者
    const isCreator = this.data.isCreator || room.creator.openid === '';
    
    let statusText = '等待玩家加入...';
    if (room.status === 'ready') {
      statusText = this.data.isCreator ? '双方已就绪，点击开始游戏' : '等待房主开始游戏...';
    } else if (room.status === 'playing') {
      statusText = '游戏进行中...';
    } else if (room.status === 'ended') {
      statusText = '游戏已结束';
    }

    this.setData({
      roomId: room.roomId || this.data.roomId, // 确保房间号有值
      roomDocId: room._id || this.data.roomDocId,
      isCreator: isCreator,
      roomStatus: room.status,
      creatorInfo: room.creator || this.data.creatorInfo,
      player2Info: room.player2,
      statusText: statusText
    });

    // 如果游戏已开始，跳转到游戏页面
    if (room.status === 'playing' && room.gameId) {
      wx.redirectTo({
        url: `/pages/game/index?mode=PVP_ONLINE&gameId=${room.gameId}&roomDocId=${room._id}&isCreator=${isCreator ? 'true' : 'false'}`
      });
    }
  },

  // 监听房间状态变化
  watchRoom() {
    const roomDocId = this.data.roomDocId;
    if (!roomDocId) {
      console.warn('roomDocId为空，无法监听房间');
      return;
    }

    try {
      const db = wx.cloud.database();
      const watcher = db.collection('rooms').doc(roomDocId).watch({
      onChange: (snapshot) => {
        if (snapshot.type === 'update' && snapshot.doc) {
          const room = snapshot.doc;
          this.updateRoomData(room);
        } else if (snapshot.type === 'remove') {
          wx.showToast({
            title: '房间已解散',
            icon: 'none'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        }
      },
      onError: (error) => {
        console.error('监听房间失败:', error);
      }
    });

    this.setData({
      roomWatcher: watcher
    });
    } catch (error) {
      console.error('启动房间监听失败:', error);
    }
  },

  // 开始游戏
  async startGame() {
    if (!this.data.isCreator || this.data.roomStatus !== 'ready') {
      return;
    }

    try {
      wx.showLoading({ title: '开始游戏...' });

      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'updateRoomStatus',
          roomDocId: this.data.roomDocId,
          status: 'playing'
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        const gameId = result.result.data.gameId;
        // 跳转到游戏页面
        wx.redirectTo({
          url: `/pages/game/index?mode=PVP_ONLINE&gameId=${gameId}&roomDocId=${this.data.roomDocId}&isCreator=true`
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '开始游戏失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '开始游戏失败',
        icon: 'none'
      });
    }
  },

  // 离开房间
  async leaveRoom() {
    wx.showModal({
      title: '确认离开',
      content: '确定要离开房间吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '离开中...' });

            const result = await wx.cloud.callFunction({
              name: 'quickstartFunctions',
              data: {
                type: 'leaveRoom',
                roomDocId: this.data.roomDocId
              }
            });

            wx.hideLoading();

            if (result.result.success) {
              wx.navigateBack();
            } else {
              wx.showToast({
                title: result.result.errMsg || '离开房间失败',
                icon: 'none'
              });
            }
          } catch (error) {
            wx.hideLoading();
            wx.showToast({
              title: error.message || '离开房间失败',
              icon: 'none'
            });
          }
        }
      }
    });
  }
});
