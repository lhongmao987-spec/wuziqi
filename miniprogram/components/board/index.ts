Component({
  properties: {
    board: {
      type: Array,
      value: []
    },
    gridCount: {
      type: Number,
      value: 15
    },
    size: {
      type: Number,
      value: 320
    },
    lastMove: {
      type: Object,
      value: null,
      observer: 'updateLastMoveMark'
    },
    winningPositions: {
      type: Array,
      value: [],
      observer: 'updateWinningMarks'
    },
    enableHighlight: {
      type: Boolean,
      value: true
    }
  },
  data: {
    starPoints: [],
    lastMoveMark: {} as Record<string, boolean>,
    winningMarks: {} as Record<string, boolean>
  },
  lifetimes: {
    attached() {
      const cell = this.data.size / this.data.gridCount;
      this.setData({
        starPoints: [
          { x: cell * 3 + 0.5 * cell, y: cell * 3 + 0.5 * cell },
          { x: cell * 3 + 0.5 * cell, y: cell * 11 + 0.5 * cell },
          { x: cell * 7 + 0.5 * cell, y: cell * 7 + 0.5 * cell },
          { x: cell * 11 + 0.5 * cell, y: cell * 3 + 0.5 * cell },
          { x: cell * 11 + 0.5 * cell, y: cell * 11 + 0.5 * cell }
        ]
      });
    }
  },
  methods: {
    onTap(e: WechatMiniprogram.BaseEvent) {
      const { x, y } = e.currentTarget.dataset as { x: number; y: number };
      this.triggerEvent('celltap', { x, y });
    },
    isLast(x: number, y: number) {
      const last = this.data.lastMove as any;
      return last && last.x === x && last.y === y;
    },
    updateLastMoveMark(newVal: any) {
      if (!this.data.enableHighlight) {
        this.setData({ lastMoveMark: {} });
        return;
      }
      const mark: Record<string, boolean> = {};
      if (newVal && typeof newVal.x === 'number' && typeof newVal.y === 'number') {
        mark[`${newVal.x}_${newVal.y}`] = true;
      }
      this.setData({ lastMoveMark: mark });
    },
    updateWinningMarks(newVal: any) {
      const marks: Record<string, boolean> = {};
      console.log('board组件 updateWinningMarks 被调用，newVal:', newVal);
      if (Array.isArray(newVal) && newVal.length > 0) {
        newVal.forEach((pos: any) => {
          if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            marks[`${pos.x}_${pos.y}`] = true;
          }
        });
        console.log('board组件生成的winningMarks:', marks);
      }
      this.setData({ winningMarks: marks });
    }
  },
  
  observers: {
    'enableHighlight': function(enableHighlight: boolean) {
      if (!enableHighlight) {
        this.setData({ lastMoveMark: {} });
      } else if (this.data.lastMove) {
        this.updateLastMoveMark(this.data.lastMove);
      }
    }
  }
});

