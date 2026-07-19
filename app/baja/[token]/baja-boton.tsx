"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { darseDeBaja } from "./actions";

export default function BajaBoton({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        className="btn-primary px-8"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await darseDeBaja(token);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Un momento…" : "Darme de baja"}
      </button>
      {error && (
        <p className="text-sm text-danger mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
