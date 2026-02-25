import {
  calculateWilksScore,
  estimateOneRepMax,
  getRankByWilks,
  getRankProgress,
  RANK_TABLE,
} from "@/lib/wilks";

// ────────────────────────────────────────────────────────────────
// WILKSスコア計算のテスト
// ────────────────────────────────────────────────────────────────
describe("calculateWilksScore", () => {
  test("体重80kg、BIG3合計300kgの場合（中級者レベル）", () => {
    const score = calculateWilksScore(80, 300);
    // 期待値：男性80kg, total=300kg → WILKS ≈ 198.xx
    expect(score).toBeGreaterThan(190);
    expect(score).toBeLessThan(210);
  });

  test("体重75kg、BIG3合計250kgの場合（初心者レベル）", () => {
    const score = calculateWilksScore(75, 250);
    expect(score).toBeGreaterThan(160);
    expect(score).toBeLessThan(185);
  });

  test("体重90kg、BIG3合計500kg（エリートレベル）", () => {
    const score = calculateWilksScore(90, 500);
    expect(score).toBeGreaterThan(310);
    expect(score).toBeLessThan(360);
  });

  test("同じ体重なら合計重量が大きいほどスコアが高い", () => {
    const score1 = calculateWilksScore(80, 300);
    const score2 = calculateWilksScore(80, 400);
    expect(score2).toBeGreaterThan(score1);
  });

  test("同じ合計重量なら比較的軽い体重の方がスコアが高い（軽量級ボーナス）", () => {
    const score_light = calculateWilksScore(60, 250);
    const score_heavy = calculateWilksScore(100, 250);
    expect(score_light).toBeGreaterThan(score_heavy);
  });

  test("体重が範囲外（39kg）の場合にエラーをスロー", () => {
    expect(() => calculateWilksScore(39, 200)).toThrow(
      "体重は40〜635kgの範囲で入力してください"
    );
  });

  test("体重が範囲外（636kg）の場合にエラーをスロー", () => {
    expect(() => calculateWilksScore(636, 200)).toThrow(
      "体重は40〜635kgの範囲で入力してください"
    );
  });

  test("合計重量が0以下の場合にエラーをスロー", () => {
    expect(() => calculateWilksScore(80, 0)).toThrow(
      "合計重量は0より大きい値を入力してください"
    );
  });

  test("返り値が小数点第2位まで丸められている", () => {
    const score = calculateWilksScore(80, 300);
    const rounded = Math.round(score * 100) / 100;
    expect(score).toBe(rounded);
  });
});

// ────────────────────────────────────────────────────────────────
// RM換算のテスト
// ────────────────────────────────────────────────────────────────
describe("estimateOneRepMax", () => {
  test("100kg × 5回 → 約116.7kg", () => {
    const oneRM = estimateOneRepMax(100, 5);
    expect(oneRM).toBeCloseTo(116.7, 0);
  });

  test("80kg × 8回 → 約101.3kg", () => {
    const oneRM = estimateOneRepMax(80, 8);
    expect(oneRM).toBeCloseTo(101.3, 0);
  });

  test("1回の場合は入力重量をそのまま返す", () => {
    expect(estimateOneRepMax(120, 1)).toBe(120);
  });

  test("回数が0以下の場合にエラーをスロー", () => {
    expect(() => estimateOneRepMax(100, 0)).toThrow(
      "回数は1〜30の範囲で入力してください"
    );
  });

  test("回数が31の場合にエラーをスロー", () => {
    expect(() => estimateOneRepMax(100, 31)).toThrow(
      "回数は1〜30の範囲で入力してください"
    );
  });

  test("重量が0以下の場合にエラーをスロー", () => {
    expect(() => estimateOneRepMax(0, 5)).toThrow(
      "重量は0より大きい値を入力してください"
    );
  });

  test("返り値が小数点第1位まで丸められている", () => {
    const oneRM = estimateOneRepMax(100, 5);
    const rounded = Math.round(oneRM * 10) / 10;
    expect(oneRM).toBe(rounded);
  });
});

