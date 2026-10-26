'use client';
import { App, Button, Checkbox, Dropdown, Input, Tooltip, type MenuProps } from 'antd';
import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ConversationChange, ConversationSummary } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';
import { useConversations, useDeleteConversation, useUpdateConversation } from './chat-queries';
import { PromptDialog } from './prompt-dialog';

/** What the chat menu needs, from the list (sidebar) or the open chat (header). */
export type ChatItem = Pick<ConversationSummary, 'id' | 'title' | 'pinned' | 'archived'>;

/** The chat list as the sidebar shows it; its search and "Show archived" live in the UI store. */
export function useChatList() {
  const search = useUIStore((state) => state.conversationSearch);
  const archived = useUIStore((state) => state.showArchived);
  // Search runs on the server (titles and message content), so it waits for a pause in typing.
  const [searchQuery, setSearchQuery] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  return { conversations: useConversations({ search: searchQuery, archived }), searchQuery, archived };
}

/** A chat's menu (pin, rename, archive, delete); render `dialog` for renaming. */
export function useChatMenu() {
  const { id: activeId } = useParams<{ id?: string }>();
  const router = useRouter();
  const t = useTranslations('chat');
  const { message: toast, modal } = App.useApp();
  const updateConversation = useUpdateConversation();
  const deleteConversation = useDeleteConversation();
  const [renaming, setRenaming] = useState<ChatItem | null>(null);
  const reportError = (cause: unknown) => toast.error((cause as Error).message);

  const update = async (item: ChatItem, change: ConversationChange, done?: string) => {
    try {
      await updateConversation.mutateAsync({ id: item.id, change });
      if (done) toast.success(done);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    }
  };
  const confirmDelete = (item: ChatItem) =>
    modal.confirm({
      title: t('deleteTitle'),
      content: t('deleteConfirm', { title: item.title }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteConversation.mutateAsync(item.id);
          toast.success(t('deleted'));
          if (item.id === activeId) router.push('/');
        } catch (cause) {
          reportError(cause);
        }
      },
    });

  const chatMenu = (item: ChatItem): MenuProps['items'] => [
    {
      key: 'pin',
      icon: item.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      label: item.pinned ? t('unpin') : t('pin'),
      onClick: () => void update(item, { pinned: !item.pinned }),
    },
    {
      key: 'rename',
      icon: <Pencil size={14} />,
      label: t('rename'),
      onClick: () => setRenaming(item),
    },
    {
      key: 'archive',
      icon: item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
      label: item.archived ? t('restore') : t('archive'),
      onClick: () =>
        void update(item, { archived: !item.archived }, item.archived ? t('restoredToast') : t('archivedToast')),
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <Trash2 size={14} />,
      label: t('delete'),
      danger: true,
      onClick: () => confirmDelete(item),
    },
  ];

  const dialog = renaming && (
    <PromptDialog
      key={renaming.id}
      title={t('renameTitle')}
      label={t('renamePrompt')}
      initialValue={renaming.title}
      requiredMessage={t('titleRequired')}
      maxLength={120}
      saving={updateConversation.isPending}
      onSubmit={async (value) => {
        if (await update(renaming, { title: value }, t('renamed'))) setRenaming(null);
      }}
      onClose={() => setRenaming(null)}
    />
  );

  return { chatMenu, dialog };
}

/** Leaving the sidebar for a chat closes the phone's menu drawer and clears the last chat error. */
function useLeaveSidebar() {
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);
  const setChatError = useUIStore((state) => state.setChatError);
  return () => {
    setMobileNavOpen(false);
    setChatError('');
  };
}

/** Opens a new chat from any page. The chat itself is created with the first message, so no empty chats pile up. */
export function NewChatButton({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const t = useTranslations('chat');
  const leaveSidebar = useLeaveSidebar();
  const newChat = () => {
    leaveSidebar();
    router.push('/');
  };
  return collapsed ? (
    <Tooltip title={t('newChat')} placement="right">
      <Button type="primary" size="large" icon={<Plus size={17} />} aria-label={t('newChat')} onClick={newChat} />
    </Tooltip>
  ) : (
    <Button type="primary" size="large" block icon={<Plus size={17} />} onClick={newChat}>
      {t('newChat')}
    </Button>
  );
}

/** New chat, the search and the chat list: the sidebar of every page. */
export function ChatSidebar() {
  const { id: activeId } = useParams<{ id?: string }>();
  const t = useTranslations('chat');
  const search = useUIStore((state) => state.conversationSearch);
  const setSearch = useUIStore((state) => state.setConversationSearch);
  const setArchived = useUIStore((state) => state.setShowArchived);
  const { conversations, searchQuery, archived } = useChatList();
  const { chatMenu, dialog } = useChatMenu();
  const leaveSidebar = useLeaveSidebar();
  const list = useRef<HTMLDivElement>(null);
  const loaded = conversations.data !== undefined;

  // Each page has its own sidebar, so the list starts at the top: bring the open chat into view.
  // Only the list scrolls; scrollIntoView would also shift the sidebar while it is widening.
  useEffect(() => {
    const row = list.current?.querySelector('[aria-current="page"]');
    if (!list.current || !row) return;
    const view = list.current.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (box.top < view.top) list.current.scrollTop -= view.top - box.top;
    else if (box.bottom > view.bottom) list.current.scrollTop += box.bottom - view.bottom;
  }, [activeId, loaded]);

  return (
    <>
      <div className="space-y-3 p-3">
        <NewChatButton />
        <Input
          size="large"
          variant="filled"
          allowClear
          aria-label={t('searchLabel')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchContent')}
          prefix={<Search size={16} className="text-fg-tertiary" />}
        />
        <Checkbox checked={archived} onChange={(event) => setArchived(event.target.checked)} className="text-xs">
          {t('showArchived')}
        </Checkbox>
      </div>
      <div ref={list} className="flex-1 space-y-1 overflow-auto px-2 pb-3">
        {conversations.data?.map((item) => (
          <div
            key={item.id}
            className={cn(
              'group flex items-center rounded-brand pr-1',
              activeId === item.id ? 'bg-primary-soft' : 'hover:bg-fill-quaternary',
            )}
          >
            <Link
              href={`/c/${item.id}`}
              onClick={leaveSidebar}
              aria-current={activeId === item.id ? 'page' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm text-fg"
            >
              {item.pinned ? (
                <Pin size={15} className="shrink-0 text-primary" aria-label={t('pinned')} />
              ) : (
                <MessageSquare size={15} className="shrink-0 text-fg-tertiary" />
              )}
              <span className="truncate">{item.title}</span>
            </Link>
            <Dropdown menu={{ items: chatMenu(item) }} trigger={['click']} placement="bottomRight">
              <Button
                type="text"
                size="small"
                title={t('chatActions')}
                aria-label={t('chatActions')}
                icon={<MoreHorizontal size={15} />}
                // Stays visible while its menu is open.
                className="hidden text-fg-tertiary group-focus-within:inline-flex group-hover:inline-flex pointer-coarse:inline-flex [&.ant-dropdown-open]:inline-flex"
              />
            </Dropdown>
          </div>
        ))}
        {conversations.data?.length === 0 && (searchQuery || archived) && (
          <p className="px-3 py-2 text-xs text-fg-tertiary">{searchQuery ? t('noMatches') : t('noArchived')}</p>
        )}
      </div>
      {dialog}
    </>
  );
}
