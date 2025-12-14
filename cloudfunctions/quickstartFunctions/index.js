const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

// 引入服务模块
const statsService = require('./services/statsService');
const leaderboardService = require('./services/leaderboardService');
// 获取openid
const getOpenId = async () => {
  // 获取基础信息
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// 登录：获取用户openid并检查/创建用户记录
const login = async () => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    
    // 查询用户是否已存在
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userResult.data.length > 0) {
      // 用户已存在，返回用户信息
      return {
        success: true,
        data: {
          openid: openid,
          userInfo: userResult.data[0]
        }
      };
    } else {
      // 用户不存在，创建新用户记录
      const now = new Date();
      const newUser = {
        _openid: openid,
        nickName: '',
        avatarUrl: '',
        createTime: now,
        updateTime: now
      };
      
      const addResult = await db.collection('users').add({
        data: newUser
      });
      
      return {
        success: true,
        data: {
          openid: openid,
          userInfo: {
            _id: addResult._id,
            ...newUser
          }
        }
      };
    }
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 保存/更新用户信息
const saveUserInfo = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const userInfo = event.data;
    
    // 构建更新数据
    const updateData = {
      nickName: userInfo.nickName || '',
      updateTime: new Date()
    };
    
    // 处理头像：优先使用 avatarFileId（云存储 fileID）
    if (userInfo.avatarFileId) {
      // 有 fileID，保存 fileID，并清空旧的 avatarUrl（如果存在）
      updateData.avatarFileId = userInfo.avatarFileId;
      updateData.avatarUrl = ''; // 清空旧的 avatarUrl
    } else if (userInfo.avatarUrl) {
      // 有 avatarUrl（https 链接），保存 avatarUrl
      // 过滤掉临时路径（127.0.0.1、__tmp__ 等）
      const avatarUrl = userInfo.avatarUrl;
      if (avatarUrl.includes('127.0.0.1') || 
          avatarUrl.includes('__tmp__') || 
          avatarUrl.startsWith('wxfile://') ||
          avatarUrl.startsWith('http://localhost') ||
          (avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://'))) {
        // 临时路径，不保存
        console.warn('检测到临时路径，不保存:', avatarUrl);
      } else {
        updateData.avatarUrl = avatarUrl;
      }
    }
    
    // 更新用户信息
    const updateResult = await db.collection('users').where({
      _openid: openid
    }).update({
      data: updateData
    });
    
    if (updateResult.stats.updated === 0) {
      // 如果更新失败，可能是用户不存在，创建新记录
      const now = new Date();
      const newUserData = {
        _openid: openid,
        nickName: userInfo.nickName || '',
        createTime: now,
        updateTime: now
      };
      
      // 添加头像字段
      if (userInfo.avatarFileId) {
        newUserData.avatarFileId = userInfo.avatarFileId;
        newUserData.avatarUrl = '';
      } else if (userInfo.avatarUrl && 
                 !userInfo.avatarUrl.includes('127.0.0.1') && 
                 !userInfo.avatarUrl.includes('__tmp__')) {
        newUserData.avatarUrl = userInfo.avatarUrl;
      }
      
      await db.collection('users').add({
        data: newUserData
      });
    }
    
    // 获取更新后的用户信息
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    const savedUser = userResult.data[0] || null;
    
    // 如果有 avatarFileId，转换为 https URL 返回
    if (savedUser && savedUser.avatarFileId) {
      try {
        const tempFileURL = await cloud.getTempFileURL({
          fileList: [savedUser.avatarFileId]
        });
        if (tempFileURL.fileList && tempFileURL.fileList.length > 0) {
          savedUser.avatarUrl = tempFileURL.fileList[0].tempFileURL;
        }
      } catch (e) {
        console.error('转换 fileID 失败:', e);
        // 转换失败，返回空字符串，前端会使用默认头像
        savedUser.avatarUrl = '';
      }
    }
    
    return {
      success: true,
      data: savedUser
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 获取用户信息
const getUserInfo = async () => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userResult.data.length > 0) {
      const userInfo = userResult.data[0];
      
      // 如果有 avatarFileId，转换为 https URL
      if (userInfo.avatarFileId) {
        try {
          const tempFileURLResult = await cloud.getTempFileURL({
            fileList: [userInfo.avatarFileId]
          });
          if (tempFileURLResult.fileList && tempFileURLResult.fileList.length > 0) {
            userInfo.avatarUrl = tempFileURLResult.fileList[0].tempFileURL;
          } else {
            userInfo.avatarUrl = '';
          }
        } catch (e) {
          console.error('转换 fileID 失败:', e);
          userInfo.avatarUrl = '';
        }
      } else if (userInfo.avatarUrl) {
        // 过滤掉临时路径
        const avatarUrl = userInfo.avatarUrl;
        if (avatarUrl.includes('127.0.0.1') || 
            avatarUrl.includes('__tmp__') || 
            avatarUrl.startsWith('wxfile://') ||
            avatarUrl.startsWith('http://localhost') ||
            (avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://'))) {
          // 临时路径，返回空字符串
          userInfo.avatarUrl = '';
        }
      }
      
      return {
        success: true,
        data: userInfo
      };
    } else {
      return {
        success: false,
        errMsg: '用户不存在'
      };
    }
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 获取用户战绩
const getUserStats = async () => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    
    // 检查用户是否已登录
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    const userInfo = userResult.data.length > 0 ? userResult.data[0] : null;
    
    // 如果用户未登录，返回默认值
    if (!userInfo || !userInfo.nickName || userInfo.nickName.trim() === '') {
      return {
        success: true,
        data: {
          totalGames: 0,
          winCount: 0,
          loseCount: 0,
          drawCount: 0,
          currentStreak: 0,
          maxStreak: 0,
          favoriteDifficulty: '中级',
          winRate: 0,
          score: 0
        }
      };
    }
    
    // 查询用户战绩
    const statsResult = await db.collection('userStats').where({
      _openid: openid
    }).get();
    
    if (statsResult.data.length > 0) {
      const stats = statsResult.data[0];
      // 计算胜率
      const totalGames = stats.totalGames || 0;
      const winCount = stats.winCount || 0;
      const winRate = totalGames > 0 ? Math.round((winCount / totalGames) * 100) : 0;
      
      return {
        success: true,
        data: {
          ...stats,
          winRate: winRate
        }
      };
    } else {
      // 用户没有战绩记录，返回默认值
      return {
        success: true,
        data: {
          totalGames: 0,
          winCount: 0,
          loseCount: 0,
          drawCount: 0,
          currentStreak: 0,
          maxStreak: 0,
          favoriteDifficulty: '中级',
          winRate: 0,
          score: 0
        }
      };
    }
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 获取最近对局
const getRecentGames = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const limit = event.limit || 10; // 默认返回最近10局
    
    // 检查用户是否已登录
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    const userInfo = userResult.data.length > 0 ? userResult.data[0] : null;
    
    // 如果用户未登录，返回空数组
    if (!userInfo || !userInfo.nickName || userInfo.nickName.trim() === '') {
      return {
        success: true,
        data: []
      };
    }
    
    // 查询最近对局记录（使用 _openid 或 playerOpenId 都可以，为了兼容性使用 playerOpenId）
    const recordsResult = await db.collection('gameRecords')
      .where({
        playerOpenId: openid
      })
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get();
    
    return {
      success: true,
      data: recordsResult.data || []
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 使用服务模块中的函数
const calculateScore = statsService.calculateScore;
const updateUserStatsAfterGame = statsService.updateUserStatsAfterGame;

// 上报对局结果（兼容旧接口，内部调用 updateUserStatsAfterGame）
// 实现幂等性：通过 dedupeKey 防止重复上报
const reportResult = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const gameData = event.data;
    
    // 获取 dedupeKey（去重键）
    const dedupeKey = gameData.dedupeKey;
    if (!dedupeKey) {
      return {
        success: false,
        errMsg: '参数错误：dedupeKey 不能为空'
      };
    }
    
    // 幂等性检查：查询是否已存在相同 dedupeKey 的记录（同一玩家维度）
    const existingRecord = await db.collection('gameRecords').where({
      playerOpenId: openid,
      dedupeKey: dedupeKey
    }).get();
    
    if (existingRecord.data.length > 0) {
      // 已上报过，直接返回成功，但不重复更新 userStats
      return {
        success: true,
        data: {
          alreadyReported: true,
          message: '该对局已上报过，不会重复统计'
        }
      };
    }
    
    // 转换结果格式：'胜'/'负'/'和' -> 'win'/'lose'/'draw'
    let result = 'lose';
    if (gameData.result === '胜') {
      result = 'win';
    } else if (gameData.result === '负') {
      result = 'lose';
    } else if (gameData.result === '和') {
      result = 'draw';
    }
    
    // 获取用户信息（用于同步昵称和头像）
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    const userInfo = userResult.data.length > 0 ? userResult.data[0] : null;
    
    // 1. 保存对局记录到 gameRecords（包含 dedupeKey）
    const gameRecord = {
      playerOpenId: openid,
      opponentType: gameData.opponentType || 'AI',
      opponentName: gameData.opponentName || 'AI',
      opponentOpenId: gameData.opponentOpenId || '',
      result: gameData.result || '负',
      moves: gameData.moves || 0,
      duration: gameData.duration || 0,
      difficulty: gameData.difficulty || '',
      gameMode: gameData.gameMode || 'PVE',
      dedupeKey: dedupeKey, // 去重键
      createTime: new Date()
    };
    
    await db.collection('gameRecords').add({ data: gameRecord });
    
    // 2. 更新用户战绩
    const updateResult = await updateUserStatsAfterGame({
      data: {
        result: result,
        nickName: userInfo ? userInfo.nickName : '',
        avatarUrl: userInfo ? userInfo.avatarUrl : '',
        gameMode: gameData.gameMode,
        opponentType: gameData.opponentType
      }
    });
    
    return updateResult;
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e.toString()
    };
  }
};

