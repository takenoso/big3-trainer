import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
  const { foodName } = await req.json();
  if (!foodName?.trim()) {
    return NextResponse.json({ error: "食品名が必要です" }, { status: 400 });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      max_tokens: 200,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a nutrition expert. Return only valid JSON with numeric values for kcal, protein, fat, and carbs.",
        },
        {
          role: "user",
          content: `食品「${foodName}」の標準的な1食分の栄養素をJSONで返してください。
形式: {"kcal": 数値, "protein": 数値, "fat": 数値, "carbs": 数値}
kcal: カロリー(整数), protein/fat/carbs: g単位(小数第1位)`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(text);
    return NextResponse.json({
      kcal:    Math.round(data.kcal    ?? 0),
      protein: Math.round((data.protein ?? 0) * 10) / 10,
      fat:     Math.round((data.fat     ?? 0) * 10) / 10,
      carbs:   Math.round((data.carbs   ?? 0) * 10) / 10,
    });
  } catch {
    return NextResponse.json({ error: "栄養素の計算に失敗しました" }, { status: 500 });
  }
}
