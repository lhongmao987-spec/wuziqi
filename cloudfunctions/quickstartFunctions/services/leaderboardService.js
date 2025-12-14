const cloud = require("wx-server-sdk");
const db = cloud.database();
const _ = db.command;

// 排行榜上榜门槛（常量）
const LEADERBOARD_MIN_GAMES = 5;

/**
 * 获取排行榜（优化版：使用数据库排序，不拉全榜）
 * 排序规则：
 * 1. score 降序
 * 2. winCount 降序
 * 3. updateTime 升序
 */
const getLeaderboard = async (event) => {
  try {
    const limit = event.limit || 50;
    const skip = event.skip || 0;
    
    // 获取当前用户openid
    const wxContext = cloud.getWXContext();
    const currentUserOpenId = wxContext.OPENID;
    
    // 严格检查 openid 是否有效：必须是字符串且不为空
    const isValidOpenId = currentUserOpenId && 
                          typeof currentUserOpenId === 'string' && 
                          currentUserOpenId.trim() !== '';
    
    // 查询上榜用户（totalGames >= LEADERBOARD_MIN_GAMES）
    // 注意：微信云数据库只支持单字段排序，先按 score 降序查询
    // 然后取足够多的数据在内存中处理同分情况（但限制在合理范围内，如200条）
    const fetchLimit = Math.min(skip + limit + 50, 200); // 多取50条用于处理同分，最多200条
    const result = await db.collection('userStats')
      .where({
        totalGames: _.gte(LEADERBOARD_MIN_GAMES)
      })
      .orderBy('score', 'desc')
      .limit(fetchLimit)
      .get();
    
    // 在内存中进行完整排序（处理同分情况）
    const sortedUsers = result.data.sort((a, b) => {
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
    const paginatedList = sortedUsers.slice(skip, skip + limit);
    
    // 格式化返回数据，确保所有字段都有默认值
    // 先批量获取所有用户的头像信息（从 users 表）
    const openids = paginatedList.map(item => item._openid).filter(id => id);
    let userAvatars = {}; // openid -> avatarUrl 映射
    let userAvatarFileIds = {}; // openid -> avatarFileId 映射
    if (openids.length > 0) {
      try {
        // 批量查询用户信息获取头像（最多50条）
        const userResults = await db.collection('users')
          .where({
            _openid: _.in(openids)
          })
          .field({
            _openid: true,
            nickName: true,
            avatarUrl: true,
            avatarFileId: true
          })
          .get();
        
        // 构建 openid -> avatarUrl/avatarFileId 映射
        userResults.data.forEach(user => {
          if (user._openid) {
            // 优先使用 avatarFileId，其次使用 avatarUrl
            if (user.avatarFileId) {
              userAvatarFileIds[user._openid] = user.avatarFileId;
            } else if (user.avatarUrl) {
              // 过滤掉临时路径
              const avatarUrl = user.avatarUrl;
              if (!avatarUrl.includes('127.0.0.1') && 
                  !avatarUrl.includes('__tmp__') && 
                  !avatarUrl.startsWith('wxfile://') &&
                  !avatarUrl.startsWith('http://localhost') &&
                  (avatarUrl.startsWith('https://') || !avatarUrl.startsWith('http://'))) {
                userAvatars[user._openid] = avatarUrl;
              }
            }
          }
        });
      } catch (e) {
        console.error('批量获取用户头像失败:', e);
        // 如果批量查询失败，不影响主流程
      }
    }
    
    // 批量转换 fileID 为 https URL
    const fileIdsToConvert = Object.values(userAvatarFileIds).filter(id => id);
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
        console.error('批量转换 fileID 失败:', e);
        // 转换失败，不影响主流程
      }
    }
    
    const rankList = paginatedList.map((item, index) => {
      // 计算胜率（确保不会出现NaN或Infinity）
      const totalGames = item.totalGames || 0;
      const winCount = item.winCount || 0;
      const winRate = totalGames > 0 ? winCount / totalGames : 0;
      
      // 确保score存在，如果不存在则计算
      let score = item.score;
      if (score === undefined || score === null) {
        // 如果score不存在，需要计算（但这种情况不应该发生）
        const logPart = totalGames >= 1 ? Math.log(totalGames) * 20 : 0;
        score = winRate * 100 + logPart;
      }
      
      // 获取头像URL：优先使用 fileID 转换的 URL，其次使用 users 表的 avatarUrl，最后使用 userStats 的 avatarUrl
      let avatarUrl = '';
      if (item._openid) {
        // 优先使用 fileID 转换的 URL
        if (userAvatarFileIds[item._openid] && fileIdToUrlMap[userAvatarFileIds[item._openid]]) {
          avatarUrl = fileIdToUrlMap[userAvatarFileIds[item._openid]];
        } else if (userAvatars[item._openid]) {
          avatarUrl = userAvatars[item._openid];
        } else if (item.avatarUrl) {
          // 使用 userStats 的头像，但需要过滤临时路径
          const statsAvatarUrl = item.avatarUrl;
          if (!statsAvatarUrl.includes('127.0.0.1') && 
              !statsAvatarUrl.includes('__tmp__') && 
              !statsAvatarUrl.startsWith('wxfile://') &&
              !statsAvatarUrl.startsWith('http://localhost') &&
              (statsAvatarUrl.startsWith('https://') || !statsAvatarUrl.startsWith('http://'))) {
            avatarUrl = statsAvatarUrl;
          }
        }
      }
      
      // 确保头像URL是有效的 https 链接（微信小程序要求）
      // 如果是 http:// 或空字符串，返回空字符串（前端会使用默认头像）
      if (avatarUrl && !avatarUrl.startsWith('https://') && !avatarUrl.startsWith('http://')) {
        // 如果是相对路径或本地路径，也返回空字符串
        avatarUrl = '';
      }
      
      return {
        rank: skip + index + 1, // 实际排名（考虑分页）
        nickName: item.nickName || '未命名',
        avatarUrl: avatarUrl, // 可能为空字符串，前端会使用默认头像
        openid: item._openid || '',
        winCount: winCount || 0,
        loseCount: item.loseCount || 0,
        totalGames: totalGames || 0,
        maxStreak: item.maxStreak || 0,
        winRate: Math.round(winRate * 100) / 100, // 保留2位小数（0-1之间）
        score: score || 0
      };
    });
    
    // 计算当前用户排名和信息
    let currentUserInfo = null;
    // 检查是否已登录：openid 必须有效
    if (isValidOpenId) {
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
        
        // 从 users 表获取用户信息（头像和昵称）
        let userNickName = userStats.nickName || '未命名';
        let userAvatarUrl = userStats.avatarUrl || '';
        let userAvatarFileId = null;
        try {
          const userResult = await db.collection('users').where({
            _openid: currentUserOpenId
          }).get();
          if (userResult.data.length > 0) {
            const userInfo = userResult.data[0];
            if (userInfo.nickName) userNickName = userInfo.nickName;
            // 优先使用 avatarFileId
            if (userInfo.avatarFileId) {
              userAvatarFileId = userInfo.avatarFileId;
              // 转换为 https URL
              try {
                const tempFileURLResult = await cloud.getTempFileURL({
                  fileList: [userInfo.avatarFileId]
                });
                if (tempFileURLResult.fileList && tempFileURLResult.fileList.length > 0) {
                  userAvatarUrl = tempFileURLResult.fileList[0].tempFileURL;
                }
              } catch (e) {
                console.error('转换当前用户 fileID 失败:', e);
                userAvatarUrl = '';
              }
            } else if (userInfo.avatarUrl) {
              // 使用 avatarUrl，但需要过滤临时路径
              const avatarUrl = userInfo.avatarUrl;
              if (!avatarUrl.includes('127.0.0.1') && 
                  !avatarUrl.includes('__tmp__') && 
                  !avatarUrl.startsWith('wxfile://') &&
                  !avatarUrl.startsWith('http://localhost') &&
                  (avatarUrl.startsWith('https://') || !avatarUrl.startsWith('http://'))) {
                userAvatarUrl = avatarUrl;
              } else {
                userAvatarUrl = '';
              }
            }
          }
        } catch (e) {
          console.error('获取用户信息失败:', e);
          // 如果查询失败，使用 userStats 中的值
        }
        
        if (userTotalGames >= LEADERBOARD_MIN_GAMES) {
          // 用户已上榜，计算排名（不拉全榜）
          // 使用数据库查询计算排名
          const aheadCount = await calculateUserRank(userScore, userWinCount, userUpdateTime);
          const myRank = aheadCount + 1;
          
          currentUserInfo = {
            rank: myRank,
            notRanked: false,
            stats: {
              openid: currentUserOpenId || '',
              nickName: userNickName,
              avatarUrl: userAvatarUrl,
              winCount: userStats.winCount || 0,
              loseCount: userStats.loseCount || 0,
              totalGames: userTotalGames || 0,
              maxStreak: userStats.maxStreak || 0,
              winRate: Math.round(userWinRate * 100) / 100,
              score: userScore || 0
            }
          };
        } else {
          // 用户未上榜
          const needGames = LEADERBOARD_MIN_GAMES - userTotalGames;
          currentUserInfo = {
            notRanked: true,
            needGames: needGames,
            stats: {
              openid: currentUserOpenId || '',
              nickName: userNickName,
              avatarUrl: userAvatarUrl,
              winCount: userStats.winCount || 0,
              loseCount: userStats.loseCount || 0,
              totalGames: userTotalGames || 0,
              maxStreak: userStats.maxStreak || 0,
              winRate: Math.round(userWinRate * 100) / 100,
              score: userScore || 0
            }
          };
        }
      } else {
        // 用户没有战绩记录（但已登录），从 users 表获取信息
        let userNickName = '未命名';
        let userAvatarUrl = '';
        try {
          const userResult = await db.collection('users').where({
            _openid: currentUserOpenId
          }).get();
          if (userResult.data.length > 0) {
            const userInfo = userResult.data[0];
            if (userInfo.nickName) userNickName = userInfo.nickName;
            if (userInfo.avatarUrl) userAvatarUrl = userInfo.avatarUrl;
          }
        } catch (e) {
          console.error('获取用户信息失败:', e);
        }
        
        currentUserInfo = {
          notRanked: true,
          needGames: LEADERBOARD_MIN_GAMES,
          stats: {
            openid: currentUserOpenId || '',
            nickName: userNickName,
            avatarUrl: userAvatarUrl,
            winCount: 0,
            loseCount: 0,
            totalGames: 0,
            maxStreak: 0,
            winRate: 0,
            score: 0
          }
        };
      }
    } else {
      // 未登录：openid 不存在或为空
      currentUserInfo = {
        notLogin: true
      };
    }
    
    // 获取总上榜人数（用于分页）
    const countResult = await db.collection('userStats')
      .where({
        totalGames: _.gte(LEADERBOARD_MIN_GAMES)
      })
      .count();
    const total = countResult.total || 0;
    
    return {
      success: true,
      data: {
        list: rankList,
        total: total,
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

/**
 * 计算用户排名（不拉全榜）
 * 返回：排名比当前用户高的用户数量
 * 
 * 排序规则：
 * 1. score 降序
 * 2. winCount 降序
 * 3. updateTime 升序（更早的在前）
 */
const calculateUserRank = async (myScore, myWinCount, myUpdateTime) => {
  try {
    // 微信云数据库不支持复杂的OR查询，需要分步计算
    
    // 1. count(score > myScore) - 分数更高的用户
    const higherScoreCount = await db.collection('userStats')
      .where({
        totalGames: _.gte(LEADERBOARD_MIN_GAMES),
        score: _.gt(myScore)
      })
      .count();
    
    // 2. count(score == myScore && winCount > myWinCount) - 同分但胜场更多的用户
    const sameScoreHigherWinCount = await db.collection('userStats')
      .where({
        totalGames: _.gte(LEADERBOARD_MIN_GAMES),
        score: myScore,
        winCount: _.gt(myWinCount)
      })
      .count();
    
    // 3. count(score == myScore && winCount == myWinCount && updateTime < myUpdateTime)
    // 注意：updateTime是Date类型，微信云数据库不支持直接比较Date
    // 我们需要查询符合条件的记录，然后在内存中过滤
    // 为了性能，限制查询数量（最多200条）
    const sameScoreSameWinCount = await db.collection('userStats')
      .where({
        totalGames: _.gte(LEADERBOARD_MIN_GAMES),
        score: myScore,
        winCount: myWinCount
      })
      .limit(200)
      .get();
    
    // 在内存中过滤 updateTime < myUpdateTime 的记录
    let earlierTimeCount = 0;
    for (const item of sameScoreSameWinCount.data) {
      const itemUpdateTime = item.updateTime ? new Date(item.updateTime).getTime() : 0;
      if (itemUpdateTime > 0 && itemUpdateTime < myUpdateTime) {
        earlierTimeCount++;
      }
    }
    
    // 总排名 = 更高score + 同score更高winCount + 同score同winCount更早updateTime
    const aheadCount = (higherScoreCount.total || 0) + (sameScoreHigherWinCount.total || 0) + earlierTimeCount;
    return aheadCount;
  } catch (e) {
    console.error('计算用户排名失败:', e);
    // 如果计算失败，返回0（表示排名第1，虽然不准确，但不会导致错误）
    return 0;
  }
};

module.exports = {
  getLeaderboard,
  LEADERBOARD_MIN_GAMES
};

