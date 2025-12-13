Page({
  data: {
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    tempNickName: '',
    tempAvatarUrl: '',
    stats: {
      games: 0,
      wins: 0,
      streak: 0,
      bestAi: '中级'
    },
    recent: []
  },

  onLoad() {
    // 页面加载时从数据库获取用户信息
    this.loadUserInfo();
    // 加载战绩数据
    this.loadUserStats();
    // 加载最近对局
    this.loadRecentGames();
  },

  onShow() {
    // 每次显示页面时重新加载用户信息
    this.loadUserInfo();
    // 重新加载战绩数据（可能在其他页面有更新）
    this.loadUserStats();
    // 重新加载最近对局
    this.loadRecentGames();
  },

  // 从数据库加载用户信息
  loadUserInfo() {
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'getUserInfo'
      },
      success: (res) => {
        if (res.result.success && res.result.data) {
          const userInfo = {
            nickName: res.result.data.nickName || '',
            avatarUrl: res.result.data.avatarUrl || ''
          };
          // 保存到本地存储
          wx.setStorageSync('userInfo', userInfo);
          // 更新页面数据
          this.setData({
            userInfo: userInfo
          });
        } else {
          // 用户不存在，清空本地存储
          this.setData({
            userInfo: {
              avatarUrl: '',
              nickName: ''
            }
          });
          wx.removeStorageSync('userInfo');
        }
      },
      fail: (err) => {
        console.error('获取用户信息失败:', err);
        // 失败时尝试从本地存储读取
        const localUserInfo = wx.getStorageSync('userInfo');
        if (localUserInfo) {
          this.setData({
            userInfo: localUserInfo
          });
        }
      }
    });
  },

  // 选择头像回调
  onChooseAvatar(e) {
    console.log('========== 选择头像 ==========');
    console.log('头像选择事件:', e);
    
    // 检查是否有错误
    if (e.detail.errMsg && e.detail.errMsg.indexOf('fail') !== -1) {
      console.error('选择头像失败:', e.detail.errMsg);
      wx.showModal({
        title: '提示',
        content: '获取头像失败，请检查是否已同意隐私保护协议。如需使用此功能，请在设置中开启相关权限。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    
    const { avatarUrl } = e.detail;
    if (!avatarUrl) {
      wx.showToast({
        title: '获取头像失败',
        icon: 'none'
      });
      return;
    }
    
    console.log('选择的头像URL:', avatarUrl);
    
    this.setData({
      tempAvatarUrl: avatarUrl
    });
    
    // 如果已经有昵称，自动保存
    if (this.data.tempNickName && this.data.tempNickName.trim()) {
      this._saveTempUserInfo();
    }
  },

  // 昵称输入回调
  onNickNameInput(e) {
    const nickName = e.detail.value;
    console.log('输入昵称:', nickName);
    
    // 检查是否有错误（隐私授权相关）
    if (e.detail.errMsg && e.detail.errMsg.indexOf('fail') !== -1) {
      console.error('输入昵称失败:', e.detail.errMsg);
      wx.showModal({
        title: '提示',
        content: '获取昵称失败，请检查是否已同意隐私保护协议。如需使用此功能，请在设置中开启相关权限。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    
    this.setData({
      tempNickName: nickName
    });
    
    // 如果已经有头像且昵称不为空，自动保存
    if (this.data.tempAvatarUrl && nickName && nickName.trim()) {
      this._saveTempUserInfo();
    }
  },

  // 保存临时用户信息（自动保存）
  _saveTempUserInfo() {
    const userInfo = {
      nickName: this.data.tempNickName?.trim() || '微信用户',
      avatarUrl: this.data.tempAvatarUrl || ''
    };
    
    // 确保至少有昵称或头像
    if (!userInfo.nickName && !userInfo.avatarUrl) {
      return;
    }
    
    this._saveUserInfo(userInfo);
  },

  // 手动保存用户信息
  handleSaveUserInfo() {
    const userInfo = {
      nickName: this.data.tempNickName?.trim() || '微信用户',
      avatarUrl: this.data.tempAvatarUrl || ''
    };
    
    // 至少需要昵称
    if (!userInfo.nickName || userInfo.nickName === '微信用户') {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }
    
    this._saveUserInfo(userInfo);
  },

  // 保存用户信息的内部方法
  _saveUserInfo(userInfo) {
    const saveUserInfo = {
      nickName: (userInfo.nickName || this.data.tempNickName || '微信用户').trim(),
      avatarUrl: userInfo.avatarUrl || this.data.tempAvatarUrl || ''
    };
    
    // 确保昵称不为空
    if (!saveUserInfo.nickName) {
      saveUserInfo.nickName = '微信用户';
    }
    wx.showLoading({
      title: '登录中...',
      mask: true
    });

    console.log('准备保存用户信息:', saveUserInfo);

    // 先调用云函数进行登录（获取openid并创建/查询用户记录）
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'login'
      },
      success: (loginRes) => {
        console.log('登录云函数调用成功:', loginRes);
        console.log('登录云函数返回的result:', loginRes.result);
        
        // 检查云函数返回结果
        if (!loginRes.result) {
          wx.hideLoading();
          console.error('云函数返回结果为空');
          wx.showToast({
            title: '登录失败：云函数返回异常',
            icon: 'none',
            duration: 3000
          });
          return;
        }
        
        if (loginRes.result.success) {
          // 登录成功，保存用户信息到云数据库
          wx.cloud.callFunction({
            name: 'quickstartFunctions',
            data: {
              type: 'saveUserInfo',
              data: saveUserInfo
            },
            success: (saveRes) => {
              console.log('保存用户信息成功:', saveRes);
              wx.hideLoading();
              if (saveRes.result.success) {
                // 保存到本地存储
                wx.setStorageSync('userInfo', saveUserInfo);
                // 更新页面数据
                this.setData({
                  userInfo: saveUserInfo
                });
                wx.showToast({
                  title: '保存成功',
                  icon: 'success'
                });
                // 清空临时数据
                this.setData({
                  tempNickName: '',
                  tempAvatarUrl: ''
                });
                // 重新加载用户信息
                this.loadUserInfo();
              } else {
                wx.showToast({
                  title: '保存用户信息失败',
                  icon: 'none'
                });
              }
            },
            fail: (saveErr) => {
              wx.hideLoading();
              console.error('保存用户信息失败:', saveErr);
              wx.showToast({
                title: '保存用户信息失败',
                icon: 'none'
              });
            }
          });
        } else {
          wx.hideLoading();
          wx.showToast({
            title: '登录失败',
            icon: 'none'
          });
        }
      },
      fail: (loginErr) => {
        wx.hideLoading();
        console.error('登录失败:', loginErr);
        wx.showToast({
          title: '登录失败，请重试',
          icon: 'none'
        });
      }
    });
  },

  // 加载用户战绩
  loadUserStats() {
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'getUserStats'
      },
      success: (res) => {
        if (res.result.success && res.result.data) {
          const stats = res.result.data;
          this.setData({
            stats: {
              games: stats.totalGames || 0,
              wins: stats.winCount || 0,
              streak: stats.currentStreak || 0,
              bestAi: stats.favoriteDifficulty || '中级'
            }
          });
        } else {
          // 没有战绩数据，使用默认值
          this.setData({
            stats: {
              games: 0,
              wins: 0,
              streak: 0,
              bestAi: '中级'
            }
          });
        }
      },
      fail: (err) => {
        console.error('获取用户战绩失败:', err);
      }
    });
  },

  // 加载最近对局
  loadRecentGames() {
    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'getRecentGames',
        limit: 10
      },
      success: (res) => {
        if (res.result.success && res.result.data) {
          const records = res.result.data.map(record => ({
            opponent: record.opponentName || (record.opponentType === 'AI' ? 'AI' : record.opponentType === '好友' ? '好友' : '本机'),
            result: record.result || '负',
            moves: record.moves || 0
          }));
          this.setData({
            recent: records
          });
        } else {
          this.setData({
            recent: []
          });
        }
      },
      fail: (err) => {
        console.error('获取最近对局失败:', err);
        this.setData({
          recent: []
        });
      }
    });
  }
});
