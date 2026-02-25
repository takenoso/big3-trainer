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
type ChatMsg = { role: "user" | "assistant"; content: string; usage?: { input: number; output: number } };
type Tab = "home" | "training" | "meal" | "summary" | "planning" | "settings";
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
  const [menuTemplate, setMenuTemplate] = useLocalStorage<MenuTemplateItem[]>("b3_menu_tpl", DEFAULT_MENU);
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
  function removeMealEntry(date: string, id: string) {
    setMealRecords((prev) =>
      prev.map((r) => r.date === date ? { ...r, entries: r.entries.filter((e) => e.id !== id) } : r)
    );
  }
  function addWeight(entry: WeightEntry) {
    setWeightLog((prev) => [entry, ...prev.filter((e) => e.date !== entry.date)]);
    setProfile((prev) => ({ ...prev, bodyweightKg: entry.kg }));
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
          <span className="text-lg font-black tracking-tight">BIG3<span className="gradient-text-lime">TRAINER</span></span>
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
          <p className="text-2xl font-black">{stats.wilks.toFixed(1)}</p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#0e1a36] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${stats.progressPercent}%`, background: `linear-gradient(90deg,${stats.currentRank.color},${stats.nextRank?.color ?? stats.currentRank.color})` }} />
          </div>
          {stats.nextRank && <p className="text-[10px] text-slate-500 mt-1">あと <span className="text-lime-400 font-bold">{stats.pointsToNext.toFixed(1)}pts</span></p>}
        </div>
      </aside>

      {/* ── メインコンテンツ ── */}
      <div className="flex-1 lg:ml-52 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 border-b border-[#1a2f5a]/60 bg-[#060c18]/90 backdrop-blur-md">
          <div className="flex items-center justify-between px-5 py-3 max-w-5xl mx-auto">
            <span className="lg:hidden text-base font-black">BIG3<span className="gradient-text-lime">TRAINER</span></span>
            <h1 className="hidden lg:block text-sm font-semibold text-slate-400">{NAV_SIDEBAR.find((n) => n.id === activeTab)?.label}</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 hidden sm:block">{new Date().toLocaleDateString("ja-JP",{month:"long",day:"numeric",weekday:"short"})}</span>
              <button onClick={() => setActiveTab("settings")} className={`text-lg transition-colors ${activeTab==="settings"?"text-lime-400":"text-slate-500 hover:text-white"}`}>⚙️</button>
              <div className="lg:hidden h-8 w-8 rounded-full bg-[#1a2f5a] flex items-center justify-center text-xs font-bold text-lime-400">{profile.name.charAt(0)}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-6 max-w-5xl mx-auto w-full pb-24 lg:pb-8">
          {activeTab === "home"     && <HomeTab profile={profile} stats={stats} todaySession={todaySession} todayMeals={todayMeals} onNavigate={setActiveTab} weightLog={weightLog} />}
          {activeTab === "training" && <TrainingTab todaySession={todaySession} onSave={saveSession} onToast={showToast} profile={profile} onUpdateProfile={setProfile} weightLog={weightLog} onAddWeight={addWeight} menuTemplate={menuTemplate} onSaveTemplate={setMenuTemplate} />}
          {activeTab === "meal"     && <MealTab todayMeals={todayMeals} onAdd={addMealEntry} onRemove={removeMealEntry} onToast={showToast} />}
          {activeTab === "summary"  && <SummaryTab sessions={sessions} mealRecords={mealRecords} weightLog={weightLog} />}
          {activeTab === "planning" && <PlanningTab systemContext={planningSystem} messages={chatMessages} setMessages={setChatMessages} sessionTokens={chatTokens} setSessionTokens={setChatTokens} />}
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
function HomeTab({ profile, stats, todaySession, todayMeals, onNavigate, weightLog }: {
  profile: UserProfile;
  stats: ReturnType<typeof computeStats>;
  todaySession?: TrainingSession;
  todayMeals?: DayMealRecord;
  onNavigate: (t: Tab) => void;
  weightLog: WeightEntry[];
}) {
  const { wilks, total, currentRank, nextRank, progressPercent, pointsToNext } = stats;
  const todayWeight = weightLog.find((e) => e.date === todayStr())?.kg;
  const todayKcal = todayMeals?.entries.reduce((a, e) => a + e.kcal, 0) ?? 0;
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
              <div className="flex items-baseline gap-1"><span className="text-4xl font-black">{wilks.toFixed(1)}</span><span className="text-sm text-slate-400">WILKS</span></div>
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
                <span>あと<span className="text-lime-400 font-bold"> {pointsToNext.toFixed(1)}pts </span>で<span style={{color:nextRank.color}}>{nextRank.labelJa}</span></span>
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
              className="rounded-xl p-3 border border-[#1a2f5a] bg-[#0e1a36] hover:bg-[#1a2f5a] transition-colors">
              <p className="text-xs text-slate-400 mb-1">食事</p>
              <p className="text-sm font-black">{todayKcal}<span className="text-slate-400 font-normal text-xs"> kcal</span></p>
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

      <RankRoadmap currentWilks={wilks} />
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

function TrainingTab({ todaySession, onSave, onToast, profile, onUpdateProfile, weightLog, onAddWeight, menuTemplate, onSaveTemplate }: {
  todaySession?: TrainingSession;
  onSave: (s: TrainingSession) => void;
  onToast: (msg: string) => void;
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  weightLog: WeightEntry[];
  onAddWeight: (entry: WeightEntry) => void;
  menuTemplate: MenuTemplateItem[];
  onSaveTemplate: (t: MenuTemplateItem[]) => void;
}) {
  const [session, setSession] = useState<TrainingSession>(
    () => todaySession ?? makeDefaultSession(menuTemplate)
  );
  const todayWeightEntry = weightLog.find((e) => e.date === todayStr());
  const [weightInput, setWeightInput] = useState(
    () => todayWeightEntry ? String(todayWeightEntry.kg) : String(profile.bodyweightKg)
  );
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

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

  const totalSets = session.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const doneSets  = session.exercises.reduce((a, ex) => a + ex.sets.filter((s) => s.completed).length, 0);

  function updateSet(ei: number, si: number, field: "weight" | "reps", raw: string) {
    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) return;
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== ei ? ex : { ...ex, sets: ex.sets.map((s, j) => j !== si ? s : { ...s, [field]: val }) }
      ),
    }));
  }
  function toggleSet(ei: number, si: number) {
    if (session.completed) return;
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== ei ? ex : { ...ex, sets: ex.sets.map((s, j) => j !== si ? s : { ...s, completed: !s.completed }) }
      ),
    }));
  }
  function addSet(ei: number) {
    setSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== ei) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return { ...ex, sets: [...ex.sets, { weight: last?.weight ?? 60, reps: last?.reps ?? 5, completed: false }] };
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
  function finish() {
    const s: TrainingSession = { ...session, completed: true, savedAt: new Date().toISOString() };
    setSession(s);
    onSave(s);

    // メニューテンプレートを保存（次回のデフォルトに使用）
    const newTemplate: MenuTemplateItem[] = s.exercises.map((ex) => ({
      exercise: ex.name,
      sets: ex.sets.length,
      reps: ex.sets[0]?.reps ?? 8,
      weightKg: ex.sets[0]?.weight ?? 60,
    }));
    onSaveTemplate(newTemplate);

    // 1RM自動更新
    let updated = { ...profile };
    let didUpdate = false;
    s.exercises.forEach((ex) => {
      const field = BIG3_MAP[ex.name];
      if (!field) return;
      const best = ex.sets
        .filter((st) => st.completed && st.weight > 0 && st.reps >= 1 && st.reps <= 30)
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
      onToast("トレーニングを記録しました！");
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest">{fmtDate(session.date)}</p>
          <h2 className="text-xl font-bold">トレーニング記録</h2>
        </div>
        {!session.completed && totalSets > 0 && (
          <div className="text-right">
            <p className="text-2xl font-black text-lime-400">{doneSets}<span className="text-slate-500 text-sm font-normal">/{totalSets}</span></p>
            <p className="text-[10px] text-slate-500">完了セット</p>
          </div>
        )}
      </div>

      {!session.completed && totalSets > 0 && (
        <div className="h-1.5 w-full rounded-full bg-[#0e1a36] overflow-hidden">
          <div className="h-full rounded-full bg-lime-400 transition-all duration-500" style={{ width:`${(doneSets/totalSets)*100}%` }} />
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
                  disabled={session.completed}
                  className="text-sm font-bold bg-transparent border-b border-transparent focus:border-lime-400/50 focus:outline-none w-full disabled:cursor-default"
                />
                {ex.sets.length > 0 && ex.sets[0].weight > 0 && ex.sets[0].reps >= 1 && ex.sets[0].reps <= 30 && (
                  <p className="text-xs text-slate-500">推定1RM: {estimateOneRepMax(ex.sets[0].weight, ex.sets[0].reps)}kg</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <p className="text-xs text-slate-500">{ex.sets.length}セット</p>
              {!session.completed && (
                <button onClick={() => removeExercise(ei)} className="text-slate-500 hover:text-red-400 text-xs transition-colors ml-1">✕</button>
              )}
            </div>
          </div>

          {/* セット行 */}
          <div className="px-4 pt-3 pb-1">
            <div className="grid grid-cols-[1.5rem_1fr_1fr_2.5rem] gap-2 mb-1.5 text-[10px] text-slate-500 px-1">
              <span>#</span><span className="text-center">重量 (kg)</span><span className="text-center">回数</span><span></span>
            </div>
            {ex.sets.map((s, si) => (
              <div key={si} className="grid grid-cols-[1.5rem_1fr_1fr_2.5rem] gap-2 mb-2 items-center">
                <span className="text-[11px] text-slate-500 text-center">{si+1}</span>
                <input type="text" inputMode="decimal" value={getRaw(ei, si, "weight")} onChange={(e) => handleSetInput(ei, si, "weight", e.target.value)} onBlur={() => handleSetBlur(ei, si, "weight")} disabled={session.completed}
                  className="rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm text-center font-bold disabled:opacity-50 focus:outline-none focus:border-lime-400/50 w-full" />
                <input type="text" inputMode="numeric" value={getRaw(ei, si, "reps")} onChange={(e) => handleSetInput(ei, si, "reps", e.target.value)} onBlur={() => handleSetBlur(ei, si, "reps")} disabled={session.completed}
                  className="rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-2 py-1.5 text-sm text-center font-bold disabled:opacity-50 focus:outline-none focus:border-lime-400/50 w-full" />
                <button onClick={() => session.completed ? undefined : toggleSet(ei, si)}
                  className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
                    s.completed ? "bg-lime-400 text-[#060c18]"
                    : session.completed ? "bg-[#0e1a36] border border-[#1a2f5a]/50 text-slate-600 cursor-not-allowed"
                    : "bg-[#0e1a36] border border-[#1a2f5a] text-slate-400 hover:border-lime-400/40"
                  }`}>{s.completed ? "✓" : "○"}</button>
              </div>
            ))}
          </div>
          {!session.completed && (
            <div className="px-4 pb-3 flex gap-2">
              <button onClick={() => addSet(ei)} className="flex-1 rounded-lg border border-dashed border-[#1a2f5a] py-1.5 text-xs text-slate-500 hover:border-lime-400/30 hover:text-lime-400 transition-colors">+ セット追加</button>
              {ex.sets.length > 1 && (
                <button onClick={() => removeSet(ei, ex.sets.length - 1)} className="px-3 rounded-lg border border-[#1a2f5a] text-xs text-slate-500 hover:border-red-500/30 hover:text-red-400 transition-colors">−</button>
              )}
            </div>
          )}
        </div>
      ))}

      {!session.completed && (
        <button onClick={addExercise}
          className="w-full rounded-2xl border-2 border-dashed border-[#1a2f5a] py-3 text-sm text-slate-500 hover:border-lime-400/30 hover:text-lime-400 transition-colors">
          ＋ 種目を追加
        </button>
      )}

      {session.completed ? (
        <div className="rounded-2xl border border-lime-400/30 bg-lime-400/5 p-5 text-center">
          <p className="text-2xl mb-1">🏆</p>
          <p className="font-black text-lime-400 text-lg">記録済み！</p>
          <p className="text-xs text-slate-500 mt-1">{session.savedAt ? new Date(session.savedAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}) : ""}に保存しました</p>
        </div>
      ) : (
        <button onClick={finish} disabled={doneSets === 0}
          className="w-full rounded-2xl bg-lime-400 py-4 font-black text-[#060c18] text-base tracking-wide hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
          style={{ boxShadow: doneSets > 0 ? "0 4px 24px rgba(163,230,53,0.35)" : undefined }}>
          ✓ 完了として保存する
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// 食事記録タブ
// ════════════════════════════════════════════════════════════════
type MealForm = { time: string; name: string; kcal: string; protein: string; fat: string; carbs: string };
const EMPTY_FORM: MealForm = { time: "", name: "", kcal: "", protein: "", fat: "", carbs: "" };

function MealTab({ todayMeals, onAdd, onRemove, onToast }: {
  todayMeals?: DayMealRecord;
  onAdd: (e: MealEntry) => void;
  onRemove: (date: string, id: string) => void;
  onToast: (msg: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MealForm>(EMPTY_FORM);
  const [calcLoading, setCalcLoading] = useState(false);

  async function autoCalc() {
    if (!form.name.trim() || calcLoading) return;
    setCalcLoading(true);
    try {
      const res = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: form.name }),
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
  const TARGET_KCAL = 2800;

  function handleAdd() {
    if (!form.name.trim()) return;
    onAdd({
      id: genId(),
      time:    form.time || nowTime(),
      name:    form.name.trim(),
      kcal:    Math.round(parseFloat(form.kcal) || 0),
      protein: parseFloat(form.protein) || 0,
      fat:     parseFloat(form.fat)     || 0,
      carbs:   parseFloat(form.carbs)   || 0,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    onToast("食事を記録しました");
  }

  const field = (key: keyof MealForm, label: string, type = "text", placeholder = "") => (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest">{label}</label>
      <input type={type} value={form[key]} placeholder={placeholder}
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
            <p className="text-3xl font-black">{totalKcal}<span className="text-sm text-slate-400 font-normal"> kcal</span></p>
          </div>
          <p className="text-sm text-slate-400">目標 <span className="font-bold text-white">{TARGET_KCAL}</span> kcal</p>
        </div>
        <div className="h-2 w-full rounded-full bg-[#0e1a36] overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width:`${Math.min(100,(totalKcal/TARGET_KCAL)*100)}%`, background:"linear-gradient(90deg,#3b82f6,#a3e635)" }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label:"P", name:"タンパク質", value:totalP, target:180, color:"#3b82f6" },
            { label:"F", name:"脂質",       value:totalF, target:70,  color:"#f59e0b" },
            { label:"C", name:"炭水化物",   value:totalC, target:350, color:"#10b981" },
          ].map(({ label, name, value, target, color }) => (
            <div key={label} className="rounded-xl bg-[#0e1a36] p-2.5 text-center">
              <p className="text-[10px] text-slate-500 mb-0.5">{name}</p>
              <p className="text-base font-black" style={{ color }}>{value}<span className="text-xs text-slate-500">g</span></p>
              <p className="text-[10px] text-slate-500">{target}g目標</p>
            </div>
          ))}
        </div>
      </div>

      {/* エントリーリスト */}
      <div className="space-y-2">
        {entries.length === 0 && !showForm && (
          <p className="text-center text-sm text-slate-500 py-4">まだ記録がありません</p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-xl border border-[#1a2f5a] bg-[#0a1224] px-4 py-3 group">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-10 shrink-0">{e.time}</span>
              <div>
                <p className="text-sm font-semibold">{e.name}</p>
                <p className="text-xs text-slate-500">P:{e.protein}g F:{e.fat}g C:{e.carbs}g</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-black">{e.kcal}<span className="text-xs text-slate-500 font-normal">kcal</span></p>
              <button onClick={() => { onRemove(todayMeals?.date ?? todayStr(), e.id); onToast("削除しました"); }}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all text-sm">✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* 追加フォーム */}
      {showForm ? (
        <div className="rounded-2xl border border-lime-400/20 bg-[#0a1224] p-5 space-y-3">
          <p className="text-sm font-bold text-lime-400 mb-3">食事を追加</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-widest">食事名</label>
              <input type="text" value={form.name} placeholder="例: 鶏むね肉 + 白米"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg bg-[#0e1a36] border border-[#1a2f5a] px-3 py-2 text-sm focus:outline-none focus:border-lime-400/50" />
            </div>
            {field("time", "時刻", "time")}
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
            {field("kcal",    "カロリー (kcal)", "number", "500")}
            {field("protein", "タンパク質 (g)",  "number", "40")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("fat",   "脂質 (g)",   "number", "10")}
            {field("carbs", "炭水化物 (g)", "number", "60")}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd} disabled={!form.name.trim()}
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

function PlanningTab({ systemContext, messages, setMessages, sessionTokens, setSessionTokens }: {
  systemContext: string;
  messages: ChatMsg[];
  setMessages: (action: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => void;
  sessionTokens: { input: number; output: number };
  setSessionTokens: (action: { input: number; output: number } | ((prev: { input: number; output: number }) => { input: number; output: number })) => void;
}) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
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
          return (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0e1a36] border border-[#1a2f5a] mt-1 text-sm">💬</div>
              )}
              <div className={`rounded-2xl px-4 py-3 max-w-[80%] ${
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
              <span className="font-black text-lime-400">{w > 0 ? w.toFixed(1) : "—"}</span>
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
