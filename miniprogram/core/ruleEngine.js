const { CellState, Player, GameResult } = require('./types');

class RuleEngine {
  isValidMove(board, x, y) {
    if (!board || !board.length || !board[0]) {
      return false;
    }
    
    if (x < 0 || x >= board.length || y < 0 || y >= board[0].length) {
      return false;
    }
    
    return board[x][y] === CellState.Empty;
  }

  applyMoveAndJudge(board, move, config) {
    // 先检查禁手（仅黑方且启用禁手规则）
    if (config.enableForbidden && move.player === Player.Black) {
      const forbiddenResult = this.checkForbidden(board, move, config);
      if (forbiddenResult) {
        return {
          winner: Player.White,
          result: GameResult.BlackLoseForbidden
        };
      }
    }

    // 检查是否五连
    const fiveInRow = this.checkFiveInRow(board, move);
    if (fiveInRow) {
      return {
        winner: fiveInRow.player,
        result: fiveInRow.player === Player.Black ? GameResult.BlackWin : GameResult.WhiteWin,
        winningPositions: fiveInRow.positions
      };
    }

    // 检查和棋（棋盘满）
    if (this.isBoardFull(board)) {
      return {
        result: GameResult.Draw
      };
    }

    // 继续对局
    return {
      result: GameResult.Ongoing
    };
  }

  checkFiveInRow(board, move) {
    const directions = [
      [[0, 1], [0, -1]],   // 水平
      [[1, 0], [-1, 0]],   // 垂直
      [[1, 1], [-1, -1]],  // 正斜
      [[1, -1], [-1, 1]]   // 反斜
    ];

    const player = move.player;
    const cellValue = player === Player.Black ? CellState.Black : CellState.White;

    for (const dir of directions) {
      const positions = [{ x: move.x, y: move.y }];
      let count = 1;

      // 正方向
      for (let i = 1; i < 5; i++) {
        const nx = move.x + dir[0][0] * i;
        const ny = move.y + dir[0][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === cellValue) {
          count++;
          positions.push({ x: nx, y: ny });
        } else {
          break;
        }
      }

      // 反方向
      for (let i = 1; i < 5; i++) {
        const nx = move.x + dir[1][0] * i;
        const ny = move.y + dir[1][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === cellValue) {
          count++;
          positions.unshift({ x: nx, y: ny });
        } else {
          break;
        }
      }

      if (count >= 5) {
        // 返回前5个位置（确保是连续的5子）
        return {
          player: player,
          positions: positions.slice(0, 5)
        };
      }
    }

    return null;
  }

  checkForbidden(board, move, config) {
    if (move.player !== Player.Black) {
      return false;
    }
    if (!config || !config.enableForbidden) {
      return false;
    }
  
    const { x, y } = move;
  
    // ⚠️ 关键：保存原值（可能是 Empty，也可能已经是 Black）
    const original = board[x][y];
  
    // 只有在“模拟判断”时才临时落子
    if (original === CellState.Empty) {
      board[x][y] = CellState.Black;
    }
  
    let forbidden = false;
    try {
      // 长连禁手（>=6）
      if (this.checkLongLine(board, x, y)) {
        forbidden = true;
      }
      // 四四禁手
      else if (this.countFourThreats(board, x, y) >= 2) {
        forbidden = true;
      }
      // 三三禁手
      else if (this.countOpenThrees(board, x, y) >= 2) {
        forbidden = true;
      }
  
      return forbidden;
    } finally {
      // ✅ 无条件恢复原值（生死线）
      board[x][y] = original;
    }
  }
  
  // 检查长连禁手（>=6连）
  checkLongLine(board, x, y) {
    const directions = [
      [[0, 1], [0, -1]],   // 水平
      [[1, 0], [-1, 0]],   // 垂直
      [[1, 1], [-1, -1]],  // 正斜
      [[1, -1], [-1, 1]]   // 反斜
    ];

    for (const dir of directions) {
      let count = 1;

      // 正方向
      for (let i = 1; i < 6; i++) {
        const nx = x + dir[0][0] * i;
        const ny = y + dir[0][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === CellState.Black) {
          count++;
        } else {
          break;
        }
      }

      // 反方向
      for (let i = 1; i < 6; i++) {
        const nx = x + dir[1][0] * i;
        const ny = y + dir[1][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === CellState.Black) {
          count++;
        } else {
          break;
        }
      }

      if (count >= 6) {
        return true;
      }
    }

    return false;
  }

