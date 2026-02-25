"use client";
import { useState, useRef, useEffect } from "react";
import { calculateWilksScore, getRankProgress, estimateOneRepMax, RANK_TABLE } from "@/lib/wilks";
import {
  useLocalStorage, todayStr, genId, fmtDate, nowTime,
  type TrainingSession,
  type MealEntry, type DayMealRecord,
  type UserProfile, type WeightEntry,
} from "@/lib/storage";

// ── デフォルト値 ──────────────────────────────────────────────
const DEFAULT_PROFILE: UserProfile = {
  name: "竹内 大地", bodyweightKg: 78,
  bench1RM: 100, squat1RM: 130, deadlift1RM: 160, trainingDays: 4,
};

const DEFAULT_MENU: { exercise: string; sets: number; reps: number; weightKg: number }[] = [
  { exercise: "ベンチプレス", sets: 4, reps: 5, weightKg: 85 },
  { exercise: "スクワット",   sets: 3, reps: 8, weightKg: 110 },
  { exercise: "インクラインダンベルプレス", sets: 3, reps: 10, weightKg: 32 },
];

// ── ユーティリティ ────────────────────────────────────────────
function safeWilks(bodyweightKg: number, totalKg: number): number {
  if (bodyweightKg < 40 || bodyweightKg > 635 || totalKg <= 0) return 0;
  return calculateWilksScore(bodyweightKg, totalKg);
}
function sig1(n: number): number {
  if (n <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.round(n / p) * p;
}
function computeStats(p: UserProfile) {
  const total = p.bench1RM + p.squat1RM + p.deadlift1RM;
  const wilks = safeWilks(p.bodyweightKg, total);
  return { wilks, total, ...getRankProgress(wilks) };
}
function makeDefaultSession(menu: MenuTemplateItem[] = DEFAULT_MENU): TrainingSession {
  return {
    id: genId(), date: todayStr(), completed: false,
    exercises: menu.map((m) => ({
      name: m.exercise,
      sets: Array.from({ length: m.sets }, () => ({ weight: m.weightKg, reps: m.reps, completed: false })),
    })),
  };
}

// ── 型 ────────────────────────────────────────────────────────
type MenuTemplateItem = { exercise: string; sets: number; reps: number; weightKg: number };
type WeeklyMenu = Record<number, MenuTemplateItem[]>; // 0=Sun 1=Mon ... 6=Sat
type ChatMsg = { role: "user" | "assistant"; content: string; usage?: { input: number; output: number } };
type GoalEntry = { text: string; savedAt: string };
type GoalData = { daily: GoalEntry | null; month1: GoalEntry | null; month6: GoalEntry | null };
const DEFAULT_GOALS: GoalData = { daily: null, month1: null, month6: null };
type MealGoal = { kcal: number; protein: number; fat: number; carbs: number };
const DEFAULT_MEAL_GOAL: MealGoal = { kcal: 2800, protein: 180, fat: 70, carbs: 350 };
type Tab = "home" | "training" | "meal" | "summary" | "planning" | "settings";
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const NAV_SIDEBAR: { id: Tab; label: string; icon: string }[] = [
  { id: "home",     label: "ホーム",          icon: "⊞"  },
  { id: "training", label: "トレーニング",    icon: "🏋️" },
  { id: "meal",     label: "食事",            icon: "🥗"  },
  { id: "summary",  label: "サマリー",        icon: "📊"  },
  { id: "planning", label: "AIプランニング",  icon: "💬"  },
  { id: "settings", label: "設定",            icon: "⚙️"  },
];
const NAV_MOBILE = NAV_SIDEBAR.slice(0, 5); // 設定はモバイルでヘッダーアイコン

// ════════════════════════════════════════════════════════════════
// メインアプリ
// ════════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [profile,     setProfile]     = useLocalStorage<UserProfile>("b3_profile", DEFAULT_PROFILE);
  const [sessions,    setSessions]    = useLocalStorage<TrainingSession[]>("b3_sessions", []);
  const [mealRecords, setMealRecords] = useLocalStorage<DayMealRecord[]>("b3_meals", []);
  const [weightLog,   setWeightLog]   = useLocalStorage<WeightEntry[]>("b3_weights", []);
  const [chatMessages, setChatMessages] = useLocalStorage<ChatMsg[]>("b3_chat_msgs", []);
  const [chatTokens,   setChatTokens]   = useLocalStorage<{ input: number; output: number }>("b3_chat_tokens", { input: 0, output: 0 });
  const [weeklyMenu,   setWeeklyMenu]   = useLocalStorage<WeeklyMenu>("b3_weekly_menu", {});
  const [goals,        setGoals]        = useLocalStorage<GoalData>("b3_goals", DEFAULT_GOALS);
  const [mealGoal,     setMealGoal]     = useLocalStorage<MealGoal>("b3_meal_goal", DEFAULT_MEAL_GOAL);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  function saveSession(s: TrainingSession) {
    setSessions((prev) => {
      const idx = prev.findIndex((x) => x.id === s.id);
      return idx >= 0 ? prev.map((x, i) => (i === idx ? s : x)) : [s, ...prev];
    });
  }
  function addMealEntry(entry: MealEntry) {
    const today = todayStr();
    setMealRecords((prev) => {
      const exists = prev.find((r) => r.date === today);
      if (exists) return prev.map((r) => r.date === today ? { ...r, entries: [...r.entries, entry] } : r);
      return [{ date: today, entries: [entry] }, ...prev];
    });
  }
  function addMealEntryForDate(date: string, entry: MealEntry) {
    setMealRecords((prev) => {
      const exists = prev.find((r) => r.date === date);
      if (exists) return prev.map((r) => r.date === date ? { ...r, entries: [...r.entries, entry] } : r);
      return [{ date, entries: [entry] }, ...prev].sort((a, b) => b.date.localeCompare(a.date));
    });
  }
  function removeMealEntry(date: string, id: string) {
    setMealRecords((prev) =>
      prev.map((r) => r.date === date ? { ...r, entries: r.entries.filter((e) => e.id !== id) } : r)
    );
  }
  function updateMealEntry(date: string, entry: MealEntry) {
    setMealRecords((prev) =>
      prev.map((r) => r.date === date ? { ...r, entries: r.entries.map((e) => e.id === entry.id ? entry : e) } : r)
    );
  }
  function addWeight(entry: WeightEntry) {
    setWeightLog((prev) => [entry, ...prev.filter((e) => e.date !== entry.date)]);
    setProfile((prev) => ({ ...prev, bodyweightKg: entry.kg }));
  }
  function saveGoal(type: keyof GoalData, text: string) {
    setGoals((prev) => ({ ...prev, [type]: { text, savedAt: todayStr() } }));
  }
  function deleteGoal(type: keyof GoalData) {
    setGoals((prev) => ({ ...prev, [type]: null }));
  }

  const stats = computeStats(profile);
  const todaySession  = sessions.find((s) => s.date === todayStr());
  const todayMeals    = mealRecords.find((r) => r.date === todayStr());

  const planningSystem = `あなたは優秀なパーソナルトレーナーAIです。ユーザーと対話しながら、科学的根拠に基づいたトレーニングメニューをゼロから一緒に作り上げていきます。

【ユーザーデータ】
体重: ${profile.bodyweightKg}kg / WILKSスコア: ${stats.wilks.toFixed(1)} (${stats.currentRank.labelJa})
ベンチ1RM: ${profile.bench1RM}kg / スクワット1RM: ${profile.squat1RM}kg / デッドリフト1RM: ${profile.deadlift1RM}kg
週トレ日数: ${profile.trainingDays}日

【進め方】
1. 今日の状態（疲労度・利用時間・前回トレ内容）を1〜2の質問で確認する
2. ボリューム理論・RPEに基づいて具体的な種目・重量・回数・セット数を提案する
3. ユーザーのフィードバックで柔軟に調整する
4. 最終メニューは箇条書きで構造的に提示する

論理的・客観的に、データドリブンで、日本語で回答してください。`;

  return (
    <div className="flex min-h-screen bg-[#060c18] text-slate-50">
      {/* ── サイドバー（PC） ── */}
      <aside className="hidden lg:flex flex-col fixed top-0 left-0 h-full w-52 border-r border-[#1a2f5a]/50 bg-[#070d1b] z-40">
        <div className="px-5 py-4 border-b border-[#1a2f5a]/40">
          <span className="text-lg font-black tracking-tight">Fit<span className="gradient-text-lime">Log</span></span>
        </div>
        <div className="px-4 py-3 border-b border-[#1a2f5a]/30">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-[#1a2f5a] flex items-center justify-center text-xs font-bold text-lime-400 shrink-0">{profile.name.charAt(0)}</div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{profile.name}</p>
              <p className="text-[10px] text-slate-500">{profile.bodyweightKg}kg</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#0e1a36] px-2.5 py-1.5">
            <span className="text-sm">{stats.currentRank.icon}</span>
            <span className="text-xs font-bold" style={{ color: stats.currentRank.color }}>{stats.currentRank.labelJa}</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {NAV_SIDEBAR.map((item) => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === item.id ? "bg-lime-400/10 text-lime-400 border border-lime-400/20" : "text-slate-400 hover:text-white hover:bg-[#0e1a36]"
              }`}
            >
              <span className="w-5 text-center">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-[#1a2f5a]/30">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">WILKS</p>
          <p className="text-2xl font-black">{sig1(stats.wilks)}</p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#0e1a36] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${stats.progressPercent}%`, background: `linear-gradient(90deg,${stats.currentRank.color},${stats.nextRank?.color ?? stats.currentRank.color})` }} />
          </div>
          {stats.nextRank && <p className="text-[10px] text-slate-500 mt-1">あと <span className="text-lime-400 font-bold">{sig1(stats.pointsToNext)}pts</span></p>}
        </div>
      </aside>

      {/* ── メインコンテンツ ── */}
      <div className="flex-1 lg:ml-52 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 border-b border-[#1a2f5a]/60 bg-[#060c18]/90 backdrop-blur-md">
          <div className="flex items-center justify-between px-5 py-3 max-w-5xl mx-auto">
            <span className="lg:hidden text-base font-black">Fit<span className="gradient-text-lime">Log</span></span>
            <h1 className="hidden lg:block text-sm font-semibold text-slate-400">{NAV_SIDEBAR.find((n) => n.id === activeTab)?.label}</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 hidden sm:block">{new Date().toLocaleDateString("ja-JP",{month:"long",day:"numeric",weekday:"short"})}</span>
              <button onClick={() => setActiveTab("settings")} className={`text-lg transition-colors ${activeTab==="settings"?"text-lime-400":"text-slate-500 hover:text-white"}`}>⚙️</button>
              <div className="lg:hidden h-8 w-8 rounded-full bg-[#1a2f5a] flex items-center justify-center text-xs font-bold text-lime-400">{profile.name.charAt(0)}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-6 max-w-5xl mx-auto w-full pb-24 lg:pb-8">
          {activeTab === "home"     && <HomeTab profile={profile} stats={stats} todaySession={todaySession} todayMeals={todayMeals} onNavigate={setActiveTab} weightLog={weightLog} goals={goals} onDeleteGoal={deleteGoal} sessions={sessions} mealRecords={mealRecords} onSaveSession={saveSession} onAddMealEntryForDate={addMealEntryForDate} onRemoveMealEntry={removeMealEntry} onUpdateMealEntry={updateMealEntry} onAddWeight={addWeight} mealGoal={mealGoal} onToast={showToast} />}
          {activeTab === "training" && <TrainingTab todaySession={todaySession} onSave={saveSession} onToast={showToast} profile={profile} onUpdateProfile={setProfile} weightLog={weightLog} onAddWeight={addWeight} weeklyMenu={weeklyMenu} onSaveWeeklyMenu={setWeeklyMenu} />}
          {activeTab === "meal"     && <MealTab todayMeals={todayMeals} onAdd={addMealEntry} onRemove={removeMealEntry} onUpdate={updateMealEntry} onToast={showToast} mealGoal={mealGoal} onSaveMealGoal={setMealGoal} />}
          {activeTab === "summary"  && <SummaryTab sessions={sessions} mealRecords={mealRecords} weightLog={weightLog} />}
          {activeTab === "planning" && <PlanningTab systemContext={planningSystem} messages={chatMessages} setMessages={setChatMessages} sessionTokens={chatTokens} setSessionTokens={setChatTokens} onSaveGoal={saveGoal} />}
          {activeTab === "settings" && <SettingsTab profile={profile} onSaveProfile={(p)=>{setProfile(p);showToast("プロフィールを保存しました");}} />}
        </main>
      </div>

      {/* ── モバイルボトムナビ ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-[#1a2f5a]/60 bg-[#060c18]/95 backdrop-blur-md">
        <div className="flex items-center justify-around py-1.5">
          {NAV_MOBILE.map((item) => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all ${activeTab===item.id?"text-lime-400":"text-slate-500 hover:text-slate-300"}`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="text-[9px] font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* トースト通知 */}
      {toast && (
        <div className="toast fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-lime-400 text-[#060c18] px-5 py-2.5 text-sm font-bold shadow-lg">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ホームタブ
// ════════════════════════════════════════════════════════════════
function HomeTab({ profile, stats, todaySession, todayMeals, onNavigate, weightLog, goals, onDeleteGoal, sessions, mealRecords, onSaveSession, onAddMealEntryForDate, onRemoveMealEntry, onUpdateMealEntry, onAddWeight, mealGoal, onToast }: {
  profile: UserProfile;
  stats: ReturnType<typeof computeStats>;
  todaySession?: TrainingSession;
  todayMeals?: DayMealRecord;
  onNavigate: (t: Tab) => void;
  weightLog: WeightEntry[];
  goals: GoalData;
  onDeleteGoal: (type: keyof GoalData) => void;
  sessions: TrainingSession[];
  mealRecords: DayMealRecord[];
  onSaveSession: (s: TrainingSession) => void;
  onAddMealEntryForDate: (date: string, e: MealEntry) => void;
  onRemoveMealEntry: (date: string, id: string) => void;
  onUpdateMealEntry: (date: string, e: MealEntry) => void;
  onAddWeight: (entry: WeightEntry) => void;
  mealGoal: MealGoal;
  onToast: (msg: string) => void;
}) {
  const { wilks, total, currentRank, nextRank, progressPercent, pointsToNext } = stats;
  const todayWeight = weightLog.find((e) => e.date === todayStr())?.kg;
  const todayKcal = todayMeals?.entries.reduce((a, e) => a + e.kcal, 0) ?? 0;
  const todayP    = todayMeals?.entries.reduce((a, e) => a + e.protein, 0) ?? 0;
  const todayF    = todayMeals?.entries.reduce((a, e) => a + e.fat, 0) ?? 0;
  const todayC    = todayMeals?.entries.reduce((a, e) => a + e.carbs, 0) ?? 0;
  const todayDone  = todaySession?.completed ?? false;
  const doneSets   = todaySession?.exercises.reduce((a, ex) => a + ex.sets.filter((s) => s.completed).length, 0) ?? 0;
  const totalSets  = todaySession?.exercises.reduce((a, ex) => a + ex.sets.length, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest">Dashboard</p>
          <h2 className="text-xl font-bold">おはよう、<span className="text-lime-400">{profile.name.split(" ")[1] ?? profile.name}</span></h2>
        </div>
        {todayWeight && (
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">今日の体重</p>
            <p className="text-xl font-black text-lime-400">{todayWeight}<span className="text-xs text-slate-400 font-normal"> kg</span></p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* KPIカード */}
        <div className="relative overflow-hidden rounded-2xl border bg-[#0a1224] p-5 card-hover"
          style={{ borderColor: currentRank.color + "40", boxShadow: `0 0 30px ${currentRank.glowColor}` }}>
          <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full opacity-15 blur-2xl" style={{ backgroundColor: currentRank.color }} />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">称号</p>
              <div className="flex items-center gap-2 mb-1.5"><span className="text-2xl">{currentRank.icon}</span><h3 className="text-2xl font-black" style={{ color: currentRank.color }}>{currentRank.labelJa}</h3></div>
              <div className="flex items-baseline gap-1"><span className="text-4xl font-black">{sig1(wilks)}</span><span className="text-sm text-slate-400">WILKS</span></div>
            </div>
            <div className="text-right space-y-1">
              {[["BN",profile.bench1RM],["SQ",profile.squat1RM],["DL",profile.deadlift1RM]].map(([l,v]) => (
                <div key={l as string} className="flex items-center gap-1 justify-end">
                  <span className="text-[10px] text-slate-500 w-5">{l}</span>
                  <span className="text-sm font-bold">{v}</span>
                  <span className="text-[10px] text-slate-500">kg</span>
                </div>
              ))}
              <div className="border-t border-[#1a2f5a] pt-1"><span className="text-xs text-slate-400">Total </span><span className="text-sm font-black text-lime-400">{total}kg</span></div>
            </div>
          </div>
          {nextRank && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>{currentRank.labelJa}</span>
                <span>あと<span className="text-lime-400 font-bold"> {sig1(pointsToNext)}pts </span>で<span style={{color:nextRank.color}}>{nextRank.labelJa}</span></span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#0e1a36] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width:`${progressPercent}%`, background:`linear-gradient(90deg,${currentRank.color},${nextRank.color})` }} />
              </div>
            </div>
          )}
        </div>

        {/* 今日のステータス */}
        <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] p-5 space-y-3">
          <p className="text-xs text-slate-400 uppercase tracking-widest">Today&apos;s Status</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => onNavigate("training")}
              className={`rounded-xl p-3 border transition-colors ${todayDone ? "border-lime-400/30 bg-lime-400/5" : "border-[#1a2f5a] bg-[#0e1a36] hover:bg-[#1a2f5a]"}`}>
              <p className="text-xs text-slate-400 mb-1">トレーニング</p>
              {todayDone ? (
                <p className="text-sm font-black text-lime-400">完了 ✓</p>
              ) : totalSets > 0 ? (
                <p className="text-sm font-black">{doneSets}<span className="text-slate-400 font-normal">/{totalSets}セット</span></p>
              ) : (
                <p className="text-sm font-black text-slate-400">未開始</p>
              )}
            </button>
            <button onClick={() => onNavigate("meal")}
              className="rounded-xl p-3 border border-[#1a2f5a] bg-[#0e1a36] hover:bg-[#1a2f5a] transition-colors text-left">
              <p className="text-xs text-slate-400 mb-1">食事</p>
              <p className="text-sm font-black">{todayKcal.toFixed(1)}<span className="text-slate-400 font-normal text-xs"> kcal</span></p>
              {todayKcal > 0 && (
                <p className="text-[10px] text-slate-500 mt-0.5">P:{todayP.toFixed(1)} F:{todayF.toFixed(1)} C:{todayC.toFixed(1)}</p>
              )}
            </button>
          </div>
          <button onClick={() => onNavigate("training")}
            className="w-full rounded-xl bg-lime-400 py-3 font-black text-[#060c18] text-sm hover:bg-lime-300 active:scale-95 transition-all"
            style={{ boxShadow: "0 4px 20px rgba(163,230,53,0.3)" }}>
            {todayDone ? "📊 今日の記録を見る" : "🏋️ 今日のトレーニングを始める"} →
          </button>
          <button onClick={() => onNavigate("planning")}
            className="w-full rounded-xl bg-[#0e1a36] border border-[#1a2f5a] py-2.5 text-sm font-semibold text-slate-300 hover:border-lime-400/30 hover:text-white transition-all">
            💬 AIとメニューを相談する
          </button>
        </div>
      </div>

      {/* BIG3スタッツ */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label:"ベンチプレス", value:profile.bench1RM, icon:"🏋️", color:"#3b82f6" },
          { label:"スクワット",   value:profile.squat1RM,  icon:"🦵",  color:"#8b5cf6" },
          { label:"デッドリフト", value:profile.deadlift1RM, icon:"💪", color:"#ef4444" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="rounded-2xl border bg-[#0a1224] p-4 text-center card-hover" style={{ borderColor: color+"30" }}>
            <span className="text-xl">{icon}</span>
            <p className="mt-1 text-2xl font-black">{value}<span className="text-xs text-slate-500 font-normal">kg</span></p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            <p className="text-xs mt-0.5 font-semibold" style={{ color }}>1RM</p>
          </div>
        ))}
      </div>

      {/* 目標カード */}
      {(goals.daily || goals.month1 || goals.month6) && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 uppercase tracking-widest">Goals</p>
          <div className="space-y-3">
            {([
              { key: "daily"  as keyof GoalData, label: "今日の目標",    icon: "🎯", color: "#a3e635" },
              { key: "month1" as keyof GoalData, label: "1ヶ月後の目標", icon: "📅", color: "#60a5fa" },
              { key: "month6" as keyof GoalData, label: "半年後の目標",  icon: "🏆", color: "#f59e0b" },
            ] as const).filter(({ key }) => goals[key]).map(({ key, label, icon, color }) => (
              <div key={key} className="rounded-2xl border bg-[#0a1224] p-4" style={{ borderColor: color + "30" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{icon}</span>
                  <p className="text-xs font-bold uppercase tracking-widest" style={{ color }}>{label}</p>
                  {goals[key]?.savedAt && (
                    <p className="text-[10px] text-slate-500 ml-auto">{fmtDate(goals[key]!.savedAt)}</p>
                  )}
                  <button onClick={() => onDeleteGoal(key)}
                    className="ml-1 text-slate-600 hover:text-red-400 transition-colors text-xs leading-none" title="削除">✕</button>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{goals[key]!.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* カレンダー */}
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">Calendar</p>
        <CalendarView
          sessions={sessions} mealRecords={mealRecords} weightLog={weightLog}
          onSaveSession={onSaveSession} onAddMealEntryForDate={onAddMealEntryForDate}
          onRemoveMealEntry={onRemoveMealEntry} onUpdateMealEntry={onUpdateMealEntry}
          onAddWeight={onAddWeight} mealGoal={mealGoal} onToast={onToast}
        />
      </div>

      <RankRoadmap currentWilks={wilks} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// カレンダービュー
// ════════════════════════════════════════════════════════════════
function CalendarView({ sessions, mealRecords, weightLog, onSaveSession, onAddMealEntryForDate, onRemoveMealEntry, onUpdateMealEntry, onAddWeight, mealGoal, onToast }: {
  sessions: TrainingSession[];
  mealRecords: DayMealRecord[];
  weightLog: WeightEntry[];
  onSaveSession: (s: TrainingSession) => void;
  onAddMealEntryForDate: (date: string, e: MealEntry) => void;
  onRemoveMealEntry: (date: string, id: string) => void;
  onUpdateMealEntry: (date: string, e: MealEntry) => void;
  onAddWeight: (entry: WeightEntry) => void;
  mealGoal: MealGoal;
  onToast: (msg: string) => void;
}) {
  const today = todayStr();
  const [selDate, setSelDate] = useState(today);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const firstDOW = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDOW).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }

  const selSession    = sessions.find((s) => s.date === selDate);
  const selMeals      = mealRecords.find((r) => r.date === selDate);
  const selWeightEntry = weightLog.find((e) => e.date === selDate);

  return (
    <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] overflow-hidden">
      {/* 月ナビ */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a2f5a]/60">
        <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#0e1a36] transition-colors text-lg">‹</button>
        <span className="text-sm font-bold">{viewYear}年{viewMonth + 1}月</span>
        <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#0e1a36] transition-colors text-lg">›</button>
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 border-b border-[#1a2f5a]/40">
        {["日","月","火","水","木","金","土"].map((d, i) => (
          <div key={d} className={`py-1.5 text-center text-[10px] font-semibold ${i===0?"text-red-400":i===6?"text-blue-400":"text-slate-500"}`}>{d}</div>
        ))}
      </div>

      {/* グリッド */}
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-[62px] border-b border-r border-[#1a2f5a]/20" />;
          const dow = (firstDOW + parseInt(date.slice(-2)) - 1) % 7;
          const hasSess  = sessions.some((s) => s.date === date);
          const hasMeals = mealRecords.some((r) => r.date === date && r.entries.length > 0);
          const hasWt    = weightLog.some((e) => e.date === date);
          const kcal     = mealRecords.find((r) => r.date === date)?.entries.reduce((a, e) => a + e.kcal, 0) ?? 0;
          const isToday  = date === today;
          const isSel    = date === selDate;
          const dayNum   = parseInt(date.slice(-2));
          return (
            <button key={date} onClick={() => setSelDate(date)}
              className={`min-h-[62px] p-1 border-b border-r border-[#1a2f5a]/20 flex flex-col items-center gap-0.5 transition-all hover:bg-[#0e1a36]/60 ${isSel ? "bg-lime-400/8 ring-1 ring-inset ring-lime-400/25" : ""}`}>
              <span className={`text-[11px] font-bold leading-none mt-0.5 ${
                isToday ? "bg-lime-400 text-[#060c18] rounded-full w-5 h-5 flex items-center justify-center text-[10px]"
                : dow===0 ? "text-red-400" : dow===6 ? "text-blue-400" : "text-slate-300"
              }`}>{dayNum}</span>
              <div className="flex gap-px flex-wrap justify-center">
                {hasSess  && <span className="text-[9px] leading-none">🏋️</span>}
                {hasMeals && <span className="text-[9px] leading-none">🥗</span>}
                {hasWt    && <span className="text-[9px] leading-none">⚖️</span>}
              </div>
              {kcal > 0 && <span className="text-[8px] text-slate-500 leading-none">{Math.round(kcal)}</span>}
            </button>
          );
        })}
      </div>

      {/* 日別詳細パネル */}
      <div className="border-t border-[#1a2f5a]/60 px-4 py-3">
        <p className="text-xs font-bold text-slate-400 mb-3">{fmtDate(selDate)}</p>
        <DayDetailPanel
          key={selDate}
          date={selDate}
          session={selSession}
          meals={selMeals}
          weightEntry={selWeightEntry}
          onSaveSession={onSaveSession}
          onAddMealEntry={(e) => onAddMealEntryForDate(selDate, e)}
          onRemoveMealEntry={(id) => onRemoveMealEntry(selDate, id)}
          onUpdateMealEntry={(e) => onUpdateMealEntry(selDate, e)}
          onAddWeight={onAddWeight}
          onToast={onToast}
        />
      </div>
    </div>
  );
}

// ── 日別編集パネル ──────────────────────────────────────────────
function DayDetailPanel({ date, session, meals, weightEntry, onSaveSession, onAddMealEntry, onRemoveMealEntry, onUpdateMealEntry, onAddWeight, onToast }: {
  date: string;
  session?: TrainingSession;
  meals?: DayMealRecord;
  weightEntry?: WeightEntry;
  onSaveSession: (s: TrainingSession) => void;
  onAddMealEntry: (e: MealEntry) => void;
  onRemoveMealEntry: (id: string) => void;
  onUpdateMealEntry: (e: MealEntry) => void;
  onAddWeight: (entry: WeightEntry) => void;
  onToast: (msg: string) => void;
}) {
  const [wInput, setWInput]           = useState(weightEntry ? String(weightEntry.kg) : "");
  const [showMealAdd, setShowMealAdd] = useState(false);
  const [mealAdd, setMealAdd]         = useState({ name: "", kcal: "", protein: "", fat: "", carbs: "" });
  const [editMealId, setEditMealId]   = useState<string | null>(null);
  const [editMealVals, setEditMealVals] = useState({ name: "", kcal: "", protein: "", fat: "", carbs: "" });
  const [editSess, setEditSess]       = useState<TrainingSession | undefined>(session);

  const entries   = meals?.entries ?? [];
  const totalKcal = entries.reduce((a, e) => a + e.kcal, 0);
  const totalP    = entries.reduce((a, e) => a + e.protein, 0);
  const totalF    = entries.reduce((a, e) => a + e.fat, 0);
  const totalC    = entries.reduce((a, e) => a + e.carbs, 0);

  function startMealEdit(e: MealEntry) {
    setEditMealId(e.id);
    setEditMealVals({ name: e.name, kcal: String(e.kcal), protein: String(e.protein), fat: String(e.fat), carbs: String(e.carbs) });
  }

  return (
    <div className="space-y-3">
      {/* ── 体重 ── */}
      <div className="rounded-xl bg-[#060c18] border border-[#1a2f5a] p-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">⚖️ 体重</p>
        <div className="flex gap-2 items-center">
          <input type="text" inputMode="decimal" value={wInput} onChange={(e) => setWInput(e.target.value)}
            placeholder={weightEntry ? String(weightEntry.kg) : "例: 78.5"}
            className="flex-1 rounded-lg bg-[#0a1224] border border-[#1a2f5a] px-3 py-1.5 text-sm focus:outline-none focus:border-lime-400/50" />
          <span className="text-xs text-slate-500 shrink-0">kg</span>
          <button onClick={() => {
            const kg = parseFloat(wInput);
            if (!isNaN(kg) && kg > 0) { onAddWeight({ date, kg }); onToast("体重を保存しました"); }
          }} className="rounded-lg bg-lime-400 px-4 py-1.5 text-xs font-black text-[#060c18] hover:bg-lime-300 transition-colors">保存</button>
        </div>
        {weightEntry && <p className="text-[10px] text-slate-500 mt-1">現在の記録: {weightEntry.kg} kg</p>}
      </div>

      {/* ── 食事 ── */}
      <div className="rounded-xl bg-[#060c18] border border-[#1a2f5a] p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">🥗 食事</p>
          {totalKcal > 0 && <p className="text-[10px] text-slate-500">{totalKcal.toFixed(1)} kcal · P:{totalP.toFixed(1)} F:{totalF.toFixed(1)} C:{totalC.toFixed(1)}</p>}
        </div>
        <div className="space-y-1.5 mb-2">
          {entries.length === 0 && !showMealAdd && <p className="text-xs text-slate-600 text-center py-1">記録なし</p>}
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg bg-[#0a1224] border border-[#1a2f5a]/50 overflow-hidden">
              {editMealId === e.id ? (
                <div className="p-2 space-y-1.5">
                  <input type="text" value={editMealVals.name} onChange={(ev) => setEditMealVals((f) => ({ ...f, name: ev.target.value }))}
                    className="w-full rounded bg-[#060c18] border border-[#1a2f5a] px-2 py-1 text-xs focus:outline-none focus:border-lime-400/50" />
                  <div className="grid grid-cols-4 gap-1">
                    {([["kcal","kcal"],["protein","P"],["fat","F"],["carbs","C"]] as const).map(([k, label]) => (
                      <div key={k}>
                        <p className="text-[9px] text-slate-500 mb-0.5">{label}</p>
                        <input type="text" inputMode="decimal" value={editMealVals[k]}
                          onChange={(ev) => setEditMealVals((f) => ({ ...f, [k]: ev.target.value }))}
                          className="w-full rounded bg-[#060c18] border border-[#1a2f5a] px-1 py-1 text-[11px] text-center focus:outline-none focus:border-lime-400/50" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => {
                      onUpdateMealEntry({ ...e, name: editMealVals.name.trim() || e.name, kcal: parseFloat(editMealVals.kcal) || 0, protein: parseFloat(editMealVals.protein) || 0, fat: parseFloat(editMealVals.fat) || 0, carbs: parseFloat(editMealVals.carbs) || 0 });
                      setEditMealId(null); onToast("更新しました");
                    }} className="flex-1 rounded bg-lime-400 py-1 text-xs font-black text-[#060c18]">保存</button>
                    <button onClick={() => setEditMealId(null)} className="px-2 rounded border border-[#1a2f5a] text-xs text-slate-400">キャンセル</button>
                    <button onClick={() => { onRemoveMealEntry(e.id); setEditMealId(null); onToast("削除しました"); }}
                      className="px-2 rounded border border-red-500/30 text-xs text-red-400 hover:bg-red-400/10">削除</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => startMealEdit(e)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#0e1a36]/40 transition-colors text-left">
                  <div>
                    <p className="text-xs font-semibold">{e.name}{e.amount && <span className="text-slate-500 font-normal ml-1">{e.amount}{e.unit}</span>}</p>
                    <p className="text-[10px] text-slate-500">P:{e.protein.toFixed(1)} F:{e.fat.toFixed(1)} C:{e.carbs.toFixed(1)}g</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-bold">{e.kcal.toFixed(1)}<span className="text-slate-500 font-normal">kcal</span></span>
                    <span className="text-[10px] text-slate-500">✏️</span>
                  </div>
                </button>
              )}
            </div>
          ))}
        </div>
        {showMealAdd ? (
          <div className="space-y-1.5 border-t border-[#1a2f5a]/40 pt-2">
            <input type="text" value={mealAdd.name} onChange={(e) => setMealAdd((f) => ({ ...f, name: e.target.value }))}
              placeholder="食事名" className="w-full rounded-lg bg-[#0a1224] border border-[#1a2f5a] px-3 py-1.5 text-xs focus:outline-none focus:border-lime-400/50" />
            <div className="grid grid-cols-4 gap-1">
              {([["kcal","kcal"],["protein","P"],["fat","F"],["carbs","C"]] as const).map(([k, label]) => (
                <div key={k}>
                  <p className="text-[9px] text-slate-500 mb-0.5">{label}</p>
                  <input type="text" inputMode="decimal" value={mealAdd[k]}
                    onChange={(e) => setMealAdd((f) => ({ ...f, [k]: e.target.value }))}
                    className="w-full rounded bg-[#0a1224] border border-[#1a2f5a] px-1 py-1 text-[11px] text-center focus:outline-none focus:border-lime-400/50" />
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => {
                if (!mealAdd.name.trim()) return;
                onAddMealEntry({ id: genId(), time: "記録", name: mealAdd.name.trim(), kcal: parseFloat(mealAdd.kcal) || 0, protein: parseFloat(mealAdd.protein) || 0, fat: parseFloat(mealAdd.fat) || 0, carbs: parseFloat(mealAdd.carbs) || 0 });
                setMealAdd({ name: "", kcal: "", protein: "", fat: "", carbs: "" }); setShowMealAdd(false); onToast("追加しました");
              }} className="flex-1 rounded-lg bg-lime-400 py-1.5 text-xs font-black text-[#060c18] hover:bg-lime-300">追加</button>
              <button onClick={() => setShowMealAdd(false)} className="px-3 rounded-lg border border-[#1a2f5a] text-xs text-slate-400 hover:text-white">キャンセル</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowMealAdd(true)} className="w-full rounded-lg border border-dashed border-[#1a2f5a] py-1.5 text-xs text-slate-500 hover:text-lime-400 hover:border-lime-400/30 transition-all">＋ 食事を追加</button>
        )}
      </div>

      {/* ── トレーニング ── */}
      <div className="rounded-xl bg-[#060c18] border border-[#1a2f5a] p-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">🏋️ トレーニング</p>
        {!editSess ? (
          <p className="text-xs text-slate-600 text-center py-1">記録なし</p>
        ) : (
          <div className="space-y-3">
            {editSess.exercises.map((ex, ei) => (
              <div key={ei}>
                <p className="text-xs font-semibold text-slate-300 mb-1.5">{ex.name}</p>
                <div className="space-y-1">
                  {ex.sets.map((st, si) => (
                    <div key={si} className="grid grid-cols-[1.5rem_1fr_auto_1fr] items-center gap-1.5">
                      <span className="text-[10px] text-slate-500 text-center">{si + 1}</span>
                      <div className="flex items-center gap-1">
                        <input type="text" inputMode="decimal" value={st.weight}
                          onChange={(ev) => setEditSess((prev) => {
                            if (!prev) return prev;
                            return { ...prev, exercises: prev.exercises.map((ex2, ei2) =>
                              ei2 !== ei ? ex2 : { ...ex2, sets: ex2.sets.map((s2, si2) =>
                                si2 !== si ? s2 : { ...s2, weight: parseFloat(ev.target.value) || 0 }
                              )}
                            )};
                          })}
                          className="w-full rounded bg-[#0a1224] border border-[#1a2f5a] px-2 py-1 text-xs text-center focus:outline-none focus:border-lime-400/50" />
                        <span className="text-[10px] text-slate-500 shrink-0">kg</span>
                      </div>
                      <span className="text-[10px] text-slate-500 px-0.5">×</span>
                      <div className="flex items-center gap-1">
                        <input type="text" inputMode="numeric" value={st.reps}
                          onChange={(ev) => setEditSess((prev) => {
                            if (!prev) return prev;
                            return { ...prev, exercises: prev.exercises.map((ex2, ei2) =>
                              ei2 !== ei ? ex2 : { ...ex2, sets: ex2.sets.map((s2, si2) =>
                                si2 !== si ? s2 : { ...s2, reps: parseInt(ev.target.value) || 0 }
                              )}
                            )};
                          })}
                          className="w-full rounded bg-[#0a1224] border border-[#1a2f5a] px-2 py-1 text-xs text-center focus:outline-none focus:border-lime-400/50" />
                        <span className="text-[10px] text-slate-500 shrink-0">回</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={() => { onSaveSession(editSess); onToast("トレーニングを保存しました"); }}
              className="w-full rounded-lg border border-lime-400/20 bg-lime-400/5 py-1.5 text-xs font-bold text-lime-400 hover:bg-lime-400/10 transition-colors">
              💾 保存する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// トレーニング記録タブ
// ════════════════════════════════════════════════════════════════
const BIG3_MAP: Record<string, keyof UserProfile> = {
  "ベンチプレス": "bench1RM",
  "スクワット":   "squat1RM",
  "デッドリフト": "deadlift1RM",
};

function TrainingTab({ todaySession, onSave, onToast, profile, onUpdateProfile, weightLog, onAddWeight, weeklyMenu, onSaveWeeklyMenu }: {
  todaySession?: TrainingSession;
  onSave: (s: TrainingSession) => void;
  onToast: (msg: string) => void;
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  weightLog: WeightEntry[];
  onAddWeight: (entry: WeightEntry) => void;
  weeklyMenu: WeeklyMenu;
  onSaveWeeklyMenu: (m: WeeklyMenu) => void;
}) {
  const todayDay = new Date().getDay();
  const todayMenu = weeklyMenu[todayDay] ?? DEFAULT_MENU;
  const [session, setSession] = useState<TrainingSession>(
    () => todaySession ?? makeDefaultSession(todayMenu)
  );
  const todayWeightEntry = weightLog.find((e) => e.date === todayStr());
  const [weightInput, setWeightInput] = useState(
    () => todayWeightEntry ? String(todayWeightEntry.kg) : String(profile.bodyweightKg)
  );
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});
  const [showMenuMgr, setShowMenuMgr] = useState(false);
  const [menuDay, setMenuDay] = useState(todayDay);

  function getRaw(ei: number, si: number, field: "weight" | "reps"): string {
    const key = `${ei}-${si}-${field}`;
    if (key in rawInputs) return rawInputs[key];
    const set = session.exercises[ei]?.sets[si];
    return String(set ? (field === "weight" ? set.weight : set.reps) : 0);
  }
  function handleSetInput(ei: number, si: number, field: "weight" | "reps", raw: string) {
    const key = `${ei}-${si}-${field}`;
    setRawInputs((prev) => ({ ...prev, [key]: raw }));
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 0) {
      setSession((prev) => ({
        ...prev,
        exercises: prev.exercises.map((ex, i) =>
          i !== ei ? ex : { ...ex, sets: ex.sets.map((s, j) => j !== si ? s : { ...s, [field]: val }) }
        ),
      }));
    }
  }
  function handleSetBlur(ei: number, si: number, field: "weight" | "reps") {
    const key = `${ei}-${si}-${field}`;
    const val = parseFloat(rawInputs[key] ?? "");
    if (isNaN(val) || val < 0) {
      const set = session.exercises[ei]?.sets[si];
      setRawInputs((prev) => ({ ...prev, [key]: String(set ? (field === "weight" ? set.weight : set.reps) : 0) }));
    }
  }

  // localStorageが読み込まれた後に todaySession で上書き
  useEffect(() => {
    if (todaySession) setSession(todaySession);
  }, [todaySession?.id]);

  function addSet(ei: number) {
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== ei) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return { ...ex, sets: [...ex.sets, { weight: last?.weight ?? 60, reps: last?.reps ?? 5, completed: true }] };
      }),
    }));
  }
  function removeSet(ei: number, si: number) {
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== ei ? ex : { ...ex, sets: ex.sets.filter((_, j) => j !== si) }
      ),
    }));
  }
  function renameExercise(ei: number, name: string) {
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => i !== ei ? ex : { ...ex, name }),
    }));
  }
  function addExercise() {
    setSession((prev) => ({
      ...prev,
      exercises: [...prev.exercises, { name: "新しい種目", sets: [{ weight: 60, reps: 8, completed: false }] }],
    }));
  }
  function removeExercise(ei: number) {
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== ei),
    }));
  }
  function save() {
    // 全セットをcompleted:trueにしてからsave（サマリー集計用）
    const s: TrainingSession = {
      ...session,
      completed: true,
      savedAt: new Date().toISOString(),
      exercises: session.exercises.map((ex) => ({
        ...ex,
        sets: ex.sets.map((st) => ({ ...st, completed: true })),
      })),
    };
    setSession(s);
    onSave(s);

    // 今日の曜日メニューを更新（次回デフォルトに使用）
    const newDayMenu: MenuTemplateItem[] = s.exercises.map((ex) => ({
      exercise: ex.name,
      sets: ex.sets.length,
      reps: ex.sets[0]?.reps ?? 8,
      weightKg: ex.sets[0]?.weight ?? 60,
    }));
    onSaveWeeklyMenu({ ...weeklyMenu, [todayDay]: newDayMenu });

    // 1RM自動更新（全セット対象）
    let updated = { ...profile };
    let didUpdate = false;
    s.exercises.forEach((ex) => {
      const field = BIG3_MAP[ex.name];
      if (!field) return;
      const best = ex.sets
        .filter((st) => st.weight > 0 && st.reps >= 1 && st.reps <= 30)
        .reduce((max, st) => {
          try {
            const est = estimateOneRepMax(st.weight, st.reps);
            return est > max ? est : max;
          } catch { return max; }
        }, 0);
      if (best > (updated[field] as number)) {
        updated = { ...updated, [field]: Math.round(best) };
        didUpdate = true;
      }
    });
    if (didUpdate) {
      onUpdateProfile(updated);
      onToast("1RMを自動更新しました！");
    } else {
      onToast("保存しました！");
    }
  }

  // 週間メニューの曜日別エディタ用ヘルパー
  const editingMenu = weeklyMenu[menuDay] ?? DEFAULT_MENU;
  function updateEditingMenu(updated: MenuTemplateItem[]) {
    onSaveWeeklyMenu({ ...weeklyMenu, [menuDay]: updated });
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest">{fmtDate(session.date)}</p>
          <h2 className="text-xl font-bold">トレーニング記録</h2>
        </div>
        <button
          onClick={() => setShowMenuMgr((v) => !v)}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${showMenuMgr ? "border-lime-400/40 bg-lime-400/10 text-lime-400" : "border-[#1a2f5a] text-slate-400 hover:text-white hover:border-slate-500"}`}
        >
          📋 メニュー管理
        </button>
      </div>

      {/* 週間メニュー管理パネル */}
      {showMenuMgr && (
        <div className="rounded-2xl border border-lime-400/20 bg-[#0a1224] p-4 space-y-3">
          <p className="text-sm font-bold text-lime-400">週間デフォルトメニュー</p>
          {/* 曜日タブ */}
          <div className="flex gap-1">
            {DAY_LABELS.map((label, d) => (
              <button key={d} onClick={() => setMenuDay(d)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  menuDay === d
                    ? d === todayDay ? "bg-lime-400 text-[#060c18]" : "bg-[#1a2f5a] text-white"
                    : d === todayDay ? "bg-lime-400/15 text-lime-400 border border-lime-400/30" : "bg-[#0e1a36] text-slate-500 hover:text-white"
                }`}
              >{label}</button>
            ))}
          </div>
          {/* 選択中の曜日のメニュー */}
          <div className="space-y-2">
            {editingMenu.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input type="text" value={item.exercise}
                  onChange={(e) => updateEditingMenu(editingMenu.map((m, j) => j === i ? { ...m, exercise: e.target.value } : m))}
                  className="flex-1 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2.5 py-1.5 text-sm focus:outline-none focus:border-lime-400/50" placeholder="種目名" />
                <input type="text" inputMode="decimal" value={String(item.weightKg)}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) updateEditingMenu(editingMenu.map((m, j) => j === i ? { ...m, weightKg: v } : m)); }}
                  className="w-14 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-1.5 py-1.5 text-sm text-center focus:outline-none focus:border-lime-400/50" placeholder="kg" />
                <span className="text-[10px] text-slate-500">kg</span>
                <input type="text" inputMode="numeric" value={String(item.reps)}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) updateEditingMenu(editingMenu.map((m, j) => j === i ? { ...m, reps: v } : m)); }}
                  className="w-10 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-1 py-1.5 text-sm text-center focus:outline-none focus:border-lime-400/50" placeholder="rep" />
                <span className="text-[10px] text-slate-500">rep</span>
                <input type="text" inputMode="numeric" value={String(item.sets)}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) updateEditingMenu(editingMenu.map((m, j) => j === i ? { ...m, sets: v } : m)); }}
                  className="w-10 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-1 py-1.5 text-sm text-center focus:outline-none focus:border-lime-400/50" placeholder="set" />
                <span className="text-[10px] text-slate-500">set</span>
                <button onClick={() => updateEditingMenu(editingMenu.filter((_, j) => j !== i))}
                  className="text-slate-500 hover:text-red-400 transition-colors text-sm px-1">✕</button>
              </div>
            ))}
          </div>
          <button onClick={() => updateEditingMenu([...editingMenu, { exercise: "新しい種目", sets: 3, reps: 8, weightKg: 60 }])}
            className="w-full rounded-xl border border-dashed border-[#1a2f5a] py-2 text-xs text-slate-500 hover:border-lime-400/30 hover:text-lime-400 transition-colors">
            ＋ 種目を追加
          </button>
          <p className="text-[10px] text-slate-500 text-center">今日（{DAY_LABELS[todayDay]}）は <span className="text-lime-400">緑</span> で表示。保存後に次回セッションへ反映されます</p>
        </div>
      )}

      {/* 体重記録 */}
      <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] px-4 py-3 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">今日の体重</p>
          <div className="flex items-center gap-2">
            <input
              type="text" inputMode="decimal"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              className="w-20 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-lime-400/50"
            />
            <span className="text-xs text-slate-400">kg</span>
            <button
              onClick={() => {
                const kg = parseFloat(weightInput);
                if (isNaN(kg) || kg < 20 || kg > 300) return;
                onAddWeight({ date: todayStr(), kg });
                onToast(`体重を記録しました: ${kg}kg`);
              }}
              className="rounded-lg bg-lime-400/10 border border-lime-400/30 px-3 py-1.5 text-xs font-bold text-lime-400 hover:bg-lime-400/20 transition-colors"
            >
              記録
            </button>
          </div>
        </div>
        {todayWeightEntry && (
          <div className="text-right">
            <p className="text-[10px] text-slate-500">記録済み</p>
            <p className="text-lg font-black text-lime-400">{todayWeightEntry.kg}<span className="text-xs text-slate-400 font-normal">kg</span></p>
          </div>
        )}
      </div>

      {session.exercises.map((ex, ei) => (
        <div key={ei} className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] overflow-hidden">
          <div className="px-4 py-3 bg-[#0e1a36]/60 border-b border-[#1a2f5a]/50 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0e1a36] text-xs font-bold text-lime-400 border border-[#1a2f5a]">{ei+1}</span>
              <div className="min-w-0">
                <input
                  type="text"
                  value={ex.name}
                  onChange={(e) => renameExercise(ei, e.target.value)}
                  className="text-sm font-bold bg-transparent border-b border-transparent focus:border-lime-400/50 focus:outline-none w-full"
                />
                {ex.sets.length > 0 && ex.sets[0].weight > 0 && ex.sets[0].reps >= 1 && ex.sets[0].reps <= 30 && (
                  <p className="text-xs text-slate-500">推定1RM: {sig1(estimateOneRepMax(ex.sets[0].weight, ex.sets[0].reps))}kg</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <p className="text-xs text-slate-500">{ex.sets.length}セット</p>
              <button onClick={() => removeExercise(ei)} className="text-slate-500 hover:text-red-400 text-xs transition-colors ml-1">✕</button>
            </div>
          </div>

          {/* セット行 */}
          <div className="px-4 pt-3 pb-1">
            <div className="grid grid-cols-[1.5rem_1fr_1fr] gap-2 mb-1.5 text-[10px] text-slate-500 px-1">
              <span>#</span><span className="text-center">重量 (kg)</span><span className="text-center">回数</span>
            </div>
            {ex.sets.map((s, si) => (
              <div key={si} className="grid grid-cols-[1.5rem_1fr_1fr] gap-2 mb-2 items-center">
                <span className="text-[11px] text-slate-500 text-center">{si+1}</span>
                <input type="text" inputMode="decimal" value={getRaw(ei, si, "weight")} onChange={(e) => handleSetInput(ei, si, "weight", e.target.value)} onBlur={() => handleSetBlur(ei, si, "weight")}
                  className="rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm text-center font-bold focus:outline-none focus:border-lime-400/50 w-full" />
                <input type="text" inputMode="numeric" value={getRaw(ei, si, "reps")} onChange={(e) => handleSetInput(ei, si, "reps", e.target.value)} onBlur={() => handleSetBlur(ei, si, "reps")}
                  className="rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm text-center font-bold focus:outline-none focus:border-lime-400/50 w-full" />
              </div>
            ))}
          </div>
          <div className="px-4 pb-3 flex gap-2">
            <button onClick={() => addSet(ei)} className="flex-1 rounded-lg border border-dashed border-[#1a2f5a] py-1.5 text-xs text-slate-500 hover:border-lime-400/30 hover:text-lime-400 transition-colors">+ セット追加</button>
            {ex.sets.length > 1 && (
              <button onClick={() => removeSet(ei, ex.sets.length - 1)} className="px-3 rounded-lg border border-[#1a2f5a] text-xs text-slate-500 hover:border-red-500/30 hover:text-red-400 transition-colors">−</button>
            )}
          </div>
        </div>
      ))}

      <button onClick={addExercise}
        className="w-full rounded-2xl border-2 border-dashed border-[#1a2f5a] py-3 text-sm text-slate-500 hover:border-lime-400/30 hover:text-lime-400 transition-colors">
        ＋ 種目を追加
      </button>

      <button onClick={save}
        className="w-full rounded-2xl bg-lime-400 py-4 font-black text-[#060c18] text-base tracking-wide hover:bg-lime-300 active:scale-95 transition-all shadow-lg"
        style={{ boxShadow: "0 4px 24px rgba(163,230,53,0.35)" }}>
        💾 保存する
      </button>
      {session.savedAt && (
        <p className="text-center text-xs text-slate-500">
          最終保存: {new Date(session.savedAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}
        </p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// 食事記録タブ
// ════════════════════════════════════════════════════════════════
type MealForm = { mealType: string; name: string; amount: string; unit: string; kcal: string; protein: string; fat: string; carbs: string };
const EMPTY_FORM: MealForm = { mealType: "朝食", name: "", amount: "", unit: "g", kcal: "", protein: "", fat: "", carbs: "" };
const MEAL_TYPES = [
  { value: "朝食",     label: "朝食" },
  { value: "午前間食", label: "間食" },
  { value: "昼食",     label: "昼食" },
  { value: "午後間食", label: "間食" },
  { value: "夕食",     label: "夕食" },
  { value: "深夜",     label: "深夜" },
];
const UNIT_PRESETS = ["g", "ml", "個", "枚", "杯", "本", "切", "皿"];

function MealTab({ todayMeals, onAdd, onRemove, onUpdate, onToast, mealGoal, onSaveMealGoal }: {
  todayMeals?: DayMealRecord;
  onAdd: (e: MealEntry) => void;
  onRemove: (date: string, id: string) => void;
  onUpdate: (date: string, e: MealEntry) => void;
  onToast: (msg: string) => void;
  mealGoal: MealGoal;
  onSaveMealGoal: (g: MealGoal) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MealForm>(EMPTY_FORM);
  const [showGoalEdit, setShowGoalEdit] = useState(false);
  const [goalForm, setGoalForm] = useState({ kcal: String(mealGoal.kcal), protein: String(mealGoal.protein), fat: String(mealGoal.fat), carbs: String(mealGoal.carbs) });
  const [calcLoading, setCalcLoading] = useState(false);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [advice, setAdvice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MealForm>(EMPTY_FORM);
  const [editCalcLoading, setEditCalcLoading] = useState(false);

  function startEdit(e: MealEntry) {
    setEditingId(e.id);
    setEditForm({
      mealType: e.time,
      name: e.name,
      amount: e.amount != null ? String(e.amount) : "",
      unit: e.unit ?? "g",
      kcal: String(e.kcal),
      protein: String(e.protein),
      fat: String(e.fat),
      carbs: String(e.carbs),
    });
  }
  function saveEdit(e: MealEntry) {
    onUpdate(todayMeals?.date ?? todayStr(), {
      ...e,
      time:    editForm.mealType || e.time,
      name:    editForm.name.trim() || e.name,
      kcal:    Math.round(parseFloat(editForm.kcal) || 0),
      protein: parseFloat(editForm.protein) || 0,
      fat:     parseFloat(editForm.fat) || 0,
      carbs:   parseFloat(editForm.carbs) || 0,
      amount:  editForm.amount ? parseFloat(editForm.amount) || undefined : undefined,
      unit:    editForm.amount ? editForm.unit : undefined,
    });
    setEditingId(null);
    onToast("更新しました");
  }
  async function autoCalcEdit() {
    if (!editForm.name.trim() || editCalcLoading) return;
    setEditCalcLoading(true);
    try {
      const foodName = editForm.amount ? `${editForm.name} ${editForm.amount}${editForm.unit}` : editForm.name;
      const res = await fetch("/api/nutrition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ foodName }) });
      const data = await res.json();
      if (data.kcal !== undefined) {
        setEditForm((f) => ({ ...f, kcal: String(data.kcal), protein: String(data.protein), fat: String(data.fat), carbs: String(data.carbs) }));
        onToast("栄養素を再計算しました");
      }
    } catch { /* ignore */ } finally { setEditCalcLoading(false); }
  }

  async function autoCalc() {
    if (!form.name.trim() || calcLoading) return;
    setCalcLoading(true);
    try {
      const foodNameWithAmount = form.amount
        ? `${form.name} ${form.amount}${form.unit}`
        : form.name;
      const res = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: foodNameWithAmount }),
      });
      const data = await res.json();
      if (data.kcal !== undefined) {
        setForm((f) => ({
          ...f,
          kcal:    String(data.kcal),
          protein: String(data.protein),
          fat:     String(data.fat),
          carbs:   String(data.carbs),
        }));
        onToast("栄養素を自動計算しました");
      }
    } catch { /* ignore */ } finally {
      setCalcLoading(false);
    }
  }
  const entries = todayMeals?.entries ?? [];
  const totalKcal = entries.reduce((a, e) => a + e.kcal, 0);
  const totalP    = entries.reduce((a, e) => a + e.protein, 0);
  const totalF    = entries.reduce((a, e) => a + e.fat, 0);
  const totalC    = entries.reduce((a, e) => a + e.carbs, 0);

  async function getAdvice() {
    if (adviceLoading) return;
    setAdviceLoading(true);
    setAdvice("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `今日の食事データを分析して、不足している栄養素と改善案を簡潔に教えてください。\n\nカロリー: ${totalKcal}kcal / 目標2800kcal\nタンパク質: ${totalP}g / 目標180g\n脂質: ${totalF}g / 目標70g\n炭水化物: ${totalC}g / 目標350g\n食事内容: ${entries.map((e) => e.name).join(", ") || "未記録"}`,
          }],
          systemContext: "あなたは栄養士AIです。短く箇条書きで、不足栄養素と補うべき具体的な食品を3〜5点で提案してください。",
        }),
      });
      if (!res.body) throw new Error();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAdvice(text.replace(/\n__USAGE__.+?__USAGE__/, "").trimEnd());
      }
      setAdvice((t) => t.replace(/\n__USAGE__.+?__USAGE__/, "").trimEnd());
    } catch { setAdvice("診断に失敗しました。"); } finally {
      setAdviceLoading(false);
    }
  }

  function handleAdd() {
    if (!form.name.trim() || !form.mealType) return;
    onAdd({
      id:      genId(),
      time:    form.mealType,
      name:    form.name.trim(),
      kcal:    Math.round(parseFloat(form.kcal) || 0),
      protein: parseFloat(form.protein) || 0,
      fat:     parseFloat(form.fat)     || 0,
      carbs:   parseFloat(form.carbs)   || 0,
      amount:  form.amount ? parseFloat(form.amount) || undefined : undefined,
      unit:    form.amount ? form.unit : undefined,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    onToast("食事を記録しました");
  }

  const numField = (key: "kcal" | "protein" | "fat" | "carbs", label: string, placeholder = "") => (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest">{label}</label>
      <input type="text" inputMode="decimal" value={form[key]} placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-3 py-2 text-sm focus:outline-none focus:border-lime-400/50" />
    </div>
  );

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-widest">Nutrition</p>
        <h2 className="text-xl font-bold">今日の食事記録</h2>
      </div>

      {/* カロリーサマリー */}
      <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] p-5">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs text-slate-500">摂取カロリー</p>
            <p className="text-3xl font-black">{totalKcal.toFixed(1)}<span className="text-sm text-slate-400 font-normal"> kcal</span></p>
          </div>
          <button onClick={() => { setGoalForm({ kcal: String(mealGoal.kcal), protein: String(mealGoal.protein), fat: String(mealGoal.fat), carbs: String(mealGoal.carbs) }); setShowGoalEdit((v) => !v); }}
            className="text-xs text-slate-400 hover:text-lime-400 transition-colors flex items-center gap-1">
            ⚙️ 目標 <span className="font-bold text-white">{mealGoal.kcal.toFixed(1)}</span> kcal
          </button>
        </div>
        {showGoalEdit && (
          <div className="mb-3 rounded-xl bg-[#0e1a36] border border-[#1a2f5a] p-3 space-y-2">
            <p className="text-xs font-bold text-lime-400">栄養目標を設定</p>
            <div className="grid grid-cols-4 gap-2">
              {([["kcal","カロリー","kcal"],["protein","タンパク質","g"],["fat","脂質","g"],["carbs","炭水化物","g"]] as const).map(([k, label, unit]) => (
                <div key={k}>
                  <p className="text-[9px] text-slate-500 mb-1">{label}</p>
                  <div className="flex items-center gap-0.5">
                    <input type="text" inputMode="decimal" value={goalForm[k]}
                      onChange={(e) => setGoalForm((f) => ({ ...f, [k]: e.target.value }))}
                      className="w-full rounded-lg bg-[#060c18] border border-[#1a2f5a] px-2 py-1.5 text-xs text-center focus:outline-none focus:border-lime-400/50" />
                    <span className="text-[9px] text-slate-500 shrink-0">{unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => {
                const k = parseFloat(goalForm.kcal) || mealGoal.kcal;
                const p = parseFloat(goalForm.protein) || mealGoal.protein;
                const f = parseFloat(goalForm.fat) || mealGoal.fat;
                const c = parseFloat(goalForm.carbs) || mealGoal.carbs;
                onSaveMealGoal({ kcal: k, protein: p, fat: f, carbs: c });
                setShowGoalEdit(false);
                onToast("目標を保存しました");
              }} className="flex-1 rounded-lg bg-lime-400 py-1.5 text-xs font-black text-[#060c18]">保存</button>
              <button onClick={() => setShowGoalEdit(false)} className="px-3 rounded-lg border border-[#1a2f5a] text-xs text-slate-400 hover:text-white">キャンセル</button>
            </div>
          </div>
        )}
        <div className="h-2 w-full rounded-full bg-[#0e1a36] overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width:`${Math.min(100,(totalKcal/mealGoal.kcal)*100)}%`, background:"linear-gradient(90deg,#3b82f6,#a3e635)" }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label:"P", name:"タンパク質", value:totalP, target:mealGoal.protein, color:"#3b82f6" },
            { label:"F", name:"脂質",       value:totalF, target:mealGoal.fat,     color:"#f59e0b" },
            { label:"C", name:"炭水化物",   value:totalC, target:mealGoal.carbs,   color:"#10b981" },
          ].map(({ label, name, value, target, color }) => (
            <div key={label} className="rounded-xl bg-[#0e1a36] p-2.5 text-center">
              <p className="text-[10px] text-slate-500 mb-0.5">{name}</p>
              <p className="text-base font-black" style={{ color }}>{value.toFixed(1)}<span className="text-xs text-slate-500">g</span></p>
              <p className="text-[10px] text-slate-500">{target.toFixed(1)}g目標</p>
            </div>
          ))}
        </div>
      </div>

      {/* AI栄養診断 */}
      <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] overflow-hidden">
        <button
          onClick={getAdvice}
          disabled={adviceLoading || entries.length === 0}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-[#0e1a36]/50 transition-colors disabled:opacity-40"
        >
          <span className="font-semibold text-slate-300">
            {adviceLoading ? <><span className="animate-spin inline-block mr-1.5">⏳</span>診断中...</> : "🤖 AIに栄養診断してもらう"}
          </span>
          <span className="text-xs text-slate-500">{entries.length === 0 ? "食事を記録してから" : "不足栄養素を指摘"}</span>
        </button>
        {advice && (
          <div className="px-4 pb-4 border-t border-[#1a2f5a]/50">
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap mt-3">{advice}</p>
          </div>
        )}
      </div>

      {/* エントリーリスト */}
      <div className="space-y-2">
        {entries.length === 0 && !showForm && (
          <p className="text-center text-sm text-slate-500 py-4">まだ記録がありません</p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="rounded-xl border border-[#1a2f5a] bg-[#0a1224] overflow-hidden">
            {editingId === e.id ? (
              /* ── 編集フォーム ── */
              <div className="p-4 space-y-3">
                {/* 食事区分 */}
                <div className="flex gap-1.5 flex-wrap">
                  {MEAL_TYPES.map((mt) => (
                    <button key={mt.value} type="button"
                      onClick={() => setEditForm((f) => ({ ...f, mealType: mt.value }))}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${editForm.mealType === mt.value ? "bg-lime-400 text-[#060c18]" : "bg-[#0e1a36] border border-[#1a2f5a] text-slate-400 hover:text-white"}`}>
                      {mt.label}
                    </button>
                  ))}
                </div>
                {/* 食事名 + 量 + 単位 */}
                <div className="flex gap-2">
                  <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="flex-1 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-3 py-1.5 text-sm focus:outline-none focus:border-lime-400/50" placeholder="食事名" />
                  <input type="text" inputMode="decimal" value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-14 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm text-center focus:outline-none focus:border-lime-400/50" placeholder="量" />
                  <input type="text" value={editForm.unit} onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                    className="w-12 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm text-center focus:outline-none focus:border-lime-400/50" />
                </div>
                {/* 単位クイック選択 */}
                <div className="flex gap-1.5 flex-wrap">
                  {UNIT_PRESETS.map((u) => (
                    <button key={u} type="button" onClick={() => setEditForm((f) => ({ ...f, unit: u }))}
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-all ${editForm.unit === u ? "bg-lime-400/20 border border-lime-400/40 text-lime-400" : "bg-[#0e1a36] border border-[#1a2f5a] text-slate-500 hover:text-white"}`}>
                      {u}
                    </button>
                  ))}
                </div>
                {/* AI再計算 */}
                <button type="button" onClick={autoCalcEdit} disabled={!editForm.name.trim() || editCalcLoading}
                  className="w-full rounded-xl border border-lime-400/30 py-1.5 text-xs font-bold text-lime-400 hover:bg-lime-400/10 disabled:opacity-40 transition-colors flex items-center justify-center gap-1">
                  {editCalcLoading ? <><span className="animate-spin">⏳</span> 計算中...</> : <>✨ 栄養素を再計算</>}
                </button>
                {/* 栄養素 */}
                <div className="grid grid-cols-4 gap-2">
                  {([["kcal","kcal"],["protein","タンパク質g"],["fat","脂質g"],["carbs","炭水化物g"]] as const).map(([k, label]) => (
                    <div key={k}>
                      <p className="text-[9px] text-slate-500 mb-1">{label}</p>
                      <input type="text" inputMode="decimal" value={editForm[k]}
                        onChange={(e) => setEditForm((f) => ({ ...f, [k]: e.target.value }))}
                        className="w-full rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-xs text-center focus:outline-none focus:border-lime-400/50" />
                    </div>
                  ))}
                </div>
                {/* 操作ボタン */}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => saveEdit(e)} className="flex-1 rounded-xl bg-lime-400 py-2 font-black text-[#060c18] text-sm">保存</button>
                  <button onClick={() => setEditingId(null)} className="px-4 rounded-xl border border-[#1a2f5a] text-sm text-slate-400 hover:text-white">キャンセル</button>
                  <button onClick={() => { onRemove(todayMeals?.date ?? todayStr(), e.id); setEditingId(null); onToast("削除しました"); }}
                    className="px-3 rounded-xl border border-red-500/30 text-xs text-red-400 hover:bg-red-400/10 transition-colors">削除</button>
                </div>
              </div>
            ) : (
              /* ── 通常表示 ── */
              <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#0e1a36]/50 transition-colors text-left" onClick={() => startEdit(e)}>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500 shrink-0 w-12 text-center leading-tight">{e.time}</span>
                  <div>
                    <p className="text-sm font-semibold">
                      {e.name}
                      {e.amount && <span className="text-xs text-slate-400 font-normal ml-1.5">{e.amount}{e.unit}</span>}
                    </p>
                    <p className="text-xs text-slate-500">P:{e.protein.toFixed(1)} F:{e.fat.toFixed(1)} C:{e.carbs.toFixed(1)}g</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black">{e.kcal.toFixed(1)}<span className="text-xs text-slate-500 font-normal">kcal</span></p>
                  <span className="text-slate-500 text-xs">✏️</span>
                </div>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 追加フォーム */}
      {showForm ? (
        <div className="rounded-2xl border border-lime-400/20 bg-[#0a1224] p-5 space-y-4">
          <p className="text-sm font-bold text-lime-400">食事を追加</p>

          {/* 食事区分セレクター */}
          <div>
            <label className="block text-[10px] text-slate-500 mb-2 uppercase tracking-widest">食事区分</label>
            <div className="flex gap-1.5 flex-wrap">
              {MEAL_TYPES.map((mt) => (
                <button
                  key={mt.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mealType: mt.value }))}
                  className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                    form.mealType === mt.value
                      ? "bg-lime-400 text-[#060c18]"
                      : "bg-[#0e1a36] border border-[#1a2f5a] text-slate-400 hover:border-slate-500 hover:text-white"
                  }`}
                >
                  {mt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 食事名 + 量 + 単位 */}
          <div>
            <label className="block text-[10px] text-slate-500 mb-1.5 uppercase tracking-widest">食事名・量・単位</label>
            <div className="flex gap-2">
              <input
                type="text" value={form.name} placeholder="例: 鶏むね肉"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="flex-1 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-3 py-2 text-sm focus:outline-none focus:border-lime-400/50"
              />
              <input
                type="text" inputMode="decimal" value={form.amount} placeholder="100"
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-16 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-2 text-sm text-center focus:outline-none focus:border-lime-400/50"
              />
              <input
                type="text" value={form.unit} placeholder="g"
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className="w-14 rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-2 text-sm text-center focus:outline-none focus:border-lime-400/50"
              />
            </div>
            {/* 単位クイック選択 */}
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {UNIT_PRESETS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, unit: u }))}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                    form.unit === u
                      ? "bg-lime-400/20 border border-lime-400/40 text-lime-400"
                      : "bg-[#0e1a36] border border-[#1a2f5a] text-slate-500 hover:text-white"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={autoCalc}
            disabled={!form.name.trim() || calcLoading}
            className="w-full rounded-xl border border-lime-400/30 bg-lime-400/8 py-2 text-xs font-bold text-lime-400 hover:bg-lime-400/15 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
          >
            {calcLoading ? (
              <><span className="animate-spin">⏳</span> AI計算中...</>
            ) : (
              <>✨ AIでカロリー・栄養素を自動計算</>
            )}
          </button>
          <div className="grid grid-cols-2 gap-3">
            {numField("kcal",    "カロリー (kcal)", "500")}
            {numField("protein", "タンパク質 (g)",  "40")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numField("fat",   "脂質 (g)",    "10")}
            {numField("carbs", "炭水化物 (g)", "60")}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd} disabled={!form.name.trim() || !form.mealType}
              className="flex-1 rounded-xl bg-lime-400 py-2.5 font-black text-[#060c18] text-sm disabled:opacity-40">追加する</button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
              className="px-4 rounded-xl border border-[#1a2f5a] text-sm text-slate-400 hover:text-white">キャンセル</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="w-full rounded-2xl border-2 border-dashed border-[#1a2f5a] bg-[#0a1224] py-5 text-slate-400 hover:border-lime-400/40 hover:text-lime-400 transition-all flex items-center justify-center gap-2">
          <span className="text-lg">＋</span>
          <span className="text-sm font-semibold">食事を追加する</span>
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// サマリータブ
// ════════════════════════════════════════════════════════════════
function SummaryTab({ sessions, mealRecords, weightLog }: {
  sessions: TrainingSession[];
  mealRecords: DayMealRecord[];
  weightLog: WeightEntry[];
}) {
  const [sub, setSub] = useState<"training" | "meal">("training");
  const recent7 = sessions.slice(0, 7);

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-widest">Summary</p>
        <h2 className="text-xl font-bold">サマリー</h2>
      </div>

      {/* サブタブ */}
      <div className="flex gap-1 rounded-xl bg-[#0a1224] p-1 border border-[#1a2f5a]">
        {[["training","🏋️ トレーニング"],["meal","🥗 食事"]] .map(([id, label]) => (
          <button key={id} onClick={() => setSub(id as "training"|"meal")}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
              sub === id ? "bg-lime-400 text-[#060c18]" : "text-slate-400 hover:text-white"}`}
          >{label}</button>
        ))}
      </div>

      {sub === "training" && (
        <div className="space-y-4">
          {recent7.length === 0 ? (
            <p className="text-center text-slate-500 py-8 text-sm">トレーニング記録がありません</p>
          ) : (
            <>
              {/* ボリューム折れ線グラフ代替（バー） */}
              <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] p-5">
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">総挙上ボリューム推移</p>
                <div className="flex items-end gap-1.5 h-24">
                  {[...recent7].reverse().map((s, i) => {
                    const vol = s.exercises.reduce((a, ex) =>
                      a + ex.sets.filter((st) => st.completed).reduce((b, st) => b + st.weight * st.reps, 0), 0);
                    const maxVol = Math.max(...recent7.map((ss) =>
                      ss.exercises.reduce((a, ex) => a + ex.sets.reduce((b, st) => b + st.weight * st.reps, 0), 0)));
                    const h = maxVol > 0 ? (vol / maxVol) * 100 : 10;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full rounded-t-sm" style={{ height:`${h}%`, background: s.completed ? "#a3e635" : "#1a2f5a" }} />
                        <p className="text-[8px] text-slate-500">{s.date.slice(5)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 体重推移 */}
              {weightLog.length > 0 && (() => {
                const recent = weightLog.slice(0, 14).reverse();
                const kgs = recent.map((e) => e.kg);
                const min = Math.min(...kgs) - 1;
                const max = Math.max(...kgs) + 1;
                const range = max - min || 1;
                return (
                  <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] p-5">
                    <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">体重推移</p>
                    <div className="flex items-end gap-1 h-20">
                      {recent.map((w, i) => {
                        const h = Math.max(8, ((w.kg - min) / range) * 100);
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                            <p className="text-[7px] text-slate-500">{w.kg}</p>
                            <div className="w-full rounded-t-sm bg-blue-400/70" style={{ height: `${h}%` }} />
                            <p className="text-[7px] text-slate-500">{w.date.slice(5)}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* セッションリスト */}
              <div className="space-y-2">
                {recent7.map((s) => {
                  const vol = s.exercises.reduce((a, ex) => a + ex.sets.filter((st) => st.completed).reduce((b, st) => b + st.weight * st.reps, 0), 0);
                  const done = s.exercises.reduce((a, ex) => a + ex.sets.filter((st) => st.completed).length, 0);
                  const total = s.exercises.reduce((a, ex) => a + ex.sets.length, 0);
                  return (
                    <div key={s.id} className="rounded-xl border border-[#1a2f5a] bg-[#0a1224] px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${s.completed ? "text-lime-400" : "text-slate-500"}`}>{s.completed ? "✓" : "○"}</span>
                          <div>
                            <p className="text-sm font-semibold">{fmtDate(s.date)}</p>
                            <p className="text-xs text-slate-500">{s.exercises.map((e) => e.name).join(" · ")}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-white">{vol.toLocaleString()}<span className="text-xs text-slate-500 font-normal">kg vol</span></p>
                          <p className="text-xs text-slate-500">{done}/{total} sets</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {sub === "meal" && (
        <div className="space-y-4">
          {mealRecords.length === 0 ? (
            <p className="text-center text-slate-500 py-8 text-sm">食事記録がありません</p>
          ) : (
            <>
              {/* 7日間カロリーバー */}
              <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] p-5">
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">カロリー推移（直近7日）</p>
                <div className="flex items-end gap-1.5 h-24">
                  {mealRecords.slice(0, 7).reverse().map((r, i) => {
                    const kcal = r.entries.reduce((a, e) => a + e.kcal, 0);
                    const h = Math.min(100, (kcal / 3500) * 100);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <p className="text-[8px] text-slate-500">{kcal}</p>
                        <div className="w-full rounded-t-sm bg-blue-500/60" style={{ height:`${h}%` }} />
                        <p className="text-[8px] text-slate-500">{r.date.slice(5)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 食事リスト */}
              {mealRecords.slice(0, 7).map((r) => {
                const kcal = r.entries.reduce((a, e) => a + e.kcal, 0);
                const p = r.entries.reduce((a, e) => a + e.protein, 0);
                return (
                  <div key={r.date} className="rounded-xl border border-[#1a2f5a] bg-[#0a1224] px-4 py-3">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm font-semibold">{fmtDate(r.date)}</p>
                      <p className="text-sm font-black text-lime-400">{kcal}<span className="text-xs text-slate-500 font-normal"> kcal</span></p>
                    </div>
                    <p className="text-xs text-slate-500">P:{p}g · {r.entries.length}食</p>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// AIプランニングタブ
// ════════════════════════════════════════════════════════════════
const PLANNING_STARTERS = [
  "今週のトレーニングメニューを一緒に考えたい",
  "明日の胸の日のメニューを作ってほしい",
  "ベンチプレスを重点的に伸ばしたい",
  "疲労が溜まってるので軽めのメニューを",
];

function PlanningTab({ systemContext, messages, setMessages, sessionTokens, setSessionTokens, onSaveGoal }: {
  systemContext: string;
  messages: ChatMsg[];
  setMessages: (action: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => void;
  sessionTokens: { input: number; output: number };
  setSessionTokens: (action: { input: number; output: number } | ((prev: { input: number; output: number }) => { input: number; output: number })) => void;
  onSaveGoal: (type: keyof GoalData, text: string) => void;
}) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [savingGoalIdx, setSavingGoalIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || isStreaming) return;
    const userMsg: ChatMsg = { role: "user", content };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setIsStreaming(true);
    setMessages((p) => [...p, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })), systemContext }),
      });
      if (!res.body) throw new Error();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((p) => { const u=[...p]; u[u.length-1]={role:"assistant",content:u[u.length-1].content+chunk}; return u; });
      }
      // ストリーム終了後、__USAGE__マーカーを抽出してコンテンツから除去
      setMessages((p) => {
        const u = [...p];
        const lastMsg = u[u.length - 1];
        const match = lastMsg.content.match(/\n__USAGE__(.+?)__USAGE__/);
        if (match) {
          try {
            const usage = JSON.parse(match[1]);
            setSessionTokens((prev) => ({ input: prev.input + usage.input, output: prev.output + usage.output }));
            u[u.length - 1] = {
              ...lastMsg,
              content: lastMsg.content.replace(/\n__USAGE__.+?__USAGE__/, "").trimEnd(),
              usage,
            };
          } catch { /* ignore */ }
        }
        return u;
      });
    } catch {
      setMessages((p) => { const u=[...p]; u[u.length-1]={role:"assistant",content:"エラーが発生しました。.env.local に GOOGLE_GENERATIVE_AI_API_KEY を設定してください。"}; return u; });
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="flex flex-col max-w-2xl" style={{ height: "calc(100vh - 10rem)" }}>
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0e1a36] border border-[#1a2f5a] mb-3">
              <span className="text-2xl">💬</span>
            </div>
            <h3 className="text-base font-bold mb-1">AIプランニング</h3>
            <p className="text-sm text-slate-400 mb-5 max-w-sm mx-auto">AIと対話しながら、あなたに最適なトレーニングメニューを一緒に作りましょう。</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
              {PLANNING_STARTERS.map((q) => (
                <button key={q} onClick={() => send(q)}
                  className="rounded-xl border border-[#1a2f5a] bg-[#0a1224] px-4 py-3 text-left text-sm text-slate-300 hover:border-lime-400/30 hover:text-white transition-all">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          const streaming = isStreaming && isLast && msg.role === "assistant";
          const showGoalBtn = msg.role === "assistant" && !streaming && msg.content.length > 0;
          return (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0e1a36] border border-[#1a2f5a] mt-1 text-sm">💬</div>
              )}
              <div className="flex flex-col gap-1.5 max-w-[80%]">
                <div className={`rounded-2xl px-4 py-3 ${
                  msg.role === "user" ? "bg-[#1a2f5a] text-white rounded-tr-sm" : "bg-[#0a1224] border border-[#1a2f5a] text-slate-200 rounded-tl-sm"
                }`}>
                  {msg.content === "" && streaming ? (
                    <div className="flex gap-1 py-1">{[0,1,2].map((j)=><div key={j} className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{animationDelay:`${j*0.2}s`}}/>)}</div>
                  ) : (
                    <p className={`text-sm leading-relaxed whitespace-pre-wrap ${streaming && msg.content ? "streaming-cursor" : ""}`}>{msg.content}</p>
                  )}
                  {msg.role === "assistant" && msg.usage && (
                    <p className="text-[10px] text-slate-500 mt-2 pt-1.5 border-t border-[#1a2f5a]/60">
                      🔢 入力 {msg.usage.input.toLocaleString()} / 出力 {msg.usage.output.toLocaleString()} トークン
                    </p>
                  )}
                </div>
                {showGoalBtn && (
                  savingGoalIdx === i ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {([
                        { type: "daily"  as keyof GoalData, label: "🎯 今日の目標",    color: "text-lime-400 border-lime-400/30" },
                        { type: "month1" as keyof GoalData, label: "📅 1ヶ月後",       color: "text-blue-400 border-blue-400/30" },
                        { type: "month6" as keyof GoalData, label: "🏆 半年後",        color: "text-amber-400 border-amber-400/30" },
                      ] as const).map(({ type, label, color }) => (
                        <button key={type}
                          onClick={() => { onSaveGoal(type, msg.content); setSavingGoalIdx(null); }}
                          className={`rounded-lg border px-3 py-1 text-xs font-semibold bg-[#0a1224] hover:bg-[#0e1a36] transition-all ${color}`}>
                          {label}
                        </button>
                      ))}
                      <button onClick={() => setSavingGoalIdx(null)}
                        className="rounded-lg border border-[#1a2f5a] px-3 py-1 text-xs text-slate-500 bg-[#0a1224] hover:text-white transition-all">
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setSavingGoalIdx(i)}
                      className="self-start rounded-lg border border-[#1a2f5a] px-3 py-1 text-xs text-slate-400 bg-[#0a1224] hover:border-lime-400/30 hover:text-lime-400 transition-all">
                      📌 目標として保存
                    </button>
                  )
                )}
              </div>
              {msg.role === "user" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1a2f5a] mt-1 text-xs font-bold text-lime-400">私</div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-[#1a2f5a]/60 pt-4">
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key==="Enter" && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="今日のメニューを一緒に考えよう..." disabled={isStreaming}
            className="flex-1 rounded-xl border border-[#1a2f5a] bg-[#0a1224] px-4 py-3 text-sm placeholder-slate-500 focus:outline-none focus:border-lime-400/40 disabled:opacity-50" />
          <button onClick={() => send()} disabled={!input.trim() || isStreaming}
            className="rounded-xl bg-lime-400 px-5 py-3 text-[#060c18] font-black text-sm hover:bg-lime-300 disabled:opacity-40 transition-all">
            {isStreaming ? "…" : "送信"}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-slate-500">Groq · Llama 3.3 70B · 無料 · メニュー作成特化</p>
          {(sessionTokens.input > 0 || sessionTokens.output > 0) && (
            <p className="text-[10px] text-slate-500">
              セッション累計 {(sessionTokens.input + sessionTokens.output).toLocaleString()} トークン
              <span className="text-lime-400/70"> / 残り約 {Math.max(0, 1000000 - sessionTokens.input - sessionTokens.output).toLocaleString()}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// 設定タブ
// ════════════════════════════════════════════════════════════════
function SettingsTab({ profile, onSaveProfile }: {
  profile: UserProfile;
  onSaveProfile: (p: UserProfile) => void;
}) {
  type Form = { name: string; bodyweightKg: string; bench1RM: string; squat1RM: string; deadlift1RM: string; trainingDays: string };
  const toForm = (p: UserProfile): Form => ({
    name: p.name,
    bodyweightKg: String(p.bodyweightKg),
    bench1RM: String(p.bench1RM),
    squat1RM: String(p.squat1RM),
    deadlift1RM: String(p.deadlift1RM),
    trainingDays: String(p.trainingDays),
  });

  const [form, setForm] = useState<Form>(() => toForm(profile));
  useEffect(() => { setForm(toForm(profile)); }, [profile.name, profile.bodyweightKg, profile.bench1RM, profile.squat1RM, profile.deadlift1RM, profile.trainingDays]);

  const numField = (label: string, key: Exclude<keyof Form, "name">, unit = "") => (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="text" inputMode="decimal"
          value={form[key]}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
          className="w-full rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-3 py-2 text-sm font-bold focus:outline-none focus:border-lime-400/50"
        />
        {unit && <span className="text-xs text-slate-500 shrink-0">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-widest">Settings</p>
        <h2 className="text-xl font-bold">設定</h2>
      </div>

      {/* プロフィール */}
      <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] p-5 space-y-4">
        <p className="text-sm font-bold text-lime-400">プロフィール</p>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest">名前</label>
          <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-3 py-2 text-sm focus:outline-none focus:border-lime-400/50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {numField("体重", "bodyweightKg", "kg")}
          {numField("週トレ日数", "trainingDays", "日")}
        </div>
        <p className="text-xs text-slate-400 font-semibold">現在の1RM（自動計算用）</p>
        <div className="grid grid-cols-3 gap-3">
          {numField("ベンチ", "bench1RM", "kg")}
          {numField("スクワット", "squat1RM", "kg")}
          {numField("デッドリフト", "deadlift1RM", "kg")}
        </div>
        {(() => {
          const bw = parseFloat(form.bodyweightKg);
          const total = (parseFloat(form.bench1RM) || 0) + (parseFloat(form.squat1RM) || 0) + (parseFloat(form.deadlift1RM) || 0);
          const w = isNaN(bw) ? 0 : safeWilks(bw, total);
          return (
            <div className="rounded-xl bg-[#0e1a36] border border-[#1a2f5a] p-3 flex justify-between items-center">
              <span className="text-xs text-slate-400">計算後のWILKS</span>
              <span className="font-black text-lime-400">{w > 0 ? sig1(w) : "—"}</span>
            </div>
          );
        })()}
        <button onClick={() => {
          const bw = parseFloat(form.bodyweightKg);
          const bench = parseFloat(form.bench1RM);
          const squat = parseFloat(form.squat1RM);
          const dl = parseFloat(form.deadlift1RM);
          const days = parseInt(form.trainingDays, 10);
          if (isNaN(bw) || isNaN(bench) || isNaN(squat) || isNaN(dl) || isNaN(days)) return;
          onSaveProfile({ name: form.name, bodyweightKg: bw, bench1RM: bench, squat1RM: squat, deadlift1RM: dl, trainingDays: days });
        }}
          className="w-full rounded-xl bg-lime-400 py-3 font-black text-[#060c18] text-sm hover:bg-lime-300 transition-colors">
          プロフィールを保存する
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ランクロードマップ
// ════════════════════════════════════════════════════════════════
function RankRoadmap({ currentWilks }: { currentWilks: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-[#1a2f5a] bg-[#0a1224] overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-400 hover:text-white transition-colors">
        <span className="font-semibold text-xs uppercase tracking-widest">Rank Roadmap — 全14階級</span>
        <span className="text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="divide-y divide-[#0e1a36] px-4 pb-4 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:divide-y-0">
          {[...RANK_TABLE].reverse().map((rank) => {
            const achieved = currentWilks >= rank.minWilks;
            const isCurrent = achieved && (rank.maxWilks === null || currentWilks < rank.maxWilks);
            return (
              <div key={rank.tier} className={`flex items-center justify-between py-2.5 ${isCurrent?"opacity-100":achieved?"opacity-55":"opacity-20"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-base w-6 text-center">{rank.icon}</span>
                  <span className={`text-sm font-bold ${isCurrent?"":"text-slate-300"}`} style={isCurrent?{color:rank.color}:undefined}>{rank.labelJa}</span>
                  {isCurrent && <span className="rounded-full bg-lime-400/10 px-1.5 py-0.5 text-[10px] text-lime-400 border border-lime-400/20">現在</span>}
                </div>
                <span className="text-xs text-slate-500">{rank.minWilks}{rank.maxWilks?`〜${rank.maxWilks}`:"+"} pts</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
