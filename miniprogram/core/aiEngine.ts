// @ts-nocheck
import { Board, CellState, Player, IAIEngine } from './types';

export class AIEngine implements IAIEngine {
  private ruleEngine: any; // 避免循环依赖，实际使用时不直接调用ruleEngine

  constructor(ruleEngine?: any) {
    this.ruleEngine = ruleEngine;
  }

  getNextMove(board: Board, player: Player, level: 'EASY' | 'MEDIUM' | 'HARD'): { x: number, y: number } {
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

  /**
   * EASY难度：随机落子 + 基础防守
   */
  private easyMove(board: Board, player: Player): { x: number, y: number } {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const boardSize = board.length;
    
    // 1. 检查是否能直接赢
    const winMove = this.findWinningMove(board, player);
    if (winMove) return winMove;

    // 2. 检查是否需要防守（对手下一步能赢）
    const blockMove = this.findWinningMove(board, opponent);
    if (blockMove) return blockMove;

    // 3. 在中心区域随机选择
    const centerMoves: { x: number, y: number }[] = [];
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

    // 4. 全棋盘随机
    const allMoves: { x: number, y: number }[] = [];
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

    // 5. 兜底（理论上不会执行）
    return { x: 7, y: 7 };
  }

  /**
   * MEDIUM难度：评分制策略
   */
  private mediumMove(board: Board, player: Player): { x: number, y: number } {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    
    // 1. 检查是否能直接赢
    const winMove = this.findWinningMove(board, player);
    if (winMove) return winMove;

    // 2. 检查是否需要防守
    const blockMove = this.findWinningMove(board, opponent);
    if (blockMove) return blockMove;

    // 3. 评分制选择最佳落子点
    let bestScore = -Infinity;
    let bestMoves: { x: number, y: number }[] = [];

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

    // 在最高分中随机选择（避免总是下同一个位置）
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  /**
   * HARD难度：预留扩展接口
   */
  private hardMove(board: Board, player: Player): { x: number, y: number } {
    // 当前与MEDIUM相同，后续可替换为更复杂的算法
    return this.mediumMove(board, player);
  }

  /**
   * 查找能直接获胜的落子点
   */
  private findWinningMove(board: Board, player: Player): { x: number, y: number } | null {
    const cellValue = player === Player.Black ? CellState.Black : CellState.White;
    
    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] !== CellState.Empty) continue;

        // 模拟落子
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

  /**
   * 检查某位置是否形成五连
   */
  private checkWin(board: Board, x: number, y: number, cellValue: CellState): boolean {
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

  /**
   * 评估某个位置的分数
   */
  private evaluatePosition(board: Board, x: number, y: number, player: Player): number {
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const playerValue = player === Player.Black ? CellState.Black : CellState.White;
    const opponentValue = opponent === Player.Black ? CellState.Black : CellState.White;

    // 模拟落子
    board[x][y] = playerValue;

    let score = 0;

    // 1. 进攻价值：评估自己形成的连子
    const playerScore = this.evaluateDirection(board, x, y, playerValue);
    
    // 2. 防守价值：评估阻止对手形成的连子
    board[x][y] = opponentValue;
    const opponentScore = this.evaluateDirection(board, x, y, opponentValue) * 0.9; // 防守权重略低
    
    // 恢复棋盘
    board[x][y] = CellState.Empty;

    score = playerScore + opponentScore;

    // 3. 位置价值：中心区域加分
    const centerDistance = Math.abs(x - 7) + Math.abs(y - 7);
    score += (14 - centerDistance) * 5; // 越中心分数越高

    return score;
  }

  /**
   * 评估某个方向上的连子价值
   */
  private evaluateDirection(board: Board, x: number, y: number, cellValue: CellState): number {
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

      // 正方向
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

      // 反方向
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

      // 评分（活棋 > 半活棋 > 死棋）
      let score = 0;
      if (count >= 5) {
        score = 100000; // 必胜
      } else if (count === 4) {
        score = blockCount === 0 ? 10000 : 1000; // 活四 vs 冲四
      } else if (count === 3) {
        score = blockCount === 0 ? 1000 : 100; // 活三 vs 眠三
      } else if (count === 2) {
        score = blockCount === 0 ? 100 : 10;
      }

      maxScore = Math.max(maxScore, score);
    }

    return maxScore;
  }

  private isInBounds(board: Board, x: number, y: number): boolean {
    return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
  }
}

