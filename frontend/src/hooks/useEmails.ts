import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { EmailRow } from '../types';

/** Loads a tab's emails and polls so status changes (scheduled -> sent) show up live. */
export function useEmails(status: 'scheduled' | 'sent', pollMs = 5000) {
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listEmails(status);
      setRows(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { rows, total, loading, error, reload: load };
}
