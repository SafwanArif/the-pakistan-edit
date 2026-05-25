import type { Metadata } from "next";
import { Inter_Tight, Playfair_Display, Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
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

export const metadata: Metadata = {
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
    <html lang="en" className={`${interTight.variable} ${playfairDisplay.variable} ${geistSans.variable}`}>
      <body className={`${interTight.className} antialiased`}>
        {children}
      </body>
    </html>
  );
}
