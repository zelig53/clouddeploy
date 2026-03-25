/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Home, Settings as SettingsIcon, Plus, ArrowRight, ArrowLeft, Github, Cloud, Upload,
  Eye, EyeOff, Lock, Unlock, CheckCircle2, AlertCircle, Loader2, Moon, Sun,
  RefreshCw, ExternalLink, GitMerge, Trash2, LayoutGrid, CloudUpload, Smartphone,
  Download, HelpCircle, History, Star, GitBranch, Clock, Globe, Check, BookOpen,
  Key, Shield, Zap, ChevronRight, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { cn } from './lib/utils';

// --- Types ---
type View = 'dashboard' | 'create' | 'settings' | 'project-detail';

interface Deployment {
  id: string;
  created_on: string;
  url: string;
  status: string;
  environment: 'production' | 'preview';
  branch?: string;
  commit_message?: string;
  versionNumber?: number;
}

interface Project {
  id: string;
  name: string;
  githubRepo: string;
  cloudflareProject: string;
  lastDeployment?: string;
  previewUrl?: string;
  previewBranch?: string;
  productionUrl?: string;
  status: 'idle' | 'deploying' | 'success' | 'error';
  productionBranch?: string;
  deployments?: Deployment[];
}

interface AppSettings {
  githubToken: string;
  cloudflareApiKey: string;
  cloudflareAccountId: string;
  theme: 'light' | 'dark';
}

const STORAGE_KEY_SETTINGS = 'cloud_deploy_settings';
const STORAGE_KEY_PROJECTS = 'cloud_deploy_projects';

