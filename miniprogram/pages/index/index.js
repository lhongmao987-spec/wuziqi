"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const types_1 = require("../../core/types");
Page({
    data: {
        GameMode: types_1.GameMode,
        selectedMode: types_1.GameMode.PVE,
        selectedAiLevel: 'MEDIUM',
        selectedTimeIndex: 0,
        aiLevels: [
            { label: '初级', value: 'EASY' },
            { label: '中级', value: 'MEDIUM' },
            { label: '高级', value: 'HARD' }
        ],
        timeOptions: ['不限时', '每方 5 分钟', '每方 10 分钟']
    },
    selectPve() {
        this.setData({ selectedMode: types_1.GameMode.PVE });
    },
    selectPvp() {
        this.setData({ selectedMode: types_1.GameMode.PVP_LOCAL });
    },
    selectAi(e) {
        const value = e.currentTarget.dataset.value;
        this.setData({ selectedAiLevel: value, selectedMode: types_1.GameMode.PVE });
    },
    onTimeChange(e) {
        const index = Number(e.detail.value);
        this.setData({ selectedTimeIndex: index });
    },
    startGame() {
        const timeLimit = [undefined, 300, 600][this.data.selectedTimeIndex];
        const query = `mode=${this.data.selectedMode}&aiLevel=${this.data.selectedAiLevel}` +
            (timeLimit ? `&timeLimit=${timeLimit}` : '');
        wx.navigateTo({ url: `/pages/game/index?${query}` });
    },
    goRank() {
        wx.navigateTo({ url: '/pages/rank/index' });
    },
    goProfile() {
        wx.navigateTo({ url: '/pages/profile/index' });
    },
    goSettings() {
        wx.navigateTo({ url: '/pages/settings/index' });
    }
});
