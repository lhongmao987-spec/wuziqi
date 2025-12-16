import { GameCore } from '../../core/gameCore';
import { Player, GameMode, GamePhase, GameResult } from '../../core/types';

const core = new GameCore();

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
    winningPositions: [], // 获胜的五子位置
    isProcessingMove: false, // 标记是否正在处理落子，防止快速连续点击
    gameStartTime: null, // 对局开始时间戳
    clientGameId: '', // 客户端生成的游戏ID（用于去重，PVE/PVP_LOCAL模式）
    // 在线对战相关
    gameId: '',
    roomDocId: '',
    isCreator: false,
    myPlayer: Player.Black, // 当前玩家的身份（黑或白）
    gameWatcher: null, // 游戏状态监听器
  },

  onLoad(query) {
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
        wx.showToast({ title: '已恢复对局', icon: 'success', duration: 1500 });
      } catch (error) {
        console.error('恢复游戏状态失败:', error);
        // 恢复失败，重新初始化
        this.initNewGame(query);
      }
    } else {
      // 初始化新游戏
      if (query.mode === GameMode.PVP_ONLINE) {
        // 在线对战模式
        this.initOnlineGame(query);
      } else {
        this.initNewGame(query);
      }
    }

    this.startTick();
  },

  initNewGame(query) {
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
    
    // 记录游戏开始时间并生成clientGameId（用于去重）
    const gameStartTime = Date.now();
    const openid = wx.getStorageSync('openid') || 'anonymous';
    const random = Math.floor(Math.random() * 10000);
    const clientGameId = `${openid}_${gameStartTime}_${random}`;
    
    this.setData({
      gameStartTime: gameStartTime,
      clientGameId: clientGameId
    });
    
    // 保存 clientGameId 到 storage（作为 dedupeKey 的备份）
    wx.setStorageSync('currentDedupeKey', clientGameId);
  },

  // 初始化在线对战
  async initOnlineGame(query) {
    const gameId = query.gameId;
    const roomDocId = query.roomDocId;
    const isCreator = query.isCreator === 'true';

    if (!gameId) {
      wx.showToast({
        title: '游戏ID错误',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
      return;
    }

    this.setData({
      gameId: gameId,
      roomDocId: roomDocId || '',
      isCreator: isCreator,
      myPlayer: isCreator ? Player.Black : Player.White, // 创建者是黑棋，加入者是白棋
      modeLabel: '在线对战',
      opponentLabel: '在线玩家'
    });

    // 加载游戏状态
    await this.loadGameState();
    
    // 开始监听游戏状态
    this.watchGameState();
  },

  // 加载游戏状态
  async loadGameState() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getGameState',
          gameId: this.data.gameId
        }
      });

      if (result.result.success) {
        const game = result.result.data;
        
        // 读取游戏设置
        const settings = wx.getStorageSync('gameSettings') || {};
        
        if (game.gameState) {
          // 恢复游戏状态
          core.restoreState(game.gameState);
          const state = core.getState();
          this.updateState(state);
        } else {
          // 初始化新游戏
          const config = {
            boardSize: 15,
            ruleSet: 'STANDARD',
            enableForbidden: settings.enableForbidden !== undefined ? settings.enableForbidden : false,
            allowUndo: false, // 在线对战不允许悔棋
            mode: GameMode.PVP_ONLINE,
            timeLimitPerMove: 60, // 每步60秒
          };
          
          core.init(config);
          
          // 记录游戏开始时间并生成clientGameId（在线对战优先使用gameId，兼容无roomId模式）
          const gameStartTime = Date.now();
          // 在线对战：优先使用 gameId，如果没有 roomId 则使用 gameId+endedAt
          // 但为了兼容性，也生成一个 clientGameId 作为备份
          const openid = wx.getStorageSync('openid') || 'anonymous';
          const random = Math.floor(Math.random() * 10000);
          const clientGameId = `${openid}_${gameStartTime}_${random}`;
          
          this.setData({
            gameStartTime: gameStartTime,
            clientGameId: clientGameId // 保存作为备份
          });
          
          // 保存 clientGameId 到 storage（作为 dedupeKey 的备份）
          wx.setStorageSync('currentDedupeKey', clientGameId);
          
          // 保存初始状态到数据库
          const state = core.getState();
          await this.syncGameState(state);
        }
      } else {
        wx.showToast({
          title: result.result.errMsg || '加载游戏失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.showToast({
        title: error.message || '加载游戏失败',
        icon: 'none'
      });
    }
  },

  // 监听游戏状态变化
  watchGameState() {
    if (!this.data.gameId) {
      return;
    }

    const db = wx.cloud.database();
    const watcher = db.collection('games').doc(this.data.gameId).watch({
      onChange: (snapshot) => {
        if (snapshot.type === 'update' && snapshot.doc) {
          const game = snapshot.doc;
          if (game.gameState) {
            // 检查是否是对方的落子
            const remoteState = game.gameState;
            const localState = core.getState();
            
            // 如果对方的moves数量更多，说明对方落子了
            if (remoteState.moves.length > localState.moves.length) {
              // 恢复远程状态
              core.restoreState(remoteState);
              const state = core.getState();
              this.updateState(state);
              
              // 播放落子音效
              if (this.data.enableSound) {
                this.playSound('move');
              }
            }
          }
        }
      },
      onError: (error) => {
        console.error('监听游戏状态失败:', error);
      }
    });

    this.setData({
      gameWatcher: watcher
    });
  },

  // 同步游戏状态到数据库
  async syncGameState(state, move) {
    try {
      await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'updateGameState',
          gameId: this.data.gameId,
          gameState: state,
          move: move
        }
      });
    } catch (error) {
      console.error('同步游戏状态失败:', error);
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
    
    // 停止监听
    if (this.data.gameWatcher) {
      this.data.gameWatcher.close();
    }
    
    // 页面卸载时保存游戏状态（如果游戏还在进行中）
    const state = core.getState();
    if (state.config.mode !== GameMode.PVP_ONLINE) {
      // 非在线对战模式才保存到本地
      if (state.phase === GamePhase.Playing && state.result === GameResult.Ongoing) {
        const storageKey = getStorageKey(state.config.mode);
        wx.setStorageSync(storageKey, state);
      } else {
        // 游戏已结束，清除保存的状态
        const storageKey = getStorageKey(state.config.mode);
        wx.removeStorageSync(storageKey);
      }
    }
  },

  tickTimer: 0,
  // 使用同步变量立即阻止重复点击，不依赖异步的setData
  isProcessingMoveSync: false,

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
        // 检查游戏状态，如果已结束则立即停止定时器
        if (currentState.phase !== GamePhase.Playing) {
          clearInterval(timerId);
          if (this.tickTimer === timerId) {
            this.tickTimer = 0;
          }
          return;
        }
        core.tick(1000);
      }, 1000);
      this.tickTimer = timerId;
    }
  },

  stopTick() {
    if (this.tickTimer) {
      console.log('stopTick: 清除定时器');
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
    }
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
    if (state.config.timeLimitPerMove) {
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
    const winningPositions = state.winningPositions || [];
    if (winningPositions.length > 0) {
      console.log('updateState: 设置winningPositions:', winningPositions);
    }
    
    this.setData({
      board: state.board,
      lastMove: newLastMove,
      prevLastMove: newLastMove, // 更新上一次的落子记录
      currentPlayer: state.currentPlayer,
      timerDisplay: timerDisplay,
      winningPositions: winningPositions // 更新获胜的五子位置
    });
  },

  async handleGameOver(state) {
    // 立即停止tick定时器，避免在结算页面继续执行
    // 使用同步方式立即清除，确保定时器被停止
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = 0;
      console.log('handleGameOver: 已清除tick定时器');
    }
    
    // 在线对战模式：同步最终状态到数据库
    if (state.config.mode === GameMode.PVP_ONLINE) {
      await this.syncGameState(state);
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
    if (state.config.mode !== GameMode.PVP_ONLINE) {
      const storageKey = getStorageKey(state.config.mode);
      wx.removeStorageSync(storageKey);
    }
    wx.setStorageSync('lastConfig', state.config);
    
    // 计算玩家结果（用于统计上报）
    let playerResult = '';
    if (state.config.mode === GameMode.PVE) {
      // 人机对战：玩家是黑棋，AI是白棋
      if (state.result === GameResult.BlackWin) {
        playerResult = '胜';
      } else if (state.result === GameResult.WhiteWin || state.result === GameResult.BlackLoseForbidden) {
        playerResult = '负';
      } else if (state.result === GameResult.Draw) {
        playerResult = '和';
      }
    } else if (state.config.mode === GameMode.PVP_LOCAL) {
      // 本机对战：不统计
      playerResult = '';
    } else if (state.config.mode === GameMode.PVP_ONLINE) {
      // 在线对战：根据当前玩家的身份判断
      if (this.data.myPlayer === Player.Black) {
        if (state.result === GameResult.BlackWin) {
          playerResult = '胜';
        } else if (state.result === GameResult.WhiteWin) {
          playerResult = '负';
        } else if (state.result === GameResult.Draw) {
          playerResult = '和';
        }
      } else {
        if (state.result === GameResult.WhiteWin) {
          playerResult = '胜';
        } else if (state.result === GameResult.BlackWin) {
          playerResult = '负';
        } else if (state.result === GameResult.Draw) {
          playerResult = '和';
        }
      }
    }
    
    // 计算对局时长（秒）
    const gameStartTime = this.data.gameStartTime || Date.now();
    const duration = Math.max(0, Math.floor((Date.now() - gameStartTime) / 1000));
    
    // 生成dedupeKey（去重键）
    let dedupeKey = '';
    if (state.config.mode === GameMode.PVP_ONLINE) {
      // 在线对战：优先使用gameId，如果没有则使用roomId + endedAt，最后使用clientGameId
      const endedAt = Math.floor(Date.now() / 1000); // 秒级时间戳
      if (this.data.gameId) {
        dedupeKey = this.data.gameId;
      } else if (this.data.roomDocId) {
        dedupeKey = `${this.data.roomDocId}_${endedAt}`;
      } else {
        // 兼容没有 roomId 的模式：使用 clientGameId
        dedupeKey = this.data.clientGameId || '';
      }
    } else {
      // 人机/本地：使用clientGameId
      dedupeKey = this.data.clientGameId || '';
    }
    
    // 如果 dedupeKey 仍然为空，从 storage 获取或生成新的
    if (!dedupeKey) {
      dedupeKey = wx.getStorageSync('currentDedupeKey') || '';
      if (!dedupeKey) {
        // 如果 storage 也没有，生成一个新的
        const openid = wx.getStorageSync('openid') || 'anonymous';
        const gameStartTime = this.data.gameStartTime || Date.now();
        const random = Math.floor(Math.random() * 10000);
        dedupeKey = `${openid}_${gameStartTime}_${random}`;
      }
    }
    
    // 保存 dedupeKey 到 storage（确保 result 页面可以获取）
    wx.setStorageSync('currentDedupeKey', dedupeKey);
    
    // 构建跳转参数
    const params = [
      `result=${state.result}`,
      `winner=${state.winner || ''}`,
      `moves=${state.moves.length}`,
      `mode=${state.config.mode}`,
      `playerResult=${playerResult}`,
      `opponentType=${state.config.mode === GameMode.PVE ? 'AI' : state.config.mode === GameMode.PVP_ONLINE ? '玩家' : ''}`,
      `opponentName=${state.config.mode === GameMode.PVE ? 'AI' : state.config.mode === GameMode.PVP_ONLINE ? '在线玩家' : ''}`,
      `difficulty=${state.config.aiLevel || ''}`,
      `duration=${duration}`,
      `dedupeKey=${dedupeKey}`
    ].filter(p => p.split('=')[1] !== '').join('&');
    
    // 使用延迟确保所有状态更新完成后再跳转，避免跳转超时
    setTimeout(() => {
      const navigateToResult = () => {
        wx.navigateTo({ 
          url: `/pages/result/index?${params}`,
          success: () => {
            console.log('跳转到结算页面成功');
          },
          fail: (err) => {
            console.error('navigateTo 跳转失败，尝试使用 redirectTo:', err);
            // 如果 navigateTo 失败，使用 redirectTo 作为备选方案
            wx.redirectTo({
              url: `/pages/result/index?${params}`,
              success: () => {
                console.log('redirectTo 跳转成功');
              },
              fail: (err2) => {
                console.error('redirectTo 也失败:', err2);
                wx.showToast({
                  title: '跳转失败，请重试',
                  icon: 'none',
                  duration: 2000
                });
              }
            });
          }
        });
      };
      
      // 尝试跳转
      navigateToResult();
    }, 100); // 延迟100ms确保状态更新完成
  },

  handleCellTap(e) {
    // 检查游戏状态，确保游戏还在进行中
    const state = core.getState();
    if (state.phase !== GamePhase.Playing || state.result !== GameResult.Ongoing) {
      console.log('游戏未在进行中，忽略点击');
      return;
    }
    
    // 在线对战模式：检查是否是自己的回合
    if (state.config.mode === GameMode.PVP_ONLINE) {
      if (state.currentPlayer !== this.data.myPlayer) {
        wx.showToast({
          title: '等待对方落子',
          icon: 'none'
        });
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
      
      const stateAfterMove = core.getState();
      const lastMove = stateAfterMove.moves[stateAfterMove.moves.length - 1];
      
      // 在线对战模式：同步游戏状态到数据库
      if (state.config.mode === GameMode.PVP_ONLINE) {
        this.syncGameState(stateAfterMove, lastMove).catch(err => {
          console.error('同步游戏状态失败:', err);
        });
      }
      
      // 执行落子后，立即检查状态，确保标志不会被意外重置
      // 只在人机模式下处理标志
      if (state.config.mode === GameMode.PVE) {
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
    const state = core.getState();
    // 在线对战不允许悔棋
    if (state.config.mode === GameMode.PVP_ONLINE) {
      wx.showToast({
        title: '在线对战不允许悔棋',
        icon: 'none'
      });
      return;
    }
    core.handleUndo();
  },

  handleResign() {
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