// --- Helpers ---
async function uploadFilesToGithub(
  files: { path: string, content: string }[],
  repo: string, branch: string, token: string, message: string
) {
  const blobs = [];
  for (const f of files) {
    const res = await fetch(`/api/github/repos/${repo}/git/blobs`, {
      method: 'POST',
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: f.content, encoding: 'base64' })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(`blob error ${f.path}: ${err.message}`); }
    blobs.push({ ...(await res.json()), path: f.path, mode: '100644', type: 'blob' });
  }
  const branchRes = await fetch(`/api/github/repos/${repo}/branches/${branch}`, { headers: { Authorization: `token ${token}` } });
  if (!branchRes.ok) throw new Error(`failed branch ${branch}`);
  const bd = await branchRes.json();
  const treeRes = await fetch(`/api/github/repos/${repo}/git/trees`, {
    method: 'POST',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: bd.commit.commit.tree.sha, tree: blobs })
  });
  if (!treeRes.ok) throw new Error('tree failed');
  const td = await treeRes.json();
  const commitRes = await fetch(`/api/github/repos/${repo}/git/commits`, {
    method: 'POST',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: td.sha, parents: [bd.commit.sha] })
  });
  if (!commitRes.ok) throw new Error('commit failed');
  const cd = await commitRes.json();
  const refRes = await fetch(`/api/github/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: cd.sha })
  });
  if (!refRes.ok) throw new Error('ref update failed');
}

function safeBtoa(str: string) {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function detectFramework(packageJsonContent: string) {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};
    if (deps.vite || deps.astro || deps['@sveltejs/kit'] || deps.nuxt) return { buildCommand: "npm install && npm run build", destinationDir: "dist" };
    if (deps['react-scripts']) return { buildCommand: "npm install && npm run build", destinationDir: "build" };
    if (deps.next) return { buildCommand: "npm install && npm run build", destinationDir: ".next" };
    if (scripts.build) return { buildCommand: "npm install && npm run build", destinationDir: "dist" };
    return { buildCommand: "npm install", destinationDir: "." };
  } catch { return { buildCommand: "npm install", destinationDir: "." }; }
}

async function extractZip(file: File) {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);
  const entries = Object.keys(loadedZip.files);
  let rootPath = '';
  const idx = entries.filter(e => e.endsWith('index.html') && !e.includes('__MACOSX')).sort((a, b) => a.split('/').length - b.split('/').length);
  if (idx.length > 0) { const ls = idx[0].lastIndexOf('/'); if (ls !== -1) rootPath = idx[0].substring(0, ls + 1); }
  else if (entries.length > 0) { const fs = entries[0].indexOf('/'); if (fs !== -1) { const p = entries[0].substring(0, fs + 1); if (entries.every(e => e.startsWith(p))) rootPath = p; } }
  const filesToUpload: { path: string, content: string }[] = [];
  let hasFunctions = false, hasPackageJson = false, packageJsonContent = '';
  for (const path of entries) {
    const entry = loadedZip.files[path];
    if (!entry.dir && !path.includes('__MACOSX') && !path.endsWith('.DS_Store')) {
      const content = await entry.async('base64');
      const np = (rootPath && path.startsWith(rootPath)) ? path.replace(rootPath, '') : path;
      filesToUpload.push({ path: np, content });
      if (np.startsWith('functions/')) hasFunctions = true;
      if (np === 'package.json') { hasPackageJson = true; packageJsonContent = atob(content); }
    }
  }
  return { filesToUpload, hasFunctions, hasPackageJson, packageJsonContent };
}

// --- App ---
export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [history, setHistory] = useState<View[]>(['dashboard']);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ githubToken: '', cloudflareApiKey: '', cloudflareAccountId: '', theme: 'light' });
  const [isInitialized, setIsInitialized] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallSheet, setShowInstallSheet] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);
    const handleBIP = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        setTimeout(() => setShowInstallSheet(true), 2000);
      }
    };
    const handleInstalled = () => { setIsInstalled(true); setDeferredPrompt(null); setShowInstallSheet(false); };
    window.addEventListener('beforeinstallprompt', handleBIP);
    window.addEventListener('appinstalled', handleInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', handleBIP); window.removeEventListener('appinstalled', handleInstalled); };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { setDeferredPrompt(null); setShowInstallSheet(false); }
  };

  useEffect(() => {
    const s = localStorage.getItem(STORAGE_KEY_SETTINGS);
    const p = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (s) { try { const parsed = JSON.parse(s); setSettings(prev => ({ ...prev, ...parsed })); if (parsed.theme === 'dark') document.documentElement.classList.add('dark'); } catch {} }
    if (p) { try { const parsed = JSON.parse(p); if (Array.isArray(parsed)) setProjects(parsed); } catch {} }
    setIsInitialized(true);
  }, []);

  useEffect(() => { if (isInitialized) { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects)); } }, [settings, projects, isInitialized]);

  const toggleTheme = () => {
    const t = settings.theme === 'light' ? 'dark' : 'light';
    setSettings(prev => ({ ...prev, theme: t }));
    if (t === 'dark') document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
  };

  const navigateTo = (newView: View, project?: Project) => { setHistory(prev => [...prev, newView]); setView(newView); if (project) setSelectedProject(project); };
  const goBack = () => { if (history.length > 1) { const h = [...history]; h.pop(); setHistory(h); setView(h[h.length - 1]); } else setView('dashboard'); };
  const goHome = () => { setHistory(['dashboard']); setView('dashboard'); };

  if (!isInitialized) return null;

  return (
    <div className="min-h-screen flex flex-col" dir="rtl">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={goBack} className="p-2 hover:bg-muted rounded-full transition-colors"><ArrowRight className="w-5 h-5" /></button>
            <button onClick={goHome} className="p-2 hover:bg-muted rounded-full transition-colors"><Home className="w-5 h-5" /></button>
            <button onClick={() => navigateTo('dashboard')} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted rounded-lg transition-colors text-sm font-medium">
              <LayoutGrid className="w-4 h-4" /><span>כל הפרויקטים</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20"><CloudUpload className="w-5 h-5" /></div>
            <h1 className="text-lg font-bold hidden sm:block">CloudDeploy</h1>
            {!isInstalled && deferredPrompt && (
              <button onClick={handleInstall} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-600 hover:bg-green-500/20 rounded-full transition-colors">
                <Smartphone className="w-4 h-4" /><span className="text-xs font-bold">התקן</span>
              </button>
            )}
            <button onClick={toggleTheme} className="p-2 hover:bg-muted rounded-full transition-colors">{settings.theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}</button>
            <button onClick={() => navigateTo('settings')} className="p-2 hover:bg-muted rounded-full transition-colors"><SettingsIcon className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && <Dashboard projects={projects} onNewProject={() => navigateTo('create')} onSelectProject={(p) => navigateTo('project-detail', p)} onDeleteProject={(id) => setProjects(prev => prev.filter(p => p.id !== id))} settings={settings} onSync={setProjects} />}
          {view === 'create' && <CreateProject settings={settings} onSuccess={(p) => { setProjects(prev => [p, ...prev]); navigateTo('dashboard'); }} />}
          {view === 'settings' && <Settings settings={settings} onSave={setSettings} onInstall={handleInstall} isInstallAvailable={!!deferredPrompt && !isInstalled} isInstalled={isInstalled} />}
          {view === 'project-detail' && selectedProject && <ProjectDetail project={selectedProject} settings={settings} onUpdate={(u) => { setProjects(prev => prev.map(p => p.id === u.id ? u : p)); setSelectedProject(u); }} />}
        </AnimatePresence>
      </main>

      <footer className="border-t border-border py-4 px-4 text-center text-muted-foreground text-xs">
        <p>© {new Date().getFullYear()} CloudDeploy — פריסה מהירה לענן</p>
      </footer>

      {/* Install Bottom Sheet */}
      <AnimatePresence>
        {showInstallSheet && deferredPrompt && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowInstallSheet(false)} className="fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed bottom-0 left-0 right-0 bg-background border-t border-border rounded-t-[2.5rem] z-[101] p-8 pb-12 shadow-2xl">
              <div className="max-w-md mx-auto space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shrink-0"><Download className="w-8 h-8" /></div>
                  <div>
                    <h3 className="text-2xl font-bold">התקינו את האפליקציה</h3>
                    <p className="text-muted-foreground text-sm">גישה מהירה ממסך הבית, גם בלי אינטרנט</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleInstall} className="flex-1 bg-primary text-primary-foreground py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
                    <Download className="w-5 h-5" /><span>התקן עכשיו</span>
                  </button>
                  <button onClick={() => setShowInstallSheet(false)} className="px-8 py-4 bg-muted text-foreground rounded-2xl font-bold hover:bg-muted/80 transition-all">אחר כך</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Dashboard ---
function Dashboard({ projects, onNewProject, onSelectProject, onDeleteProject, settings, onSync }: {
  projects: Project[], onNewProject: () => void, onSelectProject: (p: Project) => void,
  onDeleteProject: (id: string) => void, settings: AppSettings, onSync: (p: Project[]) => void
}) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');

  const syncProjects = async () => {
    if (!settings.cloudflareApiKey || !settings.cloudflareAccountId || !settings.githubToken) { alert('נא להגדיר מפתחות API בהגדרות'); return; }
    setIsSyncing(true); setSyncProgress('מתחבר ל-Cloudflare...');
    try {
      setSyncProgress('טוען פרויקטים...');
      const res = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects`, { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.errors?.[0]?.message || `שגיאת Cloudflare API`);
      const allCf = data.result || [];
      setSyncProgress(`נמצאו ${allCf.length} פרויקטים, טוען פריסות...`);
      const synced: Project[] = [];
      for (let i = 0; i < allCf.length; i++) {
        const cf = allCf[i];
        setSyncProgress(`טוען: ${cf.name} (${i + 1}/${allCf.length})`);
        let deps: Deployment[] = [];
        try {
          const dr = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${cf.name}/deployments`, { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } });
          if (dr.ok) {
            const dd = await dr.json();
            if (dd.success && dd.result) {
              const sorted = [...dd.result].sort((a: any, b: any) => new Date(a.created_on).getTime() - new Date(b.created_on).getTime());
              deps = sorted.map((d: any, idx: number) => ({
                id: d.id, created_on: d.created_on,
                url: d.url || `https://${d.id}.${cf.name}.pages.dev`,
                status: d.latest_stage?.status || d.status || 'idle',
                environment: d.environment || 'production',
                branch: d.deployment_trigger?.metadata?.branch || d.meta?.github_branch,
                commit_message: d.meta?.github_commit_message || d.deployment_trigger?.metadata?.commit_message,
                versionNumber: idx + 1
              })).reverse();
            }
          }
        } catch {}
        const existing = projects.find(p => p.cloudflareProject === cf.name);
        synced.push({
          id: existing?.id || `cf-${cf.name}-${Date.now()}-${i}`,
          name: cf.name,
          githubRepo: cf.source?.config?.owner && cf.source?.config?.repo_name ? `${cf.source.config.owner}/${cf.source.config.repo_name}` : existing?.githubRepo || 'unknown',
          cloudflareProject: cf.name,
          lastDeployment: cf.latest_deployment?.created_on || new Date().toISOString(),
          status: 'success',
          productionUrl: cf.subdomain ? `https://${cf.subdomain}` : `https://${cf.name}.pages.dev`,
          productionBranch: cf.source?.config?.production_branch || 'main',
          deployments: deps
        });
      }
      onSync(synced);
      setSyncProgress('');
      alert(`סונכרנו ${synced.length} פרויקטים בהצלחה!`);
    } catch (e: any) { alert(`סנכרון נכשל: ${e.message}`); }
    finally { setIsSyncing(false); setSyncProgress(''); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-md border border-primary/20 shrink-0"><CloudUpload className="w-8 h-8" /></div>
          <div><h2 className="text-3xl font-bold tracking-tight">לוח בקרה</h2><p className="text-muted-foreground">נהל את הפרויקטים שלך ופרוס ל-Cloudflare Pages</p></div>
        </div>
        <div className="flex gap-3">
          <button onClick={syncProjects} disabled={isSyncing} className="inline-flex items-center gap-2 bg-muted px-4 py-3 rounded-xl font-semibold hover:bg-muted/80 transition-all disabled:opacity-70">
            {isSyncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            <span>{isSyncing ? 'מסנכרן...' : 'סנכרן מ-Cloudflare'}</span>
          </button>
          <button onClick={onNewProject} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-primary/20">
            <Plus className="w-5 h-5" /><span>פרויקט חדש</span>
          </button>
        </div>
      </div>
      <AnimatePresence>
        {syncProgress && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
            <p className="text-sm font-medium text-primary">{syncProgress}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-3xl bg-muted/30">
          <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center text-primary mb-6"><CloudUpload className="w-12 h-12" /></div>
          <h3 className="text-xl font-semibold mb-2">אין פרויקטים עדיין</h3>
          <p className="text-muted-foreground mb-6 text-center max-w-xs">צור פרויקט חדש, או לחץ "סנכרן מ-Cloudflare" לייבא קיימים.</p>
          <button onClick={onNewProject} className="text-primary font-medium hover:underline">לחץ כאן להתחיל</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <motion.div key={project.id} layoutId={project.id} className="group bg-card border border-border rounded-2xl p-6 hover:shadow-xl transition-all cursor-pointer" onClick={() => onSelectProject(project)}>
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-primary/10 rounded-xl text-primary"><Github className="w-6 h-6" /></div>
                <div className="flex gap-1">
                  {project.productionUrl && <a href={project.productionUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-2 text-muted-foreground hover:text-primary transition-colors"><Globe className="w-4 h-4" /></a>}
                  <a href={`https://dash.cloudflare.com/${settings.cloudflareAccountId}/pages/view/${project.cloudflareProject}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-2 text-muted-foreground hover:text-primary transition-colors"><Cloud className="w-4 h-4" /></a>
                  <button onClick={e => { e.stopPropagation(); if (confirm('למחוק פרויקט זה?')) onDeleteProject(project.id); }} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <h4 className="text-xl font-bold mb-1">{project.name}</h4>
              <p className="text-sm text-muted-foreground mb-3 font-mono truncate">{project.githubRepo}</p>
              {project.deployments && project.deployments.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3"><History className="w-3.5 h-3.5" /><span>{project.deployments.length} פריסות</span></div>
              )}
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("px-2 py-1 rounded-full font-medium", project.status === 'success' ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground")}>
                  {project.status === 'success' ? 'פעיל' : 'ממתין'}
                </span>
                {project.lastDeployment && <span className="text-muted-foreground">{new Date(project.lastDeployment).toLocaleDateString('he-IL')}</span>}
              </div>
              <div className="mt-4 flex items-center justify-end text-primary font-semibold text-sm group-hover:translate-x-[-4px] transition-transform">
                <span>נהל פרויקט</span><ArrowLeft className="w-4 h-4 mr-1" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// --- Settings ---
function Settings({ settings, onSave, onInstall, isInstallAvailable, isInstalled }: {
  settings: AppSettings, onSave: (s: AppSettings) => void,
  onInstall: () => void, isInstallAvailable: boolean, isInstalled: boolean
}) {
  const [local, setLocal] = useState(settings);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean, message: string } | null>(null);
  const [locked, setLocked] = useState({ github: true, cf: true, cfAccount: true });
  const [visible, setVisible] = useState({ github: false, cf: false });
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState<'github' | 'cloudflare' | 'account' | 'install'>('github');
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => { onSave(local); }, [local]);

  const testGithub = async () => {
    setIsTesting(true); setTestResult(null);
    try {
      const r = await fetch('/api/github/user', { headers: { Authorization: `token ${local.githubToken}` } });
      if (r.ok) { const d = await r.json(); setTestResult({ success: true, message: `✅ מחובר כ: ${d.login}` }); }
      else setTestResult({ success: false, message: 'טוקן לא תקין או פג תוקף' });
    } catch { setTestResult({ success: false, message: 'שגיאת תקשורת' }); }
    finally { setIsTesting(false); }
  };

  const testCloudflare = async () => {
    setIsTesting(true); setTestResult(null);
    try {
      const r = await fetch(`/api/cloudflare/accounts/${local.cloudflareAccountId}/pages/projects`, { headers: { 'Authorization': `Bearer ${local.cloudflareApiKey}` } });
      const d = await r.json();
      if (!r.ok || d.success === false) throw new Error(d.errors?.[0]?.message || `שגיאת Cloudflare API`);
      setTestResult({ success: true, message: `✅ מחובר! נמצאו ${d.result?.length || 0} פרויקטים.` });
    } catch (e: any) { setTestResult({ success: false, message: e.message }); }
    finally { setIsTesting(false); }
  };

  const guideData: Record<string, { label: string, icon: React.ReactNode, color: string, steps: React.ReactNode[], note?: string }> = {
    github: {
      label: 'GitHub Token', icon: <Github className="w-5 h-5" />, color: 'from-gray-700 to-gray-900',
      steps: [
        <span>היכנס ל-<b>GitHub.com</b> ← לחץ על תמונת הפרופיל בפינה הימנית</span>,
        <span>בחר <b>Settings</b> ← גלול למטה ← לחץ <b>Developer settings</b></span>,
        <span>בחר <b>Personal access tokens</b> ← <b>Tokens (classic)</b></span>,
        <span>לחץ <b>Generate new token (classic)</b></span>,
        <span>שם: "CloudDeploy" | תוקף: "No expiration"</span>,
        <span>סמן את התיבה <b>repo</b></span>,
        <span>לחץ <b>Generate token</b> — <b>העתק מיד!</b></span>,
      ],
      note: '⚠️ העתק את הטוקן מיד — הוא לא יוצג שוב!'
    },
    cloudflare: {
      label: 'Cloudflare Token', icon: <Cloud className="w-5 h-5" />, color: 'from-orange-500 to-orange-700',
      steps: [
        <span>היכנס ל-<a href="https://dash.cloudflare.com" target="_blank" className="text-white underline">dash.cloudflare.com</a></span>,
        <span>לחץ על הפרופיל ← <b>My Profile</b> ← <b>API Tokens</b></span>,
        <span>לחץ <b>Create Token</b> ← <b>Get started</b> (Custom Token)</span>,
        <span>שם: "CloudDeploy"</span>,
        <div className="space-y-1.5">
          <span>הוסף הרשאות:</span>
          <div className="mt-1 space-y-1 text-sm">
            <div className="bg-white/20 rounded-lg px-3 py-1.5">Account → Cloudflare Pages → <b>Edit</b></div>
            <div className="bg-white/20 rounded-lg px-3 py-1.5">Account → Account Settings → <b>Read</b></div>
          </div>
        </div>,
        <span>לחץ <b>Continue to summary</b> ← <b>Create Token</b> ← העתק!</span>,
      ],
      note: '⚠️ העתק את הטוקן מיד — הוא לא יוצג שוב!'
    },
    account: {
      label: 'Account ID', icon: <Key className="w-5 h-5" />, color: 'from-blue-500 to-blue-700',
      steps: [
        <span>היכנס ל-<a href="https://dash.cloudflare.com" target="_blank" className="text-white underline">dash.cloudflare.com</a></span>,
        <span>ה-Account ID נמצא <b>ישירות בכתובת ה-URL</b>:</span>,
        <div className="bg-white/20 rounded-lg px-3 py-2 font-mono text-xs break-all">
          dash.cloudflare.com/<span className="bg-yellow-300 text-black px-1 rounded font-bold">8a2b3c4d5e6f...</span>/pages
        </div>,
        <span>העתק את המחרוזת הארוכה שאחרי הלוכסן הראשון</span>,
      ]
    },
    install: {
      label: 'התקנה', icon: <Smartphone className="w-5 h-5" />, color: 'from-green-500 to-green-700',
      steps: [
        <span><b>Android (Chrome):</b> תפריט ⋮ ← "הוסף למסך הבית"</span>,
        <span><b>iPhone (Safari בלבד):</b> כפתור שיתוף ⬆️ ← "הוסף למסך הבית"</span>,
        <span>לחץ <b>הוסף</b> — האפליקציה תופיע כמו אפליקציה רגילה!</span>,
      ],
      note: '💡 ב-iPhone חייב להשתמש ב-Safari (לא Chrome)'
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">הגדרות</h2><p className="text-muted-foreground">הגדר מפתחות API לחיבור לשירותי הענן</p></div>
        <button onClick={() => setShowGuide(!showGuide)} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold transition-all", showGuide ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20 animate-pulse")}>
          <BookOpen className="w-4 h-4" /><span>{showGuide ? 'סגור מדריך' : '📖 מדריך'}</span>
        </button>
      </div>

      {/* Visual Guide */}
      <AnimatePresence>
        {showGuide && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-card border-2 border-primary/20 rounded-[2rem] shadow-2xl overflow-hidden">
              <div className="bg-gradient-to-l from-primary to-primary/80 p-5 text-primary-foreground flex items-center gap-3">
                <div className="p-2.5 bg-white/20 rounded-xl"><BookOpen className="w-5 h-5" /></div>
                <div><h3 className="text-lg font-bold">מדריך שלב-אחרי-שלב</h3><p className="text-primary-foreground/80 text-sm">מיועד לכולם, גם ללא ניסיון</p></div>
              </div>
              <div className="grid grid-cols-4 border-b border-border bg-muted/20">
                {(Object.keys(guideData) as Array<keyof typeof guideData>).map(tab => (
                  <button key={tab} onClick={() => setGuideTab(tab)} className={cn("flex flex-col items-center gap-1.5 py-3 px-1 text-xs font-bold transition-all border-b-2", guideTab === tab ? "border-primary text-primary bg-background" : "border-transparent text-muted-foreground hover:bg-muted/50")}>
                    <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center", guideTab === tab ? "bg-primary text-primary-foreground" : "bg-muted")}>{guideData[tab].icon}</span>
                    <span className="hidden sm:block text-[10px]">{guideData[tab].label}</span>
                  </button>
                ))}
              </div>
              <div className="p-5 sm:p-7">
                <AnimatePresence mode="wait">
                  <motion.div key={guideTab} initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -15 }} className="space-y-4">
                    <div className={cn("rounded-2xl p-4 text-white bg-gradient-to-l", guideData[guideTab].color)}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg">{guideData[guideTab].icon}</div>
                        <h4 className="font-bold text-lg">{guideData[guideTab].label}</h4>
                      </div>
                    </div>
                    <ol className="space-y-3">
                      {guideData[guideTab].steps.map((step, i) => (
                        <li key={i} className="flex gap-3 items-start">
                          <span className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i + 1}</span>
                          <div className="flex-1 text-sm leading-relaxed pt-0.5">{step}</div>
                        </li>
                      ))}
                    </ol>
                    {guideData[guideTab].note && (
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300 font-medium">
                        {guideData[guideTab].note}
                      </div>
                    )}
                    {/* Visual mock */}
                    {guideTab === 'account' && (
                      <div className="border border-border rounded-xl overflow-hidden bg-background">
                        <div className="bg-muted px-3 py-2 text-[10px] text-muted-foreground font-mono">שורת הכתובת בדפדפן</div>
                        <div className="p-4 font-mono text-xs flex flex-wrap gap-1">
                          <span className="text-muted-foreground">dash.cloudflare.com/</span>
                          <span className="bg-yellow-200 dark:bg-yellow-700 text-black dark:text-white px-2 py-0.5 rounded font-bold animate-pulse">8a2b3c4d5e6f7g8h9i0j</span>
                          <span className="text-muted-foreground">/pages</span>
                        </div>
                      </div>
                    )}
                    {guideTab === 'install' && !isInstalled && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="border border-border rounded-xl overflow-hidden"><div className="bg-green-500 px-3 py-2 text-white text-xs font-bold text-center">Android / Chrome</div><div className="p-3 space-y-2"><div className="flex items-center gap-2 text-xs p-2 bg-muted rounded-lg"><span>⋮</span><span>תפריט Chrome</span></div><div className="flex items-center gap-2 text-xs p-2 bg-green-50 dark:bg-green-950/30 border border-green-200 rounded-lg font-bold"><Smartphone className="w-3.5 h-3.5 text-green-600"/><span>הוסף למסך הבית</span></div></div></div>
                        <div className="border border-border rounded-xl overflow-hidden"><div className="bg-blue-500 px-3 py-2 text-white text-xs font-bold text-center">iPhone / Safari</div><div className="p-3 space-y-2"><div className="flex items-center gap-2 text-xs p-2 bg-muted rounded-lg"><span>⬆️</span><span>כפתור שיתוף</span></div><div className="flex items-center gap-2 text-xs p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 rounded-lg font-bold"><Plus className="w-3.5 h-3.5 text-blue-600"/><span>הוסף למסך הבית</span></div></div></div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <div className="space-y-6 bg-card border border-border rounded-3xl p-6 sm:p-8">
        {/* GitHub */}
        <div className="space-y-2">
          <label className="text-sm font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2"><Github className="w-4 h-4" /><span>GitHub Personal Access Token</span></div>
            <button onClick={() => { setShowGuide(true); setGuideTab('github'); }} className="text-xs text-primary hover:underline flex items-center gap-1"><HelpCircle className="w-3 h-3" /><span>איך להשיג?</span></button>
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={visible.github ? "text" : "password"} value={local.githubToken} onChange={e => setLocal({ ...local, githubToken: e.target.value })} disabled={locked.github} className={cn("w-full px-4 py-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20 pr-10", locked.github && "opacity-60 cursor-not-allowed bg-muted")} placeholder="ghp_xxxxxxxxxxxx" />
              <button onClick={() => setVisible(v => ({ ...v, github: !v.github }))} className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground">{visible.github ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            <button onClick={() => setLocked(l => ({ ...l, github: !l.github }))} className={cn("p-3 rounded-xl border border-border", locked.github ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>{locked.github ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}</button>
          </div>
          <button onClick={testGithub} disabled={isTesting || !local.githubToken} className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50">
            {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}<span>בדוק חיבור</span>
          </button>
        </div>
        {/* Cloudflare */}
        <div className="space-y-2">
          <label className="text-sm font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2"><Cloud className="w-4 h-4" /><span>Cloudflare API Token</span></div>
            <button onClick={() => { setShowGuide(true); setGuideTab('cloudflare'); }} className="text-xs text-primary hover:underline flex items-center gap-1"><HelpCircle className="w-3 h-3" /><span>איך להשיג?</span></button>
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={visible.cf ? "text" : "password"} value={local.cloudflareApiKey} onChange={e => setLocal({ ...local, cloudflareApiKey: e.target.value })} disabled={locked.cf} className={cn("w-full px-4 py-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20 pr-10", locked.cf && "opacity-60 cursor-not-allowed bg-muted")} placeholder="מפתח API של Cloudflare" />
              <button onClick={() => setVisible(v => ({ ...v, cf: !v.cf }))} className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground">{visible.cf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            <button onClick={() => setLocked(l => ({ ...l, cf: !l.cf }))} className={cn("p-3 rounded-xl border border-border", locked.cf ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>{locked.cf ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}</button>
          </div>
        </div>
        {/* Account ID */}
        <div className="space-y-2">
          <label className="text-sm font-semibold flex items-center justify-between">
            <span>Cloudflare Account ID</span>
            <button onClick={() => { setShowGuide(true); setGuideTab('account'); }} className="text-xs text-primary hover:underline flex items-center gap-1"><HelpCircle className="w-3 h-3" /><span>איפה זה?</span></button>
          </label>
          <div className="flex gap-2">
            <input type="text" value={local.cloudflareAccountId} onChange={e => setLocal({ ...local, cloudflareAccountId: e.target.value })} disabled={locked.cfAccount} className={cn("flex-1 px-4 py-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20", locked.cfAccount && "opacity-60 cursor-not-allowed bg-muted")} placeholder="מזהה חשבון Cloudflare" />
            <button onClick={() => setLocked(l => ({ ...l, cfAccount: !l.cfAccount }))} className={cn("p-3 rounded-xl border border-border", locked.cfAccount ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>{locked.cfAccount ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}</button>
          </div>
          <button onClick={testCloudflare} disabled={isTesting || !local.cloudflareApiKey || !local.cloudflareAccountId} className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50">
            {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}<span>בדוק חיבור</span>
          </button>
          {testResult && (
            <div className={cn("text-xs p-3 rounded-lg flex items-center gap-2", testResult.success ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-600")}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
        <div className="pt-2 border-t border-border text-center">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5"><Shield className="w-3.5 h-3.5" />נשמר אוטומטית במכשיר שלך בלבד</p>
        </div>
      </div>

      {/* Install section */}
      {isInstalled ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-green-600 shrink-0"><CheckCircle2 className="w-6 h-6" /></div>
          <div><h4 className="font-bold text-green-700 dark:text-green-400">האפליקציה מותקנת ✓</h4><p className="text-sm text-muted-foreground">פועל כאפליקציה עצמאית</p></div>
        </div>
      ) : isInstallAvailable ? (
        <button onClick={onInstall} className="w-full bg-green-500 text-white rounded-2xl p-5 flex items-center gap-4 hover:bg-green-600 transition-colors shadow-lg shadow-green-500/20">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><Smartphone className="w-6 h-6" /></div>
          <div className="flex-1 text-right"><h4 className="font-bold text-lg">התקן את האפליקציה</h4><p className="text-green-100 text-sm">הוסף למסך הבית בלחיצה אחת</p></div>
          <Download className="w-6 h-6 opacity-80" />
        </button>
      ) : isIOS ? (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl overflow-hidden">
          <button onClick={() => setShowIOSGuide(!showIOSGuide)} className="w-full p-5 flex items-center gap-4 hover:bg-blue-500/10 transition-colors">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600 shrink-0"><Smartphone className="w-6 h-6" /></div>
            <div className="flex-1 text-right"><h4 className="font-bold text-blue-700 dark:text-blue-400">התקן על iPhone/iPad</h4><p className="text-sm text-muted-foreground">לחץ לראות הוראות</p></div>
            <ChevronRight className={cn("w-5 h-5 text-muted-foreground transition-transform", showIOSGuide && "rotate-90")} />
          </button>
          <AnimatePresence>
            {showIOSGuide && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="px-5 pb-5 space-y-3 border-t border-border">
                  <p className="text-sm text-muted-foreground pt-3">ב-Safari בלבד:</p>
                  {[{ icon: '⬆️', text: 'לחץ על כפתור השיתוף בתחתית' }, { icon: '➕', text: 'בחר "הוסף למסך הבית"' }, { icon: '✅', text: 'לחץ "הוסף"' }].map((s, i) => (
                    <div key={i} className="flex items-center gap-3 bg-muted/50 rounded-xl px-4 py-3"><span className="text-2xl">{s.icon}</span><span className="text-sm font-medium">{s.text}</span></div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-muted/50 border border-border rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0"><Smartphone className="w-6 h-6 text-muted-foreground" /></div>
          <div><h4 className="font-bold">התקנה על מכשיר נייד</h4><p className="text-sm text-muted-foreground">פתח ב-Chrome (Android) או Safari (iPhone)</p></div>
        </div>
      )}
    </motion.div>
  );
}

// --- CreateProject ---
function CreateProject({ settings, onSuccess }: { settings: AppSettings, onSuccess: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [step, setStep] = useState(0);
  const [deploymentStatus, setDeploymentStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const steps = ['מנתח קובץ ZIP...', 'יוצר מאגר ב-GitHub...', 'מגדיר Cloudflare Pages...', 'מעלה קבצים ל-GitHub...', 'ממתין לסיום הפריסה...'];

  const deploy = async () => {
    if (!name || !file || !settings.githubToken || !settings.cloudflareApiKey || !settings.cloudflareAccountId) { setError('נא למלא את כל השדות ולוודא שהגדרות ה-API תקינות (כולל Account ID)'); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(name)) { setError('שם הפרויקט: אותיות קטנות, מספרים ומקפים בלבד'); return; }
    setIsDeploying(true); setError(null); setStep(0);
    try {
      const { filesToUpload, hasFunctions, hasPackageJson, packageJsonContent } = await extractZip(file);
      const { buildCommand, destinationDir } = hasPackageJson ? detectFramework(packageJsonContent) : { buildCommand: "", destinationDir: "." };
      if (hasPackageJson || hasFunctions) filesToUpload.push({ path: 'wrangler.toml', content: safeBtoa(`#:schema node_modules/wrangler/config-schema.json\ncompatibility_date = "2024-01-01"\npages_build_config = { build_command = "${buildCommand}", destination_dir = "${destinationDir}" }`) });
      if (!filesToUpload.some(f => f.path === 'index.html') && destinationDir === ".") throw new Error('קובץ index.html לא נמצא בתיקיית השורש.');
      setStep(1);
      const ur = await fetch('/api/github/user', { headers: { Authorization: `token ${settings.githubToken}` } });
      if (!ur.ok) throw new Error(`שגיאת GitHub: ${(await ur.json()).message}`);
      const { login: username } = await ur.json();
      const rr = await fetch('/api/github/user/repos', { method: 'POST', headers: { Authorization: `token ${settings.githubToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, private: true, auto_init: true }) });
      if (!rr.ok) throw new Error(`נכשל ביצירת מאגר: ${rr.status}`);
      const { default_branch: defaultBranch = 'main' } = await rr.json();
      setStep(2);
      const dc = { environment_variables: { NODE_VERSION: "18" }, build_command: buildCommand, destination_dir: destinationDir };
      const cr = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects`, { method: 'POST', headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, build_config: { build_command: buildCommand, destination_dir: destinationDir, root_dir: "" }, deployment_configs: { production: dc, preview: dc }, source: { type: "github", config: { owner: username, repo_name: name, production_branch: defaultBranch, pr_comments_enabled: true, deployments_enabled: true } } }) });
      const cd = await cr.json();
      if (!cr.ok || cd.success === false) throw new Error(`שגיאת Cloudflare: ${cd.errors?.[0]?.message || cr.status}`);
      const pName = cd.result?.name || name;
      const pSub = cd.result?.subdomain || `${pName}.pages.dev`;
      setStep(3);
      await uploadFilesToGithub(filesToUpload, `${username}/${name}`, defaultBranch, settings.githubToken, 'Initial deployment');
      setStep(4);
      let deployed = false, attempts = 0, finalUrl = pSub.startsWith('http') ? pSub : `https://${pSub}`;
      while (!deployed && attempts < 30) {
        attempts++; await new Promise(r => setTimeout(r, 6000));
        try {
          const dr = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${pName}/deployments`, { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } });
          if (dr.ok) { const dd = await dr.json(); if (dd.result?.length > 0) { const l = dd.result[0]; const s = l.latest_stage?.status || l.status; if (s === 'success') { deployed = true; if (l.url) finalUrl = l.url; } else if (s === 'failure') throw new Error('הפריסה נכשלה. בדוק לוגים ב-Cloudflare.'); else setDeploymentStatus(`${s}... (${attempts}/30)`); } }
        } catch (e: any) { if (e.message.includes('נכשלה')) throw e; }
      }
      onSuccess({ id: Date.now().toString(), name, githubRepo: `${username}/${name}`, cloudflareProject: pName, lastDeployment: new Date().toISOString(), status: 'success', productionUrl: finalUrl, productionBranch: defaultBranch });
    } catch (e: any) { setError(e.message || 'שגיאה בפריסה'); setIsDeploying(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-xl mx-auto space-y-8">
      <div><h2 className="text-3xl font-bold tracking-tight">פרויקט חדש</h2><p className="text-muted-foreground">העלה ZIP וצור פרויקט ב-GitHub ו-Cloudflare</p></div>
      <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-semibold">שם הפרויקט</label>
          <input type="text" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} disabled={isDeploying} className="w-full px-4 py-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20" placeholder="my-awesome-app" />
          <p className="text-[10px] text-muted-foreground">אותיות קטנות, מספרים ומקפים בלבד</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold">קובץ ZIP</label>
          <div className="relative group">
            <input type="file" accept=".zip" onChange={e => e.target.files && setFile(e.target.files[0])} disabled={isDeploying} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className={cn("border-2 border-dashed border-border rounded-2xl p-8 text-center transition-all group-hover:border-primary/50 group-hover:bg-primary/5", file && "border-primary bg-primary/5")}>
              <Upload className={cn("w-10 h-10 mx-auto mb-3 text-muted-foreground", file && "text-primary")} />
              <p className="text-sm font-medium">{file ? file.name : 'גרור קובץ ZIP לכאן או לחץ לבחירה'}</p>
              <p className="text-xs text-muted-foreground mt-1">מקסימום 50MB</p>
            </div>
          </div>
        </div>
        {error && <div className="p-4 bg-red-500/10 text-red-600 rounded-xl text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
        {isDeploying ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between text-sm font-medium"><span>{steps[step]}</span><span>{Math.round(((step + 1) / steps.length) * 100)}%</span></div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden"><motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
            {deploymentStatus && <p className="text-[10px] text-center text-primary font-mono">{deploymentStatus}</p>}
            <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse"><Loader2 className="w-3 h-3 animate-spin" /><span>אנא המתן, עשוי לקחת מספר דקות...</span></div>
          </div>
        ) : (
          <button onClick={deploy} className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20">התחל פריסה</button>
        )}
      </div>
    </motion.div>
  );
}

// --- ProjectDetail ---
function ProjectDetail({ project, settings, onUpdate }: { project: Project, settings: AppSettings, onUpdate: (p: Project) => void }) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateFile, setUpdateFile] = useState<File | null>(null);
  const [updateStep, setUpdateStep] = useState('');
  const [deploymentStatus, setDeploymentStatus] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(project.previewUrl || null);
  const [newBranch, setNewBranch] = useState<string | null>(project.previewBranch || null);
  const [deployments, setDeployments] = useState<Deployment[]>(project.deployments || []);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const [activeTab, setActiveTab] = useState<'update' | 'history'>('update');

  useEffect(() => {
    if (project.previewUrl) setPreviewUrl(project.previewUrl);
    if (project.previewBranch) setNewBranch(project.previewBranch);
    if (project.deployments?.length) setDeployments(project.deployments);
    else fetchDeployments();
  }, [project.cloudflareProject]);

  const fetchDeployments = async () => {
    if (!settings.cloudflareApiKey || !settings.cloudflareAccountId) return;
    setIsLoadingDeployments(true);
    try {
      const r = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${project.cloudflareProject}/deployments`, { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } });
      if (r.ok) {
        const d = await r.json();
        if (d.success && d.result) {
          const sorted = [...d.result].sort((a: any, b: any) => new Date(a.created_on).getTime() - new Date(b.created_on).getTime());
          const deps: Deployment[] = sorted.map((dep: any, idx: number) => ({
            id: dep.id, created_on: dep.created_on,
            url: dep.url || `https://${dep.id}.${project.cloudflareProject}.pages.dev`,
            status: dep.latest_stage?.status || dep.status || 'idle',
            environment: dep.environment || 'production',
            branch: dep.deployment_trigger?.metadata?.branch || dep.meta?.github_branch,
            commit_message: dep.meta?.github_commit_message || dep.deployment_trigger?.metadata?.commit_message,
            versionNumber: idx + 1
          })).reverse();
          setDeployments(deps);
          onUpdate({ ...project, deployments: deps });
          // Auto-refresh if any deployment is progressing
          const hasProgressing = deps.some(d => d.status === 'progressing' || d.status === 'active' || d.status === 'queued');
          if (hasProgressing) setTimeout(fetchDeployments, 10000);
        }
      }
    } catch {} finally { setIsLoadingDeployments(false); }
  };

  const promoteToProduction = async (dep: Deployment) => {
    const isPreview = dep.environment === 'preview';
    const targetBranch = project.productionBranch || 'main';

    if (!confirm(`להפוך פריסה זו לגרסת הייצור?`)) return;
    setIsUpdating(true); setUpdateStep(isPreview ? 'ממזג ל-main...' : 'מבצע rollback...');
    try {
      if (!isPreview) {
        // Production rollback via Cloudflare
        const r = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${project.cloudflareProject}/deployments/${dep.id}/rollback`, { method: 'POST', headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}`, 'Content-Type': 'application/json' } });
        if (!r.ok) { const e = await r.json(); throw new Error(e.errors?.[0]?.message || 'נכשל'); }
        alert('✅ Rollback בוצע! גרסה זו פעילה בייצור.');
      } else {
        if (!dep.branch) throw new Error('לא ניתן לזהות את ה-branch');
        if (!settings.githubToken) throw new Error('חסר GitHub Token');
        const r = await fetch(`/api/github/repos/${project.githubRepo}/merges`, { method: 'POST', headers: { Authorization: `token ${settings.githubToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ base: targetBranch, head: dep.branch, commit_message: `Promote ${dep.branch} to production` }) });
        if (!r.ok && r.status !== 204) { const e = await r.json(); throw new Error(e.message || `שגיאת GitHub: ${r.status}`); }
        alert(`✅ מוזג ל-${targetBranch}! Cloudflare יפרוס אוטומטית.`);
      }
      fetchDeployments();
      onUpdate({ ...project, lastDeployment: new Date().toISOString(), status: 'success' });
    } catch (e: any) { alert(`שגיאה: ${e.message}`); }
    finally { setIsUpdating(false); setUpdateStep(''); }
  };

  const handleUpdate = async () => {
    if (!updateFile) return;
    setIsUpdating(true); setUpdateStep('מנתח קובץ...');
    try {
      const { filesToUpload, hasFunctions, hasPackageJson, packageJsonContent } = await extractZip(updateFile);
      const { buildCommand, destinationDir } = hasPackageJson ? detectFramework(packageJsonContent) : { buildCommand: "", destinationDir: "." };
      if (hasPackageJson || hasFunctions) filesToUpload.push({ path: 'wrangler.toml', content: safeBtoa(`#:schema node_modules/wrangler/config-schema.json\ncompatibility_date = "2024-01-01"\npages_build_config = { build_command = "${buildCommand}", destination_dir = "${destinationDir}" }`) });
      setUpdateStep('מעדכן Cloudflare...');
      const dc = { environment_variables: { NODE_VERSION: "18" }, build_command: buildCommand, destination_dir: destinationDir };
      await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${project.cloudflareProject}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ build_config: { build_command: buildCommand, destination_dir: destinationDir, root_dir: "" }, deployment_configs: { production: dc, preview: dc } }) });
      const branchName = `deploy-${Date.now()}`;
      setNewBranch(branchName);
      setUpdateStep('יוצר ענף...');
      let bd: any = null, productionBranch = 'main';
      for (const b of ['main', 'master']) {
        const r = await fetch(`/api/github/repos/${project.githubRepo}/branches/${b}`, { headers: { Authorization: `token ${settings.githubToken}` } });
        if (r.ok) { bd = await r.json(); productionBranch = b; break; }
      }
      if (!bd) throw new Error('לא נמצא ענף main/master');
      const rr = await fetch(`/api/github/repos/${project.githubRepo}/git/refs`, { method: 'POST', headers: { Authorization: `token ${settings.githubToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: bd.commit.sha }) });
      if (!rr.ok) throw new Error(`נכשל ביצירת ענף: ${(await rr.json()).message}`);
      setUpdateStep('מעלה קבצים...');
      await uploadFilesToGithub(filesToUpload, project.githubRepo, branchName, settings.githubToken, `Update ${branchName}`);
      setUpdateStep('ממתין לפריסה...');
      let deployed = false, attempts = 0, finalPreviewUrl = `https://${branchName}.${project.cloudflareProject}.pages.dev`;
      while (!deployed && attempts < 30) {
        attempts++; await new Promise(r => setTimeout(r, 6000));
        try {
          const dr = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${project.cloudflareProject}/deployments`, { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } });
          if (dr.ok) { const dd = await dr.json(); if (dd.result?.length > 0) { const l = dd.result.find((x: any) => x.meta?.github_branch === branchName) || dd.result[0]; const s = l.latest_stage?.status || l.status; if (s === 'success') { deployed = true; if (l.url) finalPreviewUrl = l.url; } else if (s === 'failure') throw new Error('הפריסה נכשלה.'); else setDeploymentStatus(`${s}... (${attempts}/30)`); } }
        } catch (e: any) { if (e.message.includes('נכשלה')) throw e; }
      }
      setPreviewUrl(finalPreviewUrl);
      onUpdate({ ...project, previewUrl: finalPreviewUrl, previewBranch: branchName, lastDeployment: new Date().toISOString(), productionBranch });
      await fetchDeployments();
    } catch (e: any) { alert(`עדכון נכשל: ${e.message}`); } finally { setIsUpdating(false); setUpdateStep(''); }
  };

  const mergeToMain = async () => {
    const b = newBranch || project.previewBranch;
    if (!b) { alert('לא נמצא ענף למיזוג.'); return; }
    const tb = project.productionBranch || 'main';
    try {
      setUpdateStep(`ממזג ל-${tb}...`);
      const r = await fetch(`/api/github/repos/${project.githubRepo}/merges`, { method: 'POST', headers: { Authorization: `token ${settings.githubToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ base: tb, head: b, commit_message: 'Promote preview to production' }) });
      if (!r.ok) throw new Error((await r.json()).message || `שגיאת GitHub`);
      alert('מוזג בהצלחה!');
      setPreviewUrl(null); setNewBranch(null);
      onUpdate({ ...project, previewUrl: undefined, previewBranch: undefined });
    } catch (e: any) { alert(`מיזוג נכשל: ${e.message}`); } finally { setUpdateStep(''); }
  };

  const statusInfo = (s: string) => ({
    success: { color: 'text-green-600 bg-green-500/10', label: 'הצליח', dot: 'bg-green-500' },
    active: { color: 'text-green-600 bg-green-500/10', label: 'הצליח', dot: 'bg-green-500' },
    failure: { color: 'text-red-600 bg-red-500/10', label: 'נכשל', dot: 'bg-red-500' },
    progressing: { color: 'text-blue-600 bg-blue-500/10 animate-pulse', label: 'בבנייה...', dot: 'bg-blue-500' },
    queued: { color: 'text-blue-600 bg-blue-500/10', label: 'בתור', dot: 'bg-blue-500' },
  }[s] || { color: 'text-muted-foreground bg-muted', label: s, dot: 'bg-muted-foreground' });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{project.name}</h2>
          <div className="flex items-center gap-2 mt-1"><Github className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground font-mono">{project.githubRepo}</span></div>
        </div>
        <div className="flex gap-3">
          {project.productionUrl && <a href={project.productionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-semibold transition-colors"><Globe className="w-4 h-4" /><span>צפה באתר</span></a>}
          <a href={`https://dash.cloudflare.com/${settings.cloudflareAccountId}/pages/view/${project.cloudflareProject}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-sm font-semibold transition-colors"><Cloud className="w-4 h-4" /><span>Cloudflare</span></a>
        </div>
      </div>

      <div className="flex border-b border-border gap-6">
        <button onClick={() => setActiveTab('update')} className={cn("pb-3 text-sm font-semibold border-b-2 transition-colors", activeTab === 'update' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>עדכון פרויקט</button>
        <button onClick={() => { setActiveTab('history'); if (!deployments.length) fetchDeployments(); }} className={cn("pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2", activeTab === 'history' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
          <History className="w-4 h-4" />היסטוריית פריסות
          {deployments.length > 0 && <span className="bg-muted text-xs px-1.5 py-0.5 rounded-full">{deployments.length}</span>}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'update' && (
          <motion.div key="update" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-card border border-border rounded-3xl p-6 sm:p-8">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-primary" /><span>עדכון פרויקט</span></h3>
                <p className="text-muted-foreground mb-6">העלה ZIP חדש לגרסת תצוגה מקדימה.</p>
                <div className="space-y-4">
                  <div className="relative group">
                    <input type="file" accept=".zip" onChange={e => e.target.files && setUpdateFile(e.target.files[0])} disabled={isUpdating} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                    <div className={cn("border-2 border-dashed border-border rounded-2xl p-6 text-center transition-all group-hover:border-primary/50", updateFile && "border-primary bg-primary/5")}>
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" /><p className="text-sm font-medium">{updateFile ? updateFile.name : 'בחר קובץ ZIP'}</p>
                    </div>
                  </div>
                  <button onClick={handleUpdate} disabled={!updateFile || isUpdating} className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold hover:opacity-90 disabled:opacity-50">
                    {isUpdating ? <div className="flex flex-col items-center gap-1"><div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /><span>{updateStep}</span></div>{deploymentStatus && <p className="text-[10px] opacity-70">{deploymentStatus}</p>}</div> : 'העלה עדכון'}
                  </button>
                </div>
              </div>
              {previewUrl && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-primary/5 border border-primary/20 rounded-3xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-primary flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /><span>תצוגה מקדימה מוכנה!</span></h3>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-sm font-bold flex items-center gap-1 hover:underline"><span>פתח</span><ExternalLink className="w-4 h-4" /></a>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">הגרסה נפרסה. בדוק לפני מיזוג לייצור.</p>
                  <button onClick={mergeToMain} disabled={!!updateStep} className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50">
                    {updateStep?.includes('ממזג') ? <Loader2 className="w-5 h-5 animate-spin" /> : <GitMerge className="w-5 h-5" />}
                    <span>{updateStep?.includes('ממזג') ? updateStep : 'מזג ל-Main (ייצור)'}</span>
                  </button>
                </motion.div>
              )}
            </div>
            <div className="space-y-6">
              <div className="bg-card border border-border rounded-3xl p-6">
                <h4 className="font-bold mb-4">פרטי פריסה</h4>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">סטטוס:</span><span className="font-medium text-green-600">פעיל</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">ענף ייצור:</span><span className="font-mono">{project.productionBranch || 'main'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">עדכון אחרון:</span><span>{project.lastDeployment ? new Date(project.lastDeployment).toLocaleDateString('he-IL') : 'מעולם לא'}</span></div>
                  {deployments.length > 0 && <div className="flex justify-between"><span className="text-muted-foreground">פריסות:</span><span>{deployments.length}</span></div>}
                </div>
              </div>
              <div className="bg-muted/50 border border-border rounded-3xl p-6"><h4 className="font-bold mb-2">צריך עזרה?</h4><p className="text-sm text-muted-foreground">וודא ש-ZIP מכיל index.html בשורש וש-API keys תקינים.</p></div>
            </div>
          </motion.div>
        )}
        {activeTab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-primary" />היסטוריית פריסות</h3>
              <button onClick={fetchDeployments} disabled={isLoadingDeployments} className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50">
                {isLoadingDeployments ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}<span>רענן</span>
              </button>
            </div>
            {isLoadingDeployments && !deployments.length ? (
              <div className="flex flex-col items-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary mb-3" /><p className="text-muted-foreground text-sm">טוען היסטוריה...</p></div>
            ) : !deployments.length ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl"><History className="w-12 h-12 mx-auto mb-3 opacity-30 text-muted-foreground" /><p className="text-muted-foreground">אין היסטוריה זמינה</p><button onClick={fetchDeployments} className="mt-3 text-primary text-sm hover:underline">טען מ-Cloudflare</button></div>
            ) : (
              <div className="space-y-3">
                {deployments.map((dep, idx) => {
                  const si = statusInfo(dep.status);
                  const isProduction = dep.environment === 'production';
                  const isMain = dep.branch === 'main' || dep.branch === 'master';
                  return (
                    <motion.div key={dep.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                      className={cn("rounded-3xl border overflow-hidden transition-all", isProduction ? "border-primary/30 bg-primary/5 ring-1 ring-primary/10" : "bg-card border-border")}>
                      <div className="p-5">
                        {/* Row 1: version + status + env + link */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground border border-border">גרסה #{dep.versionNumber}</span>
                            <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5", si.color)}>
                              {dep.status === 'progressing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className={cn("w-1.5 h-1.5 rounded-full", si.dot)} />}
                              {si.label}
                            </span>
                            {isProduction ? (
                              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-yellow-500/10 text-yellow-600 flex items-center gap-1"><Star className="w-3 h-3 fill-current" />ייצור</span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-primary/10 text-primary">תצוגה מקדימה</span>
                            )}
                          </div>
                          {dep.url && <a href={dep.url} target="_blank" rel="noopener noreferrer" className="p-2 text-muted-foreground hover:text-primary transition-colors"><ExternalLink className="w-4 h-4" /></a>}
                        </div>
                        {/* Row 2: branch + commit */}
                        {dep.branch && (
                          <div className="flex items-center gap-2 mb-2">
                            <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className={cn("font-mono text-sm", isMain && "text-primary font-bold")}>{dep.branch}</span>
                            {isMain && <Star className="w-3 h-3 text-yellow-500 fill-current" />}
                          </div>
                        )}
                        {dep.commit_message && (
                          <div className="bg-background/50 rounded-2xl p-3 border border-border/50 mb-2">
                            <p className="text-sm font-medium">{dep.commit_message}</p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4"><Clock className="w-3.5 h-3.5" />{formatDate(dep.created_on)}</p>
                        {/* Promote button */}
                        {dep.status === 'success' && !isProduction && (
                          <button onClick={() => promoteToProduction(dep)} disabled={isUpdating} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-background border border-border hover:border-primary hover:bg-primary/5 rounded-2xl text-sm font-bold transition-all disabled:opacity-50">
                            {isUpdating && updateStep ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4 text-muted-foreground" />}
                            <span>{isUpdating && updateStep ? updateStep : (dep.branch === 'main' || dep.branch === 'master' ? 'שחזר גרסה זו (Rollback)' : `מזג ל-${project.productionBranch || 'main'}`)}</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
