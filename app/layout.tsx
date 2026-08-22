import type { Metadata } from 'next';
import './globals.css';

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
