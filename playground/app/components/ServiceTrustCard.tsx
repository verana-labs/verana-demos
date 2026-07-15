"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldX, Building2, Server } from "lucide-react";

// Compact Proof-of-Trust for one demo service, mirroring the Resolve-a-DID
// card on verana.io: trust status, the service identity (ECS-Service
// claims), and the organization operating it (ECS-Org claims) — resolved
// live against the network resolver via /api/pot/[serviceId].

type Pot = {
  did: string;
  trustStatus: string;
  service: {
    name: string | null;
    type: string | null;
    description: string | null;
  } | null;
  org: {
    name: string | null;
    countryCode: string | null;
    registryId: string | null;
    address: string | null;
  } | null;
};

/** ISO 3166-1 alpha-2 country code as an emoji flag (e.g. "CH" -> 🇨🇭). */
function countryFlag(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)),
  );
}

function shortDid(did: string, max = 40): string {
  if (did.length <= max) return did;
  const head = Math.ceil((max - 3) * 0.55);
  const tail = max - 3 - head;
  return `${did.slice(0, head)}...${did.slice(-tail)}`;
}

export default function ServiceTrustCard({ serviceId }: { serviceId: string }) {
  // undefined = loading, null = unavailable
  const [pot, setPot] = useState<Pot | null | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/pot/${serviceId}`)
      .then((res) => (res.ok ? (res.json() as Promise<Pot>) : null))
      .then(setPot)
      .catch(() => setPot(null));
  }, [serviceId]);

  if (pot === undefined) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-400 animate-pulse">
        Resolving Proof-of-Trust against the network...
      </div>
    );
  }

  if (pot === null) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-400">
        Proof-of-Trust unavailable right now.
      </div>
    );
  }

  const trusted = pot.trustStatus === "TRUSTED";
  const flag = pot.org?.countryCode ? countryFlag(pot.org.countryCode) : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
      {/* Status band */}
      <div className="flex items-center gap-2 flex-wrap border-b border-gray-200 bg-white px-4 py-2">
        {trusted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
            <ShieldCheck className="w-3 h-3" />
            Trusted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-600 px-2 py-0.5 text-[11px] font-semibold">
            <ShieldX className="w-3 h-3" />
            Untrusted
          </span>
        )}
        <span
          className="font-mono text-[10px] text-gray-400 truncate"
          title={pot.did}
        >
          {shortDid(pot.did)}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 px-4 py-3">
        {/* The service */}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            <Server className="w-3 h-3" />
            Service
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {pot.service?.name ?? "Unnamed service"}
          </p>
          {pot.service?.type ? (
            <p className="font-mono text-[10px] text-gray-400 mt-0.5">
              {pot.service.type}
            </p>
          ) : null}
          {pot.service?.description ? (
            <p className="text-xs text-gray-500 mt-1">
              {pot.service.description}
            </p>
          ) : null}
        </div>

        {/* The operator */}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            <Building2 className="w-3 h-3" />
            Operated by
          </p>
          {pot.org ? (
            <>
              <p className="text-sm font-semibold text-gray-900">
                {flag ? (
                  <span
                    role="img"
                    aria-label={`Country: ${pot.org.countryCode}`}
                    title={pot.org.countryCode ?? undefined}
                    className="mr-1"
                  >
                    {flag}
                  </span>
                ) : null}
                {pot.org.name ?? "Unnamed organization"}
              </p>
              {pot.org.registryId ? (
                <p className="font-mono text-[10px] text-gray-400 mt-0.5">
                  {pot.org.registryId}
                </p>
              ) : null}
              {pot.org.address ? (
                <p className="text-xs text-gray-500 mt-1">{pot.org.address}</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-gray-400">
              No organization credential presented.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
