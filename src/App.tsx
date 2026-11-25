import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Globe,
  Server,
  Activity,
  FileSpreadsheet,
  Receipt,
  CreditCard,
  BarChart3,
  MessageSquare,
  Settings,
  Search,
  Plus,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { apiRequest, setAuthToken, setUnauthorizedHandler } from './lib/api';
import { AuthUserDTO } from '../shared/types';
import { ToastProvider, useToast } from './components/Toast';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { DomainsPage } from './pages/DomainsPage';
import { ServicesPage } from './pages/ServicesPage';
import { EstimatesPage } from './pages/EstimatesPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { PublicPortalPage } from './pages/PublicPortalPage';
import { PublicStatusPage } from './pages/PublicStatusPage';
import { SettingsPage } from './pages/SettingsPage';
import { MessagesPage } from './pages/MessagesPage';
import { UptimePage } from './pages/UptimePage';

type NavKey =
  | 'dashboard'
  | 'clients'
  | 'domains'
  | 'services'
  | 'uptime'
  | 'estimates'
  | 'invoices'
  | 'payments'
  | 'reports'
  | 'messages'
  | 'settings';

const NAV_ITEMS: Array<{ key: NavKey; label: string; icon: any; phase?: number }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'clients', label: 'Clients', icon: Users },
  { key: 'domains', label: 'Domains', icon: Globe },
  { key: 'services', label: 'Hosting & Services', icon: Server },
  { key: 'uptime', label: 'Websites / Uptime', icon: Activity },
  { key: 'estimates', label: 'Estimates', icon: FileSpreadsheet },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'messages', label: 'Messages', icon: MessageSquare },
  { key: 'settings', label: 'Settings', icon: Settings },
];

