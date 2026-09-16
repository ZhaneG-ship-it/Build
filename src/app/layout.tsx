import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Clarity — AI Business Intelligence Platform',
    template: '%s · Clarity',
  },
  description:
    'Understand how your business works, where it loses time and money, and where AI could realistically help. Assessment, opportunity analysis, roadmap and implementation in one platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
