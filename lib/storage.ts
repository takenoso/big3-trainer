"use client";
import { useState, useEffect, useCallback } from "react";

// ────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────
export interface SetRecord {
  weight: number;
  reps: number;
  completed: boolean;
}
export interface ExerciseRecord {
  name: string;
  sets: SetRecord[];
}
export interface TrainingSession {
  id: string;
  date: string;        // YYYY-MM-DD
  exercises: ExerciseRecord[];
  completed: boolean;
  savedAt?: string;
}
export interface MealEntry {
  id: string;
  time: string;        // HH:mm
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}
export interface DayMealRecord {
  date: string;
  entries: MealEntry[];
}
export interface RelativeGoal {
  benchTarget: number;
  squatTarget: number;
  deadliftTarget: number;
  targetDate: string;  // YYYY-MM-DD
}
export interface UserGoals {
  mode: "relative" | "absolute";
  relative: RelativeGoal;
  absoluteTargetRank: string;
}
export interface UserProfile {
  name: string;
  bodyweightKg: number;
  bench1RM: number;
  squat1RM: number;
  deadlift1RM: number;
  trainingDays: number;
}
export interface WeightEntry {
  date: string;  // YYYY-MM-DD
  kg: number;
}

// ────────────────────────────────────────────────────────────────
// localStorage フック（SSR安全）
// ────────────────────────────────────────────────────────────────
export function useLocalStorage<T>(
  key: string,
  init: T
): [T, (action: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(init);

  // マウント後にlocalStorageから読み込む（hydration安全）
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setState(JSON.parse(stored) as T);
    } catch { /* ignore */ }
  }, [key]);

  const set = useCallback(
    (action: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next =
          typeof action === "function"
            ? (action as (s: T) => T)(prev)
            : action;
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
    [key]
  );

  return [state, set];
}

// ────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────
export const todayStr = (): string => new Date().toISOString().slice(0, 10);

export const genId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const fmtDate = (s: string): string =>
  new Date(s + "T00:00:00").toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });

export const nowTime = (): string =>
  new Date().toTimeString().slice(0, 5);
