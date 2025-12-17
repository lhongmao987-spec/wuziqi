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

// 引入规则引擎和类型
const { RuleEngine } = require('./ruleEngine');
const { Player, CellState, GameResult, GamePhase } = require('./types');

// 检测 updateData 中是否存在以 'gameState.' 开头的 badKeys
const checkUpdateDataForBadKeys = (updateData, type, branch = '') => {
  const keys = Object.keys(updateData);
  const badKeys = keys.filter(key => key.startsWith('gameState.'));
  if (badKeys.length > 0) {
    console.error(`[ERROR] 检测到 badKeys 在 ${type}${branch ? ` (${branch})` : ''}:`, {
      badKeys: badKeys,
      allKeys: keys,
      updateData: JSON.stringify(updateData, null, 2)
    });
  } else {
    console.log(`[OK] ${type}${branch ? ` (${branch})` : ''} updateData keys:`, keys);
  }
  return badKeys;
};
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
      
      // 过滤掉过期、playing/ended 的房间
      const now = Date.now();
      const validRooms = roomRes.data.filter(room => {
        // 检查过期
        const expireAt = room.expireAt;
        const expireTime =
          expireAt instanceof Date ? expireAt.getTime() :
          typeof expireAt === 'number' ? expireAt :
          expireAt ? new Date(expireAt).getTime() : null;
        
        if (expireTime && now > expireTime) {
          return false; // 已过期
        }
        
        // 检查状态
        if (room.status === 'playing' || room.status === 'ended') {
          return false; // 已开始或已结束
        }
        
        return true; // 有效房间
      });
      
      // 如果有效房间不止一条，报错
      if (validRooms.length > 1) {
        return {
          success: false,
          errMsg: '房间号冲突，请房主重建'
        };
      }
      
      // 如果没有有效房间
      if (validRooms.length === 0) {
        return {
          success: false,
          errMsg: '房间不存在或已过期'
        };
      }
      
      const room = validRooms[0];
      
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
      
      // 打印日志便于对照
      console.log('[joinRoom updated]', {
        roomId: room.roomId,
        roomDocId: room._id,
        openid: openid,
        nickName: nickName
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
    
    // 批量转换头像：avatarFileId -> https URL（与排行榜逻辑一致）
    const fileIdsToConvert = [];
    const avatarMapping = {}; // fileID -> tempFileURL 映射
    
    // 收集 creator 和 player2 的 avatarFileId
    if (room.creator && room.creator.avatarFileId) {
      const fileId = room.creator.avatarFileId.trim();
      if (fileId) {
        fileIdsToConvert.push(fileId);
        avatarMapping.creator = fileId;
      }
    }
    
    if (room.player2 && room.player2.avatarFileId) {
      const fileId = room.player2.avatarFileId.trim();
      if (fileId) {
        fileIdsToConvert.push(fileId);
        avatarMapping.player2 = fileId;
      }
    }
    
    // 批量转换头像
    let fileIdToUrlMap = {};
    if (fileIdsToConvert.length > 0) {
      try {
        const tempFileURLResult = await cloud.getTempFileURL({
          fileList: fileIdsToConvert
        });
        if (tempFileURLResult.fileList) {
          tempFileURLResult.fileList.forEach(file => {
            if (file.fileID && file.tempFileURL) {
              fileIdToUrlMap[file.fileID] = file.tempFileURL;
            }
          });
        }
      } catch (e) {
        console.error('[getRoomInfo] 批量转换头像失败:', e);
        // 转换失败，不影响主流程，返回空字符串
      }
    }
    
    // 构建返回数据，添加转换后的 avatarUrl
    const roomData = {
      ...room,
      creator: room.creator ? {
        ...room.creator,
        avatarUrl: avatarMapping.creator && fileIdToUrlMap[avatarMapping.creator]
          ? fileIdToUrlMap[avatarMapping.creator]
          : ''
      } : room.creator,
      player2: room.player2 ? {
        ...room.player2,
        avatarUrl: avatarMapping.player2 && fileIdToUrlMap[avatarMapping.player2]
          ? fileIdToUrlMap[avatarMapping.player2]
          : ''
      } : room.player2
    };
    
    return {
      success: true,
      data: roomData
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
    
    // 如果状态为 playing 且当前状态为 rematch_wait，必须校验 rematch 状态
    if (status === 'playing' && room.status === 'rematch_wait') {
      // 必须 creatorReady && player2Ready 才允许开始
      if (!room.rematch || !room.rematch.creatorReady || !room.rematch.player2Ready) {
        return {
          success: false,
          errMsg: '双方尚未准备好，无法开始游戏'
        };
      }
    }
    
    // 更新房间状态
    const updateData = {
      status: status,
      updatedAt: new Date()
    };
    
    // 如果状态为 playing 且之前是 rematch_wait，清空 rematch
    if (status === 'playing' && room.status === 'rematch_wait') {
      updateData.rematch = {
        creatorReady: false,
        player2Ready: false,
        token: '',
        updatedAt: new Date()
      };
    }
    
    await db.collection('rooms').doc(roomDocId).update({
      data: updateData
    });
    
    // 如果状态为playing，创建游戏记录
    if (status === 'playing') {
      const now = db.serverDate();
      
      // 初始化完整的 gameState（即使 phase 仍是 ROLL_WAIT，也先有 gameState 避免 PathNotViable）
      const boardSize = 15;
      const board = Array(boardSize).fill(null).map(() => 
        Array(boardSize).fill(0) // CellState.Empty = 0
      );
      
      const timeLimitPerMove = 60; // 在线对战默认每步60秒
      const timeState = {
        blackRemain: 0,
        whiteRemain: 0,
        currentStartTs: Date.now(),
        currentMoveRemain: timeLimitPerMove
      };
      
      const initialGameState = {
        board: board, // 15x15 全0数组
        currentPlayer: 'BLACK', // Player.Black（先手待定，投骰子后确定）
        moves: [], // 空数组
        result: 'ONGOING', // GameResult.Ongoing
        winner: undefined,
        phase: 'PLAYING', // GamePhase.Playing（对局阶段，不是骰子阶段）
        config: {
          boardSize: boardSize,
          ruleSet: 'STANDARD',
          enableForbidden: false,
          allowUndo: false, // 在线对战不允许悔棋
          mode: 'PVP_ONLINE',
          timeLimitPerMove: timeLimitPerMove
        },
        timeState: timeState,
        lastMove: undefined,
        winningPositions: undefined
      };
      
      // 快照昵称到 games 文档，避免游戏页只读 games 时没有昵称
      const player1Data = {
        ...room.creator,
        nickName: room.creator.nickName || '' // 快照 nickName
      };
      const player2Data = room.player2 ? {
        ...room.player2,
        nickName: room.player2.nickName || '' // 快照 nickName
      } : null;
      
      const gameData = {
        roomId: room.roomId,
        roomDocId: roomDocId,
        player1: player1Data,
        player2: player2Data,
        gameState: initialGameState, // 直接写完整的空 gameState，避免 PathNotViable
        moves: [],
        result: 'ONGOING',
        winner: null,
        phase: 'ROLL_WAIT', // 初始阶段：等待投骰子（但 gameState 已初始化）
        roll: {},
        rollResult: {}, // 使用空对象而不是 null，避免点语法更新失败
        blackOpenid: '',
        whiteOpenid: '',
        firstPlayerOpenid: '',
        turnOpenid: '', // 当前回合的 openid（ROLL_DONE 后初始化）
        stateVersion: 0, // 状态版本号（用于幂等判断）
        startedAt: new Date(),
        endedAt: null,
        updatedAt: now
      };
      
      const gameResult = await db.collection('games').add({
        data: gameData
      });
      
      // 更新房间的游戏ID（rematch 已在上面清空）
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
// 离开房间（重构：幂等性，确保事务原子性，避免房间进入非法状态）
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
    
    // 先查询房间信息，判断是否需要查询 users（在事务外）
    const roomResult = await db.collection('rooms').doc(roomDocId).get();
    
    // 幂等性：如果房间不存在，直接返回成功（避免 document not exist 错误）
    if (!roomResult.data) {
      console.log('[leaveRoom] 房间不存在，幂等返回成功');
      return {
        success: true,
        data: { deleted: false, reason: 'room_not_exist' }
      };
    }
    
    const room = roomResult.data;
    let userInfo = null;
    
    // 如果是创建者离开且 player2 还在，需要查询 player2 的用户信息
    if (room.creator && room.creator.openid === openid && 
        room.player2 && room.player2.openid && room.player2.openid.trim() !== '') {
      try {
        const userResult = await db.collection('users').where({
          _openid: room.player2.openid
        }).get();
        if (userResult.data && userResult.data.length > 0) {
          userInfo = userResult.data[0];
        }
      } catch (e) {
        console.warn('[leaveRoom] 查询用户信息失败，使用房间中的信息:', e);
      }
    }
    
    // 进入事务执行更新（确保原子性）
    return await db.runTransaction(async (transaction) => {
      const roomsCol = transaction.collection('rooms');
      const roomDoc = await roomsCol.doc(roomDocId).get();
      
      // 幂等性：事务中再次检查房间是否存在
      if (!roomDoc.data) {
        console.log('[leaveRoom] 事务中房间不存在，幂等返回成功');
        return {
          success: true,
          data: { deleted: false, reason: 'room_not_exist_in_transaction' }
        };
      }
      
      const currentRoom = roomDoc.data;
      
      // 如果是创建者离开
      if (currentRoom.creator && currentRoom.creator.openid === openid) {
        // 如果 player2 存在，提升 player2 为 creator
        if (currentRoom.player2 && currentRoom.player2.openid && currentRoom.player2.openid.trim() !== '') {
          // 使用房间中的信息，如果查询到了 users 信息则优先使用
          let newCreator = {
            openid: currentRoom.player2.openid,
            nickName: currentRoom.player2.nickName || '',
            avatarUrl: currentRoom.player2.avatarUrl || '',
            avatarFileId: currentRoom.player2.avatarFileId || ''
          };
          
          // 如果查询到了 users 中的信息，使用更完整的信息
          if (userInfo) {
            newCreator.nickName = userInfo.nickName || newCreator.nickName;
            newCreator.avatarFileId = userInfo.avatarFileId || newCreator.avatarFileId;
          }
          
          // 提升 player2 为 creator，清空 player2，重置状态，清空所有可能导致旧局残留的字段
          await roomsCol.doc(roomDocId).update({
            data: {
              creator: newCreator,
              player2: {
                openid: '',
                nickName: '',
                avatarUrl: '',
                avatarFileId: ''
              },
              status: 'waiting',
              gameId: null, // 清空 gameId，避免指向不存在的 game
              rematch: {
                creatorReady: false,
                player2Ready: false,
                token: '',
                updatedAt: null
              }, // 清空 rematch，避免指向不存在的状态
              updatedAt: db.serverDate()
            }
          });
          
          return {
            success: true,
            data: { deleted: false, promoted: true }
          };
        } else {
          // player2 不存在，直接删除房间
          await roomsCol.doc(roomDocId).remove();
          return {
            success: true,
            data: { deleted: true, reason: 'no_player2' }
          };
        }
      }
      
      // 如果是玩家2离开，清空玩家2信息，状态改为 waiting，清空所有可能导致旧局残留的字段
      if (currentRoom.player2 && currentRoom.player2.openid === openid) {
        await roomsCol.doc(roomDocId).update({
          data: {
            player2: {
              openid: '',
              nickName: '',
              avatarUrl: '',
              avatarFileId: ''
            },
            status: 'waiting',
            gameId: null, // 清空 gameId
            rematch: {
              creatorReady: false,
              player2Ready: false,
              token: '',
              updatedAt: null
            }, // 清空 rematch
            updatedAt: db.serverDate()
          }
        });
        return {
          success: true,
          data: { deleted: false }
        };
      }
      
      // 幂等性：如果调用者既不是 creator 也不是 player2，可能是重复调用，返回成功
      // 但需要检查是否已经是空状态（避免误判）
      const isNotMember = !(currentRoom.creator && currentRoom.creator.openid === openid) &&
                          !(currentRoom.player2 && currentRoom.player2.openid === openid);
      if (isNotMember) {
        // 检查是否已经是空状态（player2 已清空）
        const player2Empty = !currentRoom.player2 || !currentRoom.player2.openid || currentRoom.player2.openid.trim() === '';
        if (player2Empty && openid !== currentRoom.creator?.openid) {
          // 如果 player2 已清空且调用者不是 creator，说明已经离开过了，幂等返回成功
          console.log('[leaveRoom] 调用者不是房间成员，但 player2 已清空，幂等返回成功');
          return {
            success: true,
            data: { deleted: false, reason: 'already_left' }
          };
        }
      }
      
      return {
        success: false,
        errMsg: '你不是房间成员'
      };
    });
  } catch (e) {
    // 如果是 document not exist 错误，幂等返回成功
    if (e.message && (e.message.includes('not exist') || e.message.includes('不存在'))) {
      console.log('[leaveRoom] 捕获 document not exist 错误，幂等返回成功:', e.message);
      return {
        success: true,
        data: { deleted: false, reason: 'room_not_exist_catch' }
      };
    }
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 再来一局准备（新增：处理 rematch 状态）
const rematchReady = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const roomDocId = event.roomDocId;
    const token = event.token; // 上一局的 gameId 或 endedAt，用于防重复点击
    
    if (!roomDocId || !token) {
      return {
        success: false,
        errMsg: '参数不完整'
      };
    }
    
    // 查询房间信息
    const roomResult = await db.collection('rooms').doc(roomDocId).get();
    if (!roomResult.data) {
      return {
        success: false,
        errMsg: '房间不存在'
      };
    }
    
    const room = roomResult.data;
    
    // 校验调用者必须是 creator 或 player2
    const isCreator = room.creator && room.creator.openid === openid;
    const isPlayer2 = room.player2 && room.player2.openid && room.player2.openid === openid;
    
    if (!isCreator && !isPlayer2) {
      return {
        success: false,
        errMsg: '无权限操作'
      };
    }
    
    // 使用事务更新 rematch 状态
    return await db.runTransaction(async transaction => {
      const roomsCol = transaction.collection('rooms');
      
      // 重新获取房间数据（事务内）
      const currentRoomDoc = await roomsCol.doc(roomDocId).get();
      if (!currentRoomDoc.data) {
        return {
          success: false,
          errMsg: '房间不存在'
        };
      }
      
      const currentRoom = currentRoomDoc.data;
      
      // 检查 token：如果 rematch.token 存在且不匹配，说明是旧结算页的请求，直接返回当前状态
      if (currentRoom.rematch && currentRoom.rematch.token && currentRoom.rematch.token !== token) {
        return {
          success: true,
          data: {
            room: currentRoom,
            message: 'token 不匹配，已返回当前房间状态'
          }
        };
      }
      
      // 初始化或更新 rematch 状态
      const rematch = currentRoom.rematch || {
        creatorReady: false,
        player2Ready: false,
        token: token,
        updatedAt: new Date()
      };
      
      // 根据 openid 判断是 creator 还是 player2，设置对应的 ready 状态
      if (isCreator) {
        rematch.creatorReady = true;
      } else if (isPlayer2) {
        rematch.player2Ready = true;
      }
      
      rematch.updatedAt = new Date();
      
      // 更新房间状态
      await roomsCol.doc(roomDocId).update({
        data: {
          rematch: rematch,
          status: 'rematch_wait',
          updatedAt: db.serverDate()
        }
      });
      
      return {
        success: true,
        data: {
          rematch: rematch,
          status: 'rematch_wait'
        }
      };
    });
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
};

// 重置房间准备下一局（保留原有逻辑，但不再用于再来一局）
const resetRoomForNext = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const roomId = event.roomId; // 使用房间号而不是 roomDocId
    
    if (!roomId) {
      return {
        success: false,
        errMsg: '房间号不能为空'
      };
    }
    
    // 先查询房间信息，判断是否需要查询 users（在事务外）
    const roomResult = await db.collection('rooms').where({ roomId: roomId }).get();
    
    if (!roomResult.data || roomResult.data.length === 0) {
      return {
        success: false,
        errMsg: '房间不存在'
      };
    }
    
    const room = roomResult.data[0];
    const roomDocId = room._id; // 获取房间文档ID
    
    // 校验调用者必须是 creator 或 player2
    const isCreator = room.creator && room.creator.openid === openid;
    const isPlayer2 = room.player2 && room.player2.openid && room.player2.openid === openid;
    
    if (!isCreator && !isPlayer2) {
      return {
        success: false,
        errMsg: '无权限操作'
      };
    }
    
    // 若 creator.openid 为空/不存在（房主已离开），需要查询用户信息
    let userInfo = null;
    if (!room.creator || !room.creator.openid || room.creator.openid.trim() === '') {
      try {
        const userResult = await db.collection('users').where({
          _openid: openid
        }).get();
        if (userResult.data && userResult.data.length > 0) {
          userInfo = userResult.data[0];
        }
      } catch (e) {
        console.warn('查询用户信息失败，使用默认值:', e);
      }
    }
    
    // 进入事务执行更新
    return await db.runTransaction(async (transaction) => {
      const roomsCol = transaction.collection('rooms');
      
      // 重新获取房间数据（事务内）
      const currentRoomDoc = await roomsCol.doc(roomDocId).get();
      if (!currentRoomDoc.data) {
        return {
          success: false,
          errMsg: '房间不存在'
        };
      }
      
      const currentRoom = currentRoomDoc.data;
      
      // 若 creator.openid 为空/不存在（房主已离开）
      if (!currentRoom.creator || !currentRoom.creator.openid || currentRoom.creator.openid.trim() === '') {
        // 调用者继承为 creator
        let newCreator = {
          openid: openid,
          nickName: '',
          avatarUrl: '',
          avatarFileId: ''
        };
        
        // 如果查询到了 users 中的信息，使用更完整的信息
        if (userInfo) {
          newCreator.nickName = userInfo.nickName || '';
          newCreator.avatarFileId = userInfo.avatarFileId || '';
        }
        
        // 清空 player2，status='waiting'，清空 gameId
        await roomsCol.doc(roomDocId).update({
          data: {
            creator: newCreator,
            player2: {
              openid: '',
              nickName: '',
              avatarUrl: '',
              avatarFileId: ''
            },
            status: 'waiting',
            gameId: null,
            updatedAt: db.serverDate()
          }
        });
        
        return {
          success: true,
          data: { inherited: true, roomId: room.roomId }
        };
      }
      
      // 若房主仍在：清空 gameId，status = (player2 存在 ? 'ready' : 'waiting')
      const hasPlayer2 = currentRoom.player2 && currentRoom.player2.openid && currentRoom.player2.openid.trim() !== '';
      const newStatus = hasPlayer2 ? 'ready' : 'waiting';
      
      await roomsCol.doc(roomDocId).update({
        data: {
          gameId: null,
          status: newStatus,
          updatedAt: db.serverDate()
        }
      });
      
      return {
        success: true,
        data: { status: newStatus, roomId: room.roomId }
      };
    });
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
    
    // 检测 updateData 中是否存在 badKeys
    checkUpdateDataForBadKeys(updateData, 'updateGameState');
    
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
  // 版本号：用于确认云函数代码已成功部署
  const VERSION = 'v2.0.1-rollDice-fix-gameState';
  console.log(`[rollDice] 版本号: ${VERSION}, gameId: ${event.gameId}`);
  
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
        // 整块写入 rollResult，不使用点语法
        const newRollResult = { p1: p1Val, p2: p2Val };
        if (p1Val === p2Val) {
          updateData.roll = {};
          updateData.rollResult = newRollResult; // 整块写入
          updateData.phase = 'ROLL_AGAIN';
          updateData.blackOpenid = '';
          updateData.whiteOpenid = '';
          updateData.firstPlayerOpenid = '';
          updateData.turnOpenid = '';
        } else {
          const firstPlayerOpenid = p1Val > p2Val ? p1 : p2;
          const secondOpenid = p1Val > p2Val ? p2 : p1;
          updateData.roll = {
            [p1]: rollObj[p1],
            [p2]: rollObj[p2]
          };
          updateData.rollResult = newRollResult; // 整块写入
          updateData.blackOpenid = firstPlayerOpenid;
          updateData.whiteOpenid = secondOpenid;
          updateData.firstPlayerOpenid = firstPlayerOpenid;
          updateData.phase = 'ROLL_DONE';
          // 初始化 turnOpenid 为黑棋 openid
          updateData.turnOpenid = firstPlayerOpenid;
          // 初始化 stateVersion
          updateData.stateVersion = 1;
          
          // 初始化完整的 gameState（如果为 null 或不存在）
          // 必须整体写入 gameState 对象，不能使用子路径更新（如 gameState.board）
          // gameState 结构必须与 core.restoreState 期望完全一致
          if (!game.gameState || game.gameState === null || !game.gameState.board || !Array.isArray(game.gameState.board)) {
            const boardSize = 15;
            const board = Array(boardSize).fill(null).map(() => 
              Array(boardSize).fill(0) // CellState.Empty = 0
            );
            
            const timeLimitPerMove = 60; // 在线对战默认每步60秒
            const timeState = {
              blackRemain: 0,
              whiteRemain: 0,
              currentStartTs: Date.now(),
              currentMoveRemain: timeLimitPerMove
            };
            
            const initialGameState = {
              board: board, // 15x15 全0数组
              currentPlayer: 'BLACK', // Player.Black
              moves: [], // 空数组
              result: 'ONGOING', // GameResult.Ongoing
              winner: undefined,
              phase: 'PLAYING', // GamePhase.Playing（对局阶段，不是骰子阶段）
              config: {
                boardSize: boardSize,
                ruleSet: 'STANDARD',
                enableForbidden: false,
                allowUndo: false, // 在线对战不允许悔棋
                mode: 'PVP_ONLINE',
                timeLimitPerMove: timeLimitPerMove
              },
              timeState: timeState,
              lastMove: undefined,
              winningPositions: undefined
            };
            
            // 整体写入 gameState，不使用子路径
            updateData.gameState = initialGameState;
          } else {
            // 如果 gameState 已存在，创建新对象并整体写入（避免直接修改原对象）
            const existingGameState = game.gameState;
            const limit = existingGameState.config && existingGameState.config.timeLimitPerMove 
              ? existingGameState.config.timeLimitPerMove 
              : 60;
            
            const updatedGameState = {
              ...existingGameState,
              currentPlayer: 'BLACK',
              phase: 'PLAYING',
              timeState: {
                ...(existingGameState.timeState || {}),
                currentMoveRemain: limit,
                currentStartTs: Date.now()
              }
            };
            
            // 整体写入 gameState，不使用子路径
            updateData.gameState = updatedGameState;
          }
        }
      }

      // 检测 updateData 中是否存在 badKeys
      checkUpdateDataForBadKeys(updateData, 'rollDice', `phase=${updateData.phase || 'UNKNOWN'}`);

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

// 在线落子（原子更新，避免并发覆盖）
const placeMove = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const gameId = event.gameId;
  const x = event.x;
  const y = event.y;
  
  if (!gameId || typeof x !== 'number' || typeof y !== 'number') {
    return { success: false, errMsg: '参数不完整' };
  }
  
  try {
    const res = await db.runTransaction(async (transaction) => {
      const gameRef = transaction.collection('games').doc(gameId);
      const gameDoc = await gameRef.get();
      const game = gameDoc.data;
      
      if (!game) {
        return { success: false, errMsg: '游戏不存在' };
      }
      
      // 校验权限
      if (game.player1.openid !== openid && game.player2.openid !== openid) {
        return { success: false, errMsg: '无权限操作' };
      }
      
      // 校验 games.phase === 'ROLL_DONE'（骰子阶段）
      if (game.phase !== 'ROLL_DONE') {
        return { success: false, errMsg: '请先投骰子决定先手' };
      }
      
      // 校验 turnOpenid === 当前 openid
      if (game.turnOpenid !== openid) {
        return { success: false, errMsg: '不是你的回合' };
      }
      
      // 校验 gameState 存在且结构完整（必须与 core.restoreState 期望一致）
      if (!game.gameState) {
        return { success: false, errMsg: '游戏状态不存在，请重新投骰子' };
      }
      if (!Array.isArray(game.gameState.board)) {
        return { success: false, errMsg: '游戏状态异常：board 不是数组' };
      }
      if (!Array.isArray(game.gameState.moves)) {
        return { success: false, errMsg: '游戏状态异常：moves 不是数组' };
      }
      // 校验 gameState.phase === 'PLAYING'（对局阶段）
      if (game.gameState.phase !== 'PLAYING') {
        return { success: false, errMsg: '游戏未在进行中' };
      }
      
      // 校验游戏是否已结束（顶层 result 检查）
      if (game.result && game.result !== 'ONGOING') {
        return { success: false, errMsg: '游戏已结束' };
      }
      
      // 校验目标格为空
      const board = game.gameState.board;
      if (x < 0 || x >= board.length || y < 0 || y >= board[x].length) {
        return { success: false, errMsg: '落子位置超出边界' };
      }
      if (board[x][y] !== CellState.Empty) {
        return { success: false, errMsg: '该位置已有棋子' };
      }
      
      // 确定当前玩家（根据 turnOpenid）
      const currentPlayer = game.turnOpenid === game.blackOpenid ? Player.Black : Player.White;
      const cellValue = currentPlayer === Player.Black ? CellState.Black : CellState.White;
      
      // 更新 board（注意：本项目棋盘坐标是 board[x][y]）
      const newBoard = JSON.parse(JSON.stringify(board));
      newBoard[x][y] = cellValue;
      
      // 创建新的 move
      const newMove = {
        x: x,
        y: y,
        player: currentPlayer,
        timestamp: Date.now()
      };
      
      // 使用 RuleEngine 进行胜负判定（与前端 GameCore.executeMove 同逻辑）
      const ruleEngine = new RuleEngine();
      const judgment = ruleEngine.applyMoveAndJudge(newBoard, newMove, game.gameState.config || {});
      
      // 更新 moves
      const newMoves = [...(game.gameState.moves || []), newMove];
      
      // 切换 currentPlayer（如果游戏未结束）
      const nextPlayer = currentPlayer === Player.Black ? Player.White : Player.Black;
      
      // 更新 timeState（重置计时）- 在线模式每次有效落子后重置
      const timeLimitPerMove = (game.gameState.config && game.gameState.config.timeLimitPerMove) || 60;
      const newTimeState = {
        ...(game.gameState.timeState || {}),
        currentStartTs: Date.now(), // 重置计时起点
        currentMoveRemain: timeLimitPerMove // 重置每步计时
      };
      
      // 根据胜负判定结果更新 gameState
      let newGameState;
      let updateData;
      let finished = false;
      
      if (judgment.result !== GameResult.Ongoing) {
        // 游戏结束
        finished = true;
        newGameState = {
          board: newBoard,
          currentPlayer: nextPlayer, // 虽然游戏结束，但保持状态一致性
          moves: newMoves,
          result: judgment.result,
          winner: judgment.winner,
          phase: GamePhase.Ended,
          config: game.gameState.config || {},
          timeState: newTimeState,
          lastMove: newMove,
          winningPositions: judgment.winningPositions || undefined
        };
        
        // 切换 turnOpenid（虽然游戏结束，但保持状态一致性）
        const opponentOpenid = game.turnOpenid === game.blackOpenid 
          ? game.whiteOpenid 
          : game.blackOpenid;
        
        updateData = {
          gameState: newGameState,
          turnOpenid: opponentOpenid,
          result: judgment.result,
          winner: judgment.winner || null,
          endedAt: db.serverDate(),
          stateVersion: _.inc(1),
          updatedAt: db.serverDate()
        };
        
        // 同时更新房间状态为ended
        if (game.roomDocId) {
          await transaction.collection('rooms').doc(game.roomDocId).update({
            data: {
              status: 'ended',
              updatedAt: db.serverDate()
            }
          });
        }
      } else {
        // 游戏继续
        newGameState = {
          board: newBoard,
          currentPlayer: nextPlayer,
          moves: newMoves,
          result: GameResult.Ongoing,
          winner: undefined,
          phase: GamePhase.Playing,
          config: game.gameState.config || {},
          timeState: newTimeState,
          lastMove: newMove,
          winningPositions: undefined
        };
        
        // 切换 turnOpenid 为对手 openid（根据 blackOpenid/whiteOpenid）
        const opponentOpenid = game.turnOpenid === game.blackOpenid 
          ? game.whiteOpenid 
          : game.blackOpenid;
        
        updateData = {
          gameState: newGameState,
          turnOpenid: opponentOpenid,
          stateVersion: _.inc(1),
          updatedAt: db.serverDate()
        };
      }
      
      // 检测 updateData 中是否存在 badKeys
      checkUpdateDataForBadKeys(updateData, 'placeMove');
      
      await gameRef.update({
        data: updateData
      });
      
      return { 
        success: true, 
        data: { 
          gameState: newGameState,
          stateVersion: (game.stateVersion || 0) + 1
        } 
      };
    });
    return res;
  } catch (e) {
    return { success: false, errMsg: e.message || e };
  }
};

// 在线认输
const resignGame = async (event) => {
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
      
      // 校验权限
      if (game.player1.openid !== openid && game.player2.openid !== openid) {
        return { success: false, errMsg: '无权限操作' };
      }
      
      // 校验 games.phase === 'ROLL_DONE'（骰子阶段）
      if (game.phase !== 'ROLL_DONE') {
        return { success: false, errMsg: '请先投骰子决定先手' };
      }
      
      // 校验 gameState 存在且结构完整
      if (!game.gameState) {
        return { success: false, errMsg: '游戏状态不存在，请重新投骰子' };
      }
      if (!Array.isArray(game.gameState.board)) {
        return { success: false, errMsg: '游戏状态异常：board 不是数组' };
      }
      if (!Array.isArray(game.gameState.moves)) {
        return { success: false, errMsg: '游戏状态异常：moves 不是数组' };
      }
      // 校验 gameState.phase === 'PLAYING'（对局阶段）
      if (game.gameState.phase !== 'PLAYING') {
        return { success: false, errMsg: '游戏未在进行中' };
      }
      
      // 确定认输的玩家和获胜者
      const resigningPlayer = game.turnOpenid === game.blackOpenid ? 'BLACK' : 'WHITE';
      const winner = resigningPlayer === 'BLACK' ? 'WHITE' : 'BLACK';
      
      // 更新 gameState
      const newGameState = {
        ...game.gameState,
        result: 'RESIGN',
        winner: winner,
        phase: 'ENDED'
      };
      
      // 更新数据
      // 注意：games.phase 仅用于骰子阶段（ROLL_WAIT/ROLL_AGAIN/ROLL_DONE），终局只写到 games.gameState.phase/result
      // 因此这里不更新 games.phase，保持为 'ROLL_DONE'
      const updateData = {
        gameState: newGameState,
        result: 'RESIGN',
        winner: winner,
        // 不更新 games.phase，保持为 'ROLL_DONE'（骰子阶段已完成）
        endedAt: db.serverDate(),
        stateVersion: _.inc(1),
        updatedAt: db.serverDate()
      };
      
      // 检测 updateData 中是否存在 badKeys
      checkUpdateDataForBadKeys(updateData, 'resignGame');
      
      // 同时更新房间状态为ended
      if (game.roomDocId) {
        await transaction.collection('rooms').doc(game.roomDocId).update({
          data: {
            status: 'ended',
            updatedAt: db.serverDate()
          }
        });
      }
      
      await gameRef.update({
        data: updateData
      });
      
      return { 
        success: true, 
        data: { 
          gameState: newGameState,
          stateVersion: (game.stateVersion || 0) + 1
        } 
      };
    });
    
    // 终局入库（幂等，在事务外调用）
    if (res.success && res.data && res.data.gameState) {
      // 重新获取游戏数据用于 finalizeOnlineGame
      const gameResult = await db.collection('games').doc(gameId).get();
      if (gameResult.data) {
        await finalizeOnlineGame(gameResult.data, res.data.gameState, gameId);
      }
    }
    
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
      
      // 创建新的 gameState 对象，避免直接修改原对象
      const newGameState = {
        ...state,
        currentPlayer: nextPlayer,
        timeState: {
          ...(state.timeState || {}),
          currentMoveRemain: limit,
          currentStartTs: Date.now()
        }
      };
      
      const updateData = {
        gameState: newGameState,
        updatedAt: db.serverDate()
      };
      
      // 检测 updateData 中是否存在 badKeys
      checkUpdateDataForBadKeys(updateData, 'forceSwitchTurn');
      
      await gameRef.update({
        data: updateData
      });
      return { success: true, data: { gameState: newGameState } };
    });
    return res;
  } catch (e) {
    return { success: false, errMsg: e.message || e };
  }
};

