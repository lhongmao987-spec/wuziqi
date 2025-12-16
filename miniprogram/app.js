// app.js
App({
  onLaunch: function () {
    this.globalData = {
      // env 参数说明：
      //   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
      //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
      //   如不填则使用默认环境（第一个创建的环境）
      env: "cloud1-5gor48qof18bad92"
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
      // 初始化完成后调用登录
      this.ensureLogin();
    }
  },

  // 确保登录：调用云函数 login，保存 openid 和 userInfo 到 storage
  async ensureLogin() {
    try {
      // 检查是否已有 openid
      const existingOpenid = wx.getStorageSync('openid');
      if (existingOpenid) {
        console.log('[ensureLogin] openid 已存在，跳过登录');
        return;
      }

      console.log('[ensureLogin] 开始调用登录云函数');
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'login'
        }
      });

      if (result.result && result.result.success && result.result.data) {
        const { openid, userInfo } = result.result.data;
        
        // 保存 openid
        if (openid) {
          wx.setStorageSync('openid', openid);
          console.log('[ensureLogin] openid 已保存:', openid);
        }
        
        // 保存 userInfo
        if (userInfo) {
          wx.setStorageSync('userInfo', userInfo);
          console.log('[ensureLogin] userInfo 已保存');
        }
      } else {
        console.error('[ensureLogin] 登录失败:', result.result);
      }
    } catch (error) {
      console.error('[ensureLogin] 登录异常:', error);
    }
  },

  // 处理隐私授权
  onNeedPrivacyAuthorization(resolve) {
    // 显示隐私授权弹窗
    wx.showModal({
      title: '用户隐私保护指引',
      content: '我们需要获取您的头像和昵称信息，用于完善个人资料和游戏体验。',
      confirmText: '同意',
      cancelText: '拒绝',
      success: (res) => {
        if (res.confirm) {
          // 用户同意，调用 resolve
          resolve({
            buttonId: 'agree',
            event: 'agree'
          });
        } else {
          // 用户拒绝
          resolve({
            buttonId: 'disagree',
            event: 'disagree'
          });
        }
      },
      fail: () => {
        // 弹窗失败，默认拒绝
        resolve({
          buttonId: 'disagree',
          event: 'disagree'
        });
      }
    });
  }
});
