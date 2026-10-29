import { Navigate } from 'react-router-dom';
import { GOOGLE_LOGIN_URL } from '../api/client';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../hooks/useAuth';

export function Login() {
  const { user, loading } = useAuth();
  const error = new URLSearchParams(window.location.search).get('error');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-emerald-600" />
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-emerald-700">ReachInbox</h1>
        <p className="mt-2 text-sm text-slate-500">Schedule and track outreach emails at scale.</p>
        {error && <p className="mt-4 rounded-lg bg-red-50 p-2 text-sm text-red-600">Sign-in failed. Please try again.</p>}
        {/* Real Google OAuth: full-page redirect through the backend */}
        <Button className="mt-6 w-full" onClick={() => (window.location.href = GOOGLE_LOGIN_URL)}>
          Continue with Google
        </Button>
      </div>
    </div>
  );
}