// 超时自动换手
const timeoutMove = async (event) => {
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
      
      // 校验 gameState 存在
      if (!game.gameState) {
        return { success: false, errMsg: '游戏状态不存在' };
      }
      
      // 校验 phase === 'PLAYING'
      if (game.gameState.phase !== GamePhase.Playing) {
        return { success: false, errMsg: '游戏未在进行中' };
      }
      
      // 校验 result === 'ONGOING'
      if (game.gameState.result !== GameResult.Ongoing) {
        return { success: false, errMsg: '游戏已结束' };
      }
      
      // 校验超时：Date.now() - gameState.timeState.currentStartTs >= limit*1000
      const limit = (game.gameState.config && game.gameState.config.timeLimitPerMove) || 60;
      const currentStartTs = game.gameState.timeState && game.gameState.timeState.currentStartTs;
      
      if (!currentStartTs) {
        return { success: false, errMsg: '计时状态异常' };
      }
      
      const elapsed = Date.now() - currentStartTs;
      const limitMs = limit * 1000;
      
      if (elapsed < limitMs) {
        return { success: false, errMsg: 'not timeout' };
      }
      
      // 已超时：切换 currentPlayer 与 turnOpenid 到对方
      const nextPlayer = game.gameState.currentPlayer === Player.Black ? Player.White : Player.Black;
      const opponentOpenid = game.turnOpenid === game.blackOpenid 
        ? game.whiteOpenid 
        : game.blackOpenid;
      
      // 重置 timeState
      const newTimeState = {
        ...(game.gameState.timeState || {}),
        currentStartTs: Date.now(),
        currentMoveRemain: limit
      };
      
      // 创建新的 gameState
      const newGameState = {
        ...game.gameState,
        currentPlayer: nextPlayer,
        timeState: newTimeState
      };
      
      // 更新数据
      const updateData = {
        gameState: newGameState,
        turnOpenid: opponentOpenid,
        stateVersion: _.inc(1),
        updatedAt: db.serverDate()
      };
      
      // 检测 updateData 中是否存在 badKeys
      checkUpdateDataForBadKeys(updateData, 'timeoutMove');
      
      await gameRef.update({
        data: updateData
      });
      
      return { 
        success: true, 
        data: { 
          gameState: newGameState,
          newStateVersion: (game.stateVersion || 0) + 1
        } 
      };
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
    case "rematchReady":
      return await rematchReady(event);
    case "resetRoomForNext":
      return await resetRoomForNext(event);
    case "updateGameState":
      return await updateGameState(event);
    case "getGameState":
      return await getGameState(event);
    case "rollDice":
      return await rollDice(event);
    case "placeMove":
      return await placeMove(event);
    case "resignGame":
      return await resignGame(event);
    case "forceSwitchTurn":
      return await forceSwitchTurn(event);
    case "timeoutMove":
      return await timeoutMove(event);
    case "fixPlayer2Null":
      return await fixPlayer2Null();
    default:
      return {
        success: false,
        errMsg: '未知的操作类型'
      };
  }
};
