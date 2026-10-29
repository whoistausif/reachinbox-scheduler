import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const base =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

function Wrapper({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}
export function Input({ label, hint, className = '', ...rest }: InputProps) {
  return (
    <Wrapper label={label} hint={hint}>
      <input className={`${base} ${className}`} {...rest} />
    </Wrapper>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}
export function Textarea({ label, hint, className = '', ...rest }: TextareaProps) {
  return (
    <Wrapper label={label} hint={hint}>
      <textarea className={`${base} ${className}`} {...rest} />
    </Wrapper>
  );
}
