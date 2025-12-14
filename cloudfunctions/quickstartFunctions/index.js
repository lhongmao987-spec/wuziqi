const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
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
    
    // 更新用户信息
    const updateResult = await db.collection('users').where({
      _openid: openid
    }).update({
      data: {
        nickName: userInfo.nickName || '',
        avatarUrl: userInfo.avatarUrl || '',
        updateTime: new Date()
      }
    });
    
    if (updateResult.stats.updated === 0) {
      // 如果更新失败，可能是用户不存在，创建新记录
      const now = new Date();
      await db.collection('users').add({
        data: {
          _openid: openid,
          nickName: userInfo.nickName || '',
          avatarUrl: userInfo.avatarUrl || '',
          createTime: now,
          updateTime: now
        }
      });
    }
    
    // 获取更新后的用户信息
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    return {
      success: true,
      data: userResult.data[0] || null
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
      return {
        success: true,
        data: userResult.data[0]
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

// 计算评分公式：score = winRate * 100 + ln(totalGames) * 20
const calculateScore = (winCount, totalGames) => {
  if (totalGames < 1) {
    return 0;
  }
  const winRate = winCount / totalGames;
  const logPart = totalGames >= 1 ? Math.log(totalGames) * 20 : 0;
  return winRate * 100 + logPart;
};

// 更新用户战绩（对局结束时调用）
// 支持原子更新，避免并发问题
const updateUserStatsAfterGame = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const { result, nickName, avatarUrl, gameMode, opponentType } = event.data || {};
    
    // 参数校验
    if (!result || !['win', 'lose', 'draw'].includes(result)) {
      return {
        success: false,
        errMsg: '参数错误：result 必须是 win/lose/draw'
      };
    }
    
    // 获取或创建用户信息
    let userInfo = null;
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userResult.data.length > 0) {
      userInfo = userResult.data[0];
    } else {
      // 如果用户不存在，创建基础记录
      const now = new Date();
      const newUser = {
        _openid: openid,
        nickName: nickName || '',
        avatarUrl: avatarUrl || '',
        createTime: now,
        updateTime: now
      };
      const addResult = await db.collection('users').add({ data: newUser });
      userInfo = { _id: addResult._id, ...newUser };
    }
    
    // 同步昵称和头像（如果传入）
    if (nickName || avatarUrl) {
      const updateData = {};
      if (nickName) updateData.nickName = nickName;
      if (avatarUrl) updateData.avatarUrl = avatarUrl;
      updateData.updateTime = new Date();
      await db.collection('users').where({ _openid: openid }).update({ data: updateData });
      if (userInfo) {
        Object.assign(userInfo, updateData);
      }
    }
    
    // 查询现有战绩
    const statsResult = await db.collection('userStats').where({
      _openid: openid
    }).get();
    
    const now = new Date();
    let finalStats = null;
    
    if (statsResult.data.length > 0) {
      // 更新现有战绩（使用原子操作）
      const oldStats = statsResult.data[0];
      
      // 使用数据库原子自增操作
      const updateData = {
        totalGames: db.command.inc(1),
        updateTime: now
      };
      
      if (result === 'win') {
        updateData.winCount = db.command.inc(1);
        updateData.currentStreak = db.command.inc(1);
        // maxStreak 需要特殊处理，因为要取 max(oldMaxStreak, newCurrentStreak)
        // 这里先自增，然后在事务外再处理 maxStreak
      } else if (result === 'lose') {
        updateData.loseCount = db.command.inc(1);
        updateData.currentStreak = 0;
      } else if (result === 'draw') {
        updateData.drawCount = db.command.inc(1);
        updateData.currentStreak = 0;
      }
      
      // 同步昵称和头像
      if (userInfo) {
        if (userInfo.nickName) updateData.nickName = userInfo.nickName;
        if (userInfo.avatarUrl) updateData.avatarUrl = userInfo.avatarUrl;
      }
      
      // 执行原子更新
      await db.collection('userStats').where({
        _openid: openid
      }).update({ data: updateData });
      
      // 重新查询获取最新数据，用于计算 score 和 maxStreak
      const updatedResult = await db.collection('userStats').where({
        _openid: openid
      }).get();
      
      if (updatedResult.data.length > 0) {
        const newStats = updatedResult.data[0];
        const newTotalGames = newStats.totalGames || 0;
        const newWinCount = newStats.winCount || 0;
        const newCurrentStreak = newStats.currentStreak || 0;
        
        // 处理 maxStreak（如果是胜利，需要比较）
        let newMaxStreak = newStats.maxStreak || 0;
        if (result === 'win') {
          newMaxStreak = Math.max(newMaxStreak, newCurrentStreak);
        }
        
        // 计算胜率
        const winRate = newTotalGames > 0 ? newWinCount / newTotalGames : 0;
        
        // 计算新评分
        const newScore = calculateScore(newWinCount, newTotalGames);
        
        // 更新 score、maxStreak、winRate
        await db.collection('userStats').where({
          _openid: openid
        }).update({
          data: {
            maxStreak: newMaxStreak,
            score: newScore,
            winRate: winRate
          }
        });
        
        // 返回最终数据
        finalStats = {
          ...newStats,
          maxStreak: newMaxStreak,
          score: newScore,
          winRate: winRate
        };
      }
    } else {
      // 创建新战绩记录
      const newTotalGames = 1;
      const newWinCount = result === 'win' ? 1 : 0;
      const newLoseCount = result === 'lose' ? 1 : 0;
      const newDrawCount = result === 'draw' ? 1 : 0;
      const newCurrentStreak = result === 'win' ? 1 : 0;
      const newMaxStreak = result === 'win' ? 1 : 0;
      const winRate = result === 'win' ? 1 : 0;
      const newScore = calculateScore(newWinCount, newTotalGames);
      
      const newStats = {
        _openid: openid,
        nickName: userInfo ? (userInfo.nickName || '') : '',
        avatarUrl: userInfo ? (userInfo.avatarUrl || '') : '',
        totalGames: newTotalGames,
        winCount: newWinCount,
        loseCount: newLoseCount,
        drawCount: newDrawCount,
        currentStreak: newCurrentStreak,
        maxStreak: newMaxStreak,
        winRate: winRate,
        score: newScore,
        createTime: now,
        updateTime: now
      };
      
      await db.collection('userStats').add({ data: newStats });
      finalStats = newStats;
    }
    
    return {
      success: true,
      data: {
        stats: finalStats,
        message: '战绩已更新'
      }
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e.toString()
    };
  }
};

