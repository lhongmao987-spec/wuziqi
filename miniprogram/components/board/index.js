// @ts-nocheck
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
        onTap(e) {
            const { x, y } = e.currentTarget.dataset;
            this.triggerEvent('celltap', { x, y });
        },
        isLast(x, y) {
            const last = this.data.lastMove;
            return last && last.x === x && last.y === y;
        }
    }
});
