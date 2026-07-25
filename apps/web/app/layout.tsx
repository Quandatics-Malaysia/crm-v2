import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "CRM",
  description: "Lightweight multitenant CRM",
};

// No-FOUC preference init (theme + text size) lives in public/prefs-init.js:
// src-based beforeInteractive scripts are hoisted into the initial HTML;
// inline ones are not (they ride the RSC payload and React then errors with
// "Encountered a script tag while rendering").

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col">
        <Script src="/prefs-init.js" strategy="beforeInteractive" />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
