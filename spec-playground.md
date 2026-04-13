# Verana Playground — Specification

An interactive single-page application that guides newcomers through the Verifiable Trust ecosystem. The playground lets users **obtain** and **present** verifiable credentials in real time, using the five demo services deployed in this repository.

## Goal

Provide an educational, hands-on experience for people unfamiliar with Verifiable Credentials, Decentralized Identifiers (DIDs), and Trust Registries. By the end of the playground, a user should understand:

1. What a **Verifiable Credential** is and why it matters
2. The roles of **Issuers** and **Verifiers** in a trust ecosystem
3. How an **Organization** establishes trust through a Trust Registry
4. How credentials are **issued**, **held**, and **presented** using the Hologram Messaging wallet

## Target Audience

- Developers exploring decentralized identity for the first time
- Product managers evaluating Verifiable Trust for their organization
- Students and researchers studying self-sovereign identity (SSI)

---

## Page Structure

### Section 1 — Introduction: What Is Verifiable Trust?

A brief, visual explanation of the core concepts:

- **Verifiable Credential (VC)** — A tamper-proof digital claim about a person or entity, issued by a trusted party
- **Decentralized Identifier (DID)** — A globally unique identifier that doesn't depend on a central authority
- **Trust Registry** — A public record that lists which organizations and services are authorized to issue or verify credentials
- **Ecosystem Governance** — Rules and roles that define who can participate and how trust is established

Include a simple diagram showing the triangle of trust: **Issuer → Holder → Verifier**, anchored by a Trust Registry.

### Section 2 — The Demo Ecosystem

Explain the five services and their roles:

| Service | Role | What It Does |
|---------|------|--------------|
| **Organization** | Trust anchor | Registers with the Ecosystem, creates a Trust Registry and credential schema |
| **Issuer Chatbot** | Credential issuer | Issues credentials to users via a conversational DIDComm chatbot |
| **Issuer Web** | Credential issuer | Issues credentials to users via a web form and QR code |
| **Verifier Chatbot** | Credential verifier | Requests and verifies credential presentations via DIDComm chatbot |
| **Verifier Web** | Credential verifier | Requests and verifies credential presentations via a web page and QR code |

Highlight that all five services form a **single ecosystem**: the Organization is the parent, and the four child services inherit trust from it.

### Section 3 — Getting Started: Install Hologram Messaging

Before running any demo, the user needs the **Hologram Messaging** wallet app:

- Show download links / QR codes for iOS and Android
- Brief explanation: Hologram Messaging is a mobile wallet that stores your credentials and communicates with services using DIDComm — an encrypted, peer-to-peer messaging protocol
- Visual: screenshot or mockup of the app with a credential in it

### Section 4 — Demo 1: Chatbot Flow (Issue + Present)

**Objective:** Obtain a credential from the Issuer Chatbot, then present it to the Verifier Chatbot.

#### Step 1 — Connect to the Issuer Chatbot

- Display the Issuer Chatbot's QR code (fetched live from the service)
- Instruction: "Open Hologram Messaging → Scan this QR code to start a conversation with the Issuer"
- Explain: scanning creates a secure, encrypted DIDComm connection between your wallet and the issuer

#### Step 2 — Receive Your Credential

- Explain the chatbot conversation flow: the issuer asks for your details, then issues a credential
- Visual: show the expected chat flow (screenshots or a step-by-step illustration)
- Explain: the credential is now stored locally in your wallet — no central database holds it

#### Step 3 — Connect to the Verifier Chatbot

- Display the Verifier Chatbot's QR code
- Instruction: "Scan this QR code to connect to the Verifier"

#### Step 4 — Present Your Credential

- The verifier chatbot requests a proof — your wallet asks for your consent
- Explain: you choose which attributes to share; the verifier cryptographically validates them without contacting the issuer
- Show a success/failure state on the playground page

### Section 5 — Demo 2: Web Flow (Issue + Present)

**Objective:** Obtain a credential from the Issuer Web, then present it to the Verifier Web.

#### Step 1 — Issue via Web Form

- Embed or link to the Issuer Web service
- The issuer web shows a form + QR code; user scans the QR to receive the credential
- Explain: unlike the chatbot, this flow starts on a web page — the QR code creates an out-of-band invitation

#### Step 2 — Present via Web Page

- Embed or link to the Verifier Web service
- The verifier web shows a QR code; user scans it, approves the proof request in Hologram
- **Live result:** once the credential is verified, the playground page replaces the QR code with the presented attributes (e.g., name, role, organization)
- Explain: this demonstrates real-time verification — the verifier never sees raw data until the holder consents

### Section 6 — What Just Happened? (Recap)

A summary panel that ties everything together:

- You established **trust** by connecting to services registered in a Trust Registry
- You received a **Verifiable Credential** — a digitally signed claim stored only on your device
- You **presented** that credential to a verifier who confirmed its authenticity without calling the issuer
- All communication happened over **DIDComm** — encrypted, peer-to-peer, no intermediaries

---

## Technical Notes

- **Framework:** Next.js + TailwindCSS
- **Deployment:** Deployed as a separate container at `<vsname>.demos.<network>.verana.network`
- **API Integration:** Fetches QR codes and invitation URLs from the issuer/verifier services at runtime
- **No backend required:** The playground is purely a frontend that orchestrates existing service APIs
