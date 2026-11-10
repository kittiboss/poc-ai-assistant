'use client';

import { Avatar, Dropdown } from 'antd';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useAuth } from 'react-oidc-context';

/** Who is signed in, at the bottom of the sidebar, with Sign out. */
export function AccountMenu() {
  const auth = useAuth();
  const profile = auth.user?.profile;
  const username = profile?.preferred_username ?? profile?.sub ?? '';
  const name = profile?.name || username;
  const detail = profile?.email ?? username;

  return (
    <Dropdown
      trigger={['click']}
      placement="topLeft"
      // As wide as the button (the sidebar less its padding).
      classNames={{ root: 'min-w-[13rem]' }}
      menu={{
        items: [
          // In full, as the button may cut them short.
          {
            key: 'account',
            type: 'group',
            label: (
              <>
                <div className="truncate font-semibold text-fg">{name}</div>
                <div className="truncate">{detail}</div>
              </>
            ),
          },
          { type: 'divider' },
          {
            key: 'sign-out',
            icon: <LogOut size={16} />,
            label: 'Sign out',
            onClick: () => void auth.signoutRedirect(),
          },
        ],
      }}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 rounded-brand px-2 py-1.5 text-left transition hover:bg-fill-tertiary [&.ant-dropdown-open]:bg-fill-tertiary"
      >
        {/* No profile pictures, so the avatar is the name's first letter. */}
        <Avatar aria-hidden className="shrink-0 bg-primary font-semibold">
          {name.charAt(0).toUpperCase()}
        </Avatar>
        <span className="sr-only">Account menu,</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-xs text-fg-secondary">{detail}</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
      </button>
    </Dropdown>
  );
}
