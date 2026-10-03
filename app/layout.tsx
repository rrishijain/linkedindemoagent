import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// DAYBREAK type pair — Plus Jakarta Sans carries the wordmark and every big
// numeral (friendly, geometric, great tabular figures); Inter carries all
// body/UI text for maximum readability. latin-ext is required for ₹ (U+20B9).
const display = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
});

const body = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "JARVIS — Personal Command Center",
  description: "A local command center for daily priorities, calendar, and marketing intelligence",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
