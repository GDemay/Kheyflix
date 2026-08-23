import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Kheyflix — Stories worth streaming',
  description: 'Discover original stories and stream legal open films on Kheyflix.',
  openGraph: {
    title: 'Kheyflix — Stories worth streaming',
    description: 'Discover original stories and stream legal open films on Kheyflix.',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'Kheyflix — Stories worth streaming' }],
  },
  twitter: { card: 'summary_large_image', title: 'Kheyflix — Stories worth streaming', description: 'Discover original stories and stream legal open films on Kheyflix.', images: ['/og.png'] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#08090b',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
