import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verana Playground",
  description:
    "An interactive guide to Verifiable Trust — learn how credentials are issued, held, and verified.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
