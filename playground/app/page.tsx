"use client";

import {
  Fingerprint,
  KeyRound,
  ScrollText,
  ShieldCheck,
  ArrowDown,
  CheckCircle2,
  Lock,
  Users,
  Zap,
} from "lucide-react";
import SectionHeading from "./components/SectionHeading";
import TrustTriangle from "./components/TrustTriangle";
import ConceptCard from "./components/ConceptCard";
import DemoSection from "./components/DemoSection";
import EcosystemSection from "./components/EcosystemSection";
import { config } from "./config";

/* ------------------------------------------------------------------ */
/*  API helpers                                                        */
/* ------------------------------------------------------------------ */

async function fetchChatbotInvitation(endpoint: string) {
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Failed to fetch invitation`);
  const data = await res.json();
  return { url: data.url as string };
}

async function fetchVerifierWebInvitation() {
  const res = await fetch("/api/verifier-web/invitation", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create verification request");
  return (await res.json()) as {
    sessionId: string;
    qrDataUrl: string;
    invitationUrl: string;
  };
}

// Creates a playground session on the verifier chatbot: a fresh connection
// invitation plus a session id to poll for the verified attributes.
async function fetchVerifierChatbotSession() {
  const res = await fetch("/api/verifier-chatbot/invitation", {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to create verification session");
  return (await res.json()) as { sessionId: string; invitationUrl: string };
}

// The verifier services report the presented attributes under `attributes`;
// DemoSection renders them as `claims`.
async function pollVerifyResult(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Poll failed");
  const data = (await res.json()) as {
    status: string;
    attributes?: Record<string, string>;
    claims?: Record<string, string>;
    error?: string;
  };
  return {
    status: data.status,
    claims: data.attributes ?? data.claims,
    error: data.error,
  };
}

const pollVerifierWebResult = (sessionId: string) =>
  pollVerifyResult(`/api/verifier-web/result/${sessionId}`);

const pollVerifierChatbotResult = (sessionId: string) =>
  pollVerifyResult(`/api/verifier-chatbot/result/${sessionId}`);

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PlaygroundPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <header className="relative bg-gradient-to-br from-[#764ba2] via-[#667eea] to-[#667eea] text-white">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <img
            src="https://verana.io/images/purple/logo.svg"
            alt="Verana logo"
            className="h-10 mx-auto mb-6"
          />
          <p className="text-white/70 text-sm font-medium tracking-wider uppercase mb-3">
            Interactive Learning Environment
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Verana Playground
          </h1>
          <p className="text-lg text-white/80 max-w-2xl mx-auto mb-8">
            Learn how verifiable credentials work by issuing and presenting them
            in real time. No prior knowledge required.
          </p>
          <a
            href="#section-1"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur text-white font-medium transition-colors"
          >
            Get Started <ArrowDown className="w-4 h-4" />
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 space-y-24">
        {/* ============================================================ */}
        {/* Section 1 — What Is Verifiable Trust?                        */}
        {/* ============================================================ */}
        <section id="section-1">
          <SectionHeading
            number={1}
            title="What Is Verifiable Trust?"
            subtitle="The core concepts behind decentralized identity"
          />

          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <ConceptCard
              icon={Fingerprint}
              title="Verifiable Credential (VC)"
              description="A tamper-proof digital claim about a person or entity, issued by a trusted party. Think of it as a digital version of an ID card or diploma."
              color="violet"
            />
            <ConceptCard
              icon={KeyRound}
              title="Decentralized Identifier (DID)"
              description="A globally unique identifier that doesn't depend on any central authority. You own and control your own DID."
              color="blue"
            />
            <ConceptCard
              icon={ScrollText}
              title="Trust Registry"
              description="A public record that lists which organizations and services are authorized to issue or verify credentials within an ecosystem."
              color="amber"
            />
            <ConceptCard
              icon={ShieldCheck}
              title="Ecosystem Governance"
              description="Rules and roles that define who can participate and how trust is established, maintained, and revoked."
              color="purple"
            />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-center text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
              The Triangle of Trust
            </h3>
            <TrustTriangle />
            <p className="text-sm text-gray-500 text-center max-w-md mx-auto">
              The <strong>Issuer</strong> creates a credential. The{" "}
              <strong>Holder</strong> stores it in their wallet. The{" "}
              <strong>Verifier</strong> confirms it — all anchored by a{" "}
              <strong>Trust Registry</strong>.
            </p>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Section 2 — The Demo Ecosystem                               */}
        {/* ============================================================ */}
        <section id="section-2">
          <SectionHeading
            number={2}
            title="The Demo Ecosystem"
            subtitle="Five services that form a complete trust ecosystem"
          />

          <EcosystemSection />
        </section>

        {/* ============================================================ */}
        {/* Section 3 — Getting Started                                  */}
        {/* ============================================================ */}
        <section id="section-3">
          <SectionHeading
            number={3}
            title="Getting Started"
            subtitle="Install Hologram Messaging to participate in the demos"
          />

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <img
                src="https://hologram.zone/logo.svg"
                alt="Hologram Messaging"
                className="w-20 h-20 rounded-2xl shrink-0"
              />
              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                  Hologram Messaging
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  A mobile wallet that stores your credentials and communicates
                  with services using{" "}
                  <strong>DIDComm</strong> — an encrypted, peer-to-peer
                  messaging protocol. No central server ever sees your data.
                </p>
                <div className="flex flex-wrap justify-center sm:justify-start gap-3">
                  <a
                    href="https://apps.apple.com/cl/app/hologram-messaging/id6474701855"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
                  >
                    App Store
                  </a>
                  <a
                    href="https://play.google.com/store/apps/details?id=io.twentysixty.mobileagent.m"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
                  >
                    Google Play
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Section 4 — Demo 1: Chatbot Flow                            */}
        {/* ============================================================ */}
        <section id="section-4">
          <SectionHeading
            number={4}
            title="Demo 1: Chatbot Flow"
            subtitle="Obtain a credential from the Issuer Chatbot, then present it to the Verifier Chatbot"
          />

          <p className="text-gray-600 mb-6 leading-relaxed">
            In this demo you&apos;ll use <strong>DIDComm messaging</strong> — a
            secure, encrypted chat channel between your wallet and the service.
            Scan a QR code to connect, then follow the chatbot conversation to
            receive and present a credential.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <DemoSection
              title="Step A — Get a Credential"
              description="Connect to the Issuer Chatbot to receive a verifiable credential."
              steps={[
                "Tap \"Generate QR Code\" below",
                "Open Hologram Messaging and scan the QR code",
                "Follow the chatbot — it will ask for your details",
                "Your credential is stored in your wallet",
              ]}
              fetchInvitation={() =>
                fetchChatbotInvitation("/api/issuer-chatbot/invitation")
              }
              resultLabel="Connected! Follow the chat in Hologram."
            />

            <DemoSection
              title="Step B — Present Your Credential"
              description="Connect to the Verifier Chatbot and prove your identity."
              steps={[
                "Tap \"Generate QR Code\" below",
                "Scan the QR code with Hologram Messaging",
                "The verifier requests a proof — approve it in your wallet",
                "The verified attributes appear here automatically",
              ]}
              fetchInvitation={() => fetchVerifierChatbotSession()}
              pollResult={(sessionId) => pollVerifierChatbotResult(sessionId)}
              resultLabel="Credential Verified!"
            />
          </div>

          <div className="mt-6 rounded-xl bg-violet-50 border border-violet-200 p-4">
            <p className="text-sm text-violet-800">
              <strong>What happened?</strong> You created an encrypted DIDComm
              connection with each service. The issuer chatbot asked for your
              details and issued a signed credential. The verifier chatbot
              requested a proof — your wallet asked for your consent before
              sharing any data.
            </p>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Section 5 — Demo 2: Web Flow                                */}
        {/* ============================================================ */}
        <section id="section-5">
          <SectionHeading
            number={5}
            title="Demo 2: Web Flow"
            subtitle="Issue and verify credentials through web interfaces"
          />

          <p className="text-gray-600 mb-6 leading-relaxed">
            This demo uses <strong>Out-of-Band (OOB) invitations</strong> — the
            web page generates a one-time QR code. Scanning it starts a DIDComm
            exchange behind the scenes. For the verifier, once you approve the
            proof request, the presented attributes appear live on this page.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <DemoSection
              title="Step A — Issue via Web"
              description="Fill in the form on the Issuer Web, then scan the QR code to receive a credential."
              steps={[
                "Tap \"Open Issuer Web\" below",
                "Fill in the credential form and submit",
                "Scan the generated QR code with Hologram Messaging",
                "Accept the credential offer in your wallet",
              ]}
              externalUrl={config.issuerWebUrl}
            />

            <DemoSection
              title="Step B — Verify via Web"
              description="Present your credential and see the verified attributes appear live."
              steps={[
                "Tap \"Generate QR Code\" below",
                "Scan the QR code with Hologram Messaging",
                "Approve the proof request in your wallet",
                "Verified attributes appear here automatically",
              ]}
              fetchInvitation={() => fetchVerifierWebInvitation()}
              pollResult={(sessionId) => pollVerifierWebResult(sessionId)}
              resultLabel="Credential Verified!"
            />
          </div>

          <div className="mt-6 rounded-xl bg-purple-50 border border-purple-200 p-4">
            <p className="text-sm text-purple-800">
              <strong>What happened?</strong> The web verifier created a
              presentation request and encoded it as a QR code. Your wallet
              decrypted the request, asked for your consent, then sent a
              cryptographic proof. The verifier confirmed the credential&apos;s
              authenticity without ever contacting the issuer.
            </p>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Section 6 — What Just Happened? (Recap)                     */}
        {/* ============================================================ */}
        <section id="section-6">
          <SectionHeading
            number={6}
            title="What Just Happened?"
            subtitle="A summary of what you experienced"
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex gap-4">
              <CheckCircle2 className="w-6 h-6 text-violet-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-1">
                  Trust Established
                </p>
                <p className="text-sm text-gray-500">
                  You connected to services registered in a Trust Registry —
                  their authority to issue or verify was publicly verifiable.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex gap-4">
              <Lock className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-1">
                  Credential Received
                </p>
                <p className="text-sm text-gray-500">
                  You received a Verifiable Credential — a digitally signed
                  claim stored only on your device. No central database holds
                  it.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex gap-4">
              <Users className="w-6 h-6 text-purple-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-1">
                  Proof Presented
                </p>
                <p className="text-sm text-gray-500">
                  You presented your credential to a verifier who confirmed its
                  authenticity without calling the issuer.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex gap-4">
              <Zap className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-1">
                  Encrypted & Peer-to-Peer
                </p>
                <p className="text-sm text-gray-500">
                  All communication happened over DIDComm — encrypted,
                  peer-to-peer, no intermediaries.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 text-center text-sm text-gray-400">
        <p>
          Verana Playground &middot; Powered by{" "}
          <a
            href="https://verana.io"
            className="text-violet-500 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Verana Network
          </a>
        </p>
      </footer>
    </div>
  );
}
