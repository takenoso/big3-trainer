import Groq from "groq-sdk";
import { NextRequest } from "next/server";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
  const { messages, systemContext } = await req.json();

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1024,
          stream: true,
          messages: [
            { role: "system", content: systemContext },
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role,
              content: m.content,
            })),
          ],
        });

        let inputTokens = 0;
        let outputTokens = 0;

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));

          // 最終チャンクにトークン使用量が含まれる
          const usage = (chunk as { x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } } }).x_groq?.usage;
          if (usage) {
            inputTokens  = usage.prompt_tokens     ?? 0;
            outputTokens = usage.completion_tokens ?? 0;
          }
        }

        if (inputTokens > 0 || outputTokens > 0) {
          const usageJson = JSON.stringify({ input: inputTokens, output: outputTokens });
          controller.enqueue(encoder.encode(`\n__USAGE__${usageJson}__USAGE__`));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "不明なエラーが発生しました";
        const friendlyMsg = msg.includes("API key") || msg.includes("GROQ_API_KEY")
          ? "APIキーが設定されていません。.env.local に GROQ_API_KEY を設定してください。"
          : `エラー: ${msg}`;
        controller.enqueue(encoder.encode(friendlyMsg));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
