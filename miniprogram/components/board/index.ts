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
      value: null
    }
  },
  data: {
    starPoints: []
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
    }
  }
});

