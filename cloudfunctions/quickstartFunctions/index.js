const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

// 引入服务模块
const statsService = require('./services/statsService');
const leaderboardService = require('./services/leaderboardService');
const fixPlayer2Null = require('./fixPlayer2Null');
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
    
    // 兼容 mode 和 gameMode 字段
    const gameMode = gameData.gameMode || gameData.mode || 'PVE';
    
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
      gameMode: gameMode,
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
        gameMode: gameMode,
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
    const avatarFileId = userInfo.avatarFileId || (dbUserInfo ? dbUserInfo.avatarFileId : '');
    const avatarUrl = ''; // 房间仅存 fileId，避免403
    
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
        avatarUrl: avatarUrl,
        avatarFileId: avatarFileId || ''
      },
      player2: {
        openid: '',
        nickName: '',
        avatarUrl: '',
        avatarFileId: ''
      },
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
  
  // 先拿用户信息（可以在事务外，因为不影响并发一致性）
  const userResult = await db.collection('users').where({
    _openid: openid
  }).get();
  
  const dbUserInfo = userResult.data.length > 0 ? userResult.data[0] : null;
  const nickName = userInfo.nickName || (dbUserInfo ? dbUserInfo.nickName : '');
  const avatarFileId = userInfo.avatarFileId || (dbUserInfo ? dbUserInfo.avatarFileId : '');
  const avatarUrl = ''; // 房间仅存 fileId，避免403
  
  if (!nickName || nickName.trim() === '') {
    return {
      success: false,
      errMsg: '请先完善个人信息（设置昵称和头像）才能加入房间'
    };
  }
  
  try {
    const res = await db.runTransaction(async (transaction) => {
      const roomsCol = transaction.collection('rooms');
      
      // 在事务内查询房间（使用 roomId）
      const roomRes = await roomsCol.where({ roomId: roomId }).get();
      if (!roomRes.data || roomRes.data.length === 0) {
        return {
          success: false,
          errMsg: '房间不存在'
        };
      }
      
      const room = roomRes.data[0];
      
      // 过期检查：expireAt 若存的是 Date，直接比较；若是时间戳也可兼容
      const expireAt = room.expireAt;
      const expireTime =
        expireAt instanceof Date ? expireAt.getTime() :
        typeof expireAt === 'number' ? expireAt :
        expireAt ? new Date(expireAt).getTime() : null;
      
      if (expireTime && Date.now() > expireTime) {
        return {
          success: false,
          errMsg: '房间已过期'
        };
      }
      
      if (room.status === 'playing' || room.status === 'ended') {
        return {
          success: false,
          errMsg: '房间已开始或已结束'
        };
      }
      
      // 创建者自己点加入：直接返回
      if (room.creator && room.creator.openid === openid) {
        return {
          success: true,
          data: room,
          isCreator: true
        };
      }
      
      // 已经是 player2：直接返回
      if (room.player2 && room.player2.openid && room.player2.openid === openid) {
        return {
          success: true,
          data: room,
          isCreator: false
        };
      }
      
      // 满员判断：player2 只要存在非空 openid 就视为已占用
      if (room.player2 && room.player2.openid && room.player2.openid.trim() !== '') {
        return {
          success: false,
          errMsg: '房间已满'
        };
      }
      
      // 更新：一次性写入整个 player2 对象
      await roomsCol.doc(room._id).update({
        data: {
          player2: {
            openid: openid,
            nickName: nickName,
          avatarUrl: avatarUrl,
            avatarFileId: avatarFileId || ''
          },
          status: 'ready',
          updatedAt: db.serverDate()
        }
      });
      
      // 事务内再读一次返回最新房间
      const updated = await roomsCol.doc(room._id).get();
      return {
        success: true,
        data: updated.data,
        isCreator: false
      };
    });
    
    return res;
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || String(e)
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
    if (room.creator.openid !== openid && (!room.player2 || !room.player2.openid || room.player2.openid.trim() === '' || room.player2.openid !== openid)) {
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
      const now = db.serverDate();
      const initialGameState = {};
      const gameData = {
        roomId: room.roomId,
        roomDocId: roomDocId,
        player1: room.creator,
        player2: room.player2,
        gameState: initialGameState,
        moves: [],
        result: 'ONGOING',
        winner: null,
        startedAt: new Date(),
        endedAt: null,
        updatedAt: now
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
          player2: {
            openid: '',
            nickName: '',
            avatarUrl: ''
          },
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
    
    // 更新游戏状态（整对象覆盖，不写子字段）
    const updateData = {
      gameState: gameState,
      updatedAt: db.serverDate()
    };
    
    // 如果有新的棋步，追加（原子 push）
    if (move) {
      updateData.moves = _.push(move);
    }
    
    // 如果游戏结束，更新结果并写战绩（幂等）
    let finished = false;
    if (gameState.result && gameState.result !== 'ONGOING') {
      finished = true;
      updateData.result = gameState.result;
      updateData.winner = gameState.winner || null;
      updateData.endedAt = db.serverDate();
      
      // 同时更新房间状态为ended
      if (game.roomDocId) {
        await db.collection('rooms').doc(game.roomDocId).update({
          data: {
            status: 'ended',
            updatedAt: db.serverDate()
          }
        });
      }
    }
    
    await db.collection('games').doc(gameId).update({
      data: updateData
    });
    
    // 终局入库（幂等）
    if (finished) {
      await finalizeOnlineGame(game, gameState, gameId);
    }
    
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

// 掷骰子决定先手
const rollDice = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const gameId = event.gameId;
  if (!gameId) {
    return { success: false, errMsg: 'gameId 不能为空' };
  }
  try {
    const res = await db.runTransaction(async (transaction) => {
      const gameRef = transaction.collection('games').doc(gameId);
      const gameDoc = await gameRef.get();
      const game = gameDoc.data;
      if (!game) {
        return { success: false, errMsg: '游戏不存在' };
      }
      if (!game.player1 || !game.player2) {
        return { success: false, errMsg: '玩家未就绪' };
      }
      if (game.player1.openid !== openid && game.player2.openid !== openid) {
        return { success: false, errMsg: '无权限' };
      }

      const rollObj = game.roll && typeof game.roll === 'object' ? game.roll : {};
      if (rollObj[openid] && rollObj[openid].value) {
        return { success: true, data: { roll: rollObj } };
      }

      const p1 = game.player1.openid;
      const p2 = game.player2.openid;
      const myRoll = Math.floor(1 + Math.random() * 6);
      rollObj[openid] = {
        value: myRoll,
        at: db.serverDate()
      };

      const opponentOpenid = openid === p1 ? p2 : p1;
      const oppRoll = opponentOpenid ? rollObj[opponentOpenid] : null;

      const updateData = {
        roll: rollObj,
        updatedAt: db.serverDate(),
        phase: 'ROLL_WAIT'
      };

      if (oppRoll && typeof oppRoll.value === 'number') {
        const p1Val = rollObj[p1] ? rollObj[p1].value : null;
        const p2Val = rollObj[p2] ? rollObj[p2].value : null;
        const rollResult = { p1: p1Val, p2: p2Val };
        if (p1Val === p2Val) {
          updateData.roll = {};
          updateData.rollResult = rollResult;
          updateData.phase = 'ROLL_AGAIN';
          updateData.blackOpenid = '';
          updateData.whiteOpenid = '';
          updateData.firstPlayerOpenid = '';
        } else {
          const firstPlayerOpenid = p1Val > p2Val ? p1 : p2;
          const secondOpenid = p1Val > p2Val ? p2 : p1;
          updateData.roll = {
            [p1]: rollObj[p1],
            [p2]: rollObj[p2]
          };
          updateData.rollResult = rollResult;
          updateData.blackOpenid = firstPlayerOpenid;
          updateData.whiteOpenid = secondOpenid;
          updateData.firstPlayerOpenid = firstPlayerOpenid;
          updateData.phase = 'ROLL_DONE';
          if (game.gameState && game.gameState.config && game.gameState.config.mode === 'PVP_ONLINE') {
            game.gameState.currentPlayer = 'BLACK';
            if (game.gameState.timeState) {
              const limit = game.gameState.config.timeLimitPerMove || 60;
              game.gameState.timeState.currentMoveRemain = limit;
              game.gameState.timeState.currentStartTs = Date.now();
            }
            updateData.gameState = game.gameState;
          }
        }
      }

      await gameRef.update({
        data: updateData
      });
      return { success: true, data: { roll: updateData.roll, rollResult: updateData.rollResult, phase: updateData.phase } };
    });
    return res;
  } catch (e) {
    return { success: false, errMsg: e.message || e };
  }
};

// 强制超时换手
const forceSwitchTurn = async (event) => {
  const gameId = event.gameId;
  if (!gameId) {
    return { success: false, errMsg: 'gameId 不能为空' };
  }
  try {
    const res = await db.runTransaction(async (transaction) => {
      const gameRef = transaction.collection('games').doc(gameId);
      const gameDoc = await gameRef.get();
      const game = gameDoc.data;
      if (!game || !game.gameState) {
        return { success: false, errMsg: '游戏不存在' };
      }
      const state = game.gameState;
      if (!state.timeState) {
        state.timeState = {};
      }
      const nextPlayer = state.currentPlayer === 'BLACK' ? 'WHITE' : 'BLACK';
      const limit = (state.config && state.config.timeLimitPerMove) ? state.config.timeLimitPerMove : 60;
      state.currentPlayer = nextPlayer;
      state.timeState.currentMoveRemain = limit;
      state.timeState.currentStartTs = Date.now();
      await gameRef.update({
        data: {
          gameState: state,
          updatedAt: db.serverDate()
        }
      });
      return { success: true, data: { gameState: state } };
    });
    return res;
  } catch (e) {
    return { success: false, errMsg: e.message || e };
  }
};

// 终局战绩（幂等）
const finalizeOnlineGame = async (game, gameState, gameId) => {
  if (!game || !game.player1 || !game.player2) return;
  const result = gameState.result;
  const winner = gameState.winner; // BLACK / WHITE / NONE
  
  // 从 users 集合获取每个玩家的最新 nickName 和 avatarUrl（避免昵称污染）
  const player1Openid = game.player1.openid;
  const player2Openid = game.player2.openid;
  
  // 获取玩家1的最新信息
  let player1Info = { openid: player1Openid, nickName: '', avatarUrl: '' };
  try {
    const user1Result = await db.collection('users').where({ _openid: player1Openid }).get();
    if (user1Result.data && user1Result.data.length > 0) {
      player1Info.nickName = user1Result.data[0].nickName || '';
      player1Info.avatarUrl = user1Result.data[0].avatarUrl || '';
    }
  } catch (e) {
    console.error('获取玩家1信息失败:', e);
  }
  
  // 获取玩家2的最新信息
  let player2Info = { openid: player2Openid, nickName: '', avatarUrl: '' };
  try {
    const user2Result = await db.collection('users').where({ _openid: player2Openid }).get();
    if (user2Result.data && user2Result.data.length > 0) {
      player2Info.nickName = user2Result.data[0].nickName || '';
      player2Info.avatarUrl = user2Result.data[0].avatarUrl || '';
    }
  } catch (e) {
    console.error('获取玩家2信息失败:', e);
  }
  
  const players = [player1Info, player2Info];
  
  for (const p of players) {
    if (!p.openid) continue;
    const dedupeKey = `online_${gameId}_${p.openid}`;
    const exist = await db.collection('gameRecords').where({
      playerOpenId: p.openid,
      dedupeKey
    }).get();
    if (exist.data && exist.data.length > 0) {
      continue;
    }
    let outcome = 'draw';
    if (winner === 'BLACK') {
      outcome = p.openid === game.player1.openid ? 'win' : 'lose';
      if (game.blackOpenid) {
        outcome = p.openid === game.blackOpenid ? 'win' : 'lose';
      }
    } else if (winner === 'WHITE') {
      outcome = p.openid === game.player1.openid ? 'lose' : 'win';
      if (game.whiteOpenid) {
        outcome = p.openid === game.whiteOpenid ? 'win' : 'lose';
      }
    }
    
    // 对手信息：使用从 users 集合获取的最新信息
    const opponent = p.openid === player1Openid ? player2Info : player1Info;
    const gameRecord = {
      playerOpenId: p.openid,
      opponentOpenId: opponent.openid,
      opponentName: opponent.nickName || '', // 对手昵称可以写，但不覆盖自己的
      result: outcome === 'win' ? '胜' : outcome === 'lose' ? '负' : '和',
      moves: (gameState.moves || []).length,
      duration: gameState.duration || 0,
      gameMode: 'PVP_ONLINE',
      opponentType: 'ONLINE',
      dedupeKey,
      createTime: new Date()
    };
    await db.collection('gameRecords').add({ data: gameRecord });
    
    // 更新 userStats 时，nickName/avatarUrl 必须来自 users 集合里该玩家的记录
    // updateUserStatsAfterGame 支持传入 openid 参数，会使用该 openid 而不是 wxContext.OPENID
    // 传入的 nickName 和 avatarUrl 来自 users 集合（已在上面获取），updateUserStatsAfterGame 会优先使用 users 集合中的最新数据
    await updateUserStatsAfterGame({
      data: {
        result: outcome,
        nickName: p.nickName, // 来自 users 集合的最新 nickName（用于初始化，实际使用 users 集合中的）
        avatarUrl: p.avatarUrl, // 来自 users 集合的最新 avatarUrl（用于初始化，实际使用 users 集合中的）
        gameMode: 'PVP_ONLINE',
        opponentType: 'ONLINE',
        openid: p.openid // 传入 openid，updateUserStatsAfterGame 会使用该 openid
      }
    });
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
    case "rollDice":
      return await rollDice(event);
    case "forceSwitchTurn":
      return await forceSwitchTurn(event);
    case "fixPlayer2Null":
      return await fixPlayer2Null();
    default:
      return {
        success: false,
        errMsg: '未知的操作类型'
      };
  }
};
