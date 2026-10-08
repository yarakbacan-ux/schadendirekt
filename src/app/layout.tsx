import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Schadendirekt',
  description: 'Unabhängige Plattform für nachvollziehbare Fahrzeughistorien.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
