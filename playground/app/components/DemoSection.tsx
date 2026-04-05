"use client";

import { useState, useEffect, useCallback } from "react";
import {
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import QRCodeLib from "qrcode";

type DemoState = "idle" | "loading" | "qr" | "polling" | "success" | "error";

interface DemoSectionProps {
  title: string;
  description: string;
  steps: string[];
  fetchInvitation: () => Promise<{
    sessionId?: string;
    qrDataUrl?: string;
    invitationUrl?: string;
    url?: string;
  }>;
  pollResult?: (sessionId: string) => Promise<{
    status: string;
    claims?: Record<string, string>;
    error?: string;
  }>;
  resultLabel?: string;
}

export default function DemoSection({
  title,
  description,
  steps,
  fetchInvitation,
  pollResult,
  resultLabel = "Result",
}: DemoSectionProps) {
  const [state, setState] = useState<DemoState>("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");

  const reset = useCallback(() => {
    setState("idle");
    setQrDataUrl("");
    setSessionId("");
    setClaims({});
    setErrorMsg("");
  }, []);

  const start = useCallback(async () => {
    setState("loading");
    try {
      const inv = await fetchInvitation();

      let qr = inv.qrDataUrl || "";
      if (!qr && (inv.invitationUrl || inv.url)) {
        qr = await QRCodeLib.toDataURL(inv.invitationUrl || inv.url || "", {
          width: 280,
          margin: 2,
        });
      }

      setQrDataUrl(qr);
      setSessionId(inv.sessionId || "");
      setState(pollResult && inv.sessionId ? "polling" : "qr");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to start");
      setState("error");
    }
  }, [fetchInvitation, pollResult]);

  useEffect(() => {
    if (state !== "polling" || !sessionId || !pollResult) return;

    const interval = setInterval(async () => {
      try {
        const res = await pollResult(sessionId);
        if (res.status === "issued" || res.status === "verified") {
          setClaims(res.claims || {});
          setState("success");
        } else if (res.status === "error") {
          setErrorMsg(res.error || "Verification failed");
          setState("error");
        }
      } catch {
        // keep polling
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [state, sessionId, pollResult]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-500">{description}</p>
      </div>

      <div className="p-6">
        {/* Steps */}
        <ol className="space-y-3 mb-6">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-semibold">
                {i + 1}
              </span>
              <span className="text-gray-600 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        {/* Action area */}
        <div className="flex flex-col items-center">
          {state === "idle" && (
            <button
              onClick={start}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#667eea] hover:bg-[#5a6fd6] text-white rounded-xl font-medium transition-colors"
            >
              <QrCode className="w-5 h-5" />
              Generate QR Code
            </button>
          )}

          {state === "loading" && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="w-8 h-8 text-[#667eea] animate-spin" />
              <span className="text-sm text-gray-500">
                Generating invitation...
              </span>
            </div>
          )}

          {(state === "qr" || state === "polling") && qrDataUrl && (
            <div className="flex flex-col items-center gap-3">
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="rounded-xl border border-gray-100"
                width={280}
                height={280}
              />
              {state === "polling" && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Waiting for response...
                </div>
              )}
              <button
                onClick={reset}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center gap-4 w-full">
              <CheckCircle2 className="w-12 h-12 text-violet-500" />
              <p className="font-semibold text-gray-900">{resultLabel}</p>
              {Object.keys(claims).length > 0 && (
                <ul className="w-full max-w-sm divide-y divide-gray-100">
                  {Object.entries(claims).map(([key, value]) => (
                    <li
                      key={key}
                      className="flex justify-between py-2 text-sm"
                    >
                      <span className="font-medium text-violet-700">
                        {key}
                      </span>
                      <span className="text-gray-600">{value}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center gap-3">
              <XCircle className="w-12 h-12 text-red-400" />
              <p className="text-sm text-red-600">{errorMsg}</p>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
