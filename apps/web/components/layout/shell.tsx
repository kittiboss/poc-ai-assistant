"use client";
import Link from "next/link";
import {
  BarChart3,
  Bot,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import { Button, cn } from "../ui/primitives";
import { userRoles } from "../../lib/auth-roles";

export function Shell({
  children,
  active,
  sidebar,
}: {
  children: React.ReactNode;
  active: "chat" | "usage" | "admin" | "settings" | "workspace";
  sidebar?: React.ReactNode;
}) {
  const auth = useAuth();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const enabled = localStorage.getItem("theme") === "dark";
    setDark(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);
  const roles = userRoles(auth.user);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5 dark:border-slate-800">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
            <Bot size={20} />
          </span>
          <div>
            <div className="font-semibold">Enterprise AI</div>
            <div className="text-[11px] text-slate-500">LOCAL POC</div>
          </div>
        </div>
        {sidebar || <div className="flex-1" />}
        <nav className="space-y-1 border-t border-slate-100 p-3 dark:border-slate-800">
          <Nav href="/" icon={<Bot size={17} />} selected={active === "chat"}>
            Chat
          </Nav>
          <Nav
            href="/workspace"
            icon={<Bot size={17} />}
            selected={active === "workspace"}
          >
            Projects & tools
          </Nav>
          <Nav
            href="/usage"
            icon={<BarChart3 size={17} />}
            selected={active === "usage"}
          >
            Usage dashboard
          </Nav>
          {roles.includes("ADMIN") && (
            <Nav
              href="/admin"
              icon={<ShieldCheck size={17} />}
              selected={active === "admin"}
            >
              Admin console
            </Nav>
          )}
          <Nav
            href="/settings"
            icon={<Settings size={17} />}
            selected={active === "settings"}
          >
            Settings
          </Nav>
          <button
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}{" "}
            {dark ? "Light theme" : "Dark theme"}
          </button>
          <button
            onClick={() => auth.signoutRedirect()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <LogOut size={17} /> Logout
          </button>
        </nav>
        <div className="px-5 pb-4 text-xs text-slate-500">
          Signed in as {auth.user?.profile.preferred_username as string}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
function Nav({
  href,
  icon,
  selected,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
        selected
          ? "bg-violet-50 font-medium text-brand dark:bg-violet-950/60"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
