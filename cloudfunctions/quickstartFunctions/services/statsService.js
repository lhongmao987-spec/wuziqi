const cloud = require("wx-server-sdk");
const db = cloud.database();
const _ = db.command;

/**
 * 计算评分公式：score = winRate * 100 + ln(totalGames) * 20
 */
const calculateScore = (winCount, totalGames) => {
  if (totalGames < 1) {
    return 0;
  }
  const winRate = winCount / totalGames;
  const logPart = totalGames >= 1 ? Math.log(totalGames) * 20 : 0;
  return winRate * 100 + logPart;
};

/**
 * 使用事务更新用户战绩，保证并发正确性
 * 重点：currentStreak 和 maxStreak 必须正确
 */
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
    // 注意：这里只同步 users 表，不处理 avatarFileId（应该在 saveUserInfo 中处理）
    if (nickName || avatarUrl) {
      const updateData = {};
      if (nickName) updateData.nickName = nickName;
      if (avatarUrl) {
        // 过滤掉临时路径
        const avatarUrlToSave = avatarUrl;
        if (!avatarUrlToSave.includes('127.0.0.1') && 
            !avatarUrlToSave.includes('__tmp__') && 
            !avatarUrlToSave.startsWith('wxfile://') &&
            !avatarUrlToSave.startsWith('http://localhost') &&
            (avatarUrlToSave.startsWith('https://') || !avatarUrlToSave.startsWith('http://'))) {
          updateData.avatarUrl = avatarUrlToSave;
        }
      }
      updateData.updateTime = new Date();
      await db.collection('users').where({ _openid: openid }).update({ data: updateData });
      if (userInfo) {
        Object.assign(userInfo, updateData);
      }
    }
    
    // 使用事务保证并发正确性
    const transaction = await db.startTransaction();
    
    try {
      // 在事务中查询现有战绩
      const statsResult = await transaction.collection('userStats').where({
        _openid: openid
      }).get();
      
      const now = new Date();
      let finalStats = null;
      
      if (statsResult.data.length > 0) {
        // 更新现有战绩（读-算-写一致）
        const oldStats = statsResult.data[0];
        
        // 读取当前值
        const oldTotalGames = oldStats.totalGames || 0;
        const oldWinCount = oldStats.winCount || 0;
        const oldLoseCount = oldStats.loseCount || 0;
        const oldDrawCount = oldStats.drawCount || 0;
        const oldCurrentStreak = oldStats.currentStreak || 0;
        const oldMaxStreak = oldStats.maxStreak || 0;
        
        // 计算新值
        const newTotalGames = oldTotalGames + 1;
        let newWinCount = oldWinCount;
        let newLoseCount = oldLoseCount;
        let newDrawCount = oldDrawCount;
        let newCurrentStreak = 0;
        let newMaxStreak = oldMaxStreak;
        
        if (result === 'win') {
          newWinCount = oldWinCount + 1;
          newCurrentStreak = oldCurrentStreak + 1;
          // maxStreak = max(oldMaxStreak, newCurrentStreak)
          newMaxStreak = Math.max(oldMaxStreak, newCurrentStreak);
        } else if (result === 'lose') {
          newLoseCount = oldLoseCount + 1;
          newCurrentStreak = 0;
          // maxStreak 保持不变
        } else if (result === 'draw') {
          newDrawCount = oldDrawCount + 1;
          newCurrentStreak = 0;
          // maxStreak 保持不变
        }
        
        // 计算胜率和评分
        const winRate = newTotalGames > 0 ? newWinCount / newTotalGames : 0;
        const newScore = calculateScore(newWinCount, newTotalGames);
        
        // 在事务中更新
        const updateData = {
          totalGames: newTotalGames,
          winCount: newWinCount,
          loseCount: newLoseCount,
          drawCount: newDrawCount,
          currentStreak: newCurrentStreak,
          maxStreak: newMaxStreak,
          winRate: winRate,
          score: newScore,
          updateTime: now
        };
        
        // 同步昵称和头像
        if (userInfo) {
          if (userInfo.nickName) updateData.nickName = userInfo.nickName;
          if (userInfo.avatarUrl) updateData.avatarUrl = userInfo.avatarUrl;
        }
        
        await transaction.collection('userStats').where({
          _openid: openid
        }).update({ data: updateData });
        
        // 构建返回数据
        finalStats = {
          _openid: openid,
          ...oldStats,
          ...updateData
        };
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
        
        await transaction.collection('userStats').add({ data: newStats });
        finalStats = newStats;
      }
      
      // 提交事务
      await transaction.commit();
      
      return {
        success: true,
        data: {
          stats: finalStats,
          message: '战绩已更新'
        }
      };
    } catch (error) {
      // 回滚事务
      await transaction.rollback();
      throw error;
    }
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e.toString()
    };
  }
};

module.exports = {
  calculateScore,
  updateUserStatsAfterGame
};

