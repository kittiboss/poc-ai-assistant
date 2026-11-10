import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { AuthProvider } from '@/components/auth/auth-provider';
import { consoleConfigScript } from '@/lib/runtime-config';
import { AntdProvider } from '@/theme/antd-provider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Vendor Console', template: '%s · Vendor Console' },
  description: 'Credits, customer deployments and model pricing of the vendor platform.',
  icons: { icon: '/icon.svg' },
  // A back-office tool on the vendor's own machine.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
  themeColor: '#020617',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Render per request, so the settings below come from the running server, not from the build.
  await connection();
  return (
    <html lang="en">
      <head>
        {/* Where vendor-control and the sign-in service are (lib/runtime-config.ts). */}
        <script dangerouslySetInnerHTML={{ __html: consoleConfigScript() }} />
      </head>
      <body>
        {/* `layer` puts AntD styles in @layer antd, ordered in globals.css */}
        <AntdRegistry layer>
          <AntdProvider>
            <AuthProvider>{children}</AuthProvider>
          </AntdProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
