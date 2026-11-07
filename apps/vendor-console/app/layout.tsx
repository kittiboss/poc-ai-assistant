import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* `layer` puts AntD styles in @layer antd, ordered in globals.css */}
        <AntdRegistry layer>
          <AntdProvider>{children}</AntdProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
