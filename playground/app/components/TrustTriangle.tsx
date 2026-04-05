"use client";

import { Shield, UserCheck, Building2, ScrollText } from "lucide-react";

export default function TrustTriangle() {
  return (
    <div className="relative w-full max-w-lg mx-auto py-8">
      <svg
        viewBox="0 0 400 300"
        className="w-full h-auto"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Triangle edges */}
        <line x1="200" y1="40" x2="60" y2="240" stroke="#d1d5db" strokeWidth="2" strokeDasharray="6 4" />
        <line x1="200" y1="40" x2="340" y2="240" stroke="#d1d5db" strokeWidth="2" strokeDasharray="6 4" />
        <line x1="60" y1="240" x2="340" y2="240" stroke="#d1d5db" strokeWidth="2" strokeDasharray="6 4" />

        {/* Arrow labels */}
        <text x="110" y="130" fill="#6b7280" fontSize="11" textAnchor="middle" transform="rotate(-55 110 130)">
          issues credential
        </text>
        <text x="290" y="130" fill="#6b7280" fontSize="11" textAnchor="middle" transform="rotate(55 290 130)">
          presents proof
        </text>
        <text x="200" y="270" fill="#6b7280" fontSize="11" textAnchor="middle">
          verifies without contacting issuer
        </text>
      </svg>

      {/* Issuer node */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
          <Building2 className="w-7 h-7 text-emerald-700" />
        </div>
        <span className="text-sm font-semibold text-gray-700">Issuer</span>
      </div>

      {/* Holder node */}
      <div className="absolute bottom-4 left-4 flex flex-col items-center gap-1">
        <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
          <UserCheck className="w-7 h-7 text-blue-700" />
        </div>
        <span className="text-sm font-semibold text-gray-700">Holder</span>
      </div>

      {/* Verifier node */}
      <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1">
        <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center">
          <Shield className="w-7 h-7 text-purple-700" />
        </div>
        <span className="text-sm font-semibold text-gray-700">Verifier</span>
      </div>

      {/* Trust Registry — center */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
        <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
          <ScrollText className="w-6 h-6 text-amber-700" />
        </div>
        <span className="text-xs font-semibold text-amber-700">Trust Registry</span>
      </div>
    </div>
  );
}
