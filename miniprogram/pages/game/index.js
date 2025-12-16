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
    roomId: '', // 房间号
    roomDocId: '',
    isCreator: false,
    myPlayer: Player.Black, // 当前玩家的身份（黑或白）
    gameWatcher: null, // 游戏状态监听器
    lastStateVersion: 0, // 最后同步的 stateVersion（用于幂等判断）
    lastStateKey: '', // 最后同步的状态 key（${stateVersion}|${phase}|${result}，用于幂等判断）
    turnOpenid: '', // 当前回合的 openid（用于超时换手）
    _timeoutSentKey: '', // 超时换手防抖 key（${stateVersion}|${turnOpenid}）
    // 投骰子相关
    showRollOverlay: false,
    phase: '', // ROLL_WAIT / ROLL_AGAIN / ROLL_DONE
    roll: {}, // { openid: { value, at } }
    rollResult: null, // { p1, p2 }
    blackOpenid: '',
    whiteOpenid: '',
    firstPlayerOpenid: '',
    rollMe: null, // 我的点数
    rollOpp: null, // 对手点数
    rolledMe: false, // 是否已投骰子
    rollDone: false, // 是否已完成投骰子
    rollAnimating: false, // 投骰子动画中
    rollDisplay: '请点击按钮投骰子', // 提示文字
    // 骰子弹窗延迟关闭相关
    showRollModal: false, // 控制弹窗显示（ROLL_DONE 后延迟关闭）
    rollWinnerText: '', // 先手提示文字
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
        // 在线对战模式：不在这里启动定时器，等待 phase === 'ROLL_DONE' 后再启动
      } else {
        this.initNewGame(query);
        // 非在线对战模式：直接启动定时器
        this.startTick();
      }
    }
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
        
        // 保存 roomId（从 game 数据中获取）
        if (game.roomId) {
          this.setData({
            roomId: game.roomId
          });
        }
        
        // 读取游戏设置
        const settings = wx.getStorageSync('gameSettings') || {};
        
        // 更新对手昵称：优先使用 games.player1/player2.nickName，只在缺失时才 fallback
        const isOnlineMode = (game.gameState && game.gameState.config && game.gameState.config.mode === 'PVP_ONLINE') 
          || this.data.modeLabel === '在线对战';
        
        if (isOnlineMode) {
          const myOpenid = wx.getStorageSync('openid') || '';
          let opponentNickName = '';
          
          if (myOpenid) {
            // 确定对手的 openid
            if (game.player1 && game.player1.openid === myOpenid) {
              // 我是 player1，对手是 player2
              opponentNickName = (game.player2 && game.player2.nickName && game.player2.nickName.trim()) 
                ? game.player2.nickName 
                : '';
            } else if (game.player2 && game.player2.openid === myOpenid) {
              // 我是 player2，对手是 player1
              opponentNickName = (game.player1 && game.player1.nickName && game.player1.nickName.trim()) 
                ? game.player1.nickName 
                : '';
            }
          }
          
          // 只在有真实昵称时才更新，避免覆盖已有昵称
          if (opponentNickName) {
            this.setData({
              opponentLabel: opponentNickName
            });
            console.log('[loadGameState] 更新对手昵称:', opponentNickName);
          }
        }
        
        // 更新 phase 相关状态
        this.updatePhaseState(game);
        
        // 只有当 game.gameState.board 与 game.gameState.moves 都是数组时才 restoreState
        if (game.gameState && 
            typeof game.gameState === 'object' &&
            game.gameState !== null &&
            Array.isArray(game.gameState.board) && 
            Array.isArray(game.gameState.moves)) {
          // 恢复游戏状态
          try {
            core.restoreState(game.gameState);
            const state = core.getState();
            this.updateState(state);
          } catch (error) {
            console.error('[loadGameState] apply remoteState 失败:', error);
            console.error('[loadGameState] gameState 内容:', game.gameState);
            wx.showToast({
              title: '加载游戏状态失败',
              icon: 'none',
              duration: 2000
            });
          }
          
          // 初始化 lastStateVersion 和 lastStateKey
          const stateVersion = game.stateVersion || 0;
          const phase = (game.gameState && game.gameState.phase) || 'PLAYING';
          const result = (game.gameState && game.gameState.result) || 'ONGOING';
          this.setData({
            lastStateVersion: stateVersion,
            lastStateKey: `${stateVersion}|${phase}|${result}`
          });
        } else {
          // 否则 core.init(config) 初始化完整 state
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
        console.log('[watchGameState] onChange, snapshot.type:', snapshot.type);
        
        // 无论 snapshot 是 update/init，都要先拿到最新 game 文档
        let game = null;
        if (snapshot.docs && snapshot.docs.length > 0) {
          game = snapshot.docs[0];
        } else if (snapshot.doc) {
          game = snapshot.doc;
        }
        
        if (!game) {
          console.warn('[watchGameState] 无法获取 game 文档');
          return;
        }
        
        console.log('[watchGameState] 获取到 game 文档，phase:', game.phase, 'roll:', game.roll, 'stateVersion:', game.stateVersion);
        
        // 保存 turnOpenid 到 data（用于超时换手）
        if (game.turnOpenid) {
          this.setData({
            turnOpenid: game.turnOpenid
          });
        }
        
        // 更新对手昵称：优先使用 games.player1/player2.nickName，只在缺失时才 fallback
        // 判断是否为在线对战模式：通过 game.gameState.config.mode 或 this.data.modeLabel
        const isOnlineMode = (game.gameState && game.gameState.config && game.gameState.config.mode === 'PVP_ONLINE') 
          || this.data.modeLabel === '在线对战';
        
        if (isOnlineMode) {
          const myOpenid = wx.getStorageSync('openid') || '';
          let opponentNickName = '';
          
          if (myOpenid) {
            // 确定对手的 openid
            if (game.player1 && game.player1.openid === myOpenid) {
              // 我是 player1，对手是 player2
              // 优先使用 games.player2.nickName
              opponentNickName = (game.player2 && game.player2.nickName && game.player2.nickName.trim()) 
                ? game.player2.nickName 
                : '';
            } else if (game.player2 && game.player2.openid === myOpenid) {
              // 我是 player2，对手是 player1
              // 优先使用 games.player1.nickName
              opponentNickName = (game.player1 && game.player1.nickName && game.player1.nickName.trim()) 
                ? game.player1.nickName 
                : '';
            }
          }
          
          // 只在有真实昵称时才更新，避免覆盖已有昵称
          if (opponentNickName && opponentNickName !== this.data.opponentLabel) {
            this.setData({
              opponentLabel: opponentNickName
            });
            console.log('[watchGameState] 更新对手昵称:', opponentNickName);
          }
        }
        
        // 每次都调用 updatePhaseState(game)，用于更新投骰子 UI
        this.updatePhaseState(game);
        
        // 如果 gameState 存在且有效，处理游戏状态（落子同步）
        if (game.gameState && 
            typeof game.gameState === 'object' &&
            game.gameState !== null &&
            Array.isArray(game.gameState.board) && 
            Array.isArray(game.gameState.moves)) {
          // 使用复合 key 进行幂等判断：${stateVersion}|${phase}|${result}
          // 注意：phase 和 result 应该从 gameState 中获取，不是 game.phase（那是投骰子阶段）
          const remoteStateVersion = game.stateVersion || 0;
          const remotePhase = (game.gameState && game.gameState.phase) || 'PLAYING';
          const remoteResult = (game.gameState && game.gameState.result) || 'ONGOING';
          const remoteStateKey = `${remoteStateVersion}|${remotePhase}|${remoteResult}`;
          const localStateKey = this.data.lastStateKey || '';
          
          // 如果状态 key 变化，说明有新的落子或状态变化（包括认输等）
          if (remoteStateKey !== localStateKey) {
            console.log('[watchGameState] 检测到状态变化，stateKey:', localStateKey, '->', remoteStateKey);
            
            // 记录恢复前的 moves 数量（用于判断是否是对方落子）
            const localStateBefore = core.getState();
            const movesBefore = localStateBefore.moves.length;
            const resultBefore = localStateBefore.result;
            
            // 恢复远程状态（保证两端最终一致）
            // 确保 gameState 有效后再调用 restoreState
            try {
              core.restoreState(game.gameState);
              const state = core.getState();
              this.updateState(state);
              
              // 更新本地记录的状态 key
              this.setData({
                lastStateVersion: remoteStateVersion,
                lastStateKey: remoteStateKey
              });
              
              // 如果 turnOpenid 变化，重置超时防抖 key（允许新回合触发超时检测）
              if (game.turnOpenid && game.turnOpenid !== this.data.turnOpenid) {
                this.data._timeoutSentKey = '';
                this.setData({
                  turnOpenid: game.turnOpenid
                });
              }
              
              // 播放落子音效（如果确实是对方落子，即远程 moves 数量增加）
              if (game.gameState.moves.length > movesBefore && this.data.enableSound) {
                this.playSound('move');
              }
              
              // 恢复远程状态后，立刻检查是否需要跳转到结算页
              this.maybeGotoResult(state);
            } catch (error) {
              // apply remoteState 失败
              console.error('[watchGameState] apply remoteState 失败:', error);
              console.error('[watchGameState] gameState 内容:', game.gameState);
              wx.showToast({
                title: '同步游戏状态失败',
                icon: 'none',
                duration: 2000
              });
            }
          }
        } else {
          // gameState 无效或为空，记录警告但不报错（可能是初始状态）
          if (game.gameState === null || game.gameState === undefined) {
            console.warn('[watchGameState] gameState 为 null/undefined，跳过状态同步');
          } else {
            console.warn('[watchGameState] gameState 结构异常，跳过状态同步:', {
              hasGameState: !!game.gameState,
              isObject: typeof game.gameState === 'object',
              hasBoard: Array.isArray(game.gameState?.board),
              hasMoves: Array.isArray(game.gameState?.moves)
            });
          }
        }
      },
      onError: (error) => {
        console.error('[watchGameState] 监听游戏状态失败:', error);
      }
    });

    this.setData({
      gameWatcher: watcher
    });
  },

  // 更新 phase 相关状态
  async updatePhaseState(game) {
    console.log('[updatePhaseState] 开始更新 phase 状态');
    
    // myOpenid 从 wx.getStorageSync('openid') 读取；为空则调用云函数获取
    let myOpenid = wx.getStorageSync('openid') || '';
    if (!myOpenid) {
      console.log('[updatePhaseState] openid 为空，调用云函数获取');
      try {
        const result = await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: {
            type: 'getOpenId'
          }
        });
        if (result.result && result.result.openid) {
          myOpenid = result.result.openid;
          wx.setStorageSync('openid', myOpenid);
          console.log('[updatePhaseState] 获取到 openid 并写入 storage:', myOpenid);
        } else {
          // 如果 getOpenId 失败，尝试 login
          const loginResult = await wx.cloud.callFunction({
            name: 'quickstartFunctions',
            data: {
              type: 'login'
            }
          });
          if (loginResult.result && loginResult.result.success && loginResult.result.data && loginResult.result.data.openid) {
            myOpenid = loginResult.result.data.openid;
            wx.setStorageSync('openid', myOpenid);
            console.log('[updatePhaseState] 通过 login 获取到 openid 并写入 storage:', myOpenid);
          }
        }
      } catch (error) {
        console.error('[updatePhaseState] 获取 openid 失败:', error);
      }
    }
    
    if (!myOpenid) {
      console.warn('[updatePhaseState] 无法获取 openid，跳过更新');
      return;
    }
    
    const phase = game.phase || 'ROLL_WAIT';
    const roll = game.roll || {};
    const rollResult = game.rollResult || null;
    const blackOpenid = game.blackOpenid || '';
    const whiteOpenid = game.whiteOpenid || '';
    const firstPlayerOpenid = game.firstPlayerOpenid || '';
    
    // 记录之前的 phase，用于检测变化
    const prevPhase = this.data.phase || '';
    
    // opponentOpenid 根据 game.player1.openid / game.player2.openid 计算
    let opponentOpenid = '';
    if (game.player1 && game.player1.openid === myOpenid) {
      opponentOpenid = game.player2 ? (game.player2.openid || '') : '';
    } else if (game.player1) {
      opponentOpenid = game.player1.openid || '';
    }
    
    // rollMe = game.roll?.[myOpenid]?.value || null，rollOpp = game.roll?.[opponentOpenid]?.value || null
    const rollMe = roll[myOpenid] && typeof roll[myOpenid].value === 'number' ? roll[myOpenid].value : null;
    const rollOpp = opponentOpenid && roll[opponentOpenid] && typeof roll[opponentOpenid].value === 'number' 
      ? roll[opponentOpenid].value 
      : null;
    
    const rolledMe = rollMe !== null;
    
    console.log('[updatePhaseState] 计算结果:', {
      myOpenid: myOpenid,
      opponentOpenid: opponentOpenid,
      rollMe: rollMe,
      rollOpp: rollOpp,
      phase: phase
    });
    
    // 根据 phase 设置提示文字
    let rollDisplay = '请点击按钮投骰子';
    if (phase === 'ROLL_AGAIN') {
      rollDisplay = '点数相同，请重新投骰子';
    } else if (phase === 'ROLL_DONE') {
      rollDisplay = '投骰子完成，游戏开始';
    } else if (rolledMe) {
      rollDisplay = '等待对手投骰子';
    }
    
    // 根据 blackOpenid/whiteOpenid 与 myOpenid 判定 myPlayer
    let myPlayer = Player.Black;
    if (blackOpenid && blackOpenid === myOpenid) {
      myPlayer = Player.Black;
    } else if (whiteOpenid && whiteOpenid === myOpenid) {
      myPlayer = Player.White;
    }
    
    // 骰子弹窗延迟关闭逻辑：ROLL_DONE 后显示双方点数和先手提示，延迟1~2秒关闭
    // 生成当前 roll 的唯一 key（用于幂等判断）
    const currentRollKey = `${rollMe || ''}_${rollOpp || ''}_${phase}`;
    
    // 如果 phase === 'ROLL_DONE' 且双方都已投完，显示弹窗并设置延迟关闭
    if (phase === 'ROLL_DONE' && rollMe !== null && rollOpp !== null) {
      // 生成先手提示文字
      let rollWinnerText = '';
      if (firstPlayerOpenid === myOpenid) {
        rollWinnerText = '你先手（黑棋）';
      } else if (firstPlayerOpenid === opponentOpenid) {
        rollWinnerText = '对手先手（黑棋）';
      } else {
        rollWinnerText = '投骰子完成';
      }
      
      // 幂等判断：如果 rollKey 变化了，才重新设置定时器
      if (currentRollKey !== (this._lastRollKey || '')) {
        // 清理旧的定时器
        if (this._rollCloseTimer) {
          clearTimeout(this._rollCloseTimer);
          this._rollCloseTimer = null;
        }
        
        // 显示弹窗
        this.setData({
          showRollModal: true,
          rollWinnerText: rollWinnerText
        });
        
        // 延迟1~2秒关闭（随机1.5秒左右）
        const delay = 1000 + Math.random() * 1000; // 1000-2000ms
        this._rollCloseTimer = setTimeout(() => {
          this.setData({
            showRollModal: false
          });
          this._rollCloseTimer = null;
        }, delay);
        
        // 记录当前 rollKey
        this._lastRollKey = currentRollKey;
        
        console.log('[updatePhaseState] ROLL_DONE 弹窗已显示，将在', delay, 'ms后关闭');
      }
    } else {
      // 非 ROLL_DONE 或未完成投骰子，隐藏弹窗
      if (this._rollCloseTimer) {
        clearTimeout(this._rollCloseTimer);
        this._rollCloseTimer = null;
      }
      if (this.data.showRollModal) {
        this.setData({
          showRollModal: false
        });
      }
      this._lastRollKey = '';
    }
    
    // 检查游戏是否已结束（基于 gameState.result，不是 games.phase）
    // 如果游戏已结束，不应该显示投骰子界面
    const gameEnded = game.gameState && 
                      typeof game.gameState === 'object' &&
                      game.gameState !== null &&
                      game.gameState.result &&
                      game.gameState.result !== 'ONGOING';
    
    // setData 更新 rollMe/rollOpp/phase
    this.setData({
      phase: phase,
      roll: roll,
      rollResult: rollResult,
      blackOpenid: blackOpenid,
      whiteOpenid: whiteOpenid,
      firstPlayerOpenid: firstPlayerOpenid,
      rollMe: rollMe,
      rollOpp: rollOpp,
      rolledMe: rolledMe,
      rollDone: phase === 'ROLL_DONE',
      // 如果游戏已结束，不显示投骰子界面（即使 games.phase 不是 ROLL_DONE）
      showRollOverlay: gameEnded ? false : (phase !== 'ROLL_DONE'),
      myPlayer: myPlayer,
      rollDisplay: rollDisplay
    });
    
    console.log('[updatePhaseState] setData 完成，phase:', phase, 'rollMe:', rollMe, 'rollOpp:', rollOpp, 'myPlayer:', myPlayer);
    
    // 检查 game.gameState 是否已终局（phase ENDED 或 result!=ONGOING）
    // 如果已终局，updatePhaseState 只负责骰子 UI，不允许执行 core.init/restore/startTick/stopTick 等会覆盖对局 UI/跳转的逻辑
    const gameStateEnded = game.gameState && 
                           typeof game.gameState === 'object' &&
                           game.gameState !== null &&
                           (game.gameState.phase === GamePhase.Ended || 
                            (game.gameState.result && game.gameState.result !== GameResult.Ongoing));
    
    if (gameStateEnded) {
      console.log('[updatePhaseState] 游戏已终局，跳过定时器和状态恢复逻辑');
      return; // 终局时只更新骰子 UI，不执行其他逻辑
    }
    
    // 检测 phase 变化，控制定时器
    // 在线对战在 phase !== 'ROLL_DONE' 时禁止 startTick（或立即 stopTick）
    const state = core.getState();
    if (state.config.mode === GameMode.PVP_ONLINE) {
      if (phase !== 'ROLL_DONE') {
        // 如果 phase 不是 ROLL_DONE，立即停止定时器
        if (this.tickTimer) {
          console.log('[updatePhaseState] phase 不是 ROLL_DONE，停止定时器');
          this.stopTick();
        }
      } else {
        // phase === 'ROLL_DONE' 时才启动定时器
        if (prevPhase !== 'ROLL_DONE') {
          console.log('[updatePhaseState] phase 变化：从非 ROLL_DONE -> ROLL_DONE，启动定时器');
          // 如果 phase === 'ROLL_DONE' 且 gameState 存在，恢复状态
          if (game.gameState && 
              typeof game.gameState === 'object' &&
              game.gameState !== null &&
              Array.isArray(game.gameState.board) && 
              Array.isArray(game.gameState.moves)) {
            try {
              core.restoreState(game.gameState);
              const state = core.getState();
              this.updateState(state);
              // 恢复状态后检查是否需要跳转
              this.maybeGotoResult(state);
            } catch (error) {
              console.error('[updatePhaseState] apply remoteState 失败:', error);
              console.error('[updatePhaseState] gameState 内容:', game.gameState);
            }
          }
          // 启动定时器
          this.startTick();
        }
      }
    }
    
    // 如果 phase === 'ROLL_DONE' 且 gameState 存在，恢复状态（首次加载或其他情况）
    if (phase === 'ROLL_DONE' && game.gameState && 
        typeof game.gameState === 'object' &&
        game.gameState !== null &&
        Array.isArray(game.gameState.board) && 
        Array.isArray(game.gameState.moves)) {
      const currentState = core.getState();
      if (currentState.moves.length === 0 || currentState.moves.length < game.gameState.moves.length) {
        try {
          core.restoreState(game.gameState);
          const state = core.getState();
          this.updateState(state);
          // 恢复状态后检查是否需要跳转
          this.maybeGotoResult(state);
        } catch (error) {
          console.error('[updatePhaseState] apply remoteState 失败:', error);
          console.error('[updatePhaseState] gameState 内容:', game.gameState);
        }
      }
    }
  },

  // 点击投骰子按钮
  async onTapRollDice() {
    if (this.data.rollAnimating || this.data.rolledMe || this.data.rollDone) {
      return;
    }
    
    if (!this.data.gameId) {
      wx.showToast({
        title: '游戏ID错误',
        icon: 'none'
      });
      return;
    }
    
    this.setData({ rollAnimating: true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'rollDice',
          gameId: this.data.gameId
        }
      });
      
      if (result.result.success) {
        const data = result.result.data;
        // 更新本地状态
        if (data.roll) {
          const myOpenid = wx.getStorageSync('openid') || '';
          if (data.roll[myOpenid] && typeof data.roll[myOpenid].value === 'number') {
            this.setData({
              rollMe: data.roll[myOpenid].value,
              rolledMe: true
            });
          }
        }
        
        // 如果 phase === 'ROLL_AGAIN'，提示重新投
        if (data.phase === 'ROLL_AGAIN') {
          wx.showToast({
            title: '点数相同，请重新投骰子',
            icon: 'none',
            duration: 2000
          });
          // 重置状态，允许重新投
          this.setData({
            rolledMe: false,
            rollMe: null,
            rollOpp: null
          });
        }
      } else {
        wx.showToast({
          title: result.result.errMsg || '投骰子失败',
          icon: 'none'
        });
      }
    } catch (error) {
      console.error('投骰子失败:', error);
      wx.showToast({
        title: error.message || '投骰子失败',
        icon: 'none'
      });
    } finally {
      this.setData({ rollAnimating: false });
    }
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
    
    // 清理骰子弹窗定时器
    if (this._rollCloseTimer) {
      clearTimeout(this._rollCloseTimer);
      this._rollCloseTimer = null;
    }
    
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
    
    const state = core.getState();
    
    // 在线对战模式：增加 phase gate，只有当 phase === 'ROLL_DONE' 时才允许启动定时器
    if (state.config.mode === GameMode.PVP_ONLINE) {
      if (this.data.phase !== 'ROLL_DONE') {
        console.log('[startTick] 在线对战：phase 不是 ROLL_DONE，不启动定时器，phase:', this.data.phase);
        return;
      }
    }
    
    // 只在游戏进行中才启动定时器
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
        
        // 在线对战模式：检查 phase，如果不是 ROLL_DONE 则停止定时器
        if (currentState.config.mode === GameMode.PVP_ONLINE) {
          if (this.data.phase !== 'ROLL_DONE') {
            console.log('[startTick] 在线对战：phase 不是 ROLL_DONE，停止定时器，phase:', this.data.phase);
            clearInterval(timerId);
            if (this.tickTimer === timerId) {
              this.tickTimer = 0;
            }
            return;
          }
          // 在线模式：不调用 core.tick()，只触发 UI 更新（计时由云端同步）
          // 通过 updateState 更新计时显示
          this.updateState(currentState);
        } else {
          // 非在线模式：调用 core.tick() 进行本地自减
          core.tick(1000);
        }
      }, 1000);
      this.tickTimer = timerId;
      console.log('[startTick] 定时器已启动');
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
    let remain = Infinity; // 用于超时检测
    if (state.config.timeLimitPerMove) {
      if (state.config.mode === GameMode.PVP_ONLINE) {
        // 在线模式：直接计算 remain = currentMoveRemain - (Date.now()-currentStartTs)/1000
        if (state.timeState.currentMoveRemain !== undefined && state.timeState.currentStartTs !== undefined) {
          const elapsed = (Date.now() - state.timeState.currentStartTs) / 1000;
          remain = Math.max(0, state.timeState.currentMoveRemain - elapsed);
          timerDisplay = this.formatTime(remain);
        } else {
          remain = state.config.timeLimitPerMove;
          timerDisplay = this.formatTime(remain);
        }
      } else {
        // 非在线模式：使用 currentMoveRemain（由 core.tick() 更新）
        if (state.timeState.currentMoveRemain !== undefined) {
          remain = state.timeState.currentMoveRemain;
          timerDisplay = this.formatTime(remain);
        } else {
          remain = state.config.timeLimitPerMove;
          timerDisplay = this.formatTime(remain);
        }
      }
    } else if (state.config.timeLimitPerPlayer) {
      remain = state.currentPlayer === Player.Black
        ? state.timeState.blackRemain
        : state.timeState.whiteRemain;
      timerDisplay = this.formatTime(remain);
    }
    
    console.log('updateState - timerDisplay:', timerDisplay, 'timeLimitPerMove:', state.config.timeLimitPerMove, 'currentMoveRemain:', state.timeState.currentMoveRemain, 'mode:', state.config.mode);
    
    // 在线对战模式：检测超时并自动换手
    if (state.config.mode === GameMode.PVP_ONLINE && 
        state.phase === GamePhase.Playing && 
        state.result === GameResult.Ongoing &&
        remain <= 0 && 
        this.data.gameId && 
        this.data.turnOpenid) {
      // 幂等防抖：使用 ${stateVersion}|${turnOpenid} 作为 key
      const stateVersion = this.data.lastStateVersion || 0;
      const timeoutKey = `${stateVersion}|${this.data.turnOpenid}`;
      
      if (this.data._timeoutSentKey !== timeoutKey) {
        console.log('[updateState] 检测到超时，调用 timeoutMove，key:', timeoutKey);
        this.data._timeoutSentKey = timeoutKey;
        
        // 异步调用云函数，不阻塞 UI 更新
        wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: {
            type: 'timeoutMove',
            gameId: this.data.gameId
          }
        }).then(result => {
          if (result.result && result.result.success) {
            console.log('[updateState] timeoutMove 成功，等待 watchGameState 同步');
            // 不在这里修改本地状态，等待 watchGameState 同步
            if (result.result.data && typeof result.result.data.newStateVersion === 'number') {
              this.setData({
                lastStateVersion: result.result.data.newStateVersion
              });
            }
          } else {
            const errMsg = result.result?.errMsg || '超时换手失败';
            console.warn('[updateState] timeoutMove 失败:', errMsg);
            // 如果是 "not timeout"，说明已经换手了，重置防抖 key
            if (errMsg === 'not timeout') {
              this.data._timeoutSentKey = '';
            }
          }
        }).catch(error => {
          console.error('[updateState] timeoutMove 调用异常:', error);
          // 重置防抖 key，允许重试
          this.data._timeoutSentKey = '';
        });
      }
    }
    
    // 更新获胜的五子位置
    const winningPositions = state.winningPositions || [];
    if (winningPositions.length > 0) {
      console.log('updateState: 设置winningPositions:', winningPositions);
    }
    
    // 在线对战模式：设置角色和回合相关变量
    let myRoleText = '';
    let opponentRoleText = '';
    let canPlay = false;
    let myColor = '';
    
    if (state.config.mode === GameMode.PVP_ONLINE) {
      // 根据 myPlayer 设置角色文本
      if (this.data.myPlayer === Player.Black) {
        myRoleText = '黑棋';
        opponentRoleText = '白棋';
        myColor = Player.Black;
      } else {
        myRoleText = '白棋';
        opponentRoleText = '黑棋';
        myColor = Player.White;
      }
      
      // canPlay: phase === 'ROLL_DONE' 且 currentPlayer === myPlayer
      canPlay = this.data.phase === 'ROLL_DONE' && state.currentPlayer === this.data.myPlayer;
    } else {
      // 非在线对战模式：默认设置
      myRoleText = state.currentPlayer === Player.Black ? '黑棋' : '白棋';
      opponentRoleText = state.currentPlayer === Player.Black ? '白棋' : '黑棋';
      canPlay = true;
      myColor = state.currentPlayer;
    }
    
    this.setData({
      board: state.board,
      lastMove: newLastMove,
      prevLastMove: newLastMove, // 更新上一次的落子记录
      currentPlayer: state.currentPlayer,
      timerDisplay: timerDisplay,
      winningPositions: winningPositions, // 更新获胜的五子位置
      myRoleText: myRoleText,
      opponentRoleText: opponentRoleText,
      canPlay: canPlay,
      myColor: myColor
    });
  },

  // 检查并跳转到结算页（统一终局跳转逻辑）
  maybeGotoResult(state) {
    // 仅基于 core.getState() 判断：state.phase==='ENDED' 或 state.result!=='ONGOING'
    if (state.phase !== GamePhase.Ended && state.result === GameResult.Ongoing) {
      return; // 游戏未结束，不跳转
    }

    // 在线模式才需要跳转
    if (state.config.mode !== GameMode.PVP_ONLINE) {
      return;
    }

    // 幂等防重复跳转
    if (this._navigatedToResult) {
      console.log('[maybeGotoResult] 已跳转过，跳过重复跳转');
      return;
    }

    console.log('[maybeGotoResult] 检测到游戏结束，跳转到结算页，phase:', state.phase, 'result:', state.result);

    // 标记已跳转
    this._navigatedToResult = true;

    // 停止监听和定时器
    if (this.data.gameWatcher) {
      this.data.gameWatcher.close();
    }
    this.stopTick();

    // 使用 wx.redirectTo 跳转到结算页
    // 调用 handleGameOver 处理跳转（复用逻辑，但使用 redirectTo 而不是 navigateTo）
    this.handleGameOver(state);
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
    ];
    
    // 在线对战模式：传递 roomId 和 gameId
    if (state.config.mode === GameMode.PVP_ONLINE) {
      if (this.data.roomId) {
        params.push(`roomId=${this.data.roomId}`);
      }
      if (this.data.gameId) {
        params.push(`gameId=${this.data.gameId}`);
      }
    }
    
    const paramsStr = params.filter(p => p.split('=')[1] !== '').join('&');
    
    // 在线模式使用 redirectTo，非在线模式使用 navigateTo
    const jumpMethod = state.config.mode === GameMode.PVP_ONLINE ? wx.redirectTo : wx.navigateTo;
    
    // 使用延迟确保所有状态更新完成后再跳转，避免跳转超时
    setTimeout(() => {
      jumpMethod({ 
        url: `/pages/result/index?${paramsStr}`,
        success: () => {
          console.log('跳转到结算页面成功');
        },
        fail: (err) => {
          console.error('跳转失败:', err);
          // 如果 redirectTo 失败，尝试 navigateTo 作为备选方案
          if (state.config.mode === GameMode.PVP_ONLINE) {
            wx.navigateTo({
              url: `/pages/result/index?${paramsStr}`,
              success: () => {
                console.log('navigateTo 跳转成功');
              },
              fail: (err2) => {
                console.error('navigateTo 也失败:', err2);
                wx.showToast({
                  title: '跳转失败，请重试',
                  icon: 'none',
                  duration: 2000
                });
              }
            });
          } else {
            wx.showToast({
              title: '跳转失败，请重试',
              icon: 'none',
              duration: 2000
            });
          }
        }
      });
    }, 100); // 延迟100ms确保状态更新完成
  },

  async handleCellTap(e) {
    // 检查游戏状态，确保游戏还在进行中
    const state = core.getState();
    if (state.phase !== GamePhase.Playing || state.result !== GameResult.Ongoing) {
      console.log('游戏未在进行中，忽略点击');
      return;
    }
    
    // 在线对战模式：检查 phase 和回合
    if (state.config.mode === GameMode.PVP_ONLINE) {
      // 如果 phase !== 'ROLL_DONE' 或 myPlayer 未确定，直接提示"请先投骰子决定先手"
      if (this.data.phase !== 'ROLL_DONE' || !this.data.myPlayer) {
        console.log('[handleCellTap] 在线对战：phase 不是 ROLL_DONE 或 myPlayer 未确定，phase:', this.data.phase, 'myPlayer:', this.data.myPlayer);
        wx.showToast({
          title: '请先投骰子决定先手',
          icon: 'none'
        });
        return;
      }
      
      // 若 state.currentPlayer !== myPlayer 则提示"等待对方落子"
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
      // 在线对战模式：只上传坐标，由云函数原子更新
      if (state.config.mode === GameMode.PVP_ONLINE) {
        // 调用 placeMove 云函数
        try {
          const result = await wx.cloud.callFunction({
            name: 'quickstartFunctions',
            data: {
              type: 'placeMove',
              gameId: this.data.gameId,
              x: Number(x),
              y: Number(y)
            }
          });
          
          // 检查云函数调用是否成功
          if (!result || !result.result) {
            throw new Error('云函数返回结构异常');
          }
          
          if (result.result.success) {
            // 在线模式：不在这里立即 restore，统一由 watchGameState 同步并 restore
            // 这样可以避免时序问题，确保状态同步的一致性
            // 只更新 stateVersion（如果返回了的话）
            if (result.result.data && typeof result.result.data.stateVersion === 'number') {
              this.setData({
                lastStateVersion: result.result.data.stateVersion
              });
            }
            
            // 播放落子音效
            if (this.data.enableSound) {
              this.playSound('move');
            }
            
            // 注意：状态同步由 watchGameState 负责，这里不调用 restoreState
            console.log('[placeMove] 落子成功，等待 watchGameState 同步状态');
          } else {
            // 落子失败，显示错误提示
            const errMsg = result.result.errMsg || '落子失败';
            console.error('[placeMove] 云函数返回失败:', errMsg);
            wx.showToast({
              title: errMsg,
              icon: 'none'
            });
            // 重置处理标志
            if (state.config.mode === GameMode.PVE) {
              this.isProcessingMoveSync = false;
              this.setData({ isProcessingMove: false });
            }
            return;
          }
        } catch (error) {
          // 云函数调用失败（网络错误、超时等）
          console.error('[placeMove] 云函数调用失败:', error);
          wx.showToast({
            title: error.message || '落子失败，请检查网络',
            icon: 'none'
          });
          // 重置处理标志
          if (state.config.mode === GameMode.PVE) {
            this.isProcessingMoveSync = false;
            this.setData({ isProcessingMove: false });
          }
          return;
        }
      } else {
        // 非在线对战模式：本地执行落子
        // 执行落子（这是同步调用，会立即执行）
        core.handlePlayerMove(Number(x), Number(y));
        
        const stateAfterMove = core.getState();
        const lastMove = stateAfterMove.moves[stateAfterMove.moves.length - 1];
        
        // 播放落子音效
        if (this.data.enableSound) {
          this.playSound('move');
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

  async handleResign() {
    const state = core.getState();
    
    // 在线对战模式：调用云函数认输
    if (state.config.mode === GameMode.PVP_ONLINE) {
      if (this.data.phase !== 'ROLL_DONE') {
        wx.showToast({
          title: '请先投骰子决定先手',
          icon: 'none'
        });
        return;
      }
      
      if (!this.data.gameId) {
        wx.showToast({
          title: '游戏ID错误',
          icon: 'none'
        });
        return;
      }
      
      try {
        const result = await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: {
            type: 'resignGame',
            gameId: this.data.gameId
          }
        });
        
        // 检查云函数调用是否成功
        if (!result || !result.result) {
          throw new Error('云函数返回结构异常');
        }
        
        if (result.result.success) {
          // 在线模式：不在这里立即 restore，统一由 watchGameState 同步并 restore
          // 只更新 stateVersion（如果返回了的话）
          if (result.result.data && typeof result.result.data.stateVersion === 'number') {
            this.setData({
              lastStateVersion: result.result.data.stateVersion
            });
          }
          
          // 注意：状态同步由 watchGameState 负责，这里不调用 restoreState
          console.log('[handleResign] 认输成功，等待 watchGameState 同步状态');
        } else {
          // 认输失败，显示错误提示
          const errMsg = result.result.errMsg || '认输失败';
          console.error('[handleResign] 云函数返回失败:', errMsg);
          wx.showToast({
            title: errMsg,
            icon: 'none'
          });
        }
      } catch (error) {
        // 云函数调用失败（网络错误、超时等）
        console.error('[handleResign] 云函数调用失败:', error);
        wx.showToast({
          title: error.message || '认输失败，请检查网络',
          icon: 'none'
        });
      }
    } else {
      // 非在线对战模式：本地处理认输
      core.handleResign(this.data.currentPlayer);
    }
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
