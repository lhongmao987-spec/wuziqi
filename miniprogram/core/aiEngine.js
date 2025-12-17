const { CellState, Player } = require('./types');

class AIEngine {
  constructor(ruleEngine) {
    this.ruleEngine = ruleEngine;
    this.DEBUG = false; // DEBUG 开关，用于定位问题
  }

  getNextMove(board, player, level, config) {
    switch (level) {
      case 'EASY':
        return this.easyMove(board, player);
      case 'MEDIUM':
        return this.mediumMove(board, player);
      case 'HARD':
        return this.hardMove(board, player, config);
      default:
        return this.easyMove(board, player);
    }
  }

  easyMove(board, player) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const boardSize = board.length;
    
    const winMove = this.findWinningMove(board, player);
    if (winMove) return winMove;

    const blockMove = this.findWinningMove(board, opponent);
    if (blockMove) return blockMove;

    const centerMoves = [];
    const start = Math.floor(boardSize * 0.3);
    const end = Math.ceil(boardSize * 0.7);

    for (let i = start; i < end; i++) {
      for (let j = start; j < end; j++) {
        if (board[i][j] === CellState.Empty) {
          centerMoves.push({ x: i, y: j });
        }
      }
    }

    if (centerMoves.length > 0) {
      return centerMoves[Math.floor(Math.random() * centerMoves.length)];
    }

    const allMoves = [];
    for (let i = 0; i < boardSize; i++) {
      for (let j = 0; j < boardSize; j++) {
        if (board[i][j] === CellState.Empty) {
          allMoves.push({ x: i, y: j });
        }
      }
    }

    if (allMoves.length > 0) {
      return allMoves[Math.floor(Math.random() * allMoves.length)];
    }

