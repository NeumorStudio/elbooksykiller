"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { interpretCommand, executePlan, type PlanStep } from "./assistant-actions";

type Phase = "idle" | "recording" | "thinking" | "confirm" | "running" | "done";

export default function Assistant() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [results, setResults] = useState<{ desc: string; ok: boolean }[]>([]);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  function reset() {
    setPhase("idle");
    setHeard("");
    setSteps([]);
    setResults([]);
    setError("");
    setText("");
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        await interpret(blob, "");
      };
      rec.start();
      recorder.current = rec;
      setPhase("recording");
    } catch {
      setError("No hay acceso al micrófono. Puedes escribir la orden abajo.");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setPhase("thinking");
  }

  async function interpret(audio: Blob | null, typed: string) {
    setPhase("thinking");
    setError("");
    const fd = new FormData();
    if (audio) fd.append("audio", audio);
    if (typed) fd.append("text", typed);
    const res = await interpretCommand(fd);
    setHeard(res.heard ?? typed);
    if (res.steps?.length) {
      setSteps(res.steps);
      setPhase("confirm");
    } else {
      setError(res.error ?? "No he entendido.");
      setPhase("idle");
    }
  }

  async function confirm() {
    setPhase("running");
    const { results } = await executePlan(steps);
    setResults(results);
    setPhase("done");
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(!open);
          if (open) reset();
        }}
        aria-label="Asistente de voz"
        className="fixed bottom-5 right-5 z-20 h-14 w-14 rounded-full bg-brand text-brand-ink text-2xl shadow-lg
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {open ? "×" : "🎤"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-20 w-[min(24rem,calc(100vw-2.5rem))] panel bg-bg p-5 shadow-xl flex flex-col gap-4">
          <p className="font-semibold">Asistente</p>

          {phase === "idle" && (
            <>
              <p className="text-sm text-muted text-pretty">
                Dime qué configurar: «añade un peluquero llamado Juan con turno de lunes a
                sábado de 10 a 8», «crea el servicio tinte a 35 euros y 90 minutos»…
              </p>
              <button onClick={startRecording} className="btn-primary">
                🎤 Hablar
              </button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim()) interpret(null, text.trim());
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="…o escríbelo"
                  className="field flex-1"
                />
                <button className="btn-quiet">Enviar</button>
              </form>
              {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            </>
          )}

          {phase === "recording" && (
            <button onClick={stopRecording} className="btn-primary animate-pulse">
              ⏹ Escuchando… toca para terminar
            </button>
          )}

          {phase === "thinking" && <p className="text-muted">Interpretando…</p>}

          {phase === "confirm" && (
            <>
              {heard && <p className="text-sm text-muted">He oído: «{heard}»</p>}
              <ul className="flex flex-col gap-1.5 text-sm">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brand" aria-hidden>→</span>
                    {s.desc}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button onClick={confirm} className="btn-primary flex-1">
                  Confirmar
                </button>
                <button onClick={reset} className="btn-quiet">
                  Cancelar
                </button>
              </div>
            </>
          )}

          {phase === "running" && <p className="text-muted">Aplicando cambios…</p>}

          {phase === "done" && (
            <>
              <ul className="flex flex-col gap-1.5 text-sm">
                {results.map((r, i) => (
                  <li key={i} className={r.ok ? "" : "text-danger"}>
                    {r.ok ? "✓" : "✗"} {r.desc}
                  </li>
                ))}
              </ul>
              <button onClick={reset} className="btn-quiet">
                Otra orden
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
