import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KitchenERP",
  description: "Kitchen operations — procurement, production, inventory, costing and approvals.",
  // Week 12 PWA. The manifest (app/manifest.ts) is linked by Next itself;
  // iOS still reads its own tags for Add to Home Screen.
  applicationName: "KitchenERP",
  appleWebApp: { capable: true, title: "KitchenERP", statusBarStyle: "default" },
  // Declared here, not by Next's app/icon.png convention — a metadata `icons`
  // object overrides that convention, so both live in public/icons.
  icons: {
    icon:  [{ url: "/icons/icon-64.png", type: "image/png", sizes: "64x64" }],
    apple: "/icons/apple-touch-icon.png",
  },
  // Long numbers (quantities, lot numbers) are not phone numbers.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // The phone's status bar, white like the top bar — see app/manifest.ts.
  themeColor: "#ffffff",
  // Use the whole screen, under the home bar and beside a notch, as an app
  // does. Everything that touches an edge pads itself with
  // env(safe-area-inset-*) — AppShell, Sidebar, BottomSheet, the receipt bar.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
