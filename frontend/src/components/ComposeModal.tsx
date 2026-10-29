import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api/client';
import { extractEmails, toLocalInputValue } from '../lib/csv';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Field';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

const defaultStart = () => toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000));

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [startTime, setStartTime] = useState(defaultStart);
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSubject('');
    setBody('');
    setRecipients([]);
    setFileName('');
    setStartTime(defaultStart());
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setRecipients(extractEmails(await file.text()));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (recipients.length === 0) return toast('error', 'Upload a lead file containing at least one email address');
    setSubmitting(true);
    try {
      const res = await api.schedule({
        subject,
        body,
        recipients,
        startTime: new Date(startTime).toISOString(),
        delayBetweenMs: Math.round(delaySeconds * 1000),
        hourlyLimit,
      });
      toast('success', `Scheduled ${res.count} emails`);
      reset();
      onScheduled();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title="Compose New Email" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <Textarea label="Body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required />

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Leads (CSV or text file)</span>
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={onFile}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-emerald-700"
          />
          {fileName && (
            <p className="mt-1 text-sm text-slate-600">
              <strong>{recipients.length}</strong> email address{recipients.length === 1 ? '' : 'es'} detected in {fileName}
            </p>
          )}
        </div>

        <Input
          label="Start time"
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Delay between emails (seconds)"
            type="number"
            min={0}
            step={0.5}
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(Number(e.target.value))}
          />
          <Input
            label="Hourly limit (per sender)"
            type="number"
            min={1}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
            hint="Capped by the server's configured maximum"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
