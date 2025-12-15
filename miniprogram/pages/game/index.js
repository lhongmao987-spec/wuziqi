const { GameCore } = require('../../core/gameCore');
const { Player, GameMode, GamePhase, GameResult } = require('../../core/types');

const core = new GameCore();
const db = wx.cloud.database();

// 根据游戏模式获取存储键
function getStorageKey(mode) {
  return mode === GameMode.PVE ? 'currentGameState_PVE' : 'currentGameState_PVP_LOCAL';
}

Page({
  data: {
    board: [],
    gridCount: 15,
    boardSizePx: 320,
    lastMove: null,
    prevLastMove: null, // 用于检测 AI 落子
    currentPlayer: Player.Black,
    players: Player,
    modeLabel: '人机对战 - 中级',
    opponentLabel: 'AI 对手',
    timerDisplay: '∞',
    enableHighlight: true,
    enableSound: true,
    isProcessingMove: false, // 标记是否正在处理落子，防止快速连续点击
    gameStartTime: null, // 对局开始时间戳
    dedupeKey: '', // 去重键，用于战绩上报幂等性
    // 在线对战上下文字段
    gameId: '',
    roomDocId: '',
    isCreator: false,
    myColor: Player.Black,
    isOnline: false,
    roll: {},
    showRollOverlay: false,
    rollMe: null,
    rollOpp: null,
    rolledMe: false,
    rollAnimating: false,
    rollDisplay: '',
    myOpenid: '',
    opponentOpenid: '',
    canPlay: false,
  },
  
  // 使用同步变量立即阻止重复点击，不依赖异步的setData
  isProcessingMoveSync: false,
  gameWatcher: null,
  lastGameUpdatedAt: 0,
  lastMovesLength: 0,
  openid: '',
  forceSwitching: false,

  async onLoad(query) {
    console.log('onLoad 被调用', query);
    // 读取游戏设置
    const settings = wx.getStorageSync('gameSettings') || {};
    this.setData({
      enableHighlight: settings.highlight !== undefined ? settings.highlight : true,
      enableSound: settings.sound !== undefined ? settings.sound : true,
    });
    
    // 注册回调
    core.onBoardUpdate((state) => this.updateState(state));
    core.onGameOver((state) => this.handleGameOver(state));
    core.onError((err) => wx.showToast({ title: err.message, icon: 'none' }));
    
    // 在线对战：直接走远程初始化与监听（计时待先手决定后再启动）
    if (query.mode === GameMode.PVP_ONLINE) {
      await this.initOnlineGame(query);
      return;
    }

    // 根据传入的模式参数，检查是否有对应模式的未完成游戏状态
    const mode = query.mode || GameMode.PVE;
    const storageKey = getStorageKey(mode);
    const savedState = wx.getStorageSync(storageKey);
    const shouldRestore = query.restore !== 'false' && savedState && 
                          savedState.phase === GamePhase.Playing && 
                          savedState.result === GameResult.Ongoing &&
                          savedState.config.mode === mode;

    if (shouldRestore) {
      // 恢复游戏状态
      try {
        core.restoreState(savedState);
        const state = core.getState();
        
        // 读取最新设置（高亮和音效可以在任何时候更新）
        const settings = wx.getStorageSync('gameSettings') || {};
        this.setData({
          modeLabel: state.config.mode === GameMode.PVE
            ? `人机对战 - ${state.config.aiLevel === 'HARD' ? '高级' : state.config.aiLevel === 'MEDIUM' ? '中级' : '初级'}`
            : '本机对战',
          opponentLabel: state.config.mode === GameMode.PVE ? 'AI 对手' : '玩家 2',
          timerDisplay: state.config.timeLimitPerMove
            ? (state.timeState.currentMoveRemain !== undefined 
                ? this.formatTime(state.timeState.currentMoveRemain) 
                : this.formatTime(state.config.timeLimitPerMove))
            : (state.config.timeLimitPerPlayer
                ? this.formatTime(
                    state.currentPlayer === Player.Black
                      ? state.timeState.blackRemain
                      : state.timeState.whiteRemain
                  )
                : '∞'),
          enableHighlight: settings.highlight !== undefined ? settings.highlight : true,
          enableSound: settings.sound !== undefined ? settings.sound : true
        });
        
        this.updateState(state);
        
        // 恢复游戏时也记录开始时间（使用当前时间，因为无法准确知道原始开始时间）
        const gameStartTime = Date.now();
        
        // 恢复游戏时，如果 dedupeKey 不存在，生成一个新的
        let dedupeKey = wx.getStorageSync('dedupeKey') || '';
        if (!dedupeKey) {
          dedupeKey = 'g_' + gameStartTime + '_' + Math.random().toString(16).slice(2);
          console.log('[FINAL] 恢复游戏时生成 dedupeKey=', dedupeKey);
        }
        
        this.setData({
          gameStartTime: gameStartTime,
          dedupeKey: dedupeKey
        });
        wx.setStorageSync('dedupeKey', dedupeKey);
        
        wx.showToast({ title: '已恢复对局', icon: 'success', duration: 1500 });
      } catch (error) {
        console.error('恢复游戏状态失败:', error);
        // 恢复失败，重新初始化
        this.initNewGame(query);
      }
    } else {
      // 初始化新游戏
      this.initNewGame(query);
    }

    this.startTick();
  },

  initNewGame(query) {
    console.log('initNewGame 被调用', query);
    // 读取游戏设置
    const settings = wx.getStorageSync('gameSettings') || {};
    
    // 构造配置：从 query 读取模式/难度，否则使用默认
    const mode = query.mode || GameMode.PVE;
    const config = {
      boardSize: 15,
      ruleSet: 'STANDARD',
      enableForbidden: settings.enableForbidden !== undefined ? settings.enableForbidden : false,
      allowUndo: true,
      mode: mode,
      aiLevel: query.aiLevel || 'MEDIUM',
      timeLimitPerPlayer: query.timeLimit ? Number(query.timeLimit) : undefined,
      // 本机对战模式下，默认启用每步60秒计时
      timeLimitPerMove: mode === GameMode.PVP_LOCAL ? 60 : undefined,
    };

    console.log('initNewGame - mode:', mode, 'config.timeLimitPerMove:', config.timeLimitPerMove);

    this.setData({
      modeLabel: config.mode === GameMode.PVE
        ? `人机对战 - ${config.aiLevel === 'HARD' ? '高级' : config.aiLevel === 'MEDIUM' ? '中级' : '初级'}`
        : '本机对战',
      opponentLabel: config.mode === GameMode.PVE ? 'AI 对手' : '玩家 2',
      timerDisplay: config.timeLimitPerMove ? this.formatTime(config.timeLimitPerMove) : (config.timeLimitPerPlayer ? this.formatTime(config.timeLimitPerPlayer) : '∞')
    });

    core.init(config);
    
    // 记录对局开始时间
    const gameStartTime = Date.now();
    
    // 生成全局唯一的 dedupeKey（去重键）
    const dedupeKey = 'g_' + gameStartTime + '_' + Math.random().toString(16).slice(2);
    console.log('[FINAL] dedupeKey=', dedupeKey);
    
    // 保存到 data 和 storage
    this.setData({
      gameStartTime: gameStartTime,
      dedupeKey: dedupeKey
    });
    wx.setStorageSync('dedupeKey', dedupeKey);
  },
  
  async initOnlineGame(query) {
    console.log('initOnlineGame 被调用', query);
    const { gameId, roomDocId } = query;
    const isCreator = String(query.isCreator) === 'true';
    
    this.setData({
      gameId: gameId,
      roomDocId: roomDocId,
      isCreator: isCreator,
      isOnline: true,
      modeLabel: '在线对战',
      opponentLabel: '在线对手',
      timerDisplay: '等待先手',
      canPlay: false,
      rollDisplay: '掷骰子决定先手...',
      showRollOverlay: true,
      rollMe: null,
      rollOpp: null,
      rolledMe: false,
      rollAnimating: false,
    });
    
    try {
      const { result: openRes } = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'getOpenId' }
      });
      this.openid = openRes.openid;
      this.setData({ myOpenid: openRes.openid });
    } catch (err) {
      console.error('获取 openid 失败', err);
      wx.showToast({ title: '获取身份失败', icon: 'none' });
    }
    
    // 进入房间先掷骰子，确保每人只会写一次
    try {
      await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'rollDice',
          gameId: gameId
        }
      });
    } catch (err) {
      console.error('rollDice 失败', err);
      wx.showToast({ title: '掷骰子失败，请返回重试', icon: 'none' });
    }
    
    let gameData = {};
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getGameState',
          gameId: gameId
        }
      });
      if (!result || !result.success) {
        wx.showToast({ title: (result && result.errMsg) || '获取对局失败', icon: 'none' });
        return;
      }
      gameData = result.data || {};
    } catch (err) {
      console.error('获取游戏状态失败', err);
      wx.showToast({ title: '获取对局失败', icon: 'none' });
      return;
    }
    
    const hasValidGameState = gameData.gameState && gameData.gameState.board;
    if (hasValidGameState) {
      if (gameData.gameState.config && gameData.gameState.config.mode === GameMode.PVP_ONLINE && !gameData.gameState.config.timeLimitPerMove) {
        gameData.gameState.config.timeLimitPerMove = 60;
      }
      core.restoreState(gameData.gameState);
    } else {
      const settings = wx.getStorageSync('gameSettings') || {};
      const config = {
        boardSize: 15,
        ruleSet: 'STANDARD',
        enableForbidden: settings.enableForbidden !== undefined ? settings.enableForbidden : false,
        allowUndo: false,
        mode: GameMode.PVP_ONLINE,
        timeLimitPerMove: 60,
        timeLimitPerPlayer: undefined,
      };
      core.init(config);
      try {
        await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: {
            type: 'updateGameState',
            gameId: gameId,
            gameState: core.getState()
          }
        });
      } catch (err) {
        console.error('写入初始状态失败', err);
        wx.showToast({ title: '初始化失败，请重试', icon: 'none' });
      }
    }
    
    // 应用 roll 信息确定执棋
    this.applyRoll(gameData.roll || {}, gameData);
    
    this.lastGameUpdatedAt = gameData.updatedAt ? new Date(gameData.updatedAt).getTime() : 0;
    this.lastMovesLength = (gameData.moves || []).length;
    
    // 初始化一次界面
    this.updateState(core.getState());
    this.watchGame(gameId);
    // 如果先手已决定则启动计时
    this.startTickIfReady();
  },
  
  applyRoll(roll, game) {
    const rollData = roll || {};
    const gameData = game || {};
    const myOpenid = this.data.myOpenid || this.openid;
    let opponentOpenid = this.data.opponentOpenid;
    if (!opponentOpenid && gameData.player1 && gameData.player2) {
      opponentOpenid = gameData.player1.openid === myOpenid ? gameData.player2.openid : gameData.player1.openid;
    }
    if (!opponentOpenid && rollData.blackOpenid) {
      opponentOpenid = rollData.blackOpenid === myOpenid ? rollData.whiteOpenid : rollData.blackOpenid;
    }

    const myRollObj = myOpenid ? rollData[myOpenid] : null;
    const oppRollObj = opponentOpenid ? rollData[opponentOpenid] : null;
    const rollMe = myRollObj && typeof myRollObj.value === 'number' ? myRollObj.value : null;
    const rollOpp = oppRollObj && typeof oppRollObj.value === 'number' ? oppRollObj.value : null;
    const rolledMe = rollMe !== null;

    let decided = false;
    let myColor = this.data.myColor;
    let showRollOverlay = true;
    let rollDisplay = '等待双方掷骰';
    let canPlay = false;

    if (rollData.blackOpenid && rollData.whiteOpenid) {
      decided = true;
      showRollOverlay = false;
      if (rollData.blackOpenid === myOpenid) {
        myColor = Player.Black;
      } else if (rollData.whiteOpenid === myOpenid) {
        myColor = Player.White;
      }
      const firstIsMe = rollData.firstPlayerOpenid && rollData.firstPlayerOpenid === myOpenid;
      rollDisplay = firstIsMe ? '你先手' : '对手先手';
      const currentState = core.getState();
      canPlay = currentState.currentPlayer === myColor;
    } else if (rolledMe) {
      rollDisplay = '已掷骰，等待对手...';
    }

    this.setData({
      roll: rollData,
      showRollOverlay,
      rollMe,
      rollOpp,
      rolledMe,
      rollAnimating: false,
      rollDisplay,
      myColor,
      opponentOpenid,
      canPlay
    }, () => {
      if (decided) {
        this.startTickIfReady();
      }
    });
  },

  async onTapRollDice() {
    if (this.data.rollAnimating || this.data.rolledMe) {
      wx.showToast({ title: '已掷骰，等待结果', icon: 'none' });
      return;
    }
    if (!this.data.gameId) {
      wx.showToast({ title: '游戏未就绪', icon: 'none' });
      return;
    }
    this.setData({ rollAnimating: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'rollDice',
          gameId: this.data.gameId
        }
      });
      const rollRes = result && (result.data && result.data.roll ? result.data.roll : result.data || result);
      this.applyRoll(rollRes || {}, {});
    } catch (err) {
      console.error('掷骰失败', err);
      wx.showToast({ title: '掷骰失败，请重试', icon: 'none' });
      this.setData({ rollAnimating: false });
    }
  },
  
  async watchGame(gameId) {
    if (this.gameWatcher) {
      this.gameWatcher.close();
    }
    this.gameWatcher = db.collection('games').where({ _id: gameId }).watch({
      onChange: async (snapshot) => {
        const game = snapshot.docs && snapshot.docs[0];
        if (game) {
          this.handleRemoteGame(game);
        } else {
          try {
            const latest = await db.collection('games').doc(gameId).get();
            if (latest && latest.data) {
              this.handleRemoteGame(latest.data);
            }
          } catch (err) {
            console.error('watchGame fallback get 失败', err);
          }
        }
      },
      onError: (err) => {
        console.error('watchGame 失败', err);
        wx.showToast({ title: '同步中断，请返回重进', icon: 'none' });
      }
    });
  },
  
  handleRemoteGame(latest) {
    if (!latest) return;
    if (latest.roll) {
      this.applyRoll(latest.roll, latest);
    }
    if (latest.gameState) {
      core.restoreState(latest.gameState);
      const state = core.getState();
      this.lastGameUpdatedAt = latest.updatedAt ? new Date(latest.updatedAt).getTime() : this.lastGameUpdatedAt;
      this.lastMovesLength = (latest.moves || state.moves || []).length;
      this.updateState(state);
    }
  },

  onShow() {
    // 从设置页面返回时，重新读取设置并更新（高亮和音效可以随时更新）
    const settings = wx.getStorageSync('gameSettings') || {};
    this.setData({
      enableHighlight: settings.highlight !== undefined ? settings.highlight : true,
      enableSound: settings.sound !== undefined ? settings.sound : true
    });
  },

  onHide() {
    // 页面隐藏时停止定时器（跳转到结算页面时）
    this.stopTick();
  },

  onUnload() {
    this.stopTick();
    if (this.gameWatcher) {
      this.gameWatcher.close();
      this.gameWatcher = null;
    }
    // 页面卸载时保存游戏状态（如果游戏还在进行中）
    const state = core.getState();
    if (state.config.mode === GameMode.PVP_ONLINE) {
      return;
    }
    if (state.phase === GamePhase.Playing && state.result === GameResult.Ongoing) {
      const storageKey = getStorageKey(state.config.mode);
      wx.setStorageSync(storageKey, state);
    } else {
      // 游戏已结束，清除保存的状态
      const storageKey = getStorageKey(state.config.mode);
      wx.removeStorageSync(storageKey);
    }
  },

  tickTimer: 0,
  tickStarted: false,

  startTickIfReady() {
    if (this.tickStarted) return;
    if (this.data.isOnline && this.data.showRollOverlay) {
      return;
    }
    this.tickStarted = true;
    this.startTick();
  },

  startTick() {
    // 先清除可能存在的旧定时器
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
    
    // 只在游戏进行中才启动定时器
    const state = core.getState();
    if (state.phase === GamePhase.Playing) {
      const timerId = setInterval(() => {
        const currentState = core.getState();
        if (this.data.isOnline && this.data.showRollOverlay) {
          // 先手未定，不计时
          return;
        }
        // 检查游戏状态，如果已结束则立即停止定时器
        if (currentState.phase !== GamePhase.Playing) {
          clearInterval(timerId);
          if (this.tickTimer === timerId) {
            this.tickTimer = 0;
          }
          return;
        }
        core.tick(1000);
        const afterTickState = core.getState();
        if (afterTickState.config.mode === GameMode.PVP_ONLINE && afterTickState.config.timeLimitPerMove) {
          const remain = afterTickState.timeState.currentMoveRemain;
          const isMyTurn = afterTickState.currentPlayer === this.data.myColor;
          if (isMyTurn && remain !== undefined && remain <= 0 && !this.forceSwitching && !this.data.showRollOverlay) {
            this.forceSwitching = true;
            wx.cloud.callFunction({
              name: 'quickstartFunctions',
              data: {
                type: 'forceSwitchTurn',
                gameId: this.data.gameId
              }
            }).catch((err) => {
              console.error('forceSwitchTurn 调用失败', err);
            });
          }
          if (!isMyTurn || (remain !== undefined && remain > 0)) {
            this.forceSwitching = false;
          }
        }
      }, 1000);
      this.tickTimer = timerId;
    }
  },

  stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
    this.tickStarted = false;
  },

  updateState(state) {
    const newLastMove = state.lastMove || null;
    const prevLastMove = this.data.prevLastMove;
    
    // 只在人机模式下处理防抖标志
    if (state.config.mode === GameMode.PVE) {
      // 如果游戏已结束，重置处理标志
      if (state.phase !== GamePhase.Playing || state.result !== GameResult.Ongoing) {
        if (this.isProcessingMoveSync || this.data.isProcessingMove) {
          this.isProcessingMoveSync = false;
          this.setData({ isProcessingMove: false });
        }
      }
      
      // 在人机模式下的标志重置逻辑：
      // 1. 如果当前轮到玩家（黑棋），且之前设置了处理标志，说明玩家已落子且AI已响应，重置标志
      // 2. 如果当前轮到AI（白棋），且之前设置了处理标志，说明玩家刚下完黑棋，等待AI下白棋，此时保持标志为true（不重置）
      if (state.currentPlayer === Player.Black && 
          (this.isProcessingMoveSync || this.data.isProcessingMove)) {
        // 玩家回合且处理标志为true，说明上一轮（玩家+AI）已完成，重置标志
        console.log('AI落子完成，重置处理标志，允许玩家再次点击');
        this.isProcessingMoveSync = false;
        this.setData({ isProcessingMove: false });
      }
      // 注意：如果 currentPlayer === White，说明玩家刚下完，等待AI，此时不重置标志
    }
    
    // 检测 AI 落子（白棋落子且 lastMove 更新了）
    const isAIMove = this.data.enableSound && 
        newLastMove && 
        newLastMove.player === Player.White &&
        (!prevLastMove || prevLastMove.x !== newLastMove.x || prevLastMove.y !== newLastMove.y);
    
    if (isAIMove) {
      // AI 落子，播放音效
      this.playSound('move');
    }
    
    // 计算计时器显示
    let timerDisplay = '∞';
    if (state.config.mode === GameMode.PVP_ONLINE && this.data.showRollOverlay) {
      timerDisplay = '等待先手';
    } else if (state.config.timeLimitPerMove) {
      if (state.timeState.currentMoveRemain !== undefined) {
        timerDisplay = this.formatTime(state.timeState.currentMoveRemain);
      } else {
        timerDisplay = this.formatTime(state.config.timeLimitPerMove);
      }
    } else if (state.config.timeLimitPerPlayer) {
      timerDisplay = this.formatTime(
        state.currentPlayer === Player.Black
          ? state.timeState.blackRemain
          : state.timeState.whiteRemain
      );
    }
    
    console.log('updateState - timerDisplay:', timerDisplay, 'timeLimitPerMove:', state.config.timeLimitPerMove, 'currentMoveRemain:', state.timeState.currentMoveRemain);
    
    // 更新获胜的五子位置
    const winningPositions = Array.isArray(state.winningPositions) ? state.winningPositions : [];

    let canPlay = this.data.canPlay;
    if (state.config.mode === GameMode.PVP_ONLINE) {
      const rollDecided = !this.data.showRollOverlay;
      canPlay = rollDecided && state.currentPlayer === this.data.myColor;
    }
    
    this.setData({
      board: state.board,
      lastMove: newLastMove,
      prevLastMove: newLastMove, // 更新上一次的落子记录
      currentPlayer: state.currentPlayer,
      timerDisplay: timerDisplay,
      winningPositions: winningPositions, // 更新获胜的五子位置
      canPlay
    });

    if (state.config.mode === GameMode.PVP_ONLINE && !this.data.showRollOverlay) {
      this.startTickIfReady();
    }
  },

  handleGameOver(state) {
    console.log('handleGameOver 被调用，state.result:', state.result, 'state.winner:', state.winner);
    
    // 立即停止tick定时器，避免在结算页面继续执行
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
      console.log('handleGameOver: 已清除tick定时器');
    }
    
    // 播放游戏结束音效
    if (this.data.enableSound) {
      if (state.result === GameResult.BlackWin || state.result === GameResult.WhiteWin) {
        this.playSound('win');
      } else {
        this.playSound('lose');
      }
    }
    
    // 游戏结束，清除保存的状态（根据模式清除对应的状态）
    const storageKey = getStorageKey(state.config.mode);
    wx.removeStorageSync(storageKey);
    wx.setStorageSync('lastConfig', state.config);
    
    // 计算对局时长（秒）
    const gameStartTime = this.data.gameStartTime || Date.now();
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);
    
    // 确定玩家结果（人机模式下，玩家是黑棋）
    let playerResult = '负';
    if (state.config.mode === GameMode.PVE) {
      // 人机模式：玩家是黑棋
      if (state.result === GameResult.BlackWin) {
        playerResult = '胜';
      } else if (state.result === GameResult.WhiteWin) {
        playerResult = '负';
      } else if (state.result === GameResult.Draw) {
        playerResult = '和';
      }
    } else if (state.config.mode === GameMode.PVP_LOCAL) {
      // 本机对战：不记录战绩（或者可以记录为"本机"）
      playerResult = '和'; // 本机对战不记录胜负
    }
    
    // 确定对手类型和名称
    let opponentType = 'AI';
    let opponentName = 'AI';
    if (state.config.mode === GameMode.PVE) {
      opponentType = 'AI';
      opponentName = 'AI';
    } else if (state.config.mode === GameMode.PVP_LOCAL) {
      opponentType = '本机';
      opponentName = '本机';
    }
    
    // 确定AI难度
    let difficulty = '';
    if (state.config.mode === GameMode.PVE && state.config.aiLevel) {
      const levelMap = {
        'EASY': '初级',
        'MEDIUM': '中级',
        'HARD': '高级'
      };
      difficulty = levelMap[state.config.aiLevel] || '中级';
    }
    
    // 获取 dedupeKey（优先使用 data 中的，如果为空则从 storage 获取，最后生成新的）
    let dedupeKey = this.data.dedupeKey || '';
    if (!dedupeKey) {
      dedupeKey = wx.getStorageSync('dedupeKey') || '';
    }
    if (!dedupeKey) {
      // 兜底：如果仍然为空，立即生成一个新的
      dedupeKey = 'g_' + Date.now() + '_' + Math.random().toString(16).slice(2);
      console.warn('[FINAL] 兜底生成 dedupeKey=', dedupeKey);
      wx.setStorageSync('dedupeKey', dedupeKey);
    }
    console.log('[FINAL] dedupeKey=', dedupeKey);
    
    const params = `result=${state.result}&winner=${state.winner || ''}&moves=${state.moves.length}&playerResult=${playerResult}&mode=${state.config.mode}&opponentType=${opponentType}&opponentName=${opponentName}&difficulty=${difficulty}&duration=${duration}&dedupeKey=${dedupeKey}`;
    console.log('准备跳转到结果页面，params:', params);
    
    // 使用延迟确保所有状态更新完成后再跳转，避免跳转超时
    // 延迟时间需要足够让 setData 和音效播放完成，但不要太长影响用户体验
    setTimeout(() => {
      const navigateToResult = () => {
        wx.navigateTo({ 
          url: `/pages/result/index?${params}`,
          success: () => {
            console.log('跳转到结算页面成功');
          },
          fail: (err) => {
            console.error('navigateTo 跳转失败，尝试使用 redirectTo:', err);
            // 如果 navigateTo 失败（可能是页面栈已满或超时），使用 redirectTo 作为备选方案
            wx.redirectTo({
              url: `/pages/result/index?${params}`,
              success: () => {
                console.log('redirectTo 跳转成功');
              },
              fail: (err2) => {
                console.error('redirectTo 也失败:', err2);
                // 如果都失败了，显示提示并尝试使用 reLaunch
                wx.showToast({
                  title: '跳转失败，请重试',
                  icon: 'none',
                  duration: 2000
                });
                // 最后尝试使用 reLaunch
                setTimeout(() => {
                  wx.reLaunch({
                    url: `/pages/result/index?${params}`,
                    fail: (err3) => {
                      console.error('reLaunch 也失败:', err3);
                    }
                  });
                }, 2000);
              }
            });
          }
        });
      };
      
      // 尝试跳转
      navigateToResult();
    }, 150); // 延迟150ms确保状态更新完成
  },

  async handleCellTap(e) {
    // 检查游戏状态，确保游戏还在进行中
    const state = core.getState();
    if (state.phase !== GamePhase.Playing || state.result !== GameResult.Ongoing) {
      console.log('游戏未在进行中，忽略点击');
      return;
    }
    
    const isOnline = state.config.mode === GameMode.PVP_ONLINE;
    
    // 在线对战：只允许轮到自己时落子
    if (isOnline) {
      if (!this.data.canPlay || state.currentPlayer !== this.data.myColor) {
        wx.showToast({ title: '等待先手判定 / 对手回合', icon: 'none' });
        return;
      }
    }
    
    // 在人机模式下，需要防抖机制和安全超时
    if (state.config.mode === GameMode.PVE) {
      // 使用同步变量立即阻止重复点击（不依赖异步的setData）
      if (this.isProcessingMoveSync) {
        console.log('正在处理落子，忽略本次点击（同步检查）');
        return;
      }
      
      // 双重检查：也检查data中的标志（虽然可能延迟，但作为额外保护）
      if (this.data.isProcessingMove) {
        console.log('正在处理落子，忽略本次点击（data检查）');
        return;
      }
      
      // 在人机模式下，如果当前不是玩家回合，忽略点击
      if (state.currentPlayer !== Player.Black) {
        console.log('当前是AI回合，忽略玩家点击');
        return;
      }
    }
    
    const { x, y } = e.detail;
    
    // 只在人机模式下设置防抖标志
    if (state.config.mode === GameMode.PVE) {
      // 立即设置同步标志，防止重复点击（同步操作，立即生效）
      this.isProcessingMoveSync = true;
      this.setData({ isProcessingMove: true });
    }
    
    try {
      // 执行落子（这是同步调用，会立即执行）
      core.handlePlayerMove(Number(x), Number(y));
      
      if (isOnline) {
        const latestState = core.getState();
        const lastMove = latestState.lastMove || null;
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'quickstartFunctions',
            data: {
              type: 'updateGameState',
              gameId: this.data.gameId,
              gameState: latestState,
              move: lastMove
            }
          });
          if (!result || !result.success) {
            wx.showToast({ title: (result && result.errMsg) || '同步失败', icon: 'none' });
          } else {
            this.lastGameUpdatedAt = Date.now();
            this.lastMovesLength = (latestState.moves || []).length;
          }
        } catch (err) {
          console.error('在线同步失败', err);
          wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
        }
      }
      
      // 执行落子后，立即检查状态，确保标志不会被意外重置
      // 只在人机模式下处理标志
      if (state.config.mode === GameMode.PVE) {
        const stateAfterMove = core.getState();
        if (stateAfterMove.currentPlayer === Player.White) {
          // 玩家已下完，当前轮到AI，保持标志为true，等待AI下完
          console.log('玩家已下完，等待AI落子，保持处理标志');
        } else if (stateAfterMove.phase !== GamePhase.Playing) {
          // 游戏已结束，重置标志
          console.log('游戏已结束，重置处理标志');
          this.isProcessingMoveSync = false;
          this.setData({ isProcessingMove: false });
        }
      }
      
      // 播放落子音效
      if (this.data.enableSound) {
        this.playSound('move');
      }
    } catch (error) {
      // 如果落子失败，立即重置标志（只在人机模式下）
      console.error('落子失败:', error);
      if (state.config.mode === GameMode.PVE) {
        this.isProcessingMoveSync = false;
        this.setData({ isProcessingMove: false });
      }
    }
    
    // 只在人机模式下设置安全超时，防止标志永远不被重置
    if (state.config.mode === GameMode.PVE) {
      setTimeout(() => {
        if (this.isProcessingMoveSync) {
          console.log('安全超时，重置 isProcessingMove 标志');
          this.isProcessingMoveSync = false;
          this.setData({ isProcessingMove: false });
        }
      }, 2000); // 2秒安全超时
    }
  },
  
  playSound(type) {
    // 使用微信小程序的音频API播放音效
    // 注意：实际项目中需要准备音频文件，这里使用系统提示音
    try {
      if (type === 'move') {
        // 落子音效 - 已移除震动反馈
        // 如需添加真实音频，可在此处使用 wx.createInnerAudioContext() 播放音频文件
      } else if (type === 'win') {
        // 胜利音效
        wx.vibrateShort({
          type: 'heavy'
        });
      } else if (type === 'lose') {
        // 失败音效
        wx.vibrateShort({
          type: 'medium'
        });
      }
    } catch (error) {
      console.error('播放音效失败:', error);
    }
  },

  handleUndo() {
    core.handleUndo();
  },

  handleResign() {
    console.log('认输按钮被点击，当前玩家:', this.data.currentPlayer);
    core.handleResign(this.data.currentPlayer);
  },

  backHome(e) {
    console.log('返回按钮被点击', e);
    
    // 阻止事件冒泡
    if (e) {
      e.stopPropagation && e.stopPropagation();
    }
    
    // 保存当前游戏状态（根据模式保存到对应的键）
    const state = core.getState();
    if (state.phase === GamePhase.Playing && state.result === GameResult.Ongoing) {
      const storageKey = getStorageKey(state.config.mode);
      wx.setStorageSync(storageKey, state);
      console.log('游戏状态已保存，模式:', state.config.mode, '存储键:', storageKey);
    }
    
    // 直接跳转到首页（使用 reLaunch 确保清除页面栈）
    wx.reLaunch({
      url: '/pages/index/index',
      success: () => {
        console.log('已跳转到首页');
      },
      fail: (err) => {
        console.error('跳转首页失败:', err);
        // 如果 reLaunch 失败，尝试 redirectTo
        wx.redirectTo({
          url: '/pages/index/index',
          success: () => {
            console.log('redirectTo 跳转成功');
          },
          fail: (err2) => {
            console.error('redirectTo 也失败:', err2);
            wx.showToast({ 
              title: '返回失败，请检查路径', 
              icon: 'none',
              duration: 2000
            });
          }
        });
      }
    });
  },

  formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }
});