function ControlCenterApp() {
  const { showToast } = useToast();
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('aws_cc_theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  const [authLoading, setAuthLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [resetTokenFromUrl] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('resetToken');
  });

  const [route, setRoute] = useState<string>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);

  // Quick-add
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [createClientTrigger, setCreateClientTrigger] = useState(0);
  const [createDomainTrigger, setCreateDomainTrigger] = useState(0);
  const [createServiceTrigger, setCreateServiceTrigger] = useState(0);
  const [createWebsiteTrigger, setCreateWebsiteTrigger] = useState(0);
  const [createEstimateTrigger, setCreateEstimateTrigger] = useState(0);
  const [createInvoiceTrigger, setCreateInvoiceTrigger] = useState(0);

  const publicPortalMatch = window.location.pathname.match(/^\/public\/(invoice|estimate)\/([^/]+)\/?$/);
  const publicStatusMatch = window.location.pathname.match(/^\/public\/status\/([^/]+)\/?$/);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('aws_cc_theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      showToast('Session expired. Please sign in again.', 'info');
    });
    return () => setUnauthorizedHandler(null);
  }, [showToast]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<{ needsSetup: boolean; authenticated: boolean; user: AuthUserDTO | null }>(
          '/api/auth/status'
        );
        setNeedsSetup(res.needsSetup);
        setUser(res.user);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchResults(null);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !user) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest(`/api/search?q=${encodeURIComponent(trimmed)}`);
        setSearchResults(res);
      } catch {
        // ignore search errors
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, user]);

  function navigate(nextRoute: string) {
    setRoute(nextRoute);
    setMobileMenuOpen(false);
    setSearchResults(null);
    setQuickAddOpen(false);
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // proceed with client sign-out
    } finally {
      setAuthToken(null);
      setUser(null);
      showToast('Signed out', 'info');
    }
  }

  if (publicPortalMatch) {
    return (
      <PublicPortalPage
        kind={publicPortalMatch[1] as 'invoice' | 'estimate'}
        token={decodeURIComponent(publicPortalMatch[2])}
      />
    );
  }

  if (publicStatusMatch) {
    return <PublicStatusPage token={decodeURIComponent(publicStatusMatch[1])} />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Loading AWS Control Center...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPage
        needsSetup={needsSetup}
        resetTokenFromUrl={resetTokenFromUrl}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        onAuthenticated={(u) => {
          setNeedsSetup(false);
          setUser(u);
        }}
      />
    );
  }

  const [basePath, queryStr] = route.split('?');
  const routeParts = basePath.split('/');
  const primarySection = routeParts[0] as NavKey;
  const detailId = routeParts[1];
  const routeParams = new URLSearchParams(queryStr || '');

  const breadcrumbMap: Record<string, string> = {
    dashboard: 'Dashboard',
    clients: detailId ? 'Clients / Detail' : 'Clients',
    domains: 'Domains',
    services: 'Hosting & Services',
    uptime: 'Websites / Uptime',
    estimates: 'Estimates',
    invoices: 'Invoices',
    payments: 'Payments',
    reports: 'Reports',
    messages: 'Messages',
    settings: 'Settings',
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex h-14 items-center px-5 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => navigate('dashboard')}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap"
          >
            AWS Control Center
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = primarySection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.key)}
                className={`w-full flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.phase && (
                  <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                    P{item.phase}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-3 text-xs">
          <div className="px-2 py-1.5">
            <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{user.name}</p>
            <p className="text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 w-full flex items-center gap-2 rounded-lg px-2 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative flex w-64 max-w-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
            <div className="flex h-14 items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-sm">AWS Control Center</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = primarySection === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate(item.key)}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active
                        ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </span>
                    {item.phase && <span className="font-mono text-[10px] text-slate-400">P{item.phase}</span>}
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-200 dark:border-slate-800 p-3">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-600 dark:text-slate-400"
              >
                <LogOut className="h-4 w-4" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
              <span>Aligarh Web Solutions</span>
              <span className="mx-2 text-slate-300 dark:text-slate-700">/</span>
              <span className="text-slate-900 dark:text-slate-100">
                {breadcrumbMap[primarySection] || 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Global Search */}
            <div ref={searchRef} className="relative hidden sm:block w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clients, domains..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
              {searchResults && (
                <div className="absolute right-0 mt-1.5 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-2 z-50 text-xs space-y-2 max-h-80 overflow-y-auto">
                  {searchResults.clients.length === 0 &&
                  searchResults.domains.length === 0 &&
                  searchResults.services.length === 0 ? (
                    <p className="p-2 text-slate-500">No matches found</p>
                  ) : (
                    <>
                      {searchResults.clients.length > 0 && (
                        <div>
                          <p className="px-2 py-1 font-medium text-slate-400">Clients</p>
                          {searchResults.clients.map((c: any) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSearchQuery('');
                                navigate(`clients/${c.id}`);
                              }}
                              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <div className="font-medium text-slate-900 dark:text-slate-100">{c.name}</div>
                              {c.company && <div className="text-[11px] text-slate-400">{c.company}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.domains.length > 0 && (
                        <div>
                          <p className="px-2 py-1 font-medium text-slate-400">Domains</p>
                          {searchResults.domains.map((d: any) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => {
                                setSearchQuery('');
                                navigate('domains');
                              }}
                              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <div className="font-mono font-medium text-slate-900 dark:text-slate-100">{d.name}</div>
                              <div className="text-[11px] text-slate-400">{d.clientName}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.services.length > 0 && (
                        <div>
                          <p className="px-2 py-1 font-medium text-slate-400">Services</p>
                          {searchResults.services.map((s: any) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setSearchQuery('');
                                navigate('services');
                              }}
                              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <div className="font-medium text-slate-900 dark:text-slate-100">{s.planName}</div>
                              <div className="text-[11px] text-slate-400">{s.clientName}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Quick Add */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setQuickAddOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" /> Quick Add
              </button>
              {quickAddOpen && (
                <div className="absolute right-0 mt-1.5 w-44 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-1 z-50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      navigate('clients');
                      setCreateClientTrigger((n) => n + 1);
                    }}
                    className="w-full text-left rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    New Client
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate('domains');
                      setCreateDomainTrigger((n) => n + 1);
                    }}
                    className="w-full text-left rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    New Domain
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate('services');
                      setCreateServiceTrigger((n) => n + 1);
                    }}
                    className="w-full text-left rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    New Service
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate('uptime');
                      setCreateWebsiteTrigger((n) => n + 1);
                    }}
                    className="w-full text-left rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    New Website
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate('invoices');
                      setCreateInvoiceTrigger((n) => n + 1);
                    }}
                    className="w-full text-left rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    New Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate('estimates');
                      setCreateEstimateTrigger((n) => n + 1);
                    }}
                    className="w-full text-left rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    New Estimate
                  </button>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle light/dark mode"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {primarySection === 'dashboard' && <DashboardPage onNavigate={navigate} />}
          {primarySection === 'clients' && !detailId && (
            <ClientsPage
              onOpenClient={(id) => navigate(`clients/${id}`)}
              openCreateTrigger={createClientTrigger}
            />
          )}
          {primarySection === 'clients' && detailId && (
            <ClientDetailPage
              clientId={detailId}
              onBack={() => navigate('clients')}
              onNavigate={navigate}
            />
          )}
          {primarySection === 'domains' && (
            <DomainsPage
              initialWindow={routeParams.get('window') || 'ALL'}
              onOpenClient={(id) => navigate(`clients/${id}`)}
              onOpenInvoice={(id) => navigate(`invoices?id=${id}`)}
              openCreateTrigger={createDomainTrigger}
            />
          )}
          {primarySection === 'services' && (
            <ServicesPage
              initialWindow={routeParams.get('window') || 'ALL'}
              onOpenClient={(id) => navigate(`clients/${id}`)}
              onOpenInvoice={(id) => navigate(`invoices?id=${id}`)}
              openCreateTrigger={createServiceTrigger}
            />
          )}
          {primarySection === 'settings' && (
            <SettingsPage
              initialTab={routeParams.get('tab') || undefined}
              user={user}
              onUserUpdated={setUser}
            />
          )}
          {primarySection === 'estimates' && (
            <EstimatesPage
              onOpenClient={(id) => navigate(`clients/${id}`)}
              onConvertedToInvoice={(invoiceId) => navigate(`invoices?id=${invoiceId}`)}
              openCreateTrigger={createEstimateTrigger}
            />
          )}
          {primarySection === 'invoices' && (
            <InvoicesPage
              initialInvoiceId={routeParams.get('id') || undefined}
              onOpenClient={(id) => navigate(`clients/${id}`)}
              openCreateTrigger={createInvoiceTrigger}
            />
          )}
          {primarySection === 'payments' && (
            <PaymentsPage
              onOpenClient={(id) => navigate(`clients/${id}`)}
              onOpenInvoice={(id) => navigate(`invoices?id=${id}`)}
            />
          )}
          {primarySection === 'reports' && (
            <ReportsPage
              onOpenClient={(id) => navigate(`clients/${id}`)}
              onOpenInvoice={(id) => navigate(`invoices?id=${id}`)}
            />
          )}
          {primarySection === 'messages' && (
            <MessagesPage onOpenClient={(id) => navigate(`clients/${id}`)} />
          )}
          {primarySection === 'uptime' && (
            <UptimePage
              onOpenClient={(id) => navigate(`clients/${id}`)}
              openCreateTrigger={createWebsiteTrigger}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 grid grid-cols-5">
        {[
          { key: 'dashboard', label: 'Home', icon: LayoutDashboard },
          { key: 'clients', label: 'Clients', icon: Users },
          { key: 'domains', label: 'Domains', icon: Globe },
          { key: 'services', label: 'Services', icon: Server },
          { key: 'settings', label: 'Settings', icon: Settings },
        ].map((item) => {
          const Icon = item.icon;
          const active = primarySection === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.key)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected render error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 text-center space-y-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Something went wrong rendering this view
            </h2>
            <p className="text-xs font-mono text-red-600 dark:text-red-400 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ToastProvider>
        <ControlCenterApp />
      </ToastProvider>
    </AppErrorBoundary>
  );
}
