'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'
import type { NotificationDto } from '@/services/notification.service'

/** Fire-and-reload: the push from the server refreshes other tabs; this one reloads itself. */
async function markRead(body: { id: string } | { all: true }, reload: () => Promise<void>) {
  await fetch('/api/notifications/read', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  await reload()
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

export function NotificationBell() {
  const { data, reload } = useNotifications()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Same click-outside behaviour as the user menu beside it.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const unread = data?.unreadCount ?? 0

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-800">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead({ all: true }, reload)}
                className="text-xs font-medium text-orange-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {!data ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Loading…</p>
          ) : data.notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No notifications yet</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto">
              {data.notifications.map(notification => (
                <li key={notification.id}>
                  <NotificationItem
                    notification={notification}
                    onOpen={() => {
                      setOpen(false)
                      if (!notification.read) void markRead({ id: notification.id }, reload)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Opening an item marks it read; one without a page is a button that only does that. */
function NotificationItem({ notification, onOpen }: { notification: NotificationDto; onOpen: () => void }) {
  const className = `block w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${notification.read ? '' : 'bg-orange-50/60'}`
  const content = (
    <>
      <p className={`flex items-start gap-2 text-sm ${notification.read ? 'text-gray-600' : 'font-semibold text-gray-800'}`}>
        {!notification.read && <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-orange-500" aria-label="Unread" />}
        <span>{notification.title}</span>
      </p>
      {notification.body && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{notification.body}</p>}
      <p className="mt-1 text-xs text-gray-400">{formatWhen(notification.createdAt)}</p>
    </>
  )

  return notification.href ? (
    <Link href={notification.href} onClick={onOpen} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  )
}
