import { Shell } from '@/components/layout/shell';

/** Every signed-in page: the sidebar and the page header. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
