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
    }
  },
  data: {
    starPoints: [],
    lastMoveMark: {},
    winningMarks: {}
  },
  lifetimes: {
    attached() {
      // 延迟计算星位点，避免阻塞页面渲染
      setTimeout(() => {
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
      }, 0);
    }
  },
  methods: {
    updateLastMoveMark(newVal) {
      const mark = {};
      if (newVal && typeof newVal.x === 'number' && typeof newVal.y === 'number') {
        mark[`${newVal.x}_${newVal.y}`] = true;
      }
      this.setData({ lastMoveMark: mark });
    },
    updateWinningMarks(newVal) {
      const marks = {};
      if (Array.isArray(newVal)) {
        newVal.forEach(pos => {
          if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            marks[`${pos.x}_${pos.y}`] = true;
          }
        });
      }
      this.setData({ winningMarks: marks });
    },
    onTap(e) {
      const { x, y } = e.currentTarget.dataset;
      const xNum = Number(x);
      const yNum = Number(y);
      this.triggerEvent('celltap', { x: xNum, y: yNum });
    },
  }
});