  // 统计四威胁数量（活四或冲四）
  countFourThreats(board, x, y) {
    const directions = [
      [[0, 1], [0, -1]],   // 水平
      [[1, 0], [-1, 0]],   // 垂直
      [[1, 1], [-1, -1]],  // 正斜
      [[1, -1], [-1, 1]]   // 反斜
    ];

    let fourCount = 0;

    for (const dir of directions) {
      const line = this.analyzeLine(board, x, y, dir[0], dir[1], CellState.Black);
      
      // 活四：连续4子，两端都开放
      if (line.consecutive === 4 && line.openEnds === 2) {
        fourCount++;
      }
      // 冲四：连续4子，一端开放（另一端被堵或边界）
      else if (line.consecutive === 4 && line.openEnds === 1) {
        fourCount++;
      }
      // 跳冲四：中间有空位的四威胁（简化处理：连续3子+1空+1子，且至少一端开放）
      else if (line.consecutive === 3 && line.hasGap && line.openEnds >= 1) {
        // 检查是否能形成冲四
        if (this.canFormFourWithGap(board, x, y, dir[0], dir[1])) {
          fourCount++;
        }
      }
    }

    return fourCount;
  }

  // 统计活三数量
  countOpenThrees(board, x, y) {
    const directions = [
      [[0, 1], [0, -1]],   // 水平
      [[1, 0], [-1, 0]],   // 垂直
      [[1, 1], [-1, -1]],  // 正斜
      [[1, -1], [-1, 1]]   // 反斜
    ];

    let openThreeCount = 0;

    for (const dir of directions) {
      const line = this.analyzeLine(board, x, y, dir[0], dir[1], CellState.Black);
      
      // 活三：连续3子，两端都开放
      if (line.consecutive === 3 && line.openEnds === 2 && !line.hasGap) {
        openThreeCount++;
      }
      // 跳活三：中间有空位的活三（简化：连续2子+1空+1子，两端开放）
      else if (line.consecutive === 2 && line.hasGap && line.openEnds === 2) {
        if (this.canFormOpenThreeWithGap(board, x, y, dir[0], dir[1])) {
          openThreeCount++;
        }
      }
    }

    return openThreeCount;
  }

  // 分析一条线上的棋型
  analyzeLine(board, x, y, dir1, dir2, cellValue) {
    let consecutive = 1;
    let openEnds = 0;
    let hasGap = false;

    // 正方向
    let pos1Open = false;
    let pos1Count = 0;
    for (let i = 1; i < 6; i++) {
      const nx = x + dir1[0] * i;
      const ny = y + dir1[1] * i;
      if (!this.isInBounds(board, nx, ny)) {
        break;
      }
      if (board[nx][ny] === cellValue) {
        consecutive++;
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
      if (!this.isInBounds(board, nx, ny)) {
        break;
      }
      if (board[nx][ny] === cellValue) {
        consecutive++;
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

    return { consecutive, openEnds, hasGap };
  }

  // 检查是否能形成带空位的冲四
  canFormFourWithGap(board, x, y, dir1, dir2) {
    // 简化：检查连续3子+空位+1子的情况
    let pattern = [];
    
    // 收集正方向5个位置
    for (let i = -4; i <= 4; i++) {
      const nx = x + dir1[0] * Math.abs(i);
      const ny = y + dir1[1] * Math.abs(i);
      if (this.isInBounds(board, nx, ny)) {
        pattern.push(board[nx][ny] === CellState.Black ? 1 : (board[nx][ny] === CellState.Empty ? 0 : -1));
      }
    }
    
    // 检查模式：1 1 1 0 1 或 1 0 1 1 1 等（简化处理）
    let blackCount = 0;
    let emptyCount = 0;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === 1) blackCount++;
      else if (pattern[i] === 0) emptyCount++;
      else break;
    }
    
    return blackCount === 4 && emptyCount === 1;
  }

  // 检查是否能形成带空位的活三
  canFormOpenThreeWithGap(board, x, y, dir1, dir2) {
    // 简化：检查连续2子+空位+1子，且两端都开放
    let leftOpen = false;
    let rightOpen = false;
    
    // 检查左侧是否开放
    const leftX = x + dir2[0] * 2;
    const leftY = y + dir2[1] * 2;
    if (this.isInBounds(board, leftX, leftY) && board[leftX][leftY] === CellState.Empty) {
      leftOpen = true;
    }
    
    // 检查右侧是否开放
    const rightX = x + dir1[0] * 2;
    const rightY = y + dir1[1] * 2;
    if (this.isInBounds(board, rightX, rightY) && board[rightX][rightY] === CellState.Empty) {
      rightOpen = true;
    }
    
    return leftOpen && rightOpen;
  }

  isBoardFull(board) {
    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] === CellState.Empty) {
          return false;
        }
      }
    }
    return true;
  }

  isInBounds(board, x, y) {
    return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
  }
}

module.exports = { RuleEngine };

