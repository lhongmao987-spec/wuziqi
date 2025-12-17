Page({
  data: {
    roomId: '',
    roomDocId: '',
    isCreator: false,
    myOpenid: '',
    hasRedirected: false,
    canStart: false,
    roomStatus: 'waiting', // waiting / ready / playing / ended
    // 统一使用 room.creator 和 room.player2 作为数据源
    creatorInfo: {
      openid: '',
      nickName: '',
      avatarFileId: '',
      avatarUrl: '' // 由 convertAvatars 填充
    },
    player2Info: null, // { openid, nickName, avatarFileId, avatarUrl } 或 null
    statusText: '等待玩家加入...',
    roomWatcher: null,
    pollTimer: null,
    retryTimer: null
  },

  // 实例变量：标记是否正在跳转到游戏页面
  _navigatingToGame: false,

  async onLoad(options) {
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

    // 获取当前用户 openid（优先从 storage 读取，没有则调用 app.ensureLogin）
    let myOpenid = wx.getStorageSync('openid') || '';
    if (!myOpenid) {
      // 兜底：调用 app.ensureLogin 确保登录
      try {
        const app = getApp();
        if (app && app.ensureLogin) {
          await app.ensureLogin();
          // 重新读取
          myOpenid = wx.getStorageSync('openid') || '';
        }
      } catch (error) {
        console.error('[room onLoad] 调用 ensureLogin 失败:', error);
      }
    }
    
    // 设置到 data
    if (myOpenid) {
      this.setData({
        myOpenid: myOpenid
      });
    } else {
      console.warn('[room onLoad] 无法获取 openid，isCreator 可能为 false');
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
    // 清理所有资源
    this.closeWatcher(); // 使用统一的关闭方法，确保幂等
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null });
    }
    if (this.data.retryTimer) {
      clearTimeout(this.data.retryTimer);
      this.setData({ retryTimer: null });
    }
    
    // 重要：禁止在 onUnload 中无条件调用 leaveRoom
    // 仅在用户主动点击"离开房间"按钮时调用 leaveRoom
    // 这样可以避免：
    // 1. 页面跳转时误触发离开房间
    // 2. 页面被系统回收时误触发离开房间
    // 3. 导致房间状态异常
    console.log('[onUnload] 页面卸载，仅清理资源，不调用 leaveRoom');
  },
  
  // 关闭 watcher（幂等：重复调用不报错）
  closeWatcher() {
    if (this.data.roomWatcher) {
      try {
        this.data.roomWatcher.close();
        console.log('[closeWatcher] watcher 已关闭');
      } catch (e) {
        // 幂等：如果已经关闭，忽略错误
        console.warn('[closeWatcher] 关闭 watcher 失败（可能已关闭）:', e);
      }
      this.setData({ roomWatcher: null });
    }
  },

  // 加载房间信息
  async loadRoomInfo(showLoading = true, autoWatch = true) {
    try {
      if (showLoading) {
        wx.showLoading({ title: '加载中...' });
      }
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId,
          roomDocId: this.data.roomDocId
        }
      });

      if (showLoading) {
        wx.hideLoading();
      }

      if (result.result.success) {
        const room = result.result.data;
        console.log('[loadRoomInfo]', {
          _id: room._id,
          roomId: room.roomId,
          status: room.status,
          p2: room.player2 && room.player2.openid,
          p2Name: room.player2 && room.player2.nickName
        });
        this.updateRoomData(room);
        // 加载完房间信息后再开始监听（仅在首次加载时自动启动 watch）
        if (autoWatch && !this.data.roomWatcher) {
          this.watchRoom();
        }
        // 保证轮询必定启动（无论 watch 成功与否）
        if (!this.data.pollTimer) {
          this.startPolling();
        }
      } else {
        if (showLoading) {
          wx.showToast({
            title: result.result.errMsg || '加载房间失败',
            icon: 'none'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        }
      }
    } catch (error) {
      if (showLoading) {
        wx.hideLoading();
        wx.showToast({
          title: error.message || '加载房间失败',
          icon: 'none'
        });
      }
    }
  },

  // 更新房间数据（统一使用 room.creator 和 room.player2 作为数据源）
  // 注意：云函数已转换头像，直接使用 room.creator.avatarUrl 和 room.player2.avatarUrl
  updateRoomData(room) {
    // 严格判断是否是创建者：从 storage 获取 myOpenid
    const myOpenid = wx.getStorageSync('openid') || this.data.myOpenid || '';
    const isCreator = room.creator && room.creator.openid && myOpenid
      ? room.creator.openid === myOpenid
      : false;
    
    // 调试日志
    const isReady = room.status === 'ready';
    const hasPlayer2 = room.player2 && room.player2.openid && room.player2.openid.trim() !== '';
    console.log('[updateRoomData] 房间数据更新', {
      roomId: room.roomId,
      myOpenid: myOpenid,
      creatorOpenid: room.creator ? room.creator.openid : null,
      creatorNickName: room.creator ? room.creator.nickName : null,
      creatorAvatarUrl: room.creator ? room.creator.avatarUrl : null,
      isCreator: isCreator,
      isReady: isReady,
      hasPlayer2: hasPlayer2,
      player2Openid: room.player2 ? room.player2.openid : null,
      player2NickName: room.player2 ? room.player2.nickName : null,
      player2AvatarUrl: room.player2 ? room.player2.avatarUrl : null
    });
    
    // 状态文本
    let statusText = '等待玩家加入...';
    if (room.status === 'rematch_wait') {
      // 再来一局等待状态
      const rematch = room.rematch || { creatorReady: false, player2Ready: false };
      if (isCreator) {
        if (rematch.creatorReady && rematch.player2Ready) {
          statusText = '双方已就绪，点击开始游戏';
        } else {
          statusText = '等待对手返回房间...';
        }
      } else {
        if (rematch.creatorReady && rematch.player2Ready) {
          statusText = '等待房主开始游戏...';
        } else {
          statusText = '等待对手返回房间...';
        }
      }
    } else if (room.status === 'ready') {
      statusText = isCreator ? '双方已就绪，点击开始游戏' : '等待房主开始游戏...';
    } else if (room.status === 'playing') {
      statusText = '游戏进行中...';
    } else if (room.status === 'ended') {
      statusText = '游戏已结束';
    }

    // 统一处理 creatorInfo：直接使用 room.creator（云函数已转换 avatarUrl）
    const creatorInfo = room.creator ? {
      openid: room.creator.openid || '',
      nickName: room.creator.nickName || '玩家1',
      avatarFileId: room.creator.avatarFileId || '',
      avatarUrl: room.creator.avatarUrl || '' // 云函数已转换的 https URL
    } : {
      openid: '',
      nickName: '玩家1',
      avatarFileId: '',
      avatarUrl: ''
    };
    
    // 统一处理 player2Info：直接使用 room.player2（云函数已转换 avatarUrl）
    let player2InfoData = null;
    if (room.player2 && room.player2.openid && room.player2.openid.trim() !== '') {
      player2InfoData = {
        openid: room.player2.openid,
        nickName: room.player2.nickName || '玩家2',
        avatarFileId: room.player2.avatarFileId || '',
        avatarUrl: room.player2.avatarUrl || '' // 云函数已转换的 https URL
      };
    }

    // 计算 canStart：
    // 1. 必须是房主
    // 2. 如果是 rematch_wait 状态，必须 creatorReady && player2Ready
    // 3. 如果是 ready 状态，必须 player2 有 openid
    let canStart = false;
    if (isCreator) {
      if (room.status === 'rematch_wait') {
        const rematch = room.rematch || { creatorReady: false, player2Ready: false };
        canStart = rematch.creatorReady && rematch.player2Ready;
      } else if (room.status === 'ready') {
        canStart = hasPlayer2;
      }
    }

    // 更新 UI 数据（直接使用云函数返回的 avatarUrl，无需客户端转换）
    this.setData({
      roomId: room.roomId || this.data.roomId,
      roomDocId: room._id || this.data.roomDocId,
      isCreator: isCreator,
      canStart: canStart,
      roomStatus: room.status,
      creatorInfo: creatorInfo,
      player2Info: player2InfoData,
      statusText: statusText,
      rematch: room.rematch || { creatorReady: false, player2Ready: false, token: '', updatedAt: null }
    }, () => {
      // setData 回调：验证数据
      console.log('[updateRoomData] setData 完成', {
        creatorInfo: this.data.creatorInfo,
        player2Info: this.data.player2Info,
        creatorAvatarUrl: this.data.creatorInfo.avatarUrl,
        player2AvatarUrl: this.data.player2Info ? this.data.player2Info.avatarUrl : null
      });
    });

    // 如果游戏已开始，跳转到游戏页面（只允许跳转一次）
    if (room.status === 'playing' && room.gameId && !this.data.hasRedirected) {
      this._navigatingToGame = true;
      this.setData({
        hasRedirected: true
      });
      wx.redirectTo({
        url: `/pages/game/index?mode=PVP_ONLINE&gameId=${room.gameId}&roomDocId=${room._id}&isCreator=${isCreator ? 'true' : 'false'}`
      });
    }
  },


  // 监听房间状态变化
  // 注意：watchRoom 从数据库直接获取数据，没有经过云函数转换头像
  // 因此检测到变化时，通过 loadRoomInfo（云函数）重新获取完整数据（包括转换后的头像）
  watchRoom() {
    const roomDocId = this.data.roomDocId;
    if (!roomDocId) {
      console.warn('[watchRoom] roomDocId为空，无法监听房间');
      return;
    }

    // 防重复创建：先关闭旧 watcher（使用统一的关闭方法，确保幂等）
    this.closeWatcher();

    try {
      const db = wx.cloud.database();
      const watcher = db.collection('rooms').doc(roomDocId).watch({
        onChange: (snapshot) => {
          let room = null;
          
          // 兼容 init/update，优先从 snapshot.docs[0] 取 room，没有再 fallback snapshot.doc
          if (snapshot.docs && snapshot.docs.length > 0) {
            room = snapshot.docs[0];
          } else if (snapshot.doc) {
            room = snapshot.doc;
          }
          
          // 处理房间被删除的情况
          if (snapshot.type === 'remove' || !room) {
            console.log('[watchRoom] 房间已删除或不存在');
            // 关闭 watcher（使用统一的关闭方法，确保幂等）
            this.closeWatcher();
            // 停止轮询
            if (this.data.pollTimer) {
              clearInterval(this.data.pollTimer);
              this.setData({ pollTimer: null });
            }
            // 提示并返回
            wx.showToast({
              title: '房间已解散',
              icon: 'none'
            });
            setTimeout(() => {
              wx.navigateBack();
            }, 1500);
            return;
          }
          
          // 检查房间是否处于非法状态（creator 为空但 room 仍存在）
          if (!room.creator || !room.creator.openid || room.creator.openid.trim() === '') {
            console.warn('[watchRoom] 房间处于非法状态：creator 为空');
            // 关闭 watcher（使用统一的关闭方法，确保幂等）
            this.closeWatcher();
            // 停止轮询
            if (this.data.pollTimer) {
              clearInterval(this.data.pollTimer);
              this.setData({ pollTimer: null });
            }
            // 提示并返回
            wx.showToast({
              title: '房间状态异常',
              icon: 'none'
            });
            setTimeout(() => {
              wx.navigateBack();
            }, 1500);
            return;
          }
          
          if (snapshot.type === 'init' || snapshot.type === 'update') {
            console.log('[watchRoom] 房间数据变化:', {
              type: snapshot.type,
              roomId: room.roomId,
              status: room.status,
              hasCreator: !!room.creator,
              hasPlayer2: !!room.player2
            });
            
            // 重要：watchRoom 返回的数据没有经过云函数转换头像
            // 因此通过 loadRoomInfo（云函数）重新获取完整数据（包括转换后的头像）
            // 这样可以确保头像始终通过云函数获取，与排行榜逻辑一致
            this.loadRoomInfo(false, false); // 不显示 loading，不自动启动 watch（避免重复）
          }
        },
        onError: (error) => {
          console.error('[watchRoom] 监听失败:', error);
          // 关闭失败的 watcher（幂等）
          this.closeWatcher();
          // 立即降级为轮询
          this.startPolling();
          // 2s 后重试 watch
          this.retryWatch();
        }
      });

      // 确保只存在一个 watcher：如果设置时发现已有 watcher，先关闭旧的
      if (this.data.roomWatcher) {
        console.warn('[watchRoom] 检测到已有 watcher，先关闭旧的');
        this.closeWatcher();
      }
      
      this.setData({
        roomWatcher: watcher
      });
      console.log('[watchRoom] 监听已启动');
    } catch (error) {
      console.error('[watchRoom] 启动监听失败:', error);
      // 关闭失败的 watcher（幂等）
      this.closeWatcher();
      // 启动失败也降级为轮询
      this.startPolling();
      this.retryWatch();
    }
  },

  // 开始轮询
  startPolling() {
    // 如果已经在轮询，不重复启动
    if (this.data.pollTimer) {
      return;
    }
    
    console.log('降级为轮询模式，每 1500ms 拉取房间数据');
    const timer = setInterval(() => {
      this.loadRoomInfo(false, false); // false 表示不显示 loading，不自动启动 watch
    }, 1500);
    
    this.setData({ pollTimer: timer });
  },

  // 停止轮询
  stopPolling() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null });
      console.log('停止轮询，watch 已恢复');
    }
  },

  // 重试 watch
  retryWatch() {
    // 如果已有重试 timer，先清除
    if (this.data.retryTimer) {
      clearTimeout(this.data.retryTimer);
    }
    
    const timer = setTimeout(() => {
      console.log('重试 watch 连接');
      this.setData({ retryTimer: null });
      this.watchRoom();
    }, 2000);
    
    this.setData({ retryTimer: timer });
  },

  // 开始游戏
  async startGame() {
    // 校验：必须是房主，且状态为 ready 或 rematch_wait
    if (!this.data.isCreator || (this.data.roomStatus !== 'ready' && this.data.roomStatus !== 'rematch_wait')) {
      return;
    }
    
    // 如果是 rematch_wait 状态，前端再次校验（云函数会强校验）
    if (this.data.roomStatus === 'rematch_wait') {
      const room = this.data;
      const rematch = room.rematch || { creatorReady: false, player2Ready: false };
      if (!rematch.creatorReady || !rematch.player2Ready) {
        wx.showToast({
          title: '等待对手返回房间...',
          icon: 'none'
        });
        return;
      }
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
        // 标记正在跳转到游戏页面
        this._navigatingToGame = true;
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
