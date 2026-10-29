import type { EmailListResponse, ScheduleRequest, ScheduleResponse, SlackStatus, User } from '../types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<User>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  listEmails: (status: 'scheduled' | 'sent') => request<EmailListResponse>(`/emails?status=${status}&pageSize=100`),
  schedule: (body: ScheduleRequest) =>
    request<ScheduleResponse>('/emails/schedule', { method: 'POST', body: JSON.stringify(body) }),
  slackStatus: () => request<SlackStatus>('/slack/status'),
  slackDisconnect: () => request<{ ok: boolean }>('/slack', { method: 'DELETE' }),
  slackTest: () => request<{ sent: boolean }>('/slack/test', { method: 'POST' }),
};

// Full-page navigations (real OAuth redirects)
export const GOOGLE_LOGIN_URL = '/api/auth/google';
export const SLACK_CONNECT_URL = '/api/slack/connect';
