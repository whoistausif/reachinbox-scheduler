export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface EmailRow {
  id: string;
  toEmail: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  error: string | null;
  previewUrl: string | null;
}

export interface EmailListResponse {
  items: EmailRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScheduleRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string; // ISO
  delayBetweenMs: number;
  hourlyLimit: number;
}

export interface ScheduleResponse {
  batchId: string;
  count: number;
  hourlyLimit: number;
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
  channel: string | null;
}
