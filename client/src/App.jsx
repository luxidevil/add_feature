import { Router, Route, Switch, useLocation } from 'wouter';
import { useAuth } from './auth';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import TriggerReset from './pages/TriggerReset';
import ChangePassword from './pages/ChangePassword';
import CheckEmail from './pages/CheckEmail';
import Proxy from './pages/Proxy';
import Logs from './pages/Logs';
import Imap from './pages/Imap';
import Credits from './pages/Credits';
import BuyCredits from './pages/BuyCredits';
import Admin from './pages/Admin';
import SignupCode from './pages/SignupCode';
import NotFound from './pages/NotFound';
import GuestPay from './pages/GuestPay';

export default function App() {
  return <Router><AppInner /></Router>;
}

function AppInner() {
  const { user, loading } = useAuth();
  const [location] = useLocation();

  // Public route — no auth required
  if (location === '/pay') return <GuestPay />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111]">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="flex min-h-screen bg-[#111]">
      <Sidebar />
      <main className="flex-1 min-h-screen overflow-auto pt-14 md:pt-0">
        <Switch>
          <Route path="/" component={TriggerReset} />
          <Route path="/change-password" component={ChangePassword} />
          <Route path="/check-email" component={CheckEmail} />
          <Route path="/logs" component={Logs} />
          <Route path="/imap" component={Imap} />
          <Route path="/proxy" component={Proxy} />
          <Route path="/credits" component={Credits} />
          <Route path="/buy-credits" component={BuyCredits} />
          <Route path="/signup-code" component={SignupCode} />
          {user?.role === 'admin' && <Route path="/admin" component={Admin} />}
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}
