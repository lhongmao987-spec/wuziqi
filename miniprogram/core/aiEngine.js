const { CellState, Player } = require('./types');

class AIEngine {
  constructor(ruleEngine) {
    this.ruleEngine = ruleEngine;
  }

  getNextMove(board, player, level) {
    switch (level) {
      case 'EASY':
        return this.easyMove(board, player);
      case 'MEDIUM':
        return this.mediumMove(board, player);
      case 'HARD':
        return this.hardMove(board, player);
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

  hardMove(board, player) {
    return this.mediumMove(board, player);
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
}

module.exports = { AIEngine };

