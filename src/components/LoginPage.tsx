import { useState } from 'react';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import logoImg from '../assets/images/anna_yael_logo_1780130406427.png';

interface LoginPageProps {
  onLogin: () => void;
}

const VALID_USERS = [
  { username: import.meta.env.VITE_AUTH_USERNAME || 'admin', password: import.meta.env.VITE_AUTH_PASSWORD || '1234' },
];

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    setTimeout(() => {
      const isValid = VALID_USERS.some(
        u => u.username === username.trim().toLowerCase() && u.password === password
      );

      if (isValid) {
        localStorage.setItem('cp_auth', 'true');
        onLogin();
      } else {
        setError('שם משתמש או סיסמה שגויים');
      }
      setIsLoading(false);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-cp-cream flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo & Brand */}
        <div className="text-center mb-8">
          <img
            src={logoImg}
            alt="Connection Point Logo"
            className="w-20 h-20 rounded-full border border-cp-line object-cover shadow-lg mx-auto mb-4"
          />
          <h1 className="text-2xl font-serif font-semibold text-cp-clay">Connection Point</h1>
          <p className="text-xs text-cp-ink-3 uppercase tracking-widest mt-1">
            אנה ויעל | נקודת חיבור
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-cp-paper border border-cp-line rounded-2xl p-6 shadow-sm flex flex-col gap-4" dir="rtl">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-xs font-semibold text-cp-ink-2">שם משתמש</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder=""
              autoComplete="username"
              className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2.5 text-sm text-cp-ink focus:outline-none focus:border-cp-clay placeholder:text-cp-ink-3/65 transition"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-semibold text-cp-ink-2">סיסמה</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                autoComplete="current-password"
                className="w-full bg-cp-bone border border-cp-line rounded-lg px-3 py-2.5 text-sm text-cp-ink focus:outline-none focus:border-cp-clay transition pl-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cp-ink-3 hover:text-cp-clay transition cursor-pointer"
                aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-cp-clay text-center font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-2.5 px-4 rounded-full transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer shadow-md mt-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            <span>כניסה</span>
          </button>
        </form>
      </div>
    </div>
  );
}
