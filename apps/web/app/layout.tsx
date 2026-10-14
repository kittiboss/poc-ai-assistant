import type { Metadata } from 'next';
import { AuthProvider } from '../components/auth/auth-provider';
import 'highlight.js/styles/github-dark.css';
import './globals.css';

export const metadata: Metadata = { title: 'Enterprise AI', description: 'Self-hosted enterprise AI assistant POC' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><AuthProvider>{children}</AuthProvider></body></html>;
}

