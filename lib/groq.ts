import "server-only";

const BASE = "https://api.groq.com/openai/v1";

export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", audio, "comando.webm");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "es");
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`groq_stt_${res.status}`);
  const data = await res.json();
  return (data.text ?? "").trim();
}

type ToolCall = { function: { name: string; arguments: string } };

export async function interpretWithTools(opts: {
  system: string;
  user: string;
  tools: unknown[];
}): Promise<{ toolCalls: { name: string; args: Record<string, unknown> }[]; text: string }> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: opts.tools,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) throw new Error(`groq_llm_${res.status}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls = ((msg.tool_calls ?? []) as ToolCall[]).map((t) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(t.function.arguments);
    } catch {}
    return { name: t.function.name, args };
  });
  return { toolCalls, text: (msg.content ?? "").trim() };
}
