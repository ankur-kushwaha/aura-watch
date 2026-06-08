import { useState } from 'react';
import App from './App.tsx';
import Login from './Login.tsx';
import { clearLoggedIn, isLoggedIn } from './auth.ts';

export default function Root() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => isLoggedIn());

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
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
