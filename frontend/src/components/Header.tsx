import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/Button';
import { SlackConnect } from './SlackConnect';

export function Header() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="text-lg font-bold text-emerald-700">ReachInbox</div>
        <div className="flex items-center gap-4">
          <SlackConnect />
          <div className="flex items-center gap-3">
            {user.avatar ? (
              <img src={user.avatar} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-700">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-slate-500">{user.email}</div>
            </div>
          </div>
          <Button variant="secondary" onClick={logout}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
