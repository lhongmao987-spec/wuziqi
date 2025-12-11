import { 
  Board, CellState, Move, Player, GameResult, GameConfig, IRuleEngine 
} from './types';

export class RuleEngine implements IRuleEngine {
  /**
   * 检查落子是否合法（边界、空位）
   */
  isValidMove(board: Board, x: number, y: number): boolean {
    if (x < 0 || x >= board.length || y < 0 || y >= board[0].length) {
      return false;
    }
    return board[x][y] === CellState.Empty;
  }

  /**
   * 落子并判断结果
   */
  applyMoveAndJudge(board: Board, move: Move, config: GameConfig): {
    winner?: Player;
    result: GameResult;
  } {
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
    const winner = this.checkFiveInRow(board, move);
    if (winner) {
      return {
        winner,
        result: winner === Player.Black ? GameResult.BlackWin : GameResult.WhiteWin
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

  /**
   * 检查五连（核心算法）
   */
  private checkFiveInRow(board: Board, move: Move): Player | null {
    const directions = [
      [[0, 1], [0, -1]],   // 水平
      [[1, 0], [-1, 0]],   // 垂直
      [[1, 1], [-1, -1]],  // 正斜
      [[1, -1], [-1, 1]]   // 反斜
    ];

    const player = move.player;
    const cellValue = player === Player.Black ? CellState.Black : CellState.White;

    for (const dir of directions) {
      let count = 1; // 包含当前落子

      // 正方向统计
      for (let i = 1; i < 5; i++) {
        const nx = move.x + dir[0][0] * i;
        const ny = move.y + dir[0][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === cellValue) {
          count++;
        } else {
          break;
        }
      }

      // 反方向统计
      for (let i = 1; i < 5; i++) {
        const nx = move.x + dir[1][0] * i;
        const ny = move.y + dir[1][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === cellValue) {
          count++;
        } else {
          break;
        }
      }

      if (count >= 5) {
        return player;
      }
    }

    return null;
  }

  /**
   * 禁手检测（黑方）
   */
  private checkForbidden(board: Board, move: Move, _config: GameConfig): boolean {
    if (move.player !== Player.Black) {
      return false;
    }

    // 长连禁手
    if (this.isLongLink(board, move)) {
      return true;
    }

    // 三三禁手
    const openThrees = this.countOpenThrees(board, move);
    if (openThrees >= 2) {
      return true;
    }

    // 四四禁手
    const fours = this.countFours(board, move);
    if (fours >= 2) {
      return true;
    }

    return false;
  }

  /**
   * 长连禁手：连续6子或以上
   */
  private isLongLink(board: Board, move: Move): boolean {
    const directions = [
      [[0, 1], [0, -1]],
      [[1, 0], [-1, 0]],
      [[1, 1], [-1, -1]],
      [[1, -1], [-1, 1]]
    ];

    const cellValue = CellState.Black;

    for (const dir of directions) {
      let count = 1;

      // 正方向
      for (let i = 1; i < 7; i++) {
        const nx = move.x + dir[0][0] * i;
        const ny = move.y + dir[0][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === cellValue) {
          count++;
        } else {
          break;
        }
      }

      // 反方向
      for (let i = 1; i < 7; i++) {
        const nx = move.x + dir[1][0] * i;
        const ny = move.y + dir[1][1] * i;
        if (this.isInBounds(board, nx, ny) && board[nx][ny] === cellValue) {
          count++;
        } else {
          break;
        }
      }

      // 如果是6连或以上，且不是正好5连，判长连禁手
      if (count >= 6) {
        // 检查是否包含5连（合法胜利）
        if (!this.containsExactlyFive(board, move, dir)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 统计活三数量
   */
  private countOpenThrees(board: Board, move: Move): number {
    let count = 0;
    const directions = [[[0, 1], [0, -1]], [[1, 0], [-1, 0]], [[1, 1], [-1, -1]], [[1, -1], [-1, 1]]];

    for (const dir of directions) {
      if (this.isOpenThree(board, move, dir)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 判断某个方向是否形成活三
   */
  private isOpenThree(board: Board, move: Move, dir: number[][]): boolean {
    // 活三定义：两端都有空位的三子
    // 复杂逻辑简化：检查当前落子后是否形成"空-黑-黑-黑-空"模式
    // 实际实现需要更复杂的模式匹配，这里给出核心思路
    const cellValue = CellState.Black;
    
    // 检查正向序列
    let sequence: CellState[] = [cellValue]; // 包含当前落子
    
    for (let i = 1; i <= 4; i++) {
      const nx = move.x + dir[0][0] * i;
      const ny = move.y + dir[0][1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      sequence.push(board[nx][ny]);
    }
    
    for (let i = 1; i <= 4; i++) {
      const nx = move.x + dir[1][0] * i;
      const ny = move.y + dir[1][1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      sequence.unshift(board[nx][ny]);
    }

    // 查找"空-黑-黑-黑-空"模式
    return this.patternMatch(sequence, [CellState.Empty, cellValue, cellValue, cellValue, CellState.Empty]);
  }

  /**
   * 统计四的数量
   */
  private countFours(board: Board, move: Move): number {
    let count = 0;
    const directions = [[[0, 1], [0, -1]], [[1, 0], [-1, 0]], [[1, 1], [-1, -1]], [[1, -1], [-1, 1]]];

    for (const dir of directions) {
      if (this.isFour(board, move, dir)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 判断某个方向是否形成四
   */
  private isFour(board: Board, move: Move, dir: number[][]): boolean {
    // 四定义：能形成五连的四子（含活四和冲四）
    // 检查"空-黑-黑-黑-黑"或"黑-黑-黑-黑-空"等模式
    // 实际实现需要更复杂的模式匹配
    const cellValue = CellState.Black;
    let sequence: CellState[] = [cellValue];
    
    for (let i = 1; i <= 5; i++) {
      const nx = move.x + dir[0][0] * i;
      const ny = move.y + dir[0][1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      sequence.push(board[nx][ny]);
    }
    
    for (let i = 1; i <= 5; i++) {
      const nx = move.x + dir[1][0] * i;
      const ny = move.y + dir[1][1] * i;
      if (!this.isInBounds(board, nx, ny)) break;
      sequence.unshift(board[nx][ny]);
    }

    // 查找四子连珠且一端为空或可延伸的模式
    return this.patternMatch(sequence, [CellState.Empty, cellValue, cellValue, cellValue, cellValue]) ||
           this.patternMatch(sequence, [cellValue, cellValue, cellValue, cellValue, CellState.Empty]);
  }

  /**
   * 模式匹配辅助函数
   */
  private patternMatch(sequence: CellState[], pattern: CellState[]): boolean {
    for (let i = 0; i <= sequence.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (pattern[j] !== -1 && sequence[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  /**
   * 检查是否包含正好5连（用于长连禁手判断）
   */
  private containsExactlyFive(board: Board, move: Move, dir: number[][]): boolean {
    // 检查该方向是否存在5连且不是6连
    const count = this.getContinuousCount(board, move, dir);
    return count === 5;
  }

  private getContinuousCount(board: Board, move: Move, dir: number[][]): number {
    const cellValue = CellState.Black;
    let count = 1;

    for (let i = 1; i < 6; i++) {
      const nx = move.x + dir[0][0] * i;
      const ny = move.y + dir[0][1] * i;
      if (!this.isInBounds(board, nx, ny) || board[nx][ny] !== cellValue) break;
      count++;
    }

    for (let i = 1; i < 6; i++) {
      const nx = move.x + dir[1][0] * i;
      const ny = move.y + dir[1][1] * i;
      if (!this.isInBounds(board, nx, ny) || board[nx][ny] !== cellValue) break;
      count++;
    }

    return count;
  }

  /**
   * 检查棋盘是否已满
   */
  private isBoardFull(board: Board): boolean {
    for (let i = 0; i < board.length; i++) {
      for (let j = 0; j < board[i].length; j++) {
        if (board[i][j] === CellState.Empty) {
          return false;
        }
      }
    }
    return true;
  }

  private isInBounds(board: Board, x: number, y: number): boolean {
    return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
  }
}

