import { useState } from 'react';
import App from './App.tsx';
import Landing from './Landing.tsx';
import Login from './Login.tsx';
import { clearLoggedIn, isLoggedIn } from './auth.ts';

type AuthView = 'landing' | 'login';

export default function Root() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => isLoggedIn());
  const [authView, setAuthView] = useState<AuthView>('landing');

  if (!isAuthenticated) {
    if (authView === 'landing') {
      return <Landing onSignIn={() => setAuthView('login')} />;
    }
    return (
      <Login
        onLogin={() => setIsAuthenticated(true)}
        onBack={() => setAuthView('landing')}
      />
    );
  }

  return (
    <App
      onLogout={() => {
        clearLoggedIn();
        setIsAuthenticated(false);
      }}
    />
  );
}
