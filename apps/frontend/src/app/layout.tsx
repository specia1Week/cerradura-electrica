import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Control de Acceso | Fase 0',
  description: 'Sistema de control de acceso y asistencia biométrico',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
