import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import App from './App.tsx';
import Admin from './Admin.tsx';
import Landing from './Landing.tsx';
import Login from './Login.tsx';
import Register from './Register.tsx';
import BlogList from './BlogList.tsx';
import BlogPost from './BlogPost.tsx';
import About from './About.tsx';
import Tutorials from './Tutorials.tsx';
import ContactPage from './ContactPage.tsx';
import Privacy from './Privacy.tsx';
import { isLoggedIn } from './auth.ts';
import ScrollToTop from './components/ScrollToTop.tsx';
import { useEffect } from 'react';
import posthog from 'posthog-js';

function PublicRoute({ children }: { children: React.ReactNode }) {
  if (isLoggedIn()) {
    return <Navigate to="/app/live" replace />;
  }
  return children;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function PostHogPageviewTracker() {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.VITE_POSTHOG_KEY) {
      posthog.capture('$pageview');
    }
  }, [location]);

  return null;
}

export default function Root() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <PostHogPageviewTracker />
      <Routes>
        <Route
          path="/"
          element={
            <PublicRoute>
              <Landing />
            </PublicRoute>
          }
        />
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <Register />
            </PublicRoute>
          }
        />
        <Route
          path="/blog"
          element={<BlogList />}
        />
        <Route
          path="/blog/:slug"
          element={<BlogPost />}
        />
        <Route
          path="/about"
          element={<About />}
        />
        <Route path="/tutorials" element={<Navigate to="/tutorials/quick-start" replace />} />
        <Route path="/tutorials/:topicId" element={<Tutorials />} />
        <Route
          path="/contact"
          element={<ContactPage />}
        />
        <Route
          path="/privacy"
          element={<Privacy />}
        />
        <Route
          path="/app/*"
          element={
            <ProtectedRoute>
              <App />
            </ProtectedRoute>
          }
        />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
