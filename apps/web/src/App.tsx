import { NavLink, Route, Routes } from 'react-router-dom';

import Home from './pages/Home.tsx';
import Interview from './pages/Interview.tsx';
import ReportPage from './pages/Report.tsx';
import Settings from './pages/Settings.tsx';
import Setup from './pages/Setup.tsx';

const navItems = [
  { to: '/', label: '面试', end: true },
  { to: '/settings', label: '设置', end: false },
];

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-8 px-6">
          <NavLink to="/" className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            AI 面试助手
          </NavLink>
          <nav className="flex items-center gap-1 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup/:resumeId" element={<Setup />} />
          <Route path="/interview/:sessionId" element={<Interview />} />
          <Route path="/report/:sessionId" element={<ReportPage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <footer className="border-t border-slate-900 px-6 py-4 text-center text-xs text-slate-600">
        所有数据保存在本机，简历与面试记录不会离开你的电脑
      </footer>
    </div>
  );
}
