/**
 * WILKS Score Calculation & Rank System
 *
 * 科学的根拠：
 * - WILKSスコア（男性用）：体重に依存せず挙上重量を比較するための係数
 * - Epley式RM換算：1RM = 重量 × (1 + 回数 / 30)
 * - 参考文献: Wilks, Robert (1998). "Proposed method for determining power
 *   rankings for multiple body weight categories in powerlifting."
 */

// ── WILKS係数（男性用） ────────────────────────────────────────
const WILKS_COEFFICIENTS_MALE = {
  a: -216.0475144,
  b: 16.2606339,
  c: -0.002388645,
  d: -0.00113732,
  e: 7.01863e-6,
  f: -1.291e-8,
} as const;

/**
 * WILKSスコアを計算する（男性用フォーミュラ）
 *
 * @param bodyweightKg - 体重（kg）
 * @param totalKg      - BIG3合計重量（kg）。ベンチ+スクワット+デッドリフトの1RM合計
 * @returns WILKSスコア（小数点第2位まで）
 * @throws 体重が40kg未満 または 635kg超の場合（フォーミュラの有効範囲外）
 */
export function calculateWilksScore(
  bodyweightKg: number,
  totalKg: number
): number {
  if (bodyweightKg < 40 || bodyweightKg > 635) {
    throw new Error(
      `体重は40〜635kgの範囲で入力してください。入力値: ${bodyweightKg}kg`
    );
  }
  if (totalKg <= 0) {
    throw new Error(`合計重量は0より大きい値を入力してください。`);
  }

  const bw = bodyweightKg;
  const { a, b, c, d, e, f } = WILKS_COEFFICIENTS_MALE;

  // 分母：Wilks係数の多項式
  const denominator =
    a +
    b * bw +
    c * Math.pow(bw, 2) +
    d * Math.pow(bw, 3) +
    e * Math.pow(bw, 4) +
    f * Math.pow(bw, 5);

  const coefficient = 500 / denominator;
  const score = totalKg * coefficient;

  return Math.round(score * 100) / 100;
}

