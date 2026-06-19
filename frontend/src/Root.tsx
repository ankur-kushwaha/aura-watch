import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.tsx';
import Admin from './Admin.tsx';
import Landing from './Landing.tsx';
import Login from './Login.tsx';
import Register from './Register.tsx';
import BlogList from './BlogList.tsx';
import BlogPost from './BlogPost.tsx';
import About from './About.tsx';
import ContactPage from './ContactPage.tsx';
import Privacy from './Privacy.tsx';
import { isLoggedIn } from './auth.ts';
import ScrollToTop from './components/ScrollToTop.tsx';

function PublicRoute({ children }: { children: React.ReactNode }) {
  if (isLoggedIn()) {
    return <Navigate to="/app/events" replace />;
  }
  return children;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function Root() {
  return (
    <BrowserRouter>
      <ScrollToTop />
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