// ────────────────────────────────────────────────────────────────
// 階級判定のテスト
// ────────────────────────────────────────────────────────────────
describe("getRankByWilks", () => {
  test("スコア50 → ブロンズ I", () => {
    const rank = getRankByWilks(50);
    expect(rank.tier).toBe("bronze1");
    expect(rank.labelJa).toBe("ブロンズ I");
  });

  test("スコア160 → シルバー I（境界値）", () => {
    const rank = getRankByWilks(160);
    expect(rank.tier).toBe("silver1");
  });

  test("スコア500 → パワーリフター", () => {
    const rank = getRankByWilks(500);
    expect(rank.tier).toBe("powerlifter");
    expect(rank.labelJa).toBe("パワーリフター");
  });

  test("スコア440 → ジムの主", () => {
    const rank = getRankByWilks(440);
    expect(rank.tier).toBe("gym_master");
  });

  test("スコア0 → ブロンズ I（最低値）", () => {
    const rank = getRankByWilks(0);
    expect(rank.tier).toBe("bronze1");
  });

  test("スコア999 → パワーリフター（上限なし）", () => {
    const rank = getRankByWilks(999);
    expect(rank.tier).toBe("powerlifter");
  });

  test("全階級の境界値が正しく機能する", () => {
    const expectedRanks = [
      { score: 0, tier: "bronze1" },
      { score: 80, tier: "bronze2" },
      { score: 120, tier: "bronze3" },
      { score: 160, tier: "silver1" },
      { score: 200, tier: "silver2" },
      { score: 230, tier: "silver3" },
      { score: 260, tier: "gold1" },
      { score: 290, tier: "gold2" },
      { score: 320, tier: "gold3" },
      { score: 350, tier: "platinum1" },
      { score: 380, tier: "platinum2" },
      { score: 410, tier: "platinum3" },
      { score: 440, tier: "gym_master" },
      { score: 500, tier: "powerlifter" },
    ];

    expectedRanks.forEach(({ score, tier }) => {
      expect(getRankByWilks(score).tier).toBe(tier);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// 進捗計算のテスト
// ────────────────────────────────────────────────────────────────
describe("getRankProgress", () => {
  test("スコア40（ブロンズ I 中間）の進捗が50%", () => {
    const { progressPercent, pointsToNext, nextRank } = getRankProgress(40);
    expect(progressPercent).toBe(50);
    expect(pointsToNext).toBeCloseTo(40, 0);
    expect(nextRank?.tier).toBe("bronze2");
  });

  test("パワーリフター（最高位）の場合は進捗100%、次の階級なし", () => {
    const { progressPercent, nextRank, pointsToNext } = getRankProgress(600);
    expect(progressPercent).toBe(100);
    expect(nextRank).toBeNull();
    expect(pointsToNext).toBe(0);
  });

  test("進捗が0〜100の範囲内に収まる", () => {
    [0, 50, 100, 200, 300, 400, 500].forEach((score) => {
      const { progressPercent } = getRankProgress(score);
      expect(progressPercent).toBeGreaterThanOrEqual(0);
      expect(progressPercent).toBeLessThanOrEqual(100);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// 階級テーブルの整合性チェック
// ────────────────────────────────────────────────────────────────
describe("RANK_TABLE integrity", () => {
  test("全14階級が定義されている", () => {
    expect(RANK_TABLE).toHaveLength(14);
  });

  test("各階級のminWilksが昇順に並んでいる", () => {
    for (let i = 1; i < RANK_TABLE.length; i++) {
      expect(RANK_TABLE[i].minWilks).toBeGreaterThan(
        RANK_TABLE[i - 1].minWilks
      );
    }
  });

  test("最高位（パワーリフター）のmaxWilksがnull", () => {
    const top = RANK_TABLE[RANK_TABLE.length - 1];
    expect(top.tier).toBe("powerlifter");
    expect(top.maxWilks).toBeNull();
  });
});
