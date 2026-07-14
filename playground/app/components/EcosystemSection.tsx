"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  MessageSquare,
  Globe,
  ExternalLink,
  FileJson,
  Landmark,
  ListTree,
  ScrollText,
} from "lucide-react";
import { config } from "../config";

/* ------------------------------------------------------------------ */
/*  Live ecosystem data (from /api/ecosystem)                          */
/* ------------------------------------------------------------------ */

type EcoService = { did: string | null; agentUrl: string };

type EcoPermission = {
  id: number;
  type: string;
  did: string | null;
  validatorPermId: number | null;
};

type EcosystemInfo = {
  network: string;
  services: Record<string, EcoService>;
  trustRegistry: { id: number; url: string } | null;
  schema: {
    id: number;
    url: string;
    jsonUrl: string;
    json: string | null;
  } | null;
  participantsUrl: string | null;
  permissions: EcoPermission[];
};

/* ------------------------------------------------------------------ */
/*  The five demo services                                             */
/* ------------------------------------------------------------------ */

const SERVICES = [
  {
    id: "organization-vs",
    name: "Organization",
    role: "Trust Anchor",
    desc: "Registers with the Ecosystem, creates the Trust Registry and publishes the credential schema",
    icon: Building2,
    color: "text-amber-600 bg-amber-50",
  },
  {
    id: "issuer-chatbot-vs",
    name: "Issuer Chatbot",
    role: "Credential Issuer",
    desc: "Issues credentials to users via a conversational DIDComm chatbot",
    icon: MessageSquare,
    color: "text-violet-600 bg-violet-50",
  },
  {
    id: "issuer-web-vs",
    name: "Issuer Web",
    role: "Credential Issuer",
    desc: "Issues credentials to users via a web form and QR code",
    icon: Globe,
    color: "text-violet-600 bg-violet-50",
  },
  {
    id: "verifier-chatbot-vs",
    name: "Verifier Chatbot",
    role: "Credential Verifier",
    desc: "Requests and verifies credential presentations via DIDComm chatbot",
    icon: MessageSquare,
    color: "text-purple-600 bg-purple-50",
  },
  {
    id: "verifier-web-vs",
    name: "Verifier Web",
    role: "Credential Verifier",
    desc: "Requests and verifies credential presentations via web page and QR code",
    icon: Globe,
    color: "text-purple-600 bg-purple-50",
  },
] as const;

const PERM_BADGE: Record<string, string> = {
  ECOSYSTEM: "text-amber-700 bg-amber-100",
  ISSUER: "text-violet-700 bg-violet-100",
  VERIFIER: "text-purple-700 bg-purple-100",
};

/** Middle-ellipsis so long DIDs stay one-line in the tree. */
function shortDid(did: string, max = 44): string {
  if (did.length <= max) return did;
  const head = Math.ceil((max - 3) * 0.55);
  const tail = max - 3 - head;
  return `${did.slice(0, head)}...${did.slice(-tail)}`;
}

