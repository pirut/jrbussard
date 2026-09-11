import React from 'react';
import { usePaginatedQuery, useMutation } from 'convex/react';
import { Bell, ArrowRight, MessageCircle } from 'lucide-react';
import { prayerApi } from './data';
import { Avatar, Button, Empty, Loading, relativeTime } from './ui';

export function Updates({ onOpen }) {
  const { results, status, loadMore } = usePaginatedQuery(prayerApi.updates, {}, { initialNumItems: 20 });
  return <main className="tg-activity"><div className="tg-section-heading"><h1>The story continues.</h1><p>New updates from the people you’re praying with.</p></div><section className="tg-activity-list">{results.map(entry => <button className="tg-activity-row" key={entry._id} onClick={() => onOpen(entry.requestId)}><Avatar name={entry.authorName} /><span><small>{entry.authorName} · {relativeTime(entry.createdAt)}</small><h2>{entry.requestTitle}</h2><p>{entry.body}</p><span className="tg-activity-link">Read the story<ArrowRight size={15} /></span></span><MessageCircle size={19} /></button>)}{status === 'LoadingFirstPage' && <Loading />}{status === 'Exhausted' && !results.length && <Empty title="Good things are worth sharing.">When someone posts an update to their request, you’ll find it here.</Empty>}{status === 'CanLoadMore' && <Button variant="quiet" onClick={() => loadMore(20)}>Load more updates</Button>}</section></main>;
}
export function Notifications({ onOpen, onCheckIn, toast }) {
  const { results, status, loadMore } = usePaginatedQuery(prayerApi.notifications, {}, { initialNumItems: 20 }); const markRead = useMutation(prayerApi.markRead);
  return <main className="tg-activity"><div className="tg-section-heading"><h1>A little closer.</h1><p>Updates on requests you follow and invitations to check in.</p></div><section className="tg-activity-list">{results.map(item => <button className={`tg-notification ${!item.readAt ? 'is-unread' : ''}`} key={item._id} onClick={async () => { try { await markRead({ notificationId: item._id }); if (item.requestId) onOpen(item.requestId); else onCheckIn(item.checkInId); } catch { toast('That notification couldn’t be opened. Please try again.'); } }}><span className="tg-notification-icon"><Bell size={20} /></span><span><strong>{item.title}</strong><small>{relativeTime(item.createdAt)}</small></span><ArrowRight size={18} /></button>)}{status === 'LoadingFirstPage' && <Loading />}{status === 'Exhausted' && !results.length && <Empty title="You’re all caught up.">Follow a prayer request to hear how things are going.</Empty>}{status === 'CanLoadMore' && <Button variant="quiet" onClick={() => loadMore(20)}>Load more notifications</Button>}</section></main>;
}
