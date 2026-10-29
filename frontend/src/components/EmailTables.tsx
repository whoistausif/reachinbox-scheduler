import { formatDateTime } from '../lib/csv';
import { useEmails } from '../hooks/useEmails';
import type { EmailRow } from '../types';
import { StatusBadge } from './ui/Badge';
import { DataTable, type Column } from './ui/DataTable';

const emailCol: Column<EmailRow> = { header: 'Email', render: (r) => r.toEmail };
const subjectCol: Column<EmailRow> = { header: 'Subject', render: (r) => <span className="line-clamp-1">{r.subject}</span> };
const statusCol: Column<EmailRow> = { header: 'Status', render: (r) => <StatusBadge status={r.status} /> };

const scheduledColumns: Column<EmailRow>[] = [
  emailCol,
  subjectCol,
  { header: 'Scheduled time', render: (r) => formatDateTime(r.scheduledAt) },
  statusCol,
];

const sentColumns: Column<EmailRow>[] = [
  emailCol,
  subjectCol,
  { header: 'Sent time', render: (r) => formatDateTime(r.sentAt) },
  statusCol,
];

export function ScheduledEmails() {
  const { rows, loading, error } = useEmails('scheduled');
  return (
    <DataTable
      columns={scheduledColumns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error}
      emptyTitle="No scheduled emails"
      emptyHint="Click “Compose New Email” to schedule your first campaign."
    />
  );
}

export function SentEmails() {
  const { rows, loading, error } = useEmails('sent');
  return (
    <DataTable
      columns={sentColumns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error}
      emptyTitle="No sent emails yet"
      emptyHint="Emails appear here once they have been delivered."
    />
  );
}
