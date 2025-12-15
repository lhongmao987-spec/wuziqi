const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

module.exports = async function fixPlayer2Null() {
  const roomsCol = db.collection('rooms');
  const PAGE_SIZE = 100;

  let fixed = 0;
  let skip = 0;

  try {
    while (true) {
      const res = await roomsCol.limit(PAGE_SIZE).skip(skip).get();
      const list = res.data || [];
      if (list.length === 0) break;

      for (const room of list) {
        const p2 = room.player2;

        // 判断是否需要修复：
        // 1) null / undefined / 字段缺失
        // 2) 不是对象（数组/字符串/数字）
        // 3) 是对象但没有 openid 字段（或 openid 不是字符串）
        const needFix =
          p2 == null ||
          typeof p2 !== 'object' ||
          Array.isArray(p2) ||
          (typeof p2 === 'object' && (!('openid' in p2)));

        if (!needFix) continue;

        // 用 set + merge:true 强制把 player2 覆盖成对象
        await roomsCol.doc(room._id).set({
          data: {
            player2: { openid: '', nickName: '', avatarUrl: '' },
            updatedAt: db.serverDate()
          },
          merge: true
        });

        fixed++;
      }

      skip += list.length;
      if (list.length < PAGE_SIZE) break;
    }

    return { success: true, fixed };
  } catch (e) {
    return { success: false, errMsg: e.message || String(e), fixed };
  }
};