// 上报对局结果（兼容旧接口，内部调用 updateUserStatsAfterGame）
const reportResult = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const gameData = event.data;
    
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
    
    // 1. 保存对局记录到 gameRecords
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

// 排行榜上榜门槛（常量）
const LEADERBOARD_MIN_GAMES = 5;

// 获取排行榜（新版本，支持完整排序和排名计算）
const getLeaderboard = async (event) => {
  try {
    const limit = event.limit || 50;
    const skip = event.skip || 0;
    
    // 获取当前用户openid
    const wxContext = cloud.getWXContext();
    const currentUserOpenId = wxContext.OPENID;
    
    // 查询上榜用户（totalGames >= LEADERBOARD_MIN_GAMES）
    // 注意：微信云数据库不支持多字段排序，只能按一个字段排序
    // 先按 score 降序查询，然后在内存中处理同分情况
    const result = await db.collection('userStats')
      .where({
        totalGames: db.command.gte(LEADERBOARD_MIN_GAMES)
      })
      .orderBy('score', 'desc')
      .limit(1000) // 先取足够多的数据，在内存中排序
      .get();
    
    // 在内存中进行完整排序（处理同分情况）
    const allRankedUsers = result.data.sort((a, b) => {
      // 1. 按 score 降序
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // 2. score 相同，按 winCount 降序
      if (b.winCount !== a.winCount) {
        return b.winCount - a.winCount;
      }
      // 3. score 和 winCount 都相同，按 updateTime 升序（更早的在前）
      const timeA = a.updateTime ? new Date(a.updateTime).getTime() : 0;
      const timeB = b.updateTime ? new Date(b.updateTime).getTime() : 0;
      return timeA - timeB;
    });
    
    // 分页处理
    const paginatedList = allRankedUsers.slice(skip, skip + limit);
    
    // 格式化返回数据，确保所有字段都有默认值
    const rankList = paginatedList.map((item, index) => {
      // 计算胜率（确保不会出现NaN或Infinity）
      const totalGames = item.totalGames || 0;
      const winCount = item.winCount || 0;
      const winRate = totalGames > 0 ? winCount / totalGames : 0;
      
      // 确保score存在，如果不存在则计算
      let score = item.score;
      if (score === undefined || score === null) {
        score = calculateScore(winCount, totalGames);
      }
      
      return {
        rank: skip + index + 1, // 实际排名（考虑分页）
        nickName: item.nickName || '未命名',
        avatarUrl: item.avatarUrl || '',
        openid: item._openid || '',
        winCount: winCount,
        loseCount: item.loseCount || 0,
        totalGames: totalGames,
        maxStreak: item.maxStreak || 0,
        winRate: Math.round(winRate * 100) / 100, // 保留2位小数（0-1之间）
        score: score
      };
    });
    
    // 计算当前用户排名和信息
    let currentUserInfo = null;
    if (currentUserOpenId) {
      // 查询当前用户战绩
      const userStatsResult = await db.collection('userStats').where({
        _openid: currentUserOpenId
      }).get();
      
      if (userStatsResult.data.length > 0) {
        const userStats = userStatsResult.data[0];
        const userTotalGames = userStats.totalGames || 0;
        const userScore = userStats.score || 0;
        const userWinCount = userStats.winCount || 0;
        const userUpdateTime = userStats.updateTime ? new Date(userStats.updateTime).getTime() : 0;
        
        // 计算胜率
        const userWinRate = userTotalGames > 0 ? (userWinCount || 0) / userTotalGames : 0;
        
        if (userTotalGames >= LEADERBOARD_MIN_GAMES) {
          // 用户已上榜，计算排名
          // 统计比当前用户排名高的用户数量
          let rank = 1;
          for (const user of allRankedUsers) {
            // 如果找到当前用户，停止计数
            if (user._openid === currentUserOpenId) {
              break;
            }
            
            const otherScore = user.score || 0;
            const otherWinCount = user.winCount || 0;
            const otherUpdateTime = user.updateTime ? new Date(user.updateTime).getTime() : 0;
            
            // 判断是否排名更高（按排序规则）
            if (otherScore > userScore) {
              rank++;
            } else if (otherScore === userScore) {
              if (otherWinCount > userWinCount) {
                rank++;
              } else if (otherWinCount === userWinCount) {
                if (otherUpdateTime < userUpdateTime) {
                  rank++;
                }
              }
            }
          }
          
          currentUserInfo = {
            rank: rank,
            notRanked: false,
            stats: {
              openid: currentUserOpenId, // 添加openid用于前端判断
              nickName: userStats.nickName || '未命名',
              avatarUrl: userStats.avatarUrl || '',
              winCount: userStats.winCount || 0,
              loseCount: userStats.loseCount || 0,
              totalGames: userTotalGames,
              maxStreak: userStats.maxStreak || 0,
              winRate: Math.round(userWinRate * 100) / 100, // 保持小数格式，前端会转换
              score: userScore
            }
          };
        } else {
          // 用户未上榜
          const needGames = LEADERBOARD_MIN_GAMES - userTotalGames;
          currentUserInfo = {
            notRanked: true,
            needGames: needGames,
            stats: {
              openid: currentUserOpenId, // 添加openid用于前端判断
              nickName: userStats.nickName || '未命名',
              avatarUrl: userStats.avatarUrl || '',
              winCount: userStats.winCount || 0,
              loseCount: userStats.loseCount || 0,
              totalGames: userTotalGames,
              maxStreak: userStats.maxStreak || 0,
              winRate: Math.round(userWinRate * 100) / 100, // 保持小数格式，前端会转换
              score: userScore
            }
          };
        }
      } else {
        // 用户没有战绩记录
        currentUserInfo = {
          notRanked: true,
          needGames: LEADERBOARD_MIN_GAMES,
          stats: null
        };
      }
    }
    
    return {
      success: true,
      data: {
        list: rankList,
        total: allRankedUsers.length,
        currentUser: currentUserInfo
      }
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e.toString()
    };
  }
};

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
