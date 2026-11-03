import { ComponentType } from 'react';

import { AdminPage } from './pages/AdminPage';
import { AdminStorePage, storeIdFromPath } from './pages/AdminStorePage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { SignupPage } from './pages/SignupPage';

// A handful of pages, so the path decides which one to show.
// Anything not listed, and not a store page, falls back to signup.
const PAGES: Record<string, ComponentType> = {
  '/admin': AdminPage,
  '/login': LoginPage,
  '/dashboard': DashboardPage,
  '/setup': SetupPage,
};

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  // One page per store under /admin/stores/:id.
  const Page = PAGES[path] ?? (storeIdFromPath(path) !== null ? AdminStorePage : SignupPage);
  return <Page />;
}