function PermBadge({ type }: { type: string }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
        PERM_BADGE[type] ?? "text-gray-600 bg-gray-100"
      }`}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export default function EcosystemSection() {
  // undefined = loading, null = live data unavailable
  const [eco, setEco] = useState<EcosystemInfo | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/ecosystem")
      .then((res) => (res.ok ? (res.json() as Promise<EcosystemInfo>) : null))
      .then(setEco)
      .catch(() => setEco(null));
  }, []);

  // Label on-chain permissions with the service names when the DID matches
  const didToName = new Map<string, string>();
  if (eco) {
    for (const s of SERVICES) {
      const did = eco.services[s.id]?.did;
      if (did) didToName.set(did, s.name);
    }
  }

  const root = eco?.permissions.find((p) => p.type === "ECOSYSTEM") ?? null;
  const children = root
    ? (eco?.permissions ?? []).filter(
        (p) => p.id !== root.id && p.validatorPermId === root.id,
      )
    : (eco?.permissions ?? []);

  const frontendLinks = [
    { label: "Trust Registry", href: eco?.trustRegistry?.url, icon: Landmark },
    { label: "Credential Schema", href: eco?.schema?.url, icon: ScrollText },
    { label: "Participant Tree", href: eco?.participantsUrl, icon: ListTree },
  ].filter((l): l is { label: string; href: string; icon: typeof Landmark } =>
    Boolean(l.href),
  );

  return (
    <>
      <p className="text-gray-600 mb-6 leading-relaxed">
        This playground connects to five live services. The{" "}
        <strong>Organization</strong> below is the trust anchor: it registered
        with the Verana Ecosystem, <strong>created a Trust Registry</strong> on
        the network, <strong>published the credential schema</strong> used by
        these demos, and granted the issuer and verifier permissions. The four
        child services inherit trust from it: two <strong>Issuers</strong> that
        create credentials and two <strong>Verifiers</strong> that validate
        them.
      </p>

      {/* Service cards */}
      <div className="space-y-3">
        {SERVICES.map((s) => {
          const live = eco?.services?.[s.id];
          return (
            <div
              key={s.id}
              className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${s.color}`}
              >
                <s.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{s.name}</span>
                  <span className="text-xs text-gray-400 font-medium">
                    {s.role}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{s.desc}</p>
                {live?.did ? (
                  <p className="font-mono text-[11px] text-gray-400 mt-1.5 break-all">
                    {live.did}
                  </p>
                ) : eco === undefined ? (
                  <p className="font-mono text-[11px] text-gray-300 mt-1.5">
                    resolving DID...
                  </p>
                ) : null}
                {s.id === "issuer-web-vs" && config.issuerWebUrl ? (
                  <a
                    href={config.issuerWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#667eea] hover:underline mt-1.5"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Issuer website
                  </a>
                ) : null}
              </div>
              {live ? (
                <a
                  href={live.agentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the VS-Agent public endpoint"
                  aria-label={`Open the ${s.name} VS-Agent in a new window`}
                  className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-[#667eea] hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* On-chain: frontend links, permission tree, schema JSON */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-1">
          Live on the Verana network
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Everything the Organization anchored is public. Inspect it on the
          Verana {eco?.network ?? "testnet"} frontend:
        </p>

        {eco === undefined ? (
          <p className="text-sm text-gray-400">Loading on-chain data...</p>
        ) : frontendLinks.length === 0 ? (
          <p className="text-sm text-gray-400">
            On-chain data is unavailable right now — try reloading the page.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {frontendLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:border-[#667eea] hover:text-[#667eea] transition-colors"
              >
                <l.icon className="w-4 h-4" />
                {l.label}
                <ExternalLink className="w-3 h-3 text-gray-400" />
              </a>
            ))}
          </div>
        )}

        {/* Permission tree */}
        {eco && root ? (
          <div className="mt-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Participant tree
            </p>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <PermBadge type={root.type} />
                <span className="font-medium text-gray-900">
                  {(root.did && didToName.get(root.did)) ?? "Ecosystem root"}
                </span>
                {root.did ? (
                  <span className="font-mono text-[11px] text-gray-400">
                    {shortDid(root.did)}
                  </span>
                ) : null}
              </div>
              <ul className="mt-3 ml-2 border-l-2 border-gray-200 pl-4 space-y-2.5">
                {children.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 flex-wrap">
                    <PermBadge type={p.type} />
                    <span className="text-gray-700">
                      {(p.did && didToName.get(p.did)) ?? "Participant"}
                    </span>
                    {p.did ? (
                      <span className="font-mono text-[11px] text-gray-400">
                        {shortDid(p.did)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Credential schema JSON */}
        {eco?.schema?.json ? (
          <details className="mt-6">
            <summary className="cursor-pointer inline-flex items-center gap-1.5 text-sm font-medium text-[#667eea] hover:underline">
              <FileJson className="w-4 h-4" />
              View the credential schema JSON
            </summary>
            <pre className="mt-3 rounded-xl bg-gray-900 text-gray-100 text-xs leading-relaxed p-4 overflow-x-auto">
              {eco.schema.json}
            </pre>
            <a
              href={eco.schema.jsonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-[#667eea] mt-2"
            >
              Raw schema from the network indexer
              <ExternalLink className="w-3 h-3" />
            </a>
          </details>
        ) : null}
      </div>
    </>
  );
}
