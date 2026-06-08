import React, { useState } from 'react';
import { Cpu, LogIn } from 'lucide-react';
import { setLoggedIn, validateCredentials } from './auth';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    if (validateCredentials(username.trim(), password)) {
      setLoggedIn();
      onLogin();
      return;
    }

    setError('Invalid username or password.');
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-panel w-full max-w-[420px] p-8">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-primary p-3 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.2)] mb-4">
            <Cpu size={28} color="white" />
          </div>
          <h1 className="text-gradient-purple text-[1.75rem] font-extrabold mb-1">AURA WATCH AI</h1>
          <p className="text-[0.85rem] text-text-muted">Sign in to access the surveillance dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-[0.8rem] text-text-secondary">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[0.8rem] text-text-secondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-[0.8rem] text-danger bg-[rgba(244,63,94,0.1)] border border-[rgba(244,63,94,0.25)] rounded-lg py-2 px-3">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
            <LogIn size={16} />
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