/**
 * Epley式による1RM推定
 * 1RM = weight × (1 + reps / 30)
 *
 * @param weightKg - 使用重量（kg）
 * @param reps     - 実施回数（1〜30）
 * @returns 推定1RM（kg、小数点第1位まで）
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0 || reps > 30) {
    throw new Error(`回数は1〜30の範囲で入力してください。入力値: ${reps}`);
  }
  if (weightKg <= 0) {
    throw new Error(`重量は0より大きい値を入力してください。`);
  }
  if (reps === 1) return weightKg;

  const oneRM = weightKg * (1 + reps / 30);
  return Math.round(oneRM * 10) / 10;
}

// ── 階級定義 ────────────────────────────────────────────────────
export type RankTier =
  | "bronze1"
  | "bronze2"
  | "bronze3"
  | "silver1"
  | "silver2"
  | "silver3"
  | "gold1"
  | "gold2"
  | "gold3"
  | "platinum1"
  | "platinum2"
  | "platinum3"
  | "gym_master"
  | "powerlifter";

export interface RankInfo {
  tier: RankTier;
  label: string;
  labelJa: string;
  minWilks: number;
  maxWilks: number | null; // null = 上限なし
  color: string;
  glowColor: string;
  icon: string;
}

export const RANK_TABLE: RankInfo[] = [
  {
    tier: "bronze1",
    label: "Bronze I",
    labelJa: "ブロンズ I",
    minWilks: 0,
    maxWilks: 80,
    color: "#cd7f32",
    glowColor: "rgba(205,127,50,0.5)",
    icon: "🥉",
  },
  {
    tier: "bronze2",
    label: "Bronze II",
    labelJa: "ブロンズ II",
    minWilks: 80,
    maxWilks: 120,
    color: "#cd7f32",
    glowColor: "rgba(205,127,50,0.5)",
    icon: "🥉",
  },
  {
    tier: "bronze3",
    label: "Bronze III",
    labelJa: "ブロンズ III",
    minWilks: 120,
    maxWilks: 160,
    color: "#b87333",
    glowColor: "rgba(184,115,51,0.5)",
    icon: "🥉",
  },
  {
    tier: "silver1",
    label: "Silver I",
    labelJa: "シルバー I",
    minWilks: 160,
    maxWilks: 200,
    color: "#c0c0c0",
    glowColor: "rgba(192,192,192,0.5)",
    icon: "🥈",
  },
  {
    tier: "silver2",
    label: "Silver II",
    labelJa: "シルバー II",
    minWilks: 200,
    maxWilks: 230,
    color: "#c0c0c0",
    glowColor: "rgba(192,192,192,0.5)",
    icon: "🥈",
  },
  {
    tier: "silver3",
    label: "Silver III",
    labelJa: "シルバー III",
    minWilks: 230,
    maxWilks: 260,
    color: "#a8a9ad",
    glowColor: "rgba(168,169,173,0.5)",
    icon: "🥈",
  },
  {
    tier: "gold1",
    label: "Gold I",
    labelJa: "ゴールド I",
    minWilks: 260,
    maxWilks: 290,
    color: "#ffd700",
    glowColor: "rgba(255,215,0,0.5)",
    icon: "🥇",
  },
  {
    tier: "gold2",
    label: "Gold II",
    labelJa: "ゴールド II",
    minWilks: 290,
    maxWilks: 320,
    color: "#ffd700",
    glowColor: "rgba(255,215,0,0.5)",
    icon: "🥇",
  },
  {
    tier: "gold3",
    label: "Gold III",
    labelJa: "ゴールド III",
    minWilks: 320,
    maxWilks: 350,
    color: "#f0c000",
    glowColor: "rgba(240,192,0,0.5)",
    icon: "🥇",
  },
  {
    tier: "platinum1",
    label: "Platinum I",
    labelJa: "プラチナ I",
    minWilks: 350,
    maxWilks: 380,
    color: "#e5e4e2",
    glowColor: "rgba(229,228,226,0.7)",
    icon: "💎",
  },
  {
    tier: "platinum2",
    label: "Platinum II",
    labelJa: "プラチナ II",
    minWilks: 380,
    maxWilks: 410,
    color: "#e5e4e2",
    glowColor: "rgba(229,228,226,0.7)",
    icon: "💎",
  },
  {
    tier: "platinum3",
    label: "Platinum III",
    labelJa: "プラチナ III",
    minWilks: 410,
    maxWilks: 440,
    color: "#d0d0e8",
    glowColor: "rgba(208,208,232,0.7)",
    icon: "💎",
  },
  {
    tier: "gym_master",
    label: "Gym Master",
    labelJa: "ジムの主",
    minWilks: 440,
    maxWilks: 500,
    color: "#ff4500",
    glowColor: "rgba(255,69,0,0.6)",
    icon: "👑",
  },
  {
    tier: "powerlifter",
    label: "Powerlifter",
    labelJa: "パワーリフター",
    minWilks: 500,
    maxWilks: null,
    color: "#a855f7",
    glowColor: "rgba(168,85,247,0.7)",
    icon: "⚡",
  },
];

/**
 * WILKSスコアから現在の階級を取得する
 */
export function getRankByWilks(wilksScore: number): RankInfo {
  // スコアが低い方から高い方へ走査し、該当する階級を返す
  for (let i = RANK_TABLE.length - 1; i >= 0; i--) {
    if (wilksScore >= RANK_TABLE[i].minWilks) {
      return RANK_TABLE[i];
    }
  }
  return RANK_TABLE[0]; // 最下位
}

/**
 * 現在の階級から次の階級への進捗率を返す（0〜1）
 */
export function getRankProgress(wilksScore: number): {
  currentRank: RankInfo;
  nextRank: RankInfo | null;
  progressPercent: number;
  pointsToNext: number;
} {
  const currentRank = getRankByWilks(wilksScore);
  const currentIndex = RANK_TABLE.findIndex((r) => r.tier === currentRank.tier);
  const nextRank =
    currentIndex < RANK_TABLE.length - 1
      ? RANK_TABLE[currentIndex + 1]
      : null;

  if (!nextRank || currentRank.maxWilks === null) {
    return {
      currentRank,
      nextRank: null,
      progressPercent: 100,
      pointsToNext: 0,
    };
  }

  const rangeSize = currentRank.maxWilks - currentRank.minWilks;
  const gained = wilksScore - currentRank.minWilks;
  const progressPercent = Math.min(100, Math.max(0, (gained / rangeSize) * 100));
  const pointsToNext = Math.max(0, currentRank.maxWilks - wilksScore);

  return {
    currentRank,
    nextRank,
    progressPercent: Math.round(progressPercent * 10) / 10,
    pointsToNext: Math.round(pointsToNext * 100) / 100,
  };
}
