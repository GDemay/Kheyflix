"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowRight, KeyRound, RotateCcw, ShieldCheck } from "lucide-react";

type AccessState = "checking" | "allowed" | "required" | "unconfigured" | "unavailable";

type AccessResponse = {
  authorized?: boolean;
  configured?: boolean;
};

const accessState = (value: AccessResponse): AccessState => {
  if (value.authorized) return "allowed";
  return value.configured ? "required" : "unconfigured";
};

export default function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>("checking");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const code = useRef<HTMLInputElement>(null);

  const loadAccessStatus = useCallback(async (): Promise<AccessState> => {
    try {
      const response = await fetch("/api/access", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Access status is unavailable.");
      return accessState(await response.json() as AccessResponse);
    } catch {
      return "unavailable";
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadAccessStatus().then((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
    };
  }, [loadAccessStatus]);

  const refresh = () => {
    setState("checking");
    setError("");
    void loadAccessStatus().then(setState);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const accessCode = code.current?.value || "";
    if (!accessCode) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      if (code.current) code.current.value = "";
      if (response.status === 204) {
        setState("allowed");
        return;
      }
      const body = await response.json().catch(() => undefined) as
        | { error?: { message?: string } }
        | undefined;
      setError(body?.error?.message || "We could not verify that access code.");
    } catch {
      setError("We could not reach Kheyflix. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "allowed") return <>{children}</>;

  const checking = state === "checking";
  const required = state === "required";
  const unavailable = state === "unavailable";
  return (
    <main className="access-gate" aria-busy={checking}>
      <div className="access-gate__glow" aria-hidden="true" />
      <section className="access-gate__panel" aria-live="polite">
        <div className="access-gate__mark" aria-hidden="true">
          <span>K</span>
        </div>
        {checking ? (
          <>
            <p className="access-gate__eyebrow">KHEYFLIX</p>
            <h1>Opening your cinema</h1>
            <p>Checking your secure viewing session.</p>
          </>
        ) : required ? (
          <>
            <p className="access-gate__eyebrow"><ShieldCheck size={15} /> PRIVATE VIEWING</p>
            <h1>Your cinema is ready</h1>
            <p>
              Enter your Kheyflix access code to continue to the catalog.
              It stays in a secure browser session and is never added to a link.
            </p>
            <form onSubmit={submit}>
              <label htmlFor="kheyflix-access-code">Kheyflix access code</label>
              <div className="access-gate__input">
                <KeyRound size={18} aria-hidden="true" />
                <input
                  ref={code}
                  id="kheyflix-access-code"
                  aria-label="Kheyflix access code"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  disabled={submitting}
                />
              </div>
              {error && <p className="access-gate__error" role="alert">{error}</p>}
              <button className="access-gate__submit" type="submit" disabled={submitting}>
                {submitting ? "Checking access…" : "Enter Kheyflix"}
                {!submitting && <ArrowRight size={18} />}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="access-gate__eyebrow">KHEYFLIX</p>
            <h1>{unavailable ? "Kheyflix is temporarily unavailable" : "Kheyflix is being prepared"}</h1>
            <p>
              {unavailable
                ? "We could not check your viewing session. Please try again."
                : "Private viewing access is being configured. Please try again shortly."}
            </p>
            <button className="access-gate__retry" type="button" onClick={refresh}>
              <RotateCcw size={17} /> Try again
            </button>
          </>
        )}
      </section>
    </main>
  );
}