    return { x: 7, y: 7 };
  }

  mediumMove(board, player) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    
    const winMove = this.findWinningMove(board, player);
    if (winMove) return winMove;

    const blockMove = this.findWinningMove(board, opponent);
    if (blockMove) return blockMove;

    let bestScore = -Infinity;
    let bestMoves = [];

    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] !== CellState.Empty) continue;

        const score = this.evaluatePosition(board, i, j, player);
        
        if (score > bestScore) {
          bestScore = score;
          bestMoves = [{ x: i, y: j }];
        } else if (score === bestScore) {
          bestMoves.push({ x: i, y: j });
        }
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  hardMove(board, player, config) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    const reason = { type: '', move: null };

    const moveCount = this.countMoves(board);
    const topK = moveCount <= 10 ? 28 : (moveCount <= 40 ? 24 : 20);
    if (this.DEBUG) {
      console.log('[HARD] player=', player, 'opponent=', opponent, 'enableForbidden=', !!(config && config.enableForbidden), 'moveCount=', moveCount, 'topK=', topK);
    }
    
    // 1. 我方一步五连致胜
    const winMove = this.findWinningMove(board, player);
    if (winMove) {
      reason.type = 'win';
      reason.move = winMove;
      if (this.DEBUG) console.log('[HARD] reason=win', winMove);
      return winMove;
    }

    // 2-7. 基于 Threat Analyzer 的必防序列
    const threats = this.getOpponentThreatBlocks(board, player, config);
    if (this.DEBUG) {
      const summarize = (arr) => arr
        .slice(0, 5)
        .map(p => `(${p.x},${p.y},w=${p.w})`)
        .join(' ');
      console.log('[ThreatSummary] win:', threats.winBlocks.length, summarize(threats.winBlocks));
      console.log('[ThreatSummary] openFour:', threats.openFourBlocks.length, summarize(threats.openFourBlocks));
      console.log('[ThreatSummary] halfFour:', threats.halfFourBlocks.length, summarize(threats.halfFourBlocks));
      console.log('[ThreatSummary] fork:', threats.forkBlocks.length, summarize(threats.forkBlocks));
      console.log('[ThreatSummary] strongThree:', threats.strongThreeBlocks.length, summarize(threats.strongThreeBlocks));
      console.log('[ThreatSummary] openThree:', threats.openThreeBlocks.length, summarize(threats.openThreeBlocks));
      console.log('[ThreatSummary] openTwo:', threats.openTwoBlocks.length, summarize(threats.openTwoBlocks));
    }

    const defendOrder = [
      { key: 'winBlocks', label: 'block_win' },
      { key: 'openFourBlocks', label: 'block_openFour' },
      { key: 'halfFourBlocks', label: 'block_halfFour' },
      { key: 'forkBlocks', label: 'block_fork' },
      { key: 'strongThreeBlocks', label: 'block_strongThree' },
      { key: 'openThreeBlocks', label: 'block_openThree' },
      { key: 'openTwoBlocks', label: 'block_openTwo' },
    ];

    for (const item of defendOrder) {
      const arr = threats[item.key] || [];
      if (arr.length === 0) continue;
      const def = this.selectBestDefenseFromThreatPoints(board, arr, player, config);
      if (def) {
        reason.type = item.label;
        reason.move = def;
        if (this.DEBUG) console.log('[HARD] reason=' + item.label, def);
        return def;
      }
    }

    // 8. 我方战术进攻
    const attackMove = this.selectBestAttackMove(board, player);
    if (attackMove) {
      reason.type = 'attack';
      reason.move = attackMove;
      if (this.DEBUG) console.log('[HARD] reason=attack', attackMove);
      return attackMove;
    }

    // 9. alpha-beta 兜底
    const candidates = this.generateCandidates(board, topK, player);
    const bestMove = this.alphaBetaSearch(board, player, config, candidates, 250, 4);
    reason.type = 'search';
    reason.move = bestMove || candidates[0] || { x: 7, y: 7 };
    if (this.DEBUG) console.log('[HARD] reason=search', reason.move);
    return reason.move;
  }

  // 统计已落子数量
  countMoves(board) {
    let count = 0;
    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] !== CellState.Empty) count++;
      }
    }
    return count;
  }

  findWinningMove(board, player) {
    const cellValue = player === Player.Black ? CellState.Black : CellState.White;
    
    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] !== CellState.Empty) continue;

        board[i][j] = cellValue;
        const win = this.checkWin(board, i, j, cellValue);
        board[i][j] = CellState.Empty;

        if (win) {
          return { x: i, y: j };
        }
      }
    }
    return null;
  }

  checkWin(board, x, y, cellValue) {
    const directions = [
      [[0, 1], [0, -1]],
      [[1, 0], [-1, 0]],
      [[1, 1], [-1, -1]],
      [[1, -1], [-1, 1]]
    ];

    for (const dir of directions) {
      let count = 1;

      for (let i = 1; i < 5; i++) {
        const nx = x + dir[0][0] * i;
        const ny = y + dir[0][1] * i;
        if (!this.isInBounds(board, nx, ny) || board[nx][ny] !== cellValue) break;
        count++;
      }

      for (let i = 1; i < 5; i++) {
        const nx = x + dir[1][0] * i;
        const ny = y + dir[1][1] * i;
        if (!this.isInBounds(board, nx, ny) || board[nx][ny] !== cellValue) break;
        count++;
      }

      if (count >= 5) return true;
    }

    return false;
  }

  evaluatePosition(board, x, y, player) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;

    board[x][y] = playerValue;
    let score = 0;
    const playerScore = this.evaluateDirection(board, x, y, playerValue);
    
    board[x][y] = opponentValue;
    const opponentScore = this.evaluateDirection(board, x, y, opponentValue) * 0.9;
    
    board[x][y] = CellState.Empty;

    score = playerScore + opponentScore;

    const centerDistance = Math.abs(x - 7) + Math.abs(y - 7);
    score += (14 - centerDistance) * 5;

    return score;
  }

  evaluateDirection(board, x, y, cellValue) {
    const directions = [
      [[0, 1], [0, -1]],
      [[1, 0], [-1, 0]],
      [[1, 1], [-1, -1]],
      [[1, -1], [-1, 1]]
    ];

    let maxScore = 0;

    for (const dir of directions) {
      let count = 1;
      let blockCount = 0;

      for (let i = 1; i < 6; i++) {
        const nx = x + dir[0][0] * i;
        const ny = y + dir[0][1] * i;
        if (!this.isInBounds(board, nx, ny)) {
          blockCount++;
          break;
        }
        if (board[nx][ny] === cellValue) {
          count++;
        } else if (board[nx][ny] === CellState.Empty) {
          break;
        } else {
          blockCount++;
          break;
        }
      }

      for (let i = 1; i < 6; i++) {
        const nx = x + dir[1][0] * i;
        const ny = y + dir[1][1] * i;
        if (!this.isInBounds(board, nx, ny)) {
          blockCount++;
          break;
        }
        if (board[nx][ny] === cellValue) {
          count++;
        } else if (board[nx][ny] === CellState.Empty) {
          break;
        } else {
          blockCount++;
          break;
        }
      }

      let score = 0;
      if (count >= 5) {
        score = 100000;
      } else if (count === 4) {
        score = blockCount === 0 ? 10000 : 1000;
      } else if (count === 3) {
        score = blockCount === 0 ? 1000 : 100;
      } else if (count === 2) {
        score = blockCount === 0 ? 100 : 10;
      }

      maxScore = Math.max(maxScore, score);
    }

    return maxScore;
  }

  isInBounds(board, x, y) {
    return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
  }

  // 生成候选点（距离已有棋子切比雪夫距离 <=3 的空位）——双榜合并，兼顾攻防
  generateCandidates(board, topK = 24, perspectivePlayer = Player.White, forcedPoints = []) {
    const boardSize = board.length;
    const rawCandidates = [];
    const candidateSet = new Set();
    
    // 如果全盘无子，返回中心点
    let hasPiece = false;
    for (let i = 0; i < boardSize; i++) {
      for (let j = 0; j < boardSize; j++) {
        if (board[i][j] !== CellState.Empty) {
          hasPiece = true;
          break;
        }
      }
      if (hasPiece) break;
    }
    
    if (!hasPiece) {
      return [{ x: Math.floor(boardSize / 2), y: Math.floor(boardSize / 2) }];
    }

    // 收集距离已有棋子 <=3 的空位（放宽范围）
    for (let i = 0; i < boardSize; i++) {
      for (let j = 0; j < boardSize; j++) {
        if (board[i][j] !== CellState.Empty) {
          for (let di = -3; di <= 3; di++) {
            for (let dj = -3; dj <= 3; dj++) {
              const ni = i + di;
              const nj = j + dj;
              if (this.isInBounds(board, ni, nj) && board[ni][nj] === CellState.Empty) {
                const key = `${ni},${nj}`;
                if (!candidateSet.has(key)) {
                  candidateSet.add(key);
                  rawCandidates.push({ x: ni, y: nj });
                }
              }
            }
          }
        }
      }
    }

    // 双榜：防守榜、进攻榜
    const attackList = [];
    const defenseList = [];
    const opponent = perspectivePlayer === Player.Black ? Player.White : Player.Black;
    const perspectiveValue = perspectivePlayer === Player.Black ? CellState.Black : CellState.White;
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;

    for (const pos of rawCandidates) {
      const attackInfo = this.getThreatMetrics(board, pos.x, pos.y, perspectiveValue);
      const defenseInfo = this.getThreatMetrics(board, pos.x, pos.y, opponentValue);

      const attackScore = this.composeThreatScore(attackInfo, true);
      const defenseScore = this.composeThreatScore(defenseInfo, false);

      attackList.push({ pos, score: attackScore });
      defenseList.push({ pos, score: defenseScore });
    }

    attackList.sort((a, b) => b.score - a.score);
    defenseList.sort((a, b) => b.score - a.score);

    const needA = Math.ceil(topK * 0.5);
    const needD = Math.ceil(topK * 0.5);
    const forcedSet = new Set();
    const forcedArr = [];
    if (Array.isArray(forcedPoints)) {
      for (const fp of forcedPoints) {
        if (!this.isInBounds(board, fp.x, fp.y)) continue;
        if (board[fp.x][fp.y] !== CellState.Empty) continue;
        const key = `${fp.x},${fp.y}`;
        if (!forcedSet.has(key)) {
          forcedSet.add(key);
          forcedArr.push({ x: fp.x, y: fp.y });
        }
      }
    }

    const merged = [];
    const mergedSet = new Set(forcedSet);
    const pushCandidate = (entry) => {
      const key = `${entry.pos.x},${entry.pos.y}`;
      if (!mergedSet.has(key)) {
        mergedSet.add(key);
        merged.push(entry.pos);
      }
    };

    const needSupplement = Math.max(0, topK - forcedArr.length);
    const targetD = needD;
    const targetA = needA;
    let addedD = 0;
    let addedA = 0;

    for (let i = 0; i < defenseList.length && (addedD < targetD) && (merged.length < needSupplement); i++) {
      if (merged.length >= needSupplement) break;
      pushCandidate(defenseList[i]);
      addedD++;
    }
    for (let i = 0; i < attackList.length && (addedA < targetA) && (merged.length < needSupplement); i++) {
      if (merged.length >= needSupplement) break;
      pushCandidate(attackList[i]);
      addedA++;
    }

    if (merged.length < needSupplement) {
      const rest = [];
      for (const pos of rawCandidates) {
        const key = `${pos.x},${pos.y}`;
        if (mergedSet.has(key)) continue;
        const att = this.getThreatMetrics(board, pos.x, pos.y, perspectiveValue);
        const def = this.getThreatMetrics(board, pos.x, pos.y, opponentValue);
        const score = this.composeThreatScore(att, true) * 1.05 + this.composeThreatScore(def, false);
        rest.push({ pos, score });
      }
      rest.sort((a, b) => b.score - a.score);
      for (const r of rest) {
        if (merged.length >= needSupplement) break;
        pushCandidate(r);
      }
    }

    return forcedArr.concat(merged);
  }

  // 组合威胁分：四威胁>强活三>升级点数>中心性
  composeThreatScore(info, isAttack) {
    const centerDistance = Math.abs(info.x - 7) + Math.abs(info.y - 7);
    const centerBonus = (14 - centerDistance) * 2;
    const fourScore = info.fourBlocks * 12000;
    const strongThreeScore = info.strongThreeCount * 3500;
    const upgradeScore = info.strongThreeUpgrades * 800;
    const base = fourScore + strongThreeScore + upgradeScore + centerBonus;
    return base * (isAttack ? 1.0 : 1.0); // 攻防同量级，避免过度压制进攻
  }

  // 计算某点的四威胁/强活三指标
  getThreatMetrics(board, x, y, playerValue) {
    const opponentValue = playerValue === CellState.Black ? CellState.White : CellState.Black;
    if (board[x][y] !== CellState.Empty) {
      return { x, y, fourBlocks: 0, strongThreeCount: 0, strongThreeUpgrades: 0 };
    }

    // 四威胁
    board[x][y] = playerValue;
    let fourBlocks = 0;
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1]
    ];
    for (const [dx, dy] of directions) {
      const blocks = this.getCriticalBlocksInDirection(board, x, y, dx, dy, playerValue);
      fourBlocks += blocks.length;
    }

    // 强活三
    const strongInfo = this.getStrongOpenThreeInfo(board, x, y, playerValue);
    board[x][y] = CellState.Empty;

    return {
      x,
      y,
      fourBlocks,
      strongThreeCount: strongInfo.strongThreeCount,
      strongThreeUpgrades: strongInfo.threeUpgradePositions.size
    };
  }

  // 获取强活三信息（5窗口枚举，需可升级为四威胁）
  getStrongOpenThreeInfo(board, x, y, playerValue) {
    const opponentValue = playerValue === CellState.Black ? CellState.White : CellState.Black;
    if (board[x][y] !== CellState.Empty) {
      return { strongThreeCount: 0, threeEmptyPositions: new Set(), threeUpgradePositions: new Set() };
    }

    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1]
    ];

    const threeEmptyPositions = new Set();
    const threeUpgradePositions = new Set();
    let strongThreeCount = 0;

    board[x][y] = playerValue;

    const addPos = (set, pos) => set.add(`${pos.x},${pos.y}`);

    const canUpgradeToFour = (px, py) => {
      if (!this.isInBounds(board, px, py) || board[px][py] !== CellState.Empty) return false;
      board[px][py] = playerValue;
      let totalBlocks = 0;
      for (const [dx, dy] of directions) {
        const blocks = this.getCriticalBlocksInDirection(board, px, py, dx, dy, playerValue);
        totalBlocks += blocks.length;
      }
      board[px][py] = CellState.Empty;
      return totalBlocks > 0;
    };

    for (const [dx, dy] of directions) {
      const cells = this.getLineCells(board, x, y, dx, dy, 4);
      for (let start = 0; start <= 4; start++) {
        let attackerCount = 0;
        let emptyCount = 0;
        let opponentCount = 0;
        const empties = [];
        for (let i = start; i < start + 5 && i < cells.length; i++) {
          const cell = cells[i];
          if (cell.v === playerValue) {
            attackerCount++;
          } else if (cell.v === CellState.Empty) {
            emptyCount++;
            empties.push({ x: cell.x, y: cell.y });
          } else {
            opponentCount++;
          }
        }
        if (attackerCount === 3 && emptyCount === 2 && opponentCount === 0) {
          // 活三窗口候选，需验证升级点
          let canUpgrade = false;
          for (const e of empties) {
            if (canUpgradeToFour(e.x, e.y)) {
              canUpgrade = true;
              addPos(threeUpgradePositions, e);
            }
          }
          if (canUpgrade) {
            strongThreeCount++;
            for (const e of empties) {
              addPos(threeEmptyPositions, e);
            }
          }
        }
      }
    }

    board[x][y] = CellState.Empty;

    return { strongThreeCount, threeEmptyPositions, threeUpgradePositions };
  }

  // 全盘扫描对手活三（5窗口枚举）
  scanOpenThreeThreats(board, opponentValue) {
    const size = board.length;
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    let threatCount = 0;
    const blockCountMap = new Map();
    const addBlock = (x, y) => {
      const key = `${x},${y}`;
      blockCountMap.set(key, (blockCountMap.get(key) || 0) + 1);
    };

    for (const [dx, dy] of directions) {
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          const endX = x + dx * 4;
          const endY = y + dy * 4;
          if (endX < 0 || endX >= size || endY < 0 || endY >= size) continue;
          let opponentCount = 0;
          let emptyCount = 0;
          let myCount = 0;
          const empties = [];
          for (let k = 0; k < 5; k++) {
            const nx = x + dx * k;
            const ny = y + dy * k;
            const v = board[nx][ny];
            if (v === opponentValue) {
              opponentCount++;
            } else if (v === CellState.Empty) {
              emptyCount++;
              empties.push({ x: nx, y: ny });
            } else {
              myCount++;
            }
          }
          if (opponentCount === 3 && emptyCount === 2 && myCount === 0) {
            threatCount++;
            for (const e of empties) addBlock(e.x, e.y);
          }
        }
      }
    }

    const blockPoints = [];
    for (const [key, count] of blockCountMap.entries()) {
      const [sx, sy] = key.split(',').map(n => parseInt(n, 10));
      blockPoints.push({ x: sx, y: sy, count });
    }

    return { threatCount, blockPoints };
  }

  // 全盘扫描强活三（支持5格与6格窗口，含跳活三）
  scanStrongOpenThreeThreats(board, opponentPlayer, config) {
    const oppValue = opponentPlayer === Player.Black ? CellState.Black : CellState.White;
    const size = board.length;
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    const windowLens = [5, 6]; // 5格活三与6格跳活三
    let strongCount = 0;
    const upgradeSet = new Set();
    const blockSet = new Set();
    const weightMap = new Map();

    const addPoint = (set, x, y, weightAdd = 1) => {
      const key = `${x},${y}`;
      set.add(key);
      weightMap.set(key, (weightMap.get(key) || 0) + weightAdd);
    };

    for (const [dx, dy] of directions) {
      for (const winLen of windowLens) {
        for (let x = 0; x < size; x++) {
          for (let y = 0; y < size; y++) {
            const endX = x + dx * (winLen - 1);
            const endY = y + dy * (winLen - 1);
            if (endX < 0 || endX >= size || endY < 0 || endY >= size) continue;

            let oppCount = 0;
            let emptyCount = 0;
            let myCount = 0;
            const empties = [];
            for (let k = 0; k < winLen; k++) {
              const nx = x + dx * k;
              const ny = y + dy * k;
              const v = board[nx][ny];
              if (v === oppValue) oppCount++;
              else if (v === CellState.Empty) {
                emptyCount++;
                empties.push({ x: nx, y: ny });
              } else {
                myCount++;
              }
            }

            // 活三候选：3子且至少2空且无我方子
            if (oppCount === 3 && myCount === 0 && emptyCount >= 2) {
              let strongWindow = false;
              for (const e of empties) {
                if (board[e.x][e.y] !== CellState.Empty) continue;
                board[e.x][e.y] = oppValue;
                let hasFour = false;
                for (const [sx, sy] of directions) {
                  const blocks = this.getCriticalBlocksInDirection(board, e.x, e.y, sx, sy, oppValue);
                  if (blocks.length >= 1) {
                    hasFour = true;
                    break;
                  }
                }
                board[e.x][e.y] = CellState.Empty;
                if (hasFour) {
                  strongWindow = true;
                  addPoint(upgradeSet, e.x, e.y, 3); // 升级点权重大
                }
              }

              if (strongWindow) {
                strongCount++;
                for (const e of empties) {
                  addPoint(blockSet, e.x, e.y, 1);
                }
              }
            }
          }
        }
      }
    }

    const toArr = (set) => Array.from(set).map(k => {
      const [sx, sy] = k.split(',').map(n => parseInt(n, 10));
      return { x: sx, y: sy };
    });
    return {
      strongCount,
      upgradePoints: toArr(upgradeSet),
      blockPoints: toArr(blockSet),
      pointWeights: weightMap,
    };
  }

  // 统计某点的四威胁数量（使用5窗口 critical blocks）
  getFourBlocksCount(board, x, y, player) {
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    if (board[x][y] !== CellState.Empty) return 0;
    board[x][y] = playerValue;
    let total = 0;
    const dirs = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (const [dx, dy] of dirs) {
      const blocks = this.getCriticalBlocksInDirection(board, x, y, dx, dy, playerValue);
      total += blocks.length;
    }
    board[x][y] = CellState.Empty;
    return total;
  }

  // 计算 fork 信息（四威胁 + 强活三）
  getForkInfo(board, x, y, player) {
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    if (board[x][y] !== CellState.Empty) {
      return { fourBlocks: 0, strongThreeCount: 0, upgradeCount: 0, fork: false, isFork: false };
    }
    board[x][y] = playerValue;
    const fourBlocks = this.getFourBlocksCount(board, x, y, player);
    const t = this.classifyOnBoardAssumingPlaced(board, x, y, playerValue);
    const isFork = (t.openFour >= 2)
      || (t.openFour >= 1 && (t.strongThree >= 1 || t.halfFour >= 1))
      || (t.strongThree >= 2)
      || (t.halfFour >= 2);
    board[x][y] = CellState.Empty;
    return {
      fourBlocks,
      strongThreeCount: t.strongThree,
      upgradeCount: 0,
      fork: isFork || !!t.fork,
      isFork: isFork || !!t.fork,
    };
  }

  // 选择最佳堵点用于活三防守
  selectBestOpenThreeBlock(board, blockPoints, player) {
    if (!blockPoints || blockPoints.length === 0) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const bp of blockPoints) {
      if (!this.isInBounds(board, bp.x, bp.y)) continue;
      if (board[bp.x][bp.y] !== CellState.Empty) continue;
      const forkInfo = this.getForkInfo(board, bp.x, bp.y, player);
      const centerDistance = Math.abs(bp.x - 7) + Math.abs(bp.y - 7);
      const centerBonus = (14 - centerDistance) * 50;
      const score = (bp.count || 1) * 10000
        + forkInfo.fourBlocks * 8000
        + forkInfo.strongThreeCount * 4000
        + forkInfo.upgradeCount * 800
        + centerBonus;
      if (score > bestScore) {
        bestScore = score;
        best = { x: bp.x, y: bp.y };
      }
    }
    return best;
  }

  // 通用防守选点（支持带重复的点，按共享次数加权）
  selectBestDefenseFromPoints(board, points, player) {
    if (!points || points.length === 0) return null;
    const countMap = new Map();
    for (const p of points) {
      const key = `${p.x},${p.y}`;
      countMap.set(key, (countMap.get(key) || 0) + (p.count || 1));
    }

    let best = null;
    let bestScore = -Infinity;
    for (const [key, cnt] of countMap.entries()) {
      const [sx, sy] = key.split(',').map(n => parseInt(n, 10));
      if (!this.isInBounds(board, sx, sy)) continue;
      if (board[sx][sy] !== CellState.Empty) continue;
      const forkInfo = this.getForkInfo(board, sx, sy, player);
      const centerDistance = Math.abs(sx - 7) + Math.abs(sy - 7);
      const centerBonus = (14 - centerDistance) * 50;
      const score = cnt * 12000
        + forkInfo.fourBlocks * 8000
        + forkInfo.strongThreeCount * 4000
        + forkInfo.upgradeCount * 800
        + centerBonus;
      if (score > bestScore) {
        bestScore = score;
        best = { x: sx, y: sy };
      }
    }
    return best;
  }

  // 选择最佳堵点用于强活三防守（考虑升级点权重）
  selectBestStrongThreeBlock(board, strongInfo, player) {
    const { blockPoints = [], upgradePoints = [], pointWeights = new Map() } = strongInfo || {};
    const allPoints = [];
    const seen = new Set();
    const pushPoint = (p, weight) => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      allPoints.push({ x: p.x, y: p.y, weight });
    };
    for (const p of upgradePoints) {
      const w = pointWeights.get(`${p.x},${p.y}`) || 3;
      pushPoint(p, w + 5); // 升级点额外加权
    }
    for (const p of blockPoints) {
      const w = pointWeights.get(`${p.x},${p.y}`) || 1;
      pushPoint(p, w);
    }
    if (allPoints.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;
    for (const pt of allPoints) {
      if (!this.isInBounds(board, pt.x, pt.y)) continue;
      if (board[pt.x][pt.y] !== CellState.Empty) continue;
      const forkInfo = this.getForkInfo(board, pt.x, pt.y, player);
      const centerDistance = Math.abs(pt.x - 7) + Math.abs(pt.y - 7);
      const centerBonus = (14 - centerDistance) * 50;
      const score = pt.weight * 12000
        + forkInfo.fourBlocks * 8000
        + forkInfo.strongThreeCount * 4000
        + forkInfo.upgradeCount * 800
        + centerBonus;
      if (score > bestScore) {
        bestScore = score;
        best = { x: pt.x, y: pt.y };
      }
    }
    return best;
  }

  // 在指定位置评估一个方向的棋型
  evaluateDirectionAt(board, x, y, dir, cellValue) {
    let count = 0;
    let openEnds = 0;

    // 正方向
    let pos1Open = false;
    for (let i = 1; i < 5; i++) {
      const nx = x + dir[0][0] * i;
      const ny = y + dir[0][1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      if (board[nx][ny] === cellValue) {
        count++;
      } else if (board[nx][ny] === CellState.Empty) {
        if (count === 0) pos1Open = true;
        break;
      } else {
        break;
      }
    }
    if (pos1Open) openEnds++;

    // 反方向
    let pos2Open = false;
    for (let i = 1; i < 5; i++) {
      const nx = x + dir[1][0] * i;
      const ny = y + dir[1][1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      if (board[nx][ny] === cellValue) {
        count++;
      } else if (board[nx][ny] === CellState.Empty) {
        if (count === 0) pos2Open = true;
        break;
      } else {
        break;
      }
    }
    if (pos2Open) openEnds++;

    // 评分
    if (count >= 4) return 10000;
    if (count === 3 && openEnds >= 1) return 1000;
    if (count === 2 && openEnds >= 1) return 100;
    return count * 10;
  }

  // VCT 搜索（活三威胁空间搜索）
  searchVCT(board, attackerPlayer, config, depthLimit = 6, timeLimit = 220) {
    const startTime = Date.now();
    const result = this.searchVCTRecursive(board, attackerPlayer, config, 0, depthLimit, startTime, timeLimit);
    return result ? result.move : null;
  }

  searchVCTRecursive(board, attackerPlayer, config, depth, depthLimit, startTime, timeLimit) {
    if (Date.now() - startTime > timeLimit || depth >= depthLimit) {
      return null;
    }
    const defenderPlayer = attackerPlayer === Player.Black ? Player.White : Player.Black;
    const attackerValue = attackerPlayer === Player.Black ? CellState.Black : CellState.White;

    // 直接胜
    const winMove = this.findWinningMove(board, attackerPlayer);
    if (winMove) {
      return { move: winMove, depth };
    }

    // 生成威胁招法：四威胁或强活三
    const threatMoves = this.getVCTThreatMoves(board, attackerPlayer, config);
    if (threatMoves.length === 0) return null;

    for (const tm of threatMoves) {
      board[tm.x][tm.y] = attackerValue;

      // 再次检查直接胜
      if (this.checkWin(board, tm.x, tm.y, attackerValue)) {
        board[tm.x][tm.y] = CellState.Empty;
        return { move: tm, depth: depth + 1 };
      }

      let forcedBlocks = [];
      if (tm.type === 'four') {
        forcedBlocks = this.getForcedBlocksForThreat(board, tm, attackerPlayer, config);
      } else {
        // 强活三：空位 + 升级位必须应手
        forcedBlocks = Array.from(new Set([
          ...tm.threeEmptyKeys,
          ...tm.upgradeKeys
        ])).map(k => {
          const [sx, sy] = k.split(',').map(n => parseInt(n, 10));
          return { x: sx, y: sy };
        });
      }

      if (forcedBlocks.length === 0) {
        board[tm.x][tm.y] = CellState.Empty;
        return { move: tm, depth: depth + 1 };
      }

      let success = false;
      for (const fb of forcedBlocks) {
        if (config && config.enableForbidden && defenderPlayer === Player.Black) {
          const testMove = { x: fb.x, y: fb.y, player: Player.Black };
          if (this.ruleEngine.checkForbidden(board, testMove, config)) continue;
        }
        const defenderValue = defenderPlayer === Player.Black ? CellState.Black : CellState.White;
        if (board[fb.x][fb.y] !== CellState.Empty) continue;
        board[fb.x][fb.y] = defenderValue;

        const res = this.searchVCTRecursive(board, attackerPlayer, config, depth + 1, depthLimit, startTime, timeLimit);

        board[fb.x][fb.y] = CellState.Empty;
        if (res) {
          success = true;
          if (depth === 0) {
            board[tm.x][tm.y] = CellState.Empty;
            return { move: tm, depth: res.depth + 1 };
          }
          board[tm.x][tm.y] = CellState.Empty;
          return { move: res.move, depth: res.depth + 1 };
        }
      }

      board[tm.x][tm.y] = CellState.Empty;
      if (success) {
        return null;
      }
    }
    return null;
  }

  // VCT 威胁招法：四威胁或强活三
  getVCTThreatMoves(board, attackerPlayer, config) {
    const attackerValue = attackerPlayer === Player.Black ? CellState.Black : CellState.White;
    const candidates = this.generateCandidates(board, 32, attackerPlayer);
    const moves = [];
    for (const c of candidates) {
      if (config && config.enableForbidden && attackerPlayer === Player.Black) {
        const testMove = { x: c.x, y: c.y, player: Player.Black };
        if (this.ruleEngine.checkForbidden(board, testMove, config)) continue;
      }
      // 四威胁
      const fb = this.getFourBlocksCount(board, c.x, c.y, attackerPlayer);
      if (fb >= 1) {
        moves.push({ x: c.x, y: c.y, type: 'four' });
        continue;
      }
      // 强活三
      const strongInfo = this.getStrongOpenThreeInfo(board, c.x, c.y, attackerValue);
      if (strongInfo.strongThreeCount >= 1 && strongInfo.threeUpgradePositions.size > 0) {
        moves.push({
          x: c.x,
          y: c.y,
          type: 'three',
          threeEmptyKeys: Array.from(strongInfo.threeEmptyPositions),
          upgradeKeys: Array.from(strongInfo.threeUpgradePositions),
        });
      }
    }
    return moves;
  }

  // VCF 搜索（连续冲四强制杀）- 重构为强制线 VCF
  searchVCF(board, attackerPlayer, config, depthLimit = 8) {
    const startTime = Date.now();
    const timeLimit = 200; // VCF 搜索时间限制 200ms
    
    const vcfResult = this.searchVCFRecursive(board, attackerPlayer, config, 0, depthLimit, startTime, timeLimit);
    return vcfResult ? vcfResult.move : null;
  }

  // 强制线 VCF 递归搜索
  searchVCFRecursive(board, attackerPlayer, config, depth, depthLimit, startTime, timeLimit) {
    if (Date.now() - startTime > timeLimit || depth >= depthLimit) {
      return null;
    }

    const defenderPlayer = attackerPlayer === Player.Black ? Player.White : Player.Black;
    const attackerValue = attackerPlayer === Player.Black ? CellState.Black : CellState.White;

    // 检查 attacker 是否直接五连（胜利则成功返回）
    const winMove = this.findWinningMove(board, attackerPlayer);
    if (winMove) {
      return { move: winMove, depth: depth };
    }

    // 检查 defender 是否要获胜（必须堵）
    const defenderWinMove = this.findWinningMove(board, defenderPlayer);
    if (defenderWinMove) {
      return null; // defender 要赢了，VCF 失败
    }

    // 从候选点生成四威胁招法（不要全盘扫）
    const threatMoves = this.getFourThreatMoves(board, attackerPlayer, config);
    if (threatMoves.length === 0) {
      return null; // 没有四威胁，VCF 失败
    }

    // 尝试每个四威胁点
    for (const threatMove of threatMoves) {
      board[threatMove.x][threatMove.y] = attackerValue;
      
      // 检查 attacker 落子后是否直接五连
      const immediateWin = this.checkWin(board, threatMove.x, threatMove.y, attackerValue);
      if (immediateWin) {
        board[threatMove.x][threatMove.y] = CellState.Empty;
        // 如果深度为0，返回第一步
        if (depth === 0) {
          return { move: threatMove, depth: depth + 1 };
        }
        return { move: threatMove, depth: depth + 1 };
      }

      // 计算 defender 的 forcedBlocks（堵住该四威胁线段的关键空点）
      const forcedBlocks = this.getForcedBlocksForThreat(board, threatMove, attackerPlayer, config);
      
      if (this.DEBUG) {
        if (depth === 0) {
          console.log('[VCF] threatMove:', threatMove, 'forcedBlocks.size:', forcedBlocks.length);
        }
      }

      // 若 forcedBlocks 为空，表示该四威胁无法被防住 => VCF 成功
      if (forcedBlocks.length === 0) {
        board[threatMove.x][threatMove.y] = CellState.Empty;
        if (this.DEBUG && depth === 0) {
          console.log('[VCF] 命中 VCF，返回第一步:', threatMove);
        }
        if (depth === 0) {
          return { move: threatMove, depth: depth + 1 };
        }
        return { move: threatMove, depth: depth + 1 };
      }

      // defender 只能从 forcedBlocks 中选择落子
      let allBlocksValid = false;
      for (const block of forcedBlocks) {
        // 如果 defender 是黑棋且 enableForbidden，过滤掉禁手堵点
        if (config && config.enableForbidden && defenderPlayer === Player.Black) {
          const testMove = { x: block.x, y: block.y, player: Player.Black };
          if (this.ruleEngine.checkForbidden(board, testMove, config)) {
            continue; // 跳过禁手堵点
          }
        }

        const defenderValue = defenderPlayer === Player.Black ? CellState.Black : CellState.White;
        board[block.x][block.y] = defenderValue;
        
        // 递归进入下一层（仍然由 attacker 继续找四威胁）
        const result = this.searchVCFRecursive(board, attackerPlayer, config, depth + 1, depthLimit, startTime, timeLimit);
        
        board[block.x][block.y] = CellState.Empty;

        if (result) {
          // 如果深度为0，返回第一步 threatMove
          if (depth === 0) {
            board[threatMove.x][threatMove.y] = CellState.Empty;
            if (this.DEBUG) {
              console.log('[VCF] 命中 VCF，返回第一步:', threatMove, 'depth:', result.depth + 1);
            }
            return { move: threatMove, depth: result.depth + 1 };
          }
          board[threatMove.x][threatMove.y] = CellState.Empty;
          return { move: result.move, depth: result.depth + 1 };
        }
        
        // 至少有一个 block 分支有效
        allBlocksValid = true;
      }

      board[threatMove.x][threatMove.y] = CellState.Empty;

      // 如果所有 forcedBlocks 都无法阻止 VCF，则失败
      if (!allBlocksValid) {
        continue;
      }
    }

    return null;
  }

  // 获取一条线上的所有格子（5窗口枚举法基础工具）
  getLineCells(board, x, y, dx, dy, span = 4) {
    const cells = [];
    for (let i = -span; i <= span; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (this.isInBounds(board, nx, ny)) {
        cells.push({ x: nx, y: ny, v: board[nx][ny] });
      } else {
        // 越界视作被堵（opponent/blocked）
        cells.push({ x: nx, y: ny, v: 2 });
      }
    }
    return cells;
  }

  // 生成线段字符串表示，便于模式匹配（X=己方，O=对手，.=空，#=越界）
  getLineString(board, x, y, dx, dy, playerValue, span = 6) {
    const opponentValue = playerValue === CellState.Black ? CellState.White : CellState.Black;
    let str = '';
    for (let i = -span; i <= span; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (!this.isInBounds(board, nx, ny)) {
        str += '#';
        continue;
      }
      const v = board[nx][ny];
      if (v === playerValue) {
        str += 'X';
      } else if (v === CellState.Empty) {
        str += '.';
      } else if (v === opponentValue) {
        str += 'O';
      } else {
        str += '#';
      }
    }
    return str;
  }

  // 在一条线字符串上做滑窗匹配，返回起始 index
  findPatternMatches(lineStr, pattern) {
    const matches = [];
    if (typeof pattern === 'string') {
      let from = 0;
      while (true) {
        const pos = lineStr.indexOf(pattern, from);
        if (pos === -1) break;
        matches.push({ index: pos, match: pattern });
        from = pos + 1;
      }
    } else if (pattern instanceof RegExp) {
      const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
      const reg = new RegExp(pattern.source, flags);
      let m;
      while ((m = reg.exec(lineStr)) !== null) {
        matches.push({ index: m.index, match: m[0] });
        if (m.index === reg.lastIndex) reg.lastIndex++; // 避免零宽死循环
      }
    }
    return matches;
  }

  // 基于线字符串的落子后局部形态分类
  classifyAfterPlace(board, x, y, playerValue) {
    const zero = {
      win: false,
      openFour: 0,
      halfFour: 0,
      openThree: 0,
      strongThree: 0,
      openTwo: 0,
      fork: false,
      detail: { perDir: [] },
    };
    if (!this.isInBounds(board, x, y) || board[x][y] !== CellState.Empty) {
      return zero;
    }

    const span = 6;
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];

    const result = { ...zero, detail: { perDir: [] } };
    const playerFromValue = playerValue === CellState.Black ? Player.Black : Player.White;

    const halfFourPatterns = ['XXXX.', '.XXXX', 'XXX.X', 'XX.XX', 'X.XXX'];
    const openThreePatterns = ['.XXX.', '.XX.X.', '.X.XX.'];
    // 仅用于提前防双二
    const openTwoPatterns = ['.XX.', '.X.X.'];

    // 临时落子
    board[x][y] = playerValue;

    const coversCenter = (start, len, spanVal) => {
      const end = start + len - 1;
      return start <= spanVal && spanVal <= end;
    };

    const validWindow = (line, start, len) => {
      const sub = line.slice(start, start + len);
      return !sub.includes('O') && !sub.includes('#');
    };

    for (const [dx, dy] of directions) {
      const line = this.getLineString(board, x, y, dx, dy, playerValue, span);
      let dirOpenFour = 0;
      let dirHalfFour = 0;
      let dirOpenThree = 0;
      let dirStrongThree = 0;
      let dirOpenTwo = 0;

      // 五连
      if (!result.win) {
        const wins = this.findPatternMatches(line, 'XXXXX');
        for (const w of wins) {
          if (!validWindow(line, w.index, 5)) continue;
          if (!coversCenter(w.index, 5, span)) continue;
          result.win = true;
          break;
        }
      }

      // 活四
      const ofMatches = this.findPatternMatches(line, '.XXXX.');
      for (const m of ofMatches) {
        if (!validWindow(line, m.index, 6)) continue;
        if (!coversCenter(m.index, 6, span)) continue;
        dirOpenFour++;
      }

      // 冲四 / 跳四
      for (const p of halfFourPatterns) {
        const hms = this.findPatternMatches(line, p);
        for (const m of hms) {
          if (!validWindow(line, m.index, p.length)) continue;
          if (!coversCenter(m.index, p.length, span)) continue;
          dirHalfFour++;
        }
      }

      // 活三 / 跳三 + 强活三
      for (const p of openThreePatterns) {
        const tms = this.findPatternMatches(line, p);
        for (const m of tms) {
          if (!validWindow(line, m.index, p.length)) continue;
          if (!coversCenter(m.index, p.length, span)) continue;
          dirOpenThree++;

          const empties = [];
          for (let i = 0; i < p.length; i++) {
            if (p[i] === '.') {
              const idx = m.index + i;
              const offset = idx - span;
              const ex = x + dx * offset;
              const ey = y + dy * offset;
              if (this.isInBounds(board, ex, ey) && board[ex][ey] === CellState.Empty) {
                empties.push({ x: ex, y: ey });
              }
            }
          }

          let upgraded = false;
          for (const e of empties) {
            board[e.x][e.y] = playerValue;
            const fb = this.getFourBlocksCount(board, e.x, e.y, playerFromValue);
            board[e.x][e.y] = CellState.Empty;
            if (fb >= 1) {
              upgraded = true;
              break;
            }
          }
          if (upgraded) dirStrongThree++;
        }
      }

      // 活二 / 跳二
      for (const p of openTwoPatterns) {
        const ms = this.findPatternMatches(line, p);
        for (const m of ms) {
          if (!validWindow(line, m.index, p.length)) continue;
          if (!coversCenter(m.index, p.length, span)) continue;
          dirOpenTwo++;
        }
      }

      result.openFour += dirOpenFour;
      result.halfFour += dirHalfFour;
      result.openThree += dirOpenThree;
      result.strongThree += dirStrongThree;
      result.openTwo += dirOpenTwo;
      result.detail.perDir.push({
        dx, dy, lineStr: line,
        openFour: dirOpenFour,
        halfFour: dirHalfFour,
        openThree: dirOpenThree,
        strongThree: dirStrongThree,
        openTwo: dirOpenTwo,
      });
    }

    // 撤销临时落子
    board[x][y] = CellState.Empty;

    // fork 判定：以威胁强度定义（必须覆盖“双活三”）
    const isFork =
      (result.openFour >= 2) ||
      (result.openFour >= 1 && (result.halfFour >= 1 || result.strongThree >= 1 || result.openThree >= 1)) ||
      (result.halfFour >= 2) ||
      (result.strongThree >= 2) ||
      (result.openThree >= 2) ||   // 双活三
      (result.openTwo >= 2);       // 双活二
    result.fork = isFork;

    return result;
  }

  // 在已落子的前提下进行分类，避免重复落子开销
  classifyOnBoardAssumingPlaced(board, x, y, playerValue) {
    const original = board[x][y];
    if (original !== playerValue) {
      return {
        win: false,
        openFour: 0,
        halfFour: 0,
        openThree: 0,
        strongThree: 0,
        openTwo: 0,
        fork: false,
        detail: { perDir: [] },
      };
    }
    board[x][y] = CellState.Empty;
    const res = this.classifyAfterPlace(board, x, y, playerValue);
    board[x][y] = original;
    return res;
  }

  // 计算对手下一手的威胁点集合（自由规则，不做禁手过滤）
  getOpponentThreatBlocks(board, player, config) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;

    const addToMap = (map, x, y, w) => {
      const key = `${x},${y}`;
      map.set(key, (map.get(key) || 0) + w);
    };

    const winMap = new Map();
    const openFourMap = new Map();
    const halfFourMap = new Map();
    const forkMap = new Map();
    const strongThreeMap = new Map();
    const openThreeMap = new Map();
    const openTwoMap = new Map();

    const candidates = this.generateCandidates(board, 120, opponent);

    for (const c of candidates) {
      if (!this.isInBounds(board, c.x, c.y)) continue;
      if (board[c.x][c.y] !== CellState.Empty) continue;

      const info = this.classifyAfterPlace(board, c.x, c.y, opponentValue);

      // 只取最高等级威胁，避免多桶叠加噪声
      if (info.win) {
        addToMap(winMap, c.x, c.y, 1000);
      } else if (info.openFour > 0) {
        addToMap(openFourMap, c.x, c.y, 300 * info.openFour);
      } else if (info.halfFour > 0) {
        addToMap(halfFourMap, c.x, c.y, 120 * info.halfFour);
      } else if (info.fork) {
        addToMap(forkMap, c.x, c.y, 200);
      } else if (info.strongThree > 0) {
        addToMap(strongThreeMap, c.x, c.y, 60 * info.strongThree);
      } else if (info.openThree > 0) {
        addToMap(openThreeMap, c.x, c.y, 25 * info.openThree);
      } else if (info.openTwo > 0) {
        addToMap(openTwoMap, c.x, c.y, 10 * info.openTwo);
      }
    }

    // 将 map 转换为数组
    const toArr = (map) => Array.from(map.entries())
      .map(([key, w]) => {
        const [sx, sy] = key.split(',').map(n => parseInt(n, 10));
        return { x: sx, y: sy, w };
      })
      .sort((a, b) => b.w - a.w);

    const result = {
      winBlocks: toArr(winMap),
      openFourBlocks: toArr(openFourMap),
      halfFourBlocks: toArr(halfFourMap),
      forkBlocks: toArr(forkMap),
      strongThreeBlocks: toArr(strongThreeMap),
      openThreeBlocks: toArr(openThreeMap),
      openTwoBlocks: toArr(openTwoMap),
    };

    if (this.DEBUG) {
      const summarize = (arr) => arr
        .slice(0, 5)
        .map(p => `(${p.x},${p.y},w=${p.w})`)
        .join(' ');
      console.log('[ThreatBlocks] win:', result.winBlocks.length, summarize(result.winBlocks));
      console.log('[ThreatBlocks] openFour:', result.openFourBlocks.length, summarize(result.openFourBlocks));
      console.log('[ThreatBlocks] halfFour:', result.halfFourBlocks.length, summarize(result.halfFourBlocks));
      console.log('[ThreatBlocks] fork:', result.forkBlocks.length, summarize(result.forkBlocks));
      console.log('[ThreatBlocks] strongThree:', result.strongThreeBlocks.length, summarize(result.strongThreeBlocks));
      console.log('[ThreatBlocks] openThree:', result.openThreeBlocks.length, summarize(result.openThreeBlocks));
      console.log('[ThreatBlocks] openTwo:', result.openTwoBlocks.length, summarize(result.openTwoBlocks));
    }

    return result;
  }

  // 计算威胁危险值（取各桶 top1 权重后加权取最大）
  getThreatDangerScore(threats) {
    if (!threats) return 0;
    const top = (arr) => (arr && arr.length > 0 ? arr[0].w : 0);
    const winW = top(threats.winBlocks);
    const openFourW = top(threats.openFourBlocks);
    const halfFourW = top(threats.halfFourBlocks);
    const forkW = top(threats.forkBlocks);
    const strongThreeW = top(threats.strongThreeBlocks);
    const openThreeW = top(threats.openThreeBlocks);
    const openTwoW = top(threats.openTwoBlocks);

    const dangers = [
      winW * 1e9,
      openFourW * 1e7,
      halfFourW * 1e6,
      forkW * 5e5,
      strongThreeW * 2e5,
      openThreeW * 5e4,
      openTwoW * 1e4,
    ];
    return Math.max(...dangers);
  }

  // 评估对手下一手的最大威胁分（越大越危险）
  estimateOpponentMaxThreat(board, player) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const oppValue = opponent === Player.Black ? CellState.Black : CellState.White;
    const cand = this.generateCandidates(board, 60, opponent);
    let best = 0;
    for (const c of cand) {
      if (!this.isInBounds(board, c.x, c.y)) continue;
      if (board[c.x][c.y] !== CellState.Empty) continue;
      const t = this.classifyAfterPlace(board, c.x, c.y, oppValue);
      const s =
        (t.win ? 10000000 : 0) +
        t.openFour * 2000000 +
        t.halfFour * 800000 +
        (t.fork ? 500000 : 0) +
        t.strongThree * 200000 +
        t.openThree * 60000 +
        t.openTwo * 15000;
      if (s > best) best = s;
    }
    return best;
  }

  // 通用防守选点：基于威胁权重与我方潜力评分
  selectBestDefenseFromThreatPoints(board, points, player, config) {
    if (!points || points.length === 0) return null;
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;

    let best = null;
    let bestScore = -Infinity;

    for (const p of points) {
      const px = p.x;
      const py = p.y;
      const w = p.w || 1;
      if (!this.isInBounds(board, px, py)) continue;
      if (board[px][py] !== CellState.Empty) continue;

      // 我方落子后，对手最强反击威胁（越大越糟）
      board[px][py] = playerValue;
      const oppMax = this.estimateOpponentMaxThreat(board, player);
      board[px][py] = CellState.Empty;

      // 我方本手战术收益
      const info = this.classifyAfterPlace(board, px, py, playerValue);

      const centerDistance = Math.abs(px - 7) + Math.abs(py - 7);
      const centerBonus = (14 - centerDistance) * 50;

      const score =
        (-oppMax) * 100
        + w * 100000
        + info.openFour * 50000
        + info.halfFour * 20000
        + (info.fork ? 15000 : 0)
        + info.strongThree * 8000
        + info.openThree * 2000
        + info.openTwo * 500
        + centerBonus;

      if (score > bestScore) {
        bestScore = score;
        best = { x: px, y: py };
      }
    }

    if (this.DEBUG && best) {
      console.log('[DefenseMinimax] best=', best, 'bestScore=', bestScore);
    }

    return best;
  }

  // 进攻选点：基于 classifyAfterPlace 的战术评分
  selectBestAttackMove(board, player, candidates) {
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    const centerScore = (x, y) => {
      const dist = Math.abs(x - 7) + Math.abs(y - 7);
      return (14 - dist) * 50;
    };

    const candList = candidates && candidates.length > 0
      ? candidates
      : this.generateCandidates(board, 60, player);

    let best = null;
    let bestScore = -Infinity;

    for (const c of candList) {
      if (!this.isInBounds(board, c.x, c.y)) continue;
      if (board[c.x][c.y] !== CellState.Empty) continue;

      const t = this.classifyAfterPlace(board, c.x, c.y, playerValue);

      if (t.win) {
        return { x: c.x, y: c.y };
      }

      const score = t.openFour * 800000
        + t.halfFour * 250000
        + (t.fork ? 160000 : 0)
        + t.strongThree * 60000
        + t.openThree * 15000
        + centerScore(c.x, c.y);

      if (score > bestScore) {
        bestScore = score;
        best = { x: c.x, y: c.y };
      }
    }

    return best;
  }

  // 调试：打印落子后的各方向匹配情况
  debugClassifyAt(board, x, y, playerValue) {
    const info = this.classifyAfterPlace(board, x, y, playerValue);
    console.log('[DebugClassify] pos=', { x, y }, 'playerValue=', playerValue);
    for (const dir of info.detail.perDir) {
      console.log(
        '[Dir]',
        `dx=${dir.dx},dy=${dir.dy}`,
        'line=', dir.lineStr,
        'openFour=', dir.openFour,
        'halfFour=', dir.halfFour,
        'openThree=', dir.openThree,
        'strongThree=', dir.strongThree,
        'openTwo=', dir.openTwo
      );
    }
    console.log('[Summary]', {
      win: info.win,
      openFour: info.openFour,
      halfFour: info.halfFour,
      openThree: info.openThree,
      strongThree: info.strongThree,
      openTwo: info.openTwo,
      fork: info.fork,
    });
  }

  // 获取一个方向上的关键堵点（5窗口枚举法）
  getCriticalBlocksInDirection(board, x, y, dx, dy, attackerValue) {
    const cells = this.getLineCells(board, x, y, dx, dy, 4);
    const blocks = [];
    const blockSet = new Set();

    // 枚举所有长度为5的窗口（start=0..4）
    for (let start = 0; start <= 4; start++) {
      let attackerCount = 0;
      let emptyCount = 0;
      let opponentCount = 0;
      const emptyPos = [];

      // 统计窗口内的棋子
      for (let i = start; i < start + 5 && i < cells.length; i++) {
        const cell = cells[i];
        if (cell.v === attackerValue) {
          attackerCount++;
        } else if (cell.v === CellState.Empty) {
          emptyCount++;
          emptyPos.push({ x: cell.x, y: cell.y });
        } else {
          opponentCount++; // 包括越界（v=2）
        }
      }

      // 若 attackerCount==4 && emptyCount==1 && opponentCount==0：这是四威胁，空位是关键堵点
      if (attackerCount === 4 && emptyCount === 1 && opponentCount === 0) {
        for (const pos of emptyPos) {
          const key = `${pos.x},${pos.y}`;
          if (!blockSet.has(key)) {
            blockSet.add(key);
            blocks.push(pos);
          }
        }
      }
    }

    return blocks;
  }

  // 从候选点生成四威胁招法（统一使用5窗口枚举法）
  getFourThreatMoves(board, attackerPlayer, config) {
    const attackerValue = attackerPlayer === Player.Black ? CellState.Black : CellState.White;
    const threats = [];
    const threatSet = new Set();

    // 从候选点生成（topK=40, radius<=3）
    const candidates = this.generateCandidates(board, 40, attackerPlayer);

    const directions = [
      [0, 1],   // 水平
      [1, 0],   // 垂直
      [1, 1],   // 正斜
      [1, -1]   // 反斜
    ];

    for (const candidate of candidates) {
      const { x, y } = candidate;
      const key = `${x},${y}`;
      if (threatSet.has(key)) continue;

      // 若 attacker 是黑且 enableForbidden，过滤禁手点
      if (config && config.enableForbidden && attackerPlayer === Player.Black) {
        const testMove = { x, y, player: Player.Black };
        if (this.ruleEngine.checkForbidden(board, testMove, config)) {
          continue; // 跳过禁手点
        }
      }

      // 临时落子
      board[x][y] = attackerValue;

      // 检查是否直接五连（不是四威胁，是直接胜）
      const isDirectWin = this.checkWin(board, x, y, attackerValue);
      if (isDirectWin) {
        board[x][y] = CellState.Empty;
        continue; // 直接胜不在四威胁范围内，已在 hardMove 第一优先级处理
      }

      // 计算所有方向的 criticalBlocks 数量
      let totalCriticalBlocks = 0;
      for (const [dx, dy] of directions) {
        const blocks = this.getCriticalBlocksInDirection(board, x, y, dx, dy, attackerValue);
        totalCriticalBlocks += blocks.length;
      }

      // 撤销落子
      board[x][y] = CellState.Empty;

      // 若 totalCriticalBlocks >= 1 且当前不是直接五连 => 这是四威胁
      if (totalCriticalBlocks >= 1) {
        threats.push({ 
          x, 
          y, 
          criticalBlocks: totalCriticalBlocks 
        });
        threatSet.add(key);
      }
    }

    // 排序：活四(criticalBlocks>=2) > 冲四(==1)
    threats.sort((a, b) => {
      if (a.criticalBlocks >= 2 && b.criticalBlocks < 2) return -1;
      if (a.criticalBlocks < 2 && b.criticalBlocks >= 2) return 1;
      return b.criticalBlocks - a.criticalBlocks;
    });

    return threats;
  }

  // 查找所有冲四威胁点（保留用于其他用途）
  findAllFourThreats(board, player) {
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    const threats = [];
    const threatSet = new Set();

    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] !== CellState.Empty) continue;

        const key = `${i},${j}`;
        if (threatSet.has(key)) continue;

        board[i][j] = playerValue;
        const score = this.evaluateDirection(board, i, j, playerValue);
        board[i][j] = CellState.Empty;

        // 检查是否是冲四或活四
        if (score >= 1000) {
          threats.push({ x: i, y: j });
          threatSet.add(key);
        }
      }
    }

    return threats;
  }

  // 计算堵住四威胁线段的关键空点（forcedBlocks）- 使用5窗口枚举法
  getForcedBlocksForThreat(board, threatMove, attackerPlayer, config) {
    const attackerValue = attackerPlayer === Player.Black ? CellState.Black : CellState.White;
    const defenderPlayer = attackerPlayer === Player.Black ? Player.White : Player.Black;
    const forcedBlocks = [];
    const blockSet = new Set();

    const directions = [
      [0, 1],   // 水平
      [1, 0],   // 垂直
      [1, 1],   // 正斜
      [1, -1]   // 反斜
    ];

    // 临时落子
    board[threatMove.x][threatMove.y] = attackerValue;

    // 对 4 个方向调用 getCriticalBlocksInDirection，并集去重
    for (const [dx, dy] of directions) {
      const blocks = this.getCriticalBlocksInDirection(board, threatMove.x, threatMove.y, dx, dy, attackerValue);
      for (const block of blocks) {
        const key = `${block.x},${block.y}`;
        if (!blockSet.has(key)) {
          blockSet.add(key);
          forcedBlocks.push(block);
        }
      }
    }

    // 撤销落子
    board[threatMove.x][threatMove.y] = CellState.Empty;

    // 对 blocks 做过滤
    const filteredBlocks = [];
    for (const block of forcedBlocks) {
      // 必须 board[x][y]===Empty
      if (board[block.x][block.y] !== CellState.Empty) {
        continue;
      }

      // 若 defender 是黑且 enableForbidden，过滤 ruleEngine.checkForbidden
      if (config && config.enableForbidden && defenderPlayer === Player.Black) {
        const testMove = { x: block.x, y: block.y, player: Player.Black };
        if (this.ruleEngine.checkForbidden(board, testMove, config)) {
          continue; // 跳过禁手堵点
        }
      }

      filteredBlocks.push(block);
    }

    return filteredBlocks;
  }

  // 分析一条线上的四威胁（已废弃，VCF 改用5窗口枚举法）
  // @deprecated 使用 getCriticalBlocksInDirection 代替
  analyzeThreatLine(board, x, y, dir1, dir2, cellValue) {
    let count = 1; // 包括当前落子点
    let openEnds = 0;
    let hasGap = false;

    // 正方向
    let pos1Open = false;
    let pos1Count = 0;
    for (let i = 1; i < 6; i++) {
      const nx = x + dir1[0] * i;
      const ny = y + dir1[1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      if (board[nx][ny] === cellValue) {
        count++;
        pos1Count++;
      } else if (board[nx][ny] === CellState.Empty) {
        if (pos1Count === 0) {
          pos1Open = true;
        } else {
          hasGap = true;
        }
        break;
      } else {
        break;
      }
    }
    if (pos1Open) openEnds++;

    // 反方向
    let pos2Open = false;
    let pos2Count = 0;
    for (let i = 1; i < 6; i++) {
      const nx = x + dir2[0] * i;
      const ny = y + dir2[1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      if (board[nx][ny] === cellValue) {
        count++;
        pos2Count++;
      } else if (board[nx][ny] === CellState.Empty) {
        if (pos2Count === 0) {
          pos2Open = true;
        } else {
          hasGap = true;
        }
        break;
      } else {
        break;
      }
    }
    if (pos2Open) openEnds++;

    // 判断是否是四威胁（活四或冲四）
    const isFourThreat = (count === 4 && openEnds >= 1) || (count === 3 && hasGap && openEnds >= 1);

    return { isFourThreat, count, openEnds, hasGap };
  }

  // 找出堵住一条线的关键空点（已废弃，VCF 改用5窗口枚举法）
  // @deprecated 使用 getCriticalBlocksInDirection 代替
  findBlockPointsForLine(board, x, y, dir1, dir2, cellValue) {
    const blocks = [];
    const blockSet = new Set();

    // 收集整条线的信息
    const lineInfo = [];
    lineInfo.push({ x, y, value: cellValue }); // 中心点

    // 正方向收集
    for (let i = 1; i < 6; i++) {
      const nx = x + dir1[0] * i;
      const ny = y + dir1[1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      lineInfo.push({ x: nx, y: ny, value: board[nx][ny] });
    }

    // 反方向收集
    for (let i = 1; i < 6; i++) {
      const nx = x + dir2[0] * i;
      const ny = y + dir2[1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      lineInfo.unshift({ x: nx, y: ny, value: board[nx][ny] });
    }

    // 找出所有空位（这些是堵点）
    for (const info of lineInfo) {
      if (info.value === CellState.Empty) {
        const key = `${info.x},${info.y}`;
        if (!blockSet.has(key)) {
          blockSet.add(key);
          blocks.push({ x: info.x, y: info.y });
        }
      }
    }

    return blocks;
  }

  // 查找必防威胁（对手活四/冲四）- 保留用于兼容
  findCriticalDefense(board, player, config) {
    const mustBlockMoves = this.findOpponentFourThreats(board, player, config);
    if (mustBlockMoves.length > 0) {
      return this.selectBestDefense(board, player, config, mustBlockMoves);
    }
    return null;
  }

  // 二层威胁防守：查找对手活四/冲四威胁点
  findOpponentFourThreats(board, player, config) {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;
    const threatPoints = new Set();
    const threatMoves = [];

    // 枚举候选点，假设对手落子后检查是否形成活四/冲四
    const candidates = this.generateCandidates(board, 50, opponent); // 扩大范围查找威胁

    for (const candidate of candidates) {
      const { x, y } = candidate;

      // 如果禁手开启且对手是黑棋，检查是否是禁手点
      if (config && config.enableForbidden && opponent === Player.Black) {
        const testMove = { x, y, player: Player.Black };
        if (this.ruleEngine.checkForbidden(board, testMove, config)) {
          continue; // 禁手点，对手不能走，不需要防守
        }
      }

      // 模拟对手落子
      board[x][y] = opponentValue;
      const score = this.evaluateDirection(board, x, y, opponentValue);
      board[x][y] = CellState.Empty;

      // 活四或冲四必须防（score >= 1000 表示活四或冲四）
      if (score >= 1000) {
        const key = `${x},${y}`;
        if (!threatPoints.has(key)) {
          threatPoints.add(key);
          threatMoves.push({ x, y, threatScore: score });
        }
      }
    }

    return threatMoves;
  }

  // 枚举升级点：对手强活三（下一手可形成开四/冲四）
  findOpponentStrongThreeMustBlocks(board, opponentPlayer, config) {
    const opponentValue = opponentPlayer === Player.Black ? CellState.Black : CellState.White;
    const candidates = this.generateCandidates(board, 60, opponentPlayer);
    const blockMap = new Map();

    for (const c of candidates) {
      if (board[c.x][c.y] !== CellState.Empty) continue;
      if (config && config.enableForbidden && opponentPlayer === Player.Black) {
        const testMove = { x: c.x, y: c.y, player: Player.Black };
        if (this.ruleEngine.checkForbidden(board, testMove, config)) {
          continue; // 对手禁手点无需防
        }
      }

      board[c.x][c.y] = opponentValue;
      const fb = this.getFourBlocksCount(board, c.x, c.y, opponentPlayer);
      const score = this.evaluateDirection(board, c.x, c.y, opponentValue);
      board[c.x][c.y] = CellState.Empty;

      if (fb >= 1 || score >= 1000) {
        const key = `${c.x},${c.y}`;
        const weight = Math.max(fb, 1);
        blockMap.set(key, (blockMap.get(key) || 0) + weight);
      }
    }

    const result = [];
    for (const [key, count] of blockMap.entries()) {
      const [x, y] = key.split(',').map(n => parseInt(n, 10));
      result.push({ x, y, count });
    }
    return result;
  }

  // 从 mustBlock 集合中选择最佳防守点
  selectBestDefense(board, player, config, mustBlockMoves) {
    if (mustBlockMoves.length === 0) return null;

    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    const defenseScores = [];

    for (const threat of mustBlockMoves) {
      // 评估我方在此点防守后的得分
      board[threat.x][threat.y] = playerValue;
      const myScore = this.evaluateDirection(board, threat.x, threat.y, playerValue);
      board[threat.x][threat.y] = CellState.Empty;

      // 防守评分：我方得分 + 威胁严重程度
      const defenseScore = myScore + threat.threatScore * 0.1;
      defenseScores.push({ x: threat.x, y: threat.y, score: defenseScore });
    }

    // 按防守评分排序
    defenseScores.sort((a, b) => b.score - a.score);

    return { x: defenseScores[0].x, y: defenseScores[0].y };
  }

  // alpha-beta 迭代加深搜索（修正：固定 rootPlayer 视角）
  alphaBetaSearch(board, rootPlayer, config, candidates, timeBudget = 250, maxDepth = 4) {
    const startTime = Date.now();
    let bestMove = null;
    let bestScore = -Infinity;

    // 迭代加深
    for (let depth = 1; depth <= maxDepth; depth++) {
      if (Date.now() - startTime > timeBudget) {
        break; // 超时，使用上一次结果
      }

      let currentBest = null;
      let currentScore = -Infinity;

      for (const candidate of candidates) {
        if (Date.now() - startTime > timeBudget) break;

        // 根节点也需要禁手过滤（黑棋）
        if (config && config.enableForbidden && rootPlayer === Player.Black) {
          const testMove = { x: candidate.x, y: candidate.y, player: Player.Black };
          if (this.ruleEngine.checkForbidden(board, testMove, config)) {
            continue;
          }
        }

        const rootPlayerValue = rootPlayer === Player.Black ? CellState.Black : CellState.White;
        board[candidate.x][candidate.y] = rootPlayerValue;

        // 根节点已落子，接下来轮到对手（minimizing）。depth 表示剩余层数，因此递归 depth-1。
        let score;
        if (depth - 1 <= 0) {
          score = this.evaluateBoard(board, rootPlayer, config);
        } else {
          score = this.alphaBeta(board, rootPlayer, config, depth - 1, -Infinity, Infinity, false, startTime, timeBudget);
        }

        board[candidate.x][candidate.y] = CellState.Empty;

        if (score > currentScore) {
          currentScore = score;
          currentBest = candidate;
        }
      }

      if (currentBest) {
        bestMove = currentBest;
        bestScore = currentScore;
      }
    }

    return bestMove;
  }

  // alpha-beta 剪枝搜索（修正：固定 rootPlayer 视角，确保分数一致性）
  alphaBeta(board, rootPlayer, config, depth, alpha, beta, isMaximizing, startTime, timeBudget) {
    // 检查是否超时
    if (Date.now() - startTime > timeBudget) {
      return this.evaluateBoard(board, rootPlayer, config);
    }

    const opponent = rootPlayer === Player.Black ? Player.White : Player.Black;

    // 确定当前落子方
    const currentPlayer = isMaximizing ? rootPlayer : (rootPlayer === Player.Black ? Player.White : Player.Black);
    const currentValue = currentPlayer === Player.Black ? CellState.Black : CellState.White;

    // 终局/必杀判定（固定 rootPlayer 视角）
    const rootWinMove = this.findWinningMove(board, rootPlayer);
    if (rootWinMove) {
      return 900000 - depth * 1000; // 越快赢分数越高
    }
    const oppWinMove = this.findWinningMove(board, opponent);
    if (oppWinMove) {
      return -900000 + depth * 1000; // 越快输分数越低（绝对值变小，便于提前剪枝）
    }

    // 受威胁时延伸搜索（quiescence-like）
    // 检查当前落子方的对手是否有威胁
    const threatPlayer = currentPlayer === Player.Black ? Player.White : Player.Black;
    const hasThreat = this.detectThreat(board, threatPlayer, config);
    let effectiveDepth = depth;
    if (hasThreat && depth <= 1) {
      effectiveDepth = 2; // 检测到威胁时至少搜索到 depth=2
    }

    if (effectiveDepth <= 0) {
      return this.evaluateBoard(board, rootPlayer, config);
    }

    // 生成候选点（限制数量以提高性能，随深度动态）
    let topK;
    if (effectiveDepth >= 4) {
      topK = 16;
    } else if (effectiveDepth === 3) {
      topK = 14;
    } else {
      topK = 10;
    }
    const candidates = this.generateCandidates(board, topK, currentPlayer);
    if (candidates.length === 0) {
      return this.evaluateBoard(board, rootPlayer, config);
    }

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (const candidate of candidates) {
        if (Date.now() - startTime > timeBudget) break;

        // 如果禁手开启且当前落子方为黑棋，跳过禁手点
        if (config && config.enableForbidden && currentPlayer === Player.Black) {
          const testMove = { x: candidate.x, y: candidate.y, player: Player.Black };
          if (this.ruleEngine.checkForbidden(board, testMove, config)) {
            continue;
          }
        }

        board[candidate.x][candidate.y] = currentValue;
        const score = this.alphaBeta(board, rootPlayer, config, effectiveDepth - 1, alpha, beta, false, startTime, timeBudget);
        board[candidate.x][candidate.y] = CellState.Empty;

        maxScore = Math.max(maxScore, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break; // 剪枝
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (const candidate of candidates) {
        if (Date.now() - startTime > timeBudget) break;

        // 如果禁手开启且当前落子方为黑棋，跳过禁手点
        if (config && config.enableForbidden && currentPlayer === Player.Black) {
          const testMove = { x: candidate.x, y: candidate.y, player: Player.Black };
          if (this.ruleEngine.checkForbidden(board, testMove, config)) {
            continue; // 跳过禁手点
          }
        }

        board[candidate.x][candidate.y] = currentValue;
        const score = this.alphaBeta(board, rootPlayer, config, effectiveDepth - 1, alpha, beta, true, startTime, timeBudget);
        board[candidate.x][candidate.y] = CellState.Empty;

        minScore = Math.min(minScore, score);
        beta = Math.min(beta, score);
        if (beta <= alpha) break; // 剪枝
      }
      return minScore;
    }
  }

  // 检测是否存在威胁（对手活四/冲四/一步胜）
  detectThreat(board, opponent, config) {
    // 检查对手是否一步胜
    if (this.findWinningMove(board, opponent)) {
      return true;
    }

    // 检查对手是否有活四/冲四威胁
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;
    const candidates = this.generateCandidates(board, 20, opponent);
    
    for (const candidate of candidates) {
      // 如果禁手开启且对手是黑棋，检查是否是禁手点
      if (config && config.enableForbidden && opponent === Player.Black) {
        const testMove = { x: candidate.x, y: candidate.y, player: Player.Black };
        if (this.ruleEngine.checkForbidden(board, testMove, config)) {
          continue;
        }
      }

      board[candidate.x][candidate.y] = opponentValue;
      const score = this.evaluateDirection(board, candidate.x, candidate.y, opponentValue);
      board[candidate.x][candidate.y] = CellState.Empty;

      if (score >= 1000) { // 活四或冲四
        return true;
      }
    }

    return false;
  }

  // 评估整个棋盘（修正：始终从 rootPlayer 视角，提升威胁惩罚力度）
  evaluateBoard(board, rootPlayer, config) {
    const opponent = rootPlayer === Player.Black ? Player.White : Player.Black;
    const playerValue = rootPlayer === Player.Black ? CellState.Black : CellState.White;
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;

    let playerScore = 0;
    let opponentScore = 0;
    let opponentThreatScore = 0; // 对手威胁分数（活四/冲四/活三）

    // 评估所有位置
    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] === playerValue) {
          playerScore += this.evaluateDirection(board, i, j, playerValue);
        } else if (board[i][j] === opponentValue) {
          const dirScore = this.evaluateDirection(board, i, j, opponentValue);
          opponentScore += dirScore;
          
          // 对对手的威胁给极大负分
          if (dirScore >= 10000) {
            opponentThreatScore += 50000; // 对手活四，极大惩罚
          } else if (dirScore >= 1000) {
            opponentThreatScore += 20000; // 对手冲四，大惩罚
          } else if (dirScore >= 100) {
            opponentThreatScore += 5000; // 对手活三，较大惩罚
          }
        }
      }
    }

    // 检查对手是否有一步胜威胁（额外惩罚）
    if (this.findWinningMove(board, opponent)) {
      opponentThreatScore += 100000; // 对手一步胜，极大惩罚
    }

    // 战术评估：基于 classifyAfterPlace 的局部最大威胁/机会
    const tacticalEval = (perspectivePlayer) => {
      const cand = this.generateCandidates(board, 12, perspectivePlayer);
      const pv = perspectivePlayer === Player.Black ? CellState.Black : CellState.White;
      let best = 0;
      for (const c of cand) {
        if (!this.isInBounds(board, c.x, c.y)) continue;
        if (board[c.x][c.y] !== CellState.Empty) continue;
        const t = this.classifyAfterPlace(board, c.x, c.y, pv);
        const score = t.openFour * 50000
          + t.halfFour * 20000
          + (t.fork ? 15000 : 0)
          + t.strongThree * 8000
          + t.openThree * 2000;
        if (score > best) best = score;
      }
      return best;
    };

    const playerTac = tacticalEval(rootPlayer);
    const opponentTac = tacticalEval(opponent);

    // 最终分数：我方得分 - 对手得分 - 威胁惩罚 + 战术差值
    return playerScore - opponentScore * 1.2 - opponentThreatScore + playerTac - opponentTac;
  }
}

module.exports = { AIEngine };

