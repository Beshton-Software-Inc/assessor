import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import { LeadProvider } from "@/components/lead/LeadProvider";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LEAD — your college-readiness check",
  description:
    "A 15-minute voice-and-video check that shows where you stand and how to stand out.",
};

/**
 * Layout for the public LEAD funnel. Wraps every /lead/* page in:
 *   - the teal/coral design tokens (.lead-root)
 *   - the LeadProvider (shared run state + the page-4 recorder hook,
 *     so an in-flight upload survives navigating from /lead/record →
 *     /lead/register).
 *
 * Importantly, no auth gate here — pages 1–4 are anonymous; sign-in
 * happens on page 5 and is then linked to the run via /api/lead/runs/:id/claim.
 */
export default function LeadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`lead-root ${hanken.variable} ${bricolage.variable}`}>
      <LeadProvider>{children}</LeadProvider>
    </div>
  );
}
