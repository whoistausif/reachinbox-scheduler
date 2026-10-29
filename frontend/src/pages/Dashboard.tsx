import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ComposeModal } from '../components/ComposeModal';
import { ScheduledEmails, SentEmails } from '../components/EmailTables';
import { Header } from '../components/Header';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../hooks/useAuth';

type Tab = 'scheduled' | 'sent';
const TABS: { id: Tab; label: string }[] = [
  { id: 'scheduled', label: 'Scheduled Emails' },
  { id: 'sent', label: 'Sent Emails' },
];

export function Dashboard() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  // bump to remount the active table and refetch right after scheduling
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-emerald-600" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
        </div>

        <div className="rounded-xl bg-white ring-1 ring-slate-200">
          {tab === 'scheduled' ? <ScheduledEmails key={refreshKey} /> : <SentEmails key={refreshKey} />}
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onScheduled={() => { setTab('scheduled'); setRefreshKey((k) => k + 1); }} />
    </div>
  );
}
