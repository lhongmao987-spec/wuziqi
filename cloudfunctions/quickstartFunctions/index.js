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

// 获取小程序二维码
const getMiniProgramCode = async () => {
  // 获取小程序二维码的buffer
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  // 将图片上传云存储空间
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建集合
const createCollection = async () => {
  try {
    // 创建集合
    await db.createCollection("sales");
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "上海",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "南京",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "广州",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "深圳",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    // 这里catch到的是该collection已经存在，从业务逻辑上来说是运行成功的，所以catch返回success给前端，避免工具在前端抛出异常
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 查询数据
const selectRecord = async () => {
  // 返回数据库查询结果
  return await db.collection("sales").get();
};

// 更新数据
const updateRecord = async (event) => {
  try {
    // 遍历修改数据库信息
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({
          _id: event.data[i]._id,
        })
        .update({
          data: {
            sales: event.data[i].sales,
          },
        });
    }
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 新增数据
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    // 插入数据
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 删除数据
const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({
        _id: event.data._id,
      })
      .remove();
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
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
    
    // 查询最近对局记录
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

// 上报对局结果
const reportResult = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const gameData = event.data;
    
    // 获取用户信息（用于记录昵称和头像）
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    const userInfo = userResult.data.length > 0 ? userResult.data[0] : null;
    
    // 1. 保存对局记录到 gameRecords
    const gameRecord = {
      playerOpenId: openid,
      opponentType: gameData.opponentType || 'AI', // AI / 好友 / 本机
      opponentName: gameData.opponentName || 'AI',
      opponentOpenId: gameData.opponentOpenId || '',
      result: gameData.result || '负', // 胜 / 负 / 和
      moves: gameData.moves || 0,
      duration: gameData.duration || 0, // 对局时长（秒）
      difficulty: gameData.difficulty || '', // AI难度
      gameMode: gameData.gameMode || 'PVE', // PVE / PVP_LOCAL / PVP_ONLINE
      createTime: new Date()
    };
    
    await db.collection('gameRecords').add({
      data: gameRecord
    });
    
    // 2. 更新或创建用户战绩
    const statsResult = await db.collection('userStats').where({
      _openid: openid
    }).get();
    
    const isWin = gameData.result === '胜';
    const isLose = gameData.result === '负';
    const isDraw = gameData.result === '和';
    
    if (statsResult.data.length > 0) {
      // 更新现有战绩
      const oldStats = statsResult.data[0];
      const newTotalGames = (oldStats.totalGames || 0) + 1;
      const newWinCount = (oldStats.winCount || 0) + (isWin ? 1 : 0);
      const newLoseCount = (oldStats.loseCount || 0) + (isLose ? 1 : 0);
      const newDrawCount = (oldStats.drawCount || 0) + (isDraw ? 1 : 0);
      
      // 计算连胜
      let newCurrentStreak = oldStats.currentStreak || 0;
      if (isWin) {
        newCurrentStreak = (oldStats.currentStreak || 0) + 1;
      } else if (isLose || isDraw) {
        newCurrentStreak = 0;
      }
      const newMaxStreak = Math.max(oldStats.maxStreak || 0, newCurrentStreak);
      
      // 更新常用难度（如果是对战AI）
      let favoriteDifficulty = oldStats.favoriteDifficulty || '中级';
      if (gameData.difficulty && gameData.opponentType === 'AI') {
        favoriteDifficulty = gameData.difficulty;
      }
      
      // 计算积分（简单规则：胜+10，负-5，和+2）
      const newScore = (oldStats.score || 0) + (isWin ? 10 : isLose ? -5 : 2);
      
      await db.collection('userStats').where({
        _openid: openid
      }).update({
        data: {
          totalGames: newTotalGames,
          winCount: newWinCount,
          loseCount: newLoseCount,
          drawCount: newDrawCount,
          currentStreak: newCurrentStreak,
          maxStreak: newMaxStreak,
          favoriteDifficulty: favoriteDifficulty,
          score: Math.max(0, newScore), // 积分不能为负
          updateTime: new Date()
        }
      });
    } else {
      // 创建新战绩记录
      const newStats = {
        _openid: openid,
        nickName: userInfo ? (userInfo.nickName || '') : '',
        avatarUrl: userInfo ? (userInfo.avatarUrl || '') : '',
        totalGames: 1,
        winCount: isWin ? 1 : 0,
        loseCount: isLose ? 1 : 0,
        drawCount: isDraw ? 1 : 0,
        currentStreak: isWin ? 1 : 0,
        maxStreak: isWin ? 1 : 0,
        favoriteDifficulty: gameData.difficulty || '中级',
        score: isWin ? 10 : isLose ? 0 : 2,
        createTime: new Date(),
        updateTime: new Date()
      };
      
      await db.collection('userStats').add({
        data: newStats
      });
    }
    
    return {
      success: true,
      data: '战绩已更新'
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
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
    
    const nickName = userInfo.nickName || (userResult.data.length > 0 ? userResult.data[0].nickName : '玩家');
    const avatarUrl = userInfo.avatarUrl || (userResult.data.length > 0 ? userResult.data[0].avatarUrl : '');
    
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
    
    // 获取用户信息
    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();
    
    const nickName = userInfo.nickName || (userResult.data.length > 0 ? userResult.data[0].nickName : '玩家');
    const avatarUrl = userInfo.avatarUrl || (userResult.data.length > 0 ? userResult.data[0].avatarUrl : '');
    
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
    if (gameResult.data.length === 0) {
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
    
    if (gameResult.data.length === 0) {
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

// 获取排行榜
const getRankList = async (event) => {
  try {
    const type = event.rankType || event.type || 'GLOBAL'; // GLOBAL / FRIEND
    const period = event.period || 'ALL'; // ALL / WEEK / MONTH
    const limit = event.limit || 100;
    
    let query = db.collection('userStats');
    
    // 根据时间筛选（如果需要）
    if (period === 'WEEK' || period === 'MONTH') {
      const now = new Date();
      const startDate = new Date();
      if (period === 'WEEK') {
        startDate.setDate(now.getDate() - 7);
      } else if (period === 'MONTH') {
        startDate.setMonth(now.getMonth() - 1);
      }
      // 注意：这里需要根据updateTime筛选，但userStats可能没有按时间筛选的需求
      // 如果需要按时间筛选，应该筛选gameRecords然后聚合
    }
    
    // 如果是好友榜，需要获取用户的好友列表（这里简化处理，暂时返回全服榜）
    // 实际实现中，可以通过云函数获取用户的好友关系
    
    // 按积分降序排列
    const result = await query
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    // 格式化数据
    const rankList = result.data.map((item, index) => ({
      rank: index + 1,
      name: item.nickName || '未命名',
      avatarUrl: item.avatarUrl || '',
      wins: item.winCount || 0,
      streak: item.maxStreak || 0,
      totalGames: item.totalGames || 0,
      winRate: item.totalGames > 0 ? Math.round((item.winCount || 0) / item.totalGames * 100) : 0,
      score: item.score || 0
    }));
    
    return {
      success: true,
      data: rankList
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e
    };
  }
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
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
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
