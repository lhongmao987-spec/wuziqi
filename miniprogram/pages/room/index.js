Page({
  data: {
    roomId: '',
    roomDocId: '',
    isCreator: false,
    myOpenid: '',
    hasRedirected: false,
    canStart: false,
    roomStatus: 'waiting', // waiting / ready / playing / ended
    creatorInfo: {
      openid: '',
      nickName: '',
      avatarUrl: ''
    },
    player2Info: null,
    statusText: '等待玩家加入...',
    roomWatcher: null,
    pollTimer: null,
    retryTimer: null
  },

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
    if (this.data.roomWatcher) {
      this.data.roomWatcher.close();
      this.setData({ roomWatcher: null });
    }
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null });
    }
    if (this.data.retryTimer) {
      clearTimeout(this.data.retryTimer);
      this.setData({ retryTimer: null });
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

  // 更新房间数据
  updateRoomData(room) {
    // 严格判断是否是创建者：从 storage 获取 myOpenid
    const myOpenid = wx.getStorageSync('openid') || this.data.myOpenid || '';
    const isCreator = room.creator && room.creator.openid && myOpenid
      ? room.creator.openid === myOpenid
      : false;
    
    // 调试日志
    const isReady = room.status === 'ready';
    const hasPlayer2 = room.player2 && room.player2.openid && room.player2.openid.trim() !== '';
    console.log('[updateRoomData] 判断条件', {
      roomId: room.roomId,
      myOpenid: myOpenid,
      creatorOpenid: room.creator ? room.creator.openid : null,
      isCreator: isCreator,
      isReady: isReady,
      hasPlayer2: hasPlayer2,
      player2Openid: room.player2 ? room.player2.openid : null
    });
    
    let statusText = '等待玩家加入...';
    if (room.status === 'ready') {
      statusText = isCreator ? '双方已就绪，点击开始游戏' : '等待房主开始游戏...';
    } else if (room.status === 'playing') {
      statusText = '游戏进行中...';
    } else if (room.status === 'ended') {
      statusText = '游戏已结束';
    }

    // 处理 player2Info：如果 player2 为空或没有 openid，设置为 null
    let player2Info = null;
    if (room.player2 && room.player2.openid && room.player2.openid.trim() !== '') {
      player2Info = room.player2;
    }

    // 计算 canStart：房主 && 状态为 ready && player2 有 openid
    const canStart = isCreator && isReady && hasPlayer2;

    // 处理 creatorInfo 和 player2Info（保留 avatarFileId 用于后续转换）
    // 确保 avatarUrl 初始化为空字符串，等待 convertAvatars 转换
    const creatorInfo = room.creator ? {
      ...room.creator,
      avatarUrl: '' // 初始化为空，等待转换
    } : this.data.creatorInfo;
    
    const player2InfoData = player2Info ? {
      ...player2Info,
      avatarUrl: '' // 初始化为空，等待转换
    } : null;

    this.setData({
      roomId: room.roomId || this.data.roomId, // 确保房间号有值
      roomDocId: room._id || this.data.roomDocId,
      isCreator: isCreator, // 覆盖 isCreator
      canStart: canStart,
      roomStatus: room.status,
      creatorInfo: creatorInfo,
      player2Info: player2InfoData,
      statusText: statusText
    }, () => {
      // setData 回调，验证数据是否更新
      console.log('[updateRoomData setData 后]', {
        isCreator: this.data.isCreator,
        canStart: this.data.canStart,
        roomStatus: this.data.roomStatus,
        player2Info: this.data.player2Info,
        player2NickName: this.data.player2Info ? this.data.player2Info.nickName : null,
        player2Openid: this.data.player2Info ? this.data.player2Info.openid : null,
        creatorAvatarFileId: this.data.creatorInfo ? this.data.creatorInfo.avatarFileId : null,
        player2AvatarFileId: this.data.player2Info ? this.data.player2Info.avatarFileId : null
      });
      
      // 异步转换头像：avatarFileId -> tempFileURL（带缓存）
      // 使用 this.data 中的最新数据，确保 avatarFileId 正确传递
      this.convertAvatars(this.data.creatorInfo, this.data.player2Info);
    });

    // 如果游戏已开始，跳转到游戏页面（只允许跳转一次）
    if (room.status === 'playing' && room.gameId && !this.data.hasRedirected) {
      this.setData({
        hasRedirected: true
      });
      wx.redirectTo({
        url: `/pages/game/index?mode=PVP_ONLINE&gameId=${room.gameId}&roomDocId=${room._id}&isCreator=${isCreator ? 'true' : 'false'}`
      });
    }
  },

  // 转换头像：avatarFileId -> tempFileURL（带缓存）
  async convertAvatars(creatorInfo, player2Info) {
    // 初始化缓存（如果不存在）
    if (!this.avatarUrlCache) {
      this.avatarUrlCache = {};
    }
    
    // 初始化失败标记（如果不存在），避免重复转换失败的文件
    if (!this.avatarFailedCache) {
      this.avatarFailedCache = {};
    }
    
    const fileList = [];
    const needConvert = {};
    const updateData = {};
    
    // 默认头像 URL（使用空字符串表示使用占位符）
    const defaultAvatarUrl = '';
    
    // 检查 creator 头像是否需要转换
    if (creatorInfo) {
      const fileId = creatorInfo.avatarFileId ? creatorInfo.avatarFileId.trim() : '';
      if (!fileId) {
        // fileId 为空，使用默认头像
        if (!this.data.creatorInfo || this.data.creatorInfo.avatarUrl !== defaultAvatarUrl) {
          updateData['creatorInfo.avatarUrl'] = defaultAvatarUrl;
        }
      } else if (this.avatarFailedCache[fileId]) {
        // 之前转换失败过，使用默认头像
        if (!this.data.creatorInfo || this.data.creatorInfo.avatarUrl !== defaultAvatarUrl) {
          updateData['creatorInfo.avatarUrl'] = defaultAvatarUrl;
        }
      } else if (this.avatarUrlCache[fileId]) {
        // 使用缓存
        const cachedUrl = this.avatarUrlCache[fileId];
        if (!this.data.creatorInfo || this.data.creatorInfo.avatarUrl !== cachedUrl) {
          updateData['creatorInfo.avatarUrl'] = cachedUrl;
          console.log('[convertAvatars] creator 使用缓存:', cachedUrl);
        }
      } else {
        // 需要转换
        fileList.push(fileId);
        needConvert.creator = fileId;
      }
    }
    
    // 检查 player2 头像是否需要转换
    if (player2Info) {
      const fileId = player2Info.avatarFileId ? player2Info.avatarFileId.trim() : '';
      if (!fileId) {
        // fileId 为空，使用默认头像
        if (!this.data.player2Info || this.data.player2Info.avatarUrl !== defaultAvatarUrl) {
          updateData['player2Info.avatarUrl'] = defaultAvatarUrl;
        }
      } else if (this.avatarFailedCache[fileId]) {
        // 之前转换失败过，使用默认头像
        if (!this.data.player2Info || this.data.player2Info.avatarUrl !== defaultAvatarUrl) {
          updateData['player2Info.avatarUrl'] = defaultAvatarUrl;
        }
      } else if (this.avatarUrlCache[fileId]) {
        // 使用缓存
        const cachedUrl = this.avatarUrlCache[fileId];
        if (!this.data.player2Info || this.data.player2Info.avatarUrl !== cachedUrl) {
          updateData['player2Info.avatarUrl'] = cachedUrl;
          console.log('[convertAvatars] player2 使用缓存:', cachedUrl);
        }
      } else {
        // 需要转换
        fileList.push(fileId);
        needConvert.player2 = fileId;
      }
    }
    
    // 先更新默认头像
    if (Object.keys(updateData).length > 0) {
      this.setData(updateData);
    }
    
    // 如果没有需要转换的头像，直接返回
    if (fileList.length === 0) {
      return;
    }
    
    try {
      console.log('[convertAvatars] 开始转换头像，fileList:', fileList);
      const result = await wx.cloud.getTempFileURL({
        fileList: fileList
      });
      
      const convertUpdateData = {};
      
      // 处理 creator 头像
      if (needConvert.creator) {
        const creatorFile = result.fileList.find(f => f.fileID === needConvert.creator);
        if (creatorFile && creatorFile.tempFileURL) {
          // 存入缓存
          this.avatarUrlCache[needConvert.creator] = creatorFile.tempFileURL;
          convertUpdateData['creatorInfo.avatarUrl'] = creatorFile.tempFileURL;
          console.log('[convertAvatars] creator 转换成功:', creatorFile.tempFileURL);
        } else {
          // 转换失败，标记为失败，使用默认头像
          this.avatarFailedCache[needConvert.creator] = true;
          convertUpdateData['creatorInfo.avatarUrl'] = defaultAvatarUrl;
          console.warn('[convertAvatars] creator 转换失败，使用默认头像:', needConvert.creator);
        }
      }
      
      // 处理 player2 头像
      if (needConvert.player2) {
        const player2File = result.fileList.find(f => f.fileID === needConvert.player2);
        if (player2File && player2File.tempFileURL) {
          // 存入缓存
          this.avatarUrlCache[needConvert.player2] = player2File.tempFileURL;
          convertUpdateData['player2Info.avatarUrl'] = player2File.tempFileURL;
          console.log('[convertAvatars] player2 转换成功:', player2File.tempFileURL);
        } else {
          // 转换失败，标记为失败，使用默认头像
          this.avatarFailedCache[needConvert.player2] = true;
          convertUpdateData['player2Info.avatarUrl'] = defaultAvatarUrl;
          console.warn('[convertAvatars] player2 转换失败，使用默认头像:', needConvert.player2);
        }
      }
      
      if (Object.keys(convertUpdateData).length > 0) {
        this.setData(convertUpdateData);
        console.log('[convertAvatars] 头像转换完成，updateData:', convertUpdateData);
      }
    } catch (error) {
      console.error('[convertAvatars] 头像转换失败:', error);
      // 转换失败，标记为失败，使用默认头像
      const errorUpdateData = {};
      if (needConvert.creator) {
        this.avatarFailedCache[needConvert.creator] = true;
        errorUpdateData['creatorInfo.avatarUrl'] = defaultAvatarUrl;
      }
      if (needConvert.player2) {
        this.avatarFailedCache[needConvert.player2] = true;
        errorUpdateData['player2Info.avatarUrl'] = defaultAvatarUrl;
      }
      if (Object.keys(errorUpdateData).length > 0) {
        this.setData(errorUpdateData);
      }
    }
  },

  // 监听房间状态变化
  watchRoom() {
    const roomDocId = this.data.roomDocId;
    if (!roomDocId) {
      console.warn('roomDocId为空，无法监听房间');
      return;
    }

    // 防重复创建：先关闭旧 watcher
    if (this.data.roomWatcher) {
      try {
        this.data.roomWatcher.close();
      } catch (e) {
        console.warn('关闭旧 watcher 失败:', e);
      }
      this.setData({ roomWatcher: null });
    }

    try {
      const db = wx.cloud.database();
      const watcher = db.collection('rooms').doc(roomDocId).watch({
      onChange: (snapshot) => {
        // watch 成功时可选停止轮询（但轮询作为备用仍可保持）
        // 这里不强制停止，让轮询和 watch 并行工作，提高可靠性
        
        let room = null;
        
        // 兼容 init/update，优先从 snapshot.docs[0] 取 room，没有再 fallback snapshot.doc
        if (snapshot.docs && snapshot.docs.length > 0) {
          room = snapshot.docs[0];
        } else if (snapshot.doc) {
          room = snapshot.doc;
        }
        
        if (room && (snapshot.type === 'init' || snapshot.type === 'update')) {
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
        // 立即降级为轮询
        this.startPolling();
        // 2s 后重试 watch
        this.retryWatch();
      }
    });

    this.setData({
      roomWatcher: watcher
    });
    } catch (error) {
      console.error('启动房间监听失败:', error);
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
