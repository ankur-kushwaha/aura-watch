import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { register } from './api';

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await register(email.trim(), password, name.trim(), orgName.trim());
      navigate('/app/events', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <Link
        to="/login"
        className="absolute top-6 left-6 btn btn-secondary text-[0.85rem] py-2 px-3"
      >
        <ArrowLeft size={16} />
        Back
      </Link>
      <div className="glass-panel w-full max-w-[420px] p-8">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-primary p-3 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.2)] mb-4">
            <Building2 size={28} color="white" />
          </div>
          <h1 className="text-gradient-purple text-[1.75rem] font-extrabold mb-1">Create Organization</h1>
          <p className="text-[0.85rem] text-text-muted">Set up your workspace and admin account</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="orgName" className="text-[0.8rem] text-text-secondary">
              Organization name
            </label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Security"
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-[0.8rem] text-text-secondary">
              Your name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[0.8rem] text-text-secondary">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
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
            <Building2 size={16} />
            Create Account
          </button>
        </form>
      </div>
    </div>
  );
}
