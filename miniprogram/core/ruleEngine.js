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
    // 简化版：暂时不实现禁手检测
    return false;
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

