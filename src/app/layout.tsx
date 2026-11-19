import type { Metadata, Viewport } from "next";
import { Inter_Tight, Playfair_Display, Geist, Plus_Jakarta_Sans, Onest, DM_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const onest = Onest({
  subsets: ["latin"],
  variable: "--font-onest",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair-display",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111c19",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "TPE | Institutional Engine",
  description: "The Pakistan Edit Institutional Content Engine v2027",
  icons: {
    icon: [
      { url: '/assets/logos/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/assets/logos/icon.svg',
  },
  openGraph: {
    title: "The Pakistan Edit",
    description: "Institutional Content Engine v2027",
    images: ['/og-image.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "The Pakistan Edit",
    description: "Institutional Content Engine v2027",
    images: ['/og-image.png'],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${interTight.variable} ${playfairDisplay.variable} ${geistSans.variable} ${plusJakarta.variable} ${onest.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <body className={`${interTight.className} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
