import { useCallback, useEffect, useState } from 'react';
import { api, SLACK_CONNECT_URL } from '../api/client';
import type { SlackStatus } from '../types';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';

export function SlackConnect() {
  const toast = useToast();
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => api.slackStatus().then(setStatus).catch(() => setStatus(null)), []);

  useEffect(() => {
    refresh();
    // Surface the result of the OAuth round-trip, then clean the URL.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('slack');
    if (result) {
      if (result === 'connected') toast('success', 'Slack connected');
      else toast('error', result === 'denied' ? 'Slack connection was cancelled' : 'Slack connection failed');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refresh, toast]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      await refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  if (!status.connected) {
    // Real OAuth: full-page navigation to the backend, which redirects to Slack.
    return (
      <Button variant="secondary" onClick={() => (window.location.href = SLACK_CONNECT_URL)}>
        Connect Slack
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        Slack{status.channel ? ` ${status.channel}` : ''}
      </span>
      <Button
        variant="ghost"
        loading={busy}
        onClick={() => api.slackTest().then(() => toast('success', 'Test message sent')).catch((e) => toast('error', e.message))}
      >
        Test
      </Button>
      <Button variant="danger" loading={busy} onClick={() => run(api.slackDisconnect, 'Slack disconnected')}>
        Disconnect
      </Button>
    </div>
  );
}