// 生成4位数字房间号
const generateRoomId = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// 创建房间
const createRoom = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const userInfo = event.data || {};
    
    // 获取用户信息
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    const dbUserInfo = userResult.data.length > 0 ? userResult.data[0] : null;
    const nickName = userInfo.nickName || (dbUserInfo ? dbUserInfo.nickName : '');
    const avatarUrl = userInfo.avatarUrl || (dbUserInfo ? dbUserInfo.avatarUrl : '');
    
    // 检查用户是否已登录（必须有昵称）
    if (!nickName || nickName.trim() === '') {
      return {
        success: false,
        errMsg: '请先完善个人信息（设置昵称和头像）才能创建房间'
      };
    }
    
    // 生成唯一的房间号（最多重试10次）
    let roomId = '';
    let attempts = 0;
    while (attempts < 10) {
      roomId = generateRoomId();
      const existingRoom = await db.collection('rooms').where({
        roomId: roomId,
        status: db.command.in(['waiting', 'ready'])
      }).get();
      
      if (existingRoom.data.length === 0) {
        break; // 房间号可用
      }
      attempts++;
    }
    
    if (attempts >= 10) {
      return {
        success: false,
        errMsg: '创建房间失败，请稍后重试'
      };
    }
    
    // 创建房间记录
    const now = new Date();
    const expireAt = new Date(now.getTime() + 30 * 60 * 1000); // 30分钟后过期
    
    const roomData = {
      roomId: roomId,
      creator: {
        openid: openid,
        nickName: nickName,
        avatarUrl: avatarUrl
      },
      player2: null,
      status: 'waiting', // waiting / ready / playing / ended
      gameId: null,
      createdAt: now,
      updatedAt: now,
      expireAt: expireAt
    };
    
    const addResult = await db.collection('rooms').add({
      data: roomData
    });
    
    return {
      success: true,
      data: {
        _id: addResult._id,
        ...roomData
      }
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 加入房间
const joinRoom = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const roomId = event.roomId;
    const userInfo = event.data || {};
    
    if (!roomId) {
      return {
        success: false,
        errMsg: '房间号不能为空'
      };
    }
    
    // 获取用户信息并检查是否已登录
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    const dbUserInfo = userResult.data.length > 0 ? userResult.data[0] : null;
    const nickName = userInfo.nickName || (dbUserInfo ? dbUserInfo.nickName : '');
    const avatarUrl = userInfo.avatarUrl || (dbUserInfo ? dbUserInfo.avatarUrl : '');
    
    // 检查用户是否已登录（必须有昵称）
    if (!nickName || nickName.trim() === '') {
      return {
        success: false,
        errMsg: '请先完善个人信息（设置昵称和头像）才能加入房间'
      };
    }
    
    // 查询房间
    const roomResult = await db.collection('rooms').where({
      roomId: roomId
    }).get();
    
    if (roomResult.data.length === 0) {
      return {
        success: false,
        errMsg: '房间不存在'
      };
    }
    
    const room = roomResult.data[0];
    
    // 检查房间状态
    if (room.status === 'playing' || room.status === 'ended') {
      return {
        success: false,
        errMsg: '房间已开始或已结束'
      };
    }
    
    // 检查是否已过期
    if (room.expireAt && new Date(room.expireAt) < new Date()) {
      return {
        success: false,
        errMsg: '房间已过期'
      };
    }
    
    // 检查是否是创建者
    if (room.creator.openid === openid) {
      return {
        success: true,
        data: room,
        isCreator: true
      };
    }
    
    // 检查是否已有玩家2
    if (room.player2 && room.player2.openid === openid) {
      return {
        success: true,
        data: room,
        isCreator: false
      };
    }
    
    if (room.player2) {
      return {
        success: false,
        errMsg: '房间已满'
      };
    }
    
    // 加入房间
    const updateResult = await db.collection('rooms').doc(room._id).update({
      data: {
        player2: {
          openid: openid,
          nickName: nickName,
          avatarUrl: avatarUrl
        },
        status: 'ready', // 双方就绪
        updatedAt: new Date()
      }
    });
    
    // 获取更新后的房间信息
    const updatedRoom = await db.collection('rooms').doc(room._id).get();
    
    return {
      success: true,
      data: updatedRoom.data,
      isCreator: false
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 获取房间信息
const getRoomInfo = async (event) => {
  try {
    const roomId = event.roomId;
    const roomDocId = event.roomDocId; // 房间文档ID
    
    if (!roomId && !roomDocId) {
      return {
        success: false,
        errMsg: '房间号或房间ID不能为空'
      };
    }
    
    let result;
    if (roomDocId) {
      result = await db.collection('rooms').doc(roomDocId).get();
      if (!result.data) {
        return {
          success: false,
          errMsg: '房间不存在'
        };
      }
    } else {
      result = await db.collection('rooms').where({ roomId: roomId }).get();
      if (result.data.length === 0) {
        return {
          success: false,
          errMsg: '房间不存在'
        };
      }
    }
    
    const room = roomDocId ? result.data : result.data[0];
    
    // 检查是否过期
    if (room.expireAt && new Date(room.expireAt) < new Date()) {
      return {
        success: false,
        errMsg: '房间已过期'
      };
    }
    
    return {
      success: true,
      data: room
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 更新房间状态
const updateRoomStatus = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const roomDocId = event.roomDocId;
    const status = event.status; // waiting / ready / playing / ended
    
    if (!roomDocId || !status) {
      return {
        success: false,
        errMsg: '参数不完整'
      };
    }
    
    // 验证用户权限（必须是房间创建者或玩家2）
    const roomResult = await db.collection('rooms').doc(roomDocId).get();
    if (!roomResult.data) {
      return {
        success: false,
        errMsg: '房间不存在'
      };
    }
    
    const room = roomResult.data;
    if (room.creator.openid !== openid && (!room.player2 || room.player2.openid !== openid)) {
      return {
        success: false,
        errMsg: '无权限操作'
      };
    }
    
    // 更新房间状态
    await db.collection('rooms').doc(roomDocId).update({
      data: {
        status: status,
        updatedAt: new Date()
      }
    });
    
    // 如果状态为playing，创建游戏记录
    if (status === 'playing') {
      const gameData = {
        roomId: room.roomId,
        roomDocId: roomDocId,
        player1: room.creator,
        player2: room.player2,
        gameState: null, // 游戏状态将在游戏页面初始化
        moves: [],
        result: 'ONGOING',
        winner: null,
        startedAt: new Date(),
        endedAt: null
      };
      
      const gameResult = await db.collection('games').add({
        data: gameData
      });
      
      // 更新房间的游戏ID
      await db.collection('rooms').doc(roomDocId).update({
        data: {
          gameId: gameResult._id
        }
      });
      
      return {
        success: true,
        data: {
          gameId: gameResult._id,
          status: status
        }
      };
    }
    
    return {
      success: true,
      data: { status: status }
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 离开房间
const leaveRoom = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const roomDocId = event.roomDocId;
    
    if (!roomDocId) {
      return {
        success: false,
        errMsg: '房间ID不能为空'
      };
    }
    
    const roomResult = await db.collection('rooms').doc(roomDocId).get();
    if (roomResult.data.length === 0) {
      return {
        success: false,
        errMsg: '房间不存在'
      };
    }
    
    const room = roomResult.data;
    
    // 如果是创建者离开，删除房间
    if (room.creator.openid === openid) {
      await db.collection('rooms').doc(roomDocId).remove();
      return {
        success: true,
        data: { deleted: true }
      };
    }
    
    // 如果是玩家2离开，清空玩家2信息，状态改为waiting
    if (room.player2 && room.player2.openid === openid) {
      await db.collection('rooms').doc(roomDocId).update({
        data: {
          player2: null,
          status: 'waiting',
          updatedAt: new Date()
        }
      });
      return {
        success: true,
        data: { deleted: false }
      };
    }
    
    return {
      success: false,
      errMsg: '你不是房间成员'
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 更新游戏状态
const updateGameState = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const gameId = event.gameId;
    const gameState = event.gameState;
    const move = event.move;
    
    if (!gameId || !gameState) {
      return {
        success: false,
        errMsg: '参数不完整'
      };
    }
    
    // 验证用户权限
    const gameResult = await db.collection('games').doc(gameId).get();
    if (!gameResult.data) {
      return {
        success: false,
        errMsg: '游戏不存在'
      };
    }
    
    const game = gameResult.data;
    if (game.player1.openid !== openid && game.player2.openid !== openid) {
      return {
        success: false,
        errMsg: '无权限操作'
      };
    }
    
    // 更新游戏状态
    const updateData = {
      gameState: gameState,
      updatedAt: new Date()
    };
    
    // 如果有新的棋步，添加到moves数组
    if (move) {
      const moves = game.moves || [];
      moves.push(move);
      updateData.moves = moves;
    }
    
    // 如果游戏结束，更新结果
    if (gameState.result !== 'ONGOING') {
      updateData.result = gameState.result;
      updateData.winner = gameState.winner || null;
      updateData.endedAt = new Date();
      
      // 同时更新房间状态为ended
      if (game.roomDocId) {
        await db.collection('rooms').doc(game.roomDocId).update({
          data: {
            status: 'ended',
            updatedAt: new Date()
          }
        });
      }
    }
    
    await db.collection('games').doc(gameId).update({
      data: updateData
    });
    
    return {
      success: true,
      data: updateData
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 获取游戏状态
const getGameState = async (event) => {
  try {
    const gameId = event.gameId;
    
    if (!gameId) {
      return {
        success: false,
        errMsg: '游戏ID不能为空'
      };
    }
    
    const gameResult = await db.collection('games').doc(gameId).get();
    
    if (!gameResult.data) {
      return {
        success: false,
        errMsg: '游戏不存在'
      };
    }
    
    return {
      success: true,
      data: gameResult.data
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 使用服务模块中的排行榜函数
const getLeaderboard = leaderboardService.getLeaderboard;

// 获取排行榜（兼容旧接口）
const getRankList = async (event) => {
  // 调用新接口
  return await getLeaderboard(event);
};

// const getOpenId = require('./getOpenId/index');
// const getMiniProgramCode = require('./getMiniProgramCode/index');
// const createCollection = require('./createCollection/index');
// const selectRecord = require('./selectRecord/index');
// const updateRecord = require('./updateRecord/index');
// const sumRecord = require('./sumRecord/index');
// const fetchGoodsList = require('./fetchGoodsList/index');
// const genMpQrcode = require('./genMpQrcode/index');
// 云函数入口函数
exports.main = async (event, context) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "login":
      return await login();
    case "saveUserInfo":
      return await saveUserInfo(event);
    case "getUserInfo":
      return await getUserInfo();
    case "getUserStats":
      return await getUserStats();
    case "getRecentGames":
      return await getRecentGames(event);
    case "reportResult":
      return await reportResult(event);
    case "getRankList":
      return await getRankList(event);
    case "getLeaderboard":
      return await getLeaderboard(event);
    case "updateUserStatsAfterGame":
      return await updateUserStatsAfterGame(event);
    case "createRoom":
      return await createRoom(event);
    case "joinRoom":
      return await joinRoom(event);
    case "getRoomInfo":
      return await getRoomInfo(event);
    case "updateRoomStatus":
      return await updateRoomStatus(event);
    case "leaveRoom":
      return await leaveRoom(event);
    case "updateGameState":
      return await updateGameState(event);
    case "getGameState":
      return await getGameState(event);
    default:
      return {
        success: false,
        errMsg: '未知的操作类型'
      };
  }
};
