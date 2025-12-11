// @ts-nocheck
import { GameResult, Player } from '../../core/types';

const resultTextMap: Record<GameResult, string> = {
  [GameResult.BlackWin]: '黑棋胜利',
  [GameResult.WhiteWin]: '白棋胜利',
  [GameResult.Draw]: '平局',
  [GameResult.BlackLoseForbidden]: '黑棋禁手判负',
  [GameResult.Resign]: '对局已结束',
  [GameResult.Timeout]: '超时判负',
  [GameResult.Ongoing]: '对局进行中'
};

Page({
  data: {
    resultText: '',
    subText: '',
    moves: 0,
    highlight: '',
    badges: [] as string[]
  },

  onLoad(query: Record<string, string>) {
    const result = (query.result as GameResult) || GameResult.Ongoing;
    const winner = query.winner as Player | undefined;
    const moves = Number(query.moves || 0);

    const highlight = winner === Player.Black
      ? '恭喜，黑棋执先取得胜利'
      : winner === Player.White
        ? '白棋后手反击成功'
        : '再来一局试试吧';

    const badges: string[] = [];
    if (moves > 0 && moves <= 20) badges.push('速战速决');
    if (result === GameResult.Timeout) badges.push('保持专注，留意计时');

    this.setData({
      resultText: resultTextMap[result],
      subText: highlight,
      moves,
      highlight,
      badges
    });
  },

  restart() {
    const config = wx.getStorageSync('lastConfig');
    if (config) {
      const { mode, aiLevel, timeLimitPerPlayer } = config;
      const query = `mode=${mode}&aiLevel=${aiLevel || ''}` +
        (timeLimitPerPlayer ? `&timeLimit=${timeLimitPerPlayer}` : '');
      wx.redirectTo({ url: `/pages/game/index?${query}` });
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  backHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
