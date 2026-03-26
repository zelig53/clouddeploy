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
  Key, Shield, Zap, ChevronRight, ChevronDown, FileText, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { cn } from './lib/utils';

// --- Types ---
type View = 'dashboard' | 'create' | 'settings' | 'project-detail' | 'github-import';

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
    const d = await res.json();
    blobs.push({ path: f.path, sha: d.sha, mode: '100644', type: 'blob' });
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

// ============================================================
// --- DeleteConfirmModal (מחיקה כפולה — אישור נפרד לכל שירות) ---
// ============================================================
function DeleteConfirmModal({ project, settings, onConfirm, onCancel }: {
  project: Project, settings: AppSettings,
  onConfirm: () => void, onCancel: () => void
}) {
  // step: 'initial' | 'confirm-cf' | 'confirm-gh' | 'deleting'
  const [step, setStep] = useState<'initial' | 'confirm-cf' | 'confirm-gh' | 'deleting'>('initial');
  const [cfConfirmed, setCfConfirmed] = useState(false);
  const [ghConfirmed, setGhConfirmed] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState('');
  const [error, setError] = useState('');

  const hasGithub = project.githubRepo && project.githubRepo !== 'unknown';

  const handleConfirmCf = () => {
    setCfConfirmed(true);
    if (hasGithub) {
      setStep('confirm-gh');
    } else {
      runDelete(true, false);
    }
  };

  const handleConfirmGh = () => {
    setGhConfirmed(true);
    runDelete(true, true);
  };

  const runDelete = async (deleteCf: boolean, deleteGh: boolean) => {
    setStep('deleting');
    setError('');
    const errors: string[] = [];

    if (deleteCf) {
      try {
        setDeleteStatus('מוחק מ-Cloudflare Pages...');
        const cfRes = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${project.cloudflareProject}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` }
        });
        if (!cfRes.ok && cfRes.status !== 404) {
          const d = await cfRes.json();
          errors.push(`Cloudflare: ${d.errors?.[0]?.message || cfRes.status}`);
        }
      } catch (e: any) { errors.push(`Cloudflare: ${e.message}`); }
    }

    if (deleteGh && hasGithub) {
      try {
        setDeleteStatus('מוחק מאגר GitHub...');
        const ghRes = await fetch(`/api/github/repos/${project.githubRepo}`, {
          method: 'DELETE',
          headers: {
            Authorization: `token ${settings.githubToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          }
        });
        if (!ghRes.ok && ghRes.status !== 404) {
          const d = await ghRes.json();
          errors.push(`GitHub: ${d.message || ghRes.status}`);
        }
      } catch (e: any) { errors.push(`GitHub: ${e.message}`); }
    }

    if (errors.length > 0) {
      setError(`שגיאות:\n${errors.join('\n')}\nהפרויקט הוסר מהרשימה המקומית בכל מקרה.`);
      setTimeout(() => { onConfirm(); }, 3000);
    } else {
      onConfirm();
    }
  };

  const isDeleting = step === 'deleting';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={!isDeleting ? onCancel : undefined} className="fixed inset-0 bg-black/80 z-[200]" />
      <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="fixed inset-0 z-[201] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 border-2 border-red-200 dark:border-red-900 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.4)] p-6 max-w-sm w-full space-y-5" dir="rtl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center shrink-0"><Trash2 className="w-6 h-6 text-red-600" /></div>
            <div><h3 className="text-lg font-bold">מחיקת פרויקט</h3><p className="text-sm text-muted-foreground">{project.name}</p></div>
          </div>

          {/* Step indicator */}
          {hasGithub && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn("px-2 py-1 rounded-full font-semibold", cfConfirmed ? "bg-green-500/20 text-green-700 dark:text-green-400" : "bg-orange-500/20 text-orange-700 dark:text-orange-400")}>
                {cfConfirmed ? '✓' : '1'} Cloudflare
              </span>
              <span className="text-border">→</span>
              <span className={cn("px-2 py-1 rounded-full font-semibold", ghConfirmed ? "bg-green-500/20 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground")}>
                {ghConfirmed ? '✓' : '2'} GitHub
              </span>
            </div>
          )}

          <div className="bg-red-50 dark:bg-red-950 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4 space-y-2 text-sm">
            <p className="font-bold text-red-700 dark:text-red-400 text-base">⚠️ פעולה זו תמחק לצמיתות!</p>
            {/* Cloudflare confirmation */}
            {step === 'initial' && (
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <Cloud className="w-4 h-4 shrink-0 text-red-500" />
                <span>האם למחוק פרויקט Cloudflare: <b className="text-red-700 dark:text-red-400">{project.cloudflareProject}</b>?</span>
              </div>
            )}
            {step === 'confirm-gh' && (
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <Github className="w-4 h-4 shrink-0 text-red-500" />
                <span>האם למחוק מאגר GitHub: <b className="text-red-700 dark:text-red-400">{project.githubRepo}</b>?</span>
              </div>
            )}
            {isDeleting && (
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <Cloud className="w-4 h-4 shrink-0 text-red-500" /><span>פרויקט Cloudflare: <b className="text-red-700 dark:text-red-400">{project.cloudflareProject}</b></span>
              </div>
            )}
            {isDeleting && hasGithub && (
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <Github className="w-4 h-4 shrink-0 text-red-500" /><span>מאגר GitHub: <b className="text-red-700 dark:text-red-400">{project.githubRepo}</b></span>
              </div>
            )}
          </div>

          {isDeleting && (
            <div className="flex items-center gap-3 bg-muted/50 rounded-xl px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
              <p className="text-sm font-medium">{deleteStatus}</p>
            </div>
          )}

          {error && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 whitespace-pre-line">{error}</div>
          )}

          <div className="flex gap-3">
            {step === 'initial' && (
              <>
                <button onClick={handleConfirmCf} className="flex-1 bg-red-600 text-white py-3 rounded-2xl font-bold hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
                  <Cloud className="w-4 h-4" /><span>אשר מחיקת Cloudflare</span>
                </button>
                <button onClick={onCancel} className="px-5 py-3 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-2xl font-bold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors border border-zinc-300 dark:border-zinc-600">ביטול</button>
              </>
            )}
            {step === 'confirm-gh' && (
              <>
                <button onClick={handleConfirmGh} className="flex-1 bg-red-600 text-white py-3 rounded-2xl font-bold hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
                  <Github className="w-4 h-4" /><span>אשר מחיקת GitHub</span>
                </button>
                <button onClick={onCancel} className="px-5 py-3 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-2xl font-bold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors border border-zinc-300 dark:border-zinc-600">ביטול</button>
              </>
            )}
            {isDeleting && (
              <div className="flex-1 bg-red-600/60 text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                <Loader2 className="w-4 h-4 animate-spin" /><span>מוחק...</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ============================================================
// --- HelpCenterModal — מרכז הדרכה מלא ---
// ============================================================
const HELP_STEPS = [
  {
    id: 'intro',
    icon: <Zap className="w-5 h-5" />,
    label: 'מבוא',
    color: 'from-violet-600 to-purple-700',
    accent: '#7c3aed',
    title: 'מה זה CloudDeploy?',
    subtitle: 'אוטומציה מלאה של פריסה לענן',
    content: (
      <div className="space-y-4">
        <div className="bg-gradient-to-l from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/40 border border-violet-200 dark:border-violet-800 rounded-2xl p-4 text-sm leading-relaxed">
          <p className="font-bold text-violet-800 dark:text-violet-300 text-base mb-2">💡 הרעיון בקצרה</p>
          <p className="text-gray-700 dark:text-gray-300">CloudDeploy מחבר בין <b>GitHub</b> ל-<b>Cloudflare Pages</b> — ומאפשר לך לפרוס, לנהל ולמחוק פרויקטים מהנייד, ללא צורך בשורת פקודה.</p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {[
            { icon: '🚀', title: 'פריסה מהירה', desc: 'בחר מאגר GitHub ותוך שניות הוא עולה ל-Cloudflare Pages' },
            { icon: '📱', title: 'ניהול מהנייד', desc: 'לוח בקרה מלא שעובד כ-PWA ישירות ממסך הבית שלך' },
            { icon: '🔄', title: 'סנכרון אוטומטי', desc: 'כל push ל-GitHub מפרוס אוטומטית את האתר שלך' },
            { icon: '🗑️', title: 'מחיקה בטוחה', desc: 'מחיקה כפולה עם אישור — מגנה מפני טעויות' },
          ].map(item => (
            <div key={item.title} className="flex items-start gap-3 bg-card border border-border rounded-xl p-3">
              <span className="text-2xl shrink-0">{item.icon}</span>
              <div><p className="font-bold text-sm">{item.title}</p><p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p></div>
            </div>
          ))}
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
          <b>🔁 הזרימה הבסיסית:</b> הגדרות (API Keys) ← ייבוא מאגר ← הפרויקט חי ← שינויים עוברים אוטומטית
        </div>
      </div>
    ),
  },
  {
    id: 'settings',
    icon: <Key className="w-5 h-5" />,
    label: 'הגדרות',
    color: 'from-gray-700 to-gray-900',
    accent: '#374151',
    title: 'חיבור מפתחות API',
    subtitle: 'שלב ראשון — חובה לפני כל דבר',
    content: (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">האפליקציה צריכה שלושה מפתחות כדי לעבוד. כולם חינמיים ומתקבלים בכמה קליקים:</p>

        {/* GitHub Token */}
        <div className="border-2 border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-l from-gray-800 to-gray-900 px-4 py-3 flex items-center gap-2 text-white">
            <Github className="w-4 h-4" /><span className="font-bold text-sm">GitHub Personal Access Token</span>
          </div>
          <div className="p-4 space-y-2">
            {[
              'פתח github.com ← לחץ על תמונת הפרופיל',
              'Settings ← Developer settings ← Personal access tokens',
              'Tokens (classic) ← Generate new token (classic)',
              'שם: "CloudDeploy" | תוקף: No expiration',
              <span key="scope">סמן: <span className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded font-mono text-xs font-bold">repo</span> + <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 rounded font-mono text-xs font-bold">delete_repo</span></span>,
              <span key="copy"><b>Generate token</b> ← <span className="text-red-600 font-bold">העתק מיד!</span> (לא יוצג שוב)</span>,
            ].map((step, i) => (
              <div key={i} className="flex gap-2.5 items-start text-sm">
                <span className="w-5 h-5 rounded-full bg-gray-800 dark:bg-gray-600 text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i+1}</span>
                <div className="leading-relaxed">{step}</div>
              </div>
            ))}
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 mt-2">
              ⚠️ ללא <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">delete_repo</code> מחיקת פרויקטים לא תעבוד
            </div>
          </div>
        </div>

        {/* Cloudflare Token */}
        <div className="border-2 border-orange-200 dark:border-orange-800 rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-l from-orange-500 to-orange-700 px-4 py-3 flex items-center gap-2 text-white">
            <Cloud className="w-4 h-4" /><span className="font-bold text-sm">Cloudflare API Token</span>
          </div>
          <div className="p-4 space-y-2">
            {[
              <span key="1">פתח <b>dash.cloudflare.com</b> ← My Profile ← API Tokens</span>,
              'Create Token ← Custom Token (Get started)',
              'שם: "CloudDeploy"',
              <div key="perms" className="space-y-1">
                <span>הוסף הרשאות:</span>
                <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg px-3 py-2 font-mono text-xs space-y-1 mt-1">
                  <div>Account → <b>Cloudflare Pages</b> → Edit</div>
                  <div>Account → <b>Account Settings</b> → Read</div>
                </div>
              </div>,
              <span key="5">Continue to summary ← <b>Create Token</b> ← <span className="text-red-600 font-bold">העתק מיד!</span></span>,
            ].map((step, i) => (
              <div key={i} className="flex gap-2.5 items-start text-sm">
                <span className="w-5 h-5 rounded-full bg-orange-600 text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i+1}</span>
                <div className="leading-relaxed">{step}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Account ID */}
        <div className="border-2 border-blue-200 dark:border-blue-800 rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-l from-blue-500 to-blue-700 px-4 py-3 flex items-center gap-2 text-white">
            <Shield className="w-4 h-4" /><span className="font-bold text-sm">Cloudflare Account ID</span>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <p>ה-Account ID נמצא ב-URL של Cloudflare:</p>
            <div className="bg-muted rounded-xl p-3 font-mono text-xs break-all text-center leading-relaxed">
              dash.cloudflare.com/<span className="bg-yellow-200 dark:bg-yellow-700/60 text-black dark:text-yellow-200 px-1.5 py-0.5 rounded font-bold animate-pulse">8a2b3c4d5e6f7g8h</span>/pages
            </div>
            <p className="text-muted-foreground text-xs">העתק את המחרוזת הארוכה שבין הלוכסנים</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'import',
    icon: <Github className="w-5 h-5" />,
    label: 'ייבוא',
    color: 'from-indigo-600 to-blue-700',
    accent: '#4f46e5',
    title: 'ייבוא וחיבור פרויקטים',
    subtitle: 'שני מסלולים — בחר את המתאים לך',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          {/* Track A */}
          <div className="border-2 border-indigo-200 dark:border-indigo-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-l from-indigo-600 to-blue-700 px-4 py-3 text-white">
              <p className="font-bold text-sm">🔵 מסלול א׳ — סנכרון מ-Cloudflare</p>
              <p className="text-xs text-white/80 mt-0.5">כשיש לך כבר פרויקטים פעילים ב-Cloudflare Pages</p>
            </div>
            <div className="p-4 space-y-2">
              {['לחץ "סנכרן מ-Cloudflare" בלוח הבקרה', 'הפרויקטים הקיימים יופיעו אוטומטית', 'לחץ על פרויקט כדי לנהל אותו'].map((s, i) => (
                <div key={i} className="flex gap-2.5 items-start text-sm">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i+1}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Track B */}
          <div className="border-2 border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-l from-gray-800 to-gray-900 px-4 py-3 text-white">
              <p className="font-bold text-sm">⚫ מסלול ב׳ — ייבוא מ-GitHub</p>
              <p className="text-xs text-white/80 mt-0.5">כשרוצים לפרוס מאגר GitHub חדש ל-Cloudflare</p>
            </div>
            <div className="p-4 space-y-2">
              {[
                'לחץ "ייבוא מ-GitHub" — רשימת המאגרים שלך תופיע',
                'חפש מאגר ← לחץ "פרוס ל-Cloudflare"',
                'CloudDeploy יוצר אוטומטית דף חדש ב-Cloudflare Pages',
                'הפרויקט מופיע בלוח הבקרה ומוכן לניהול',
              ].map((s, i) => (
                <div key={i} className="flex gap-2.5 items-start text-sm">
                  <span className="w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i+1}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Track C */}
          <div className="border-2 border-green-200 dark:border-green-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-l from-green-600 to-emerald-700 px-4 py-3 text-white">
              <p className="font-bold text-sm">🟢 מסלול ג׳ — פרויקט חדש לגמרי</p>
              <p className="text-xs text-white/80 mt-0.5">יוצר מאגר GitHub + דף Cloudflare בבת אחת</p>
            </div>
            <div className="p-4 space-y-2">
              {[
                'לחץ "פרויקט חדש" ← מלא שם ותיאור',
                'CloudDeploy יוצר מאגר GitHub ריק',
                'ומחבר אותו אוטומטית ל-Cloudflare Pages',
                'תוך שניות הפרויקט חי ומוכן!',
              ].map((s, i) => (
                <div key={i} className="flex gap-2.5 items-start text-sm">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i+1}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'manage',
    icon: <LayoutGrid className="w-5 h-5" />,
    label: 'ניהול',
    color: 'from-teal-600 to-cyan-700',
    accent: '#0d9488',
    title: 'ניהול ופריסה',
    subtitle: 'כל מה שאפשר לעשות עם פרויקט קיים',
    content: (
      <div className="space-y-4">
        {/* Card anatomy */}
        <p className="text-sm text-muted-foreground">כרטיס פרויקט מכיל את כל המידע במבט אחד:</p>
        <div className="border-2 border-teal-200 dark:border-teal-800 rounded-2xl p-4 space-y-3 bg-card">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-primary/10 rounded-xl text-primary"><Github className="w-4 h-4" /></div>
            <div className="flex items-center gap-1">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center"><Globe className="w-3.5 h-3.5 text-muted-foreground" /></div>
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center"><Cloud className="w-3.5 h-3.5 text-muted-foreground" /></div>
              <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5 text-red-400" /></div>
            </div>
          </div>
          <div>
            <p className="font-bold text-sm">my-awesome-site</p>
            <p className="text-xs text-muted-foreground font-mono">username/my-awesome-site</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="bg-green-500/10 text-green-600 px-2 py-1 rounded-full font-medium">פעיל</span>
            <span className="text-muted-foreground">26.3.2026</span>
          </div>
          <div className="flex items-center justify-end text-primary text-xs font-semibold">
            <span>נהל פרויקט</span><ArrowLeft className="w-3 h-3 mr-1" />
          </div>
        </div>
        {/* Legend */}
        <div className="space-y-2">
          {[
            { icon: <Globe className="w-4 h-4 text-primary" />, label: 'כפתור גלובוס', desc: 'פתיחת האתר החי בדפדפן' },
            { icon: <Cloud className="w-4 h-4 text-orange-500" />, label: 'כפתור ענן', desc: 'מעבר ישיר לדשבורד Cloudflare של הפרויקט' },
            { icon: <Trash2 className="w-4 h-4 text-red-500" />, label: 'כפתור מחיקה', desc: 'מחיקה בטוחה עם אישור כפול' },
            { icon: <History className="w-4 h-4 text-muted-foreground" />, label: 'מספר הפריסות', desc: 'כמה פעמים הפרויקט נפרס עד כה' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3 text-sm bg-muted/40 rounded-xl px-3 py-2.5">
              <span className="shrink-0">{item.icon}</span>
              <div><span className="font-semibold">{item.label}</span> — <span className="text-muted-foreground text-xs">{item.desc}</span></div>
            </div>
          ))}
        </div>
        <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-xl p-3 text-xs text-teal-800 dark:text-teal-300">
          💡 לחיצה על הכרטיס פותחת את דף הפרויקט המלא עם היסטוריית פריסות ואפשרות עדכון
        </div>
      </div>
    ),
  },
  {
    id: 'delete',
    icon: <Trash2 className="w-5 h-5" />,
    label: 'מחיקה',
    color: 'from-red-600 to-rose-700',
    accent: '#dc2626',
    title: 'מחיקה בטוחה',
    subtitle: 'מנגנון אישור כפול — לא ניתן לטעות',
    content: (
      <div className="space-y-4">
        <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-800 rounded-2xl p-4 text-sm space-y-2">
          <p className="font-bold text-red-700 dark:text-red-400">⚠️ מחיקה היא בלתי הפיכה!</p>
          <p className="text-gray-700 dark:text-gray-300 text-xs">CloudDeploy מוחק גם מ-Cloudflare Pages וגם מ-GitHub — ולכן דורש אישור נפרד לכל שירות.</p>
        </div>
        {/* Flow */}
        <div className="space-y-3">
          {[
            { step: 1, color: 'bg-orange-100 dark:bg-orange-950/40 border-orange-300 dark:border-orange-700', icon: <Trash2 className="w-4 h-4 text-orange-600" />, title: 'לחיצה על סמל המחיקה', desc: 'נפתח חלון אישור עם פרטי הפרויקט' },
            { step: 2, color: 'bg-orange-100 dark:bg-orange-950/40 border-orange-300 dark:border-orange-700', icon: <Cloud className="w-4 h-4 text-orange-600" />, title: 'אישור ראשון — Cloudflare', desc: 'לחץ "אשר מחיקת Cloudflare" לאישור מחיקת הדף מ-Cloudflare Pages' },
            { step: 3, color: 'bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-700', icon: <Github className="w-4 h-4 text-red-600" />, title: 'אישור שני — GitHub', desc: 'לחץ "אשר מחיקת GitHub" לאישור מחיקת המאגר מ-GitHub' },
            { step: 4, color: 'bg-green-100 dark:bg-green-950/40 border-green-300 dark:border-green-700', icon: <Check className="w-4 h-4 text-green-600" />, title: 'מחיקה מתבצעת', desc: 'CloudDeploy מוחק משני השירותים ומסיר מלוח הבקרה' },
          ].map(item => (
            <div key={item.step} className={`border-2 rounded-xl p-3 flex gap-3 items-start ${item.color}`}>
              <div className="w-8 h-8 rounded-xl bg-white/60 dark:bg-black/20 flex items-center justify-center shrink-0">{item.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{item.title}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
          💡 ניתן לבטל בכל שלב עם כפתור "ביטול" — הפרויקט לא ייפגע
        </div>
      </div>
    ),
  },
  {
    id: 'pwa',
    icon: <Smartphone className="w-5 h-5" />,
    label: 'התקנה',
    color: 'from-green-600 to-emerald-700',
    accent: '#16a34a',
    title: 'התקנה כאפליקציה (PWA)',
    subtitle: 'גישה מיידית ממסך הבית — ללא App Store',
    content: (
      <div className="space-y-4">
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-2xl p-4 text-sm">
          <p className="font-bold text-green-700 dark:text-green-400 mb-1">✅ יתרונות ה-PWA</p>
          <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
            <li>• נפתח כאפליקציה מלאה ללא שורת הכתובת</li>
            <li>• עובד גם במצב לא מקוון (Offline)</li>
            <li>• מתעדכן אוטומטית בכל פתיחה</li>
            <li>• נראה ומרגיש בדיוק כמו אפליקציה רגילה</li>
          </ul>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {/* Android */}
          <div className="border-2 border-green-200 dark:border-green-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-l from-green-600 to-emerald-700 px-4 py-3 text-white flex items-center gap-2">
              <span className="text-lg">🤖</span><span className="font-bold text-sm">Android — Chrome</span>
            </div>
            <div className="p-4 space-y-2.5">
              {[
                { icon: '🌐', text: 'פתח את CloudDeploy ב-Chrome' },
                { icon: '⋮', text: 'לחץ על תפריט שלוש הנקודות (פינה ימנית עליונה)' },
                { icon: '📲', text: 'בחר "הוסף למסך הבית" או "התקן אפליקציה"' },
                { icon: '✅', text: 'לחץ "הוסף" — האפליקציה מופיעה כאייקון!' },
              ].map((item, i) => (
                <div key={i} className="flex gap-3 items-center text-sm">
                  <span className="w-7 h-7 bg-green-100 dark:bg-green-900/40 rounded-lg flex items-center justify-center text-base shrink-0">{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
              <div className="bg-green-50 dark:bg-green-950/30 rounded-xl p-2.5 text-xs text-green-800 dark:text-green-300 mt-1">
                💡 Chrome עשוי להציג באנר "התקן" אוטומטית בתחתית המסך
              </div>
            </div>
          </div>
          {/* iPhone */}
          <div className="border-2 border-blue-200 dark:border-blue-800 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-l from-blue-500 to-blue-700 px-4 py-3 text-white flex items-center gap-2">
              <span className="text-lg">🍎</span><span className="font-bold text-sm">iPhone / iPad — Safari בלבד</span>
            </div>
            <div className="p-4 space-y-2.5">
              {[
                { icon: '🧭', text: 'פתח את CloudDeploy ב-Safari (חובה! לא Chrome)' },
                { icon: '⬆️', text: 'לחץ על כפתור השיתוף (תחתית המסך)' },
                { icon: '➕', text: 'גלול ובחר "הוסף למסך הבית"' },
                { icon: '✅', text: 'לחץ "הוסף" (פינה ימנית עליונה)' },
              ].map((item, i) => (
                <div key={i} className="flex gap-3 items-center text-sm">
                  <span className="w-7 h-7 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center text-base shrink-0">{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-xl p-2.5 text-xs text-amber-800 dark:text-amber-300 mt-1">
                ⚠️ ב-iPhone, ב-Chrome אין אפשרות להתקין — חייב להשתמש ב-Safari
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'tips',
    icon: <Star className="w-5 h-5" />,
    label: 'טיפים',
    color: 'from-amber-500 to-orange-600',
    accent: '#d97706',
    title: 'טיפים מתקדמים',
    subtitle: 'שימוש חכם יותר ב-CloudDeploy',
    content: (
      <div className="space-y-3">
        {[
          {
            icon: '🔑', title: 'אבטח את המפתחות',
            desc: 'אל תשתף את ה-Tokens עם אף אחד. אם חשפת טוקן — בטל אותו מיד ב-GitHub/Cloudflare וצור חדש.',
          },
          {
            icon: '📌', title: 'No Expiration — אבל בזהירות',
            desc: 'טוקן ללא תפוגה נוח, אבל אם הוא נגנב — הנזק גדול יותר. הגדר תזכורת לחידוש כל 6 חודשים.',
          },
          {
            icon: '🔄', title: 'סנכרן לפני שאתה מנהל',
            desc: 'לחץ "סנכרן מ-Cloudflare" בכל פעם שחזרת לאפליקציה — כדי לוודא שהנתונים עדכניים.',
          },
          {
            icon: '🗑️', title: 'מחיקה חלקית אפשרית',
            desc: 'אם אתה רוצה למחוק רק מ-Cloudflare (ולהשאיר את ה-GitHub) — לחץ ביטול אחרי האישור הראשון.',
          },
          {
            icon: '🌐', title: 'דומיין מותאם אישית',
            desc: 'אחרי פריסה, ניתן להגדיר דומיין משלך ישירות ב-Cloudflare Pages — CloudDeploy לא עוסק בזה, אבל מספק לינק ישיר לדשבורד.',
          },
          {
            icon: '📊', title: 'עקוב אחרי פריסות',
            desc: 'כמות הפריסות בכרטיס מציגה כמה פעמים הפרויקט עודכן. גדול = פרויקט פעיל ובריא.',
          },
        ].map(tip => (
          <div key={tip.title} className="flex gap-3 items-start bg-card border border-border rounded-xl p-3">
            <span className="text-xl shrink-0 mt-0.5">{tip.icon}</span>
            <div><p className="font-bold text-sm">{tip.title}</p><p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{tip.desc}</p></div>
          </div>
        ))}
      </div>
    ),
  },
];

function HelpCenterModal({ onClose }: { onClose: () => void }) {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/85 backdrop-blur-md z-[300]"
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        className="fixed inset-0 z-[301] flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <div className="w-full sm:max-w-xl sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col overflow-hidden bg-white dark:bg-zinc-900" style={{maxHeight: '92vh'}}>

          {/* Header */}
          <div className="bg-gradient-to-l from-primary to-primary/80 px-5 py-4 text-primary-foreground flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center"><BookOpen className="w-5 h-5" /></div>
              <div>
                <h3 className="font-bold text-lg leading-tight">מרכז הדרכה</h3>
                <p className="text-primary-foreground/70 text-xs">מדריך שימוש מלא ב-CloudDeploy</p>
              </div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step tabs — horizontal scroll */}
          <div className="flex overflow-x-auto border-b border-border bg-zinc-100 dark:bg-zinc-800 shrink-0 scrollbar-hide">
            {HELP_STEPS.map((step, i) => (
              <button
                key={step.id}
                onClick={() => setActiveStep(i)}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-2.5 text-[10px] font-bold shrink-0 border-b-2 transition-all min-w-[64px]",
                  activeStep === i
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:bg-muted/60"
                )}
              >
                <span className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-all",
                  activeStep === i ? "bg-primary text-primary-foreground scale-110" : "bg-muted"
                )}>{step.icon}</span>
                <span className="leading-tight text-center">{step.label}</span>
              </button>
            ))}
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted shrink-0">
            <motion.div
              className="h-full bg-primary"
              animate={{ width: `${((activeStep + 1) / HELP_STEPS.length) * 100}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            />
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 p-5 bg-white dark:bg-zinc-900 help-modal-body" dir="rtl">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeStep}
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                {/* Step title */}
                <div className={`rounded-2xl p-4 text-white bg-gradient-to-l ${HELP_STEPS[activeStep].color}`}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-xl">{HELP_STEPS[activeStep].icon}</div>
                    <div>
                      <h4 className="font-bold text-base">{HELP_STEPS[activeStep].title}</h4>
                      <p className="text-white/75 text-xs mt-0.5">{HELP_STEPS[activeStep].subtitle}</p>
                    </div>
                  </div>
                </div>
                {HELP_STEPS[activeStep].content}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer navigation */}
          <div className="flex gap-3 p-4 border-t border-border bg-zinc-50 dark:bg-zinc-800 shrink-0">
            <button
              onClick={() => setActiveStep(p => Math.max(0, p - 1))}
              disabled={activeStep === 0}
              className="flex-1 py-3 rounded-2xl bg-muted text-foreground font-bold text-sm hover:bg-muted/80 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              <ChevronRight className="w-4 h-4" /><span>הקודם</span>
            </button>
            <span className="flex items-center text-xs text-muted-foreground font-medium shrink-0">
              {activeStep + 1} / {HELP_STEPS.length}
            </span>
            {activeStep < HELP_STEPS.length - 1 ? (
              <button
                onClick={() => setActiveStep(p => Math.min(HELP_STEPS.length - 1, p + 1))}
                className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
              >
                <span>הבא</span><ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-all flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /><span>הבנתי!</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
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
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [showHelpCenter, setShowHelpCenter] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);

    // iOS Safari doesn't fire beforeinstallprompt — detect and show iOS instructions
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.navigator as any).standalone;
    if (isIOS && !isStandalone) {
      setTimeout(() => setShowInstallSheet(true), 2000);
    }

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

  const handleDeleteConfirmed = () => {
    if (projectToDelete) {
      setProjects(prev => prev.filter(p => p.id !== projectToDelete.id));
      setProjectToDelete(null);
    }
  };

  if (!isInitialized) return null;

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden" dir="rtl">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between min-w-0">
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
            {/* שיפור #4 - כפתור התקנה קבוע בסרגל */}
            {!isInstalled && deferredPrompt && (
              <button onClick={handleInstall} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white hover:bg-green-600 rounded-full transition-colors shadow-sm">
                <Smartphone className="w-4 h-4" /><span className="text-xs font-bold">התקן</span>
              </button>
            )}
            <button onClick={() => setShowHelpCenter(true)} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-primary" title="מרכז הדרכה">
              <HelpCircle className="w-5 h-5" />
            </button>
            <button onClick={toggleTheme} className="p-2 hover:bg-muted rounded-full transition-colors">{settings.theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}</button>
            <button onClick={() => navigateTo('settings')} className="p-2 hover:bg-muted rounded-full transition-colors"><SettingsIcon className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 overflow-x-hidden min-w-0">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && <Dashboard projects={projects} onNewProject={() => navigateTo('create')} onSelectProject={(p) => navigateTo('project-detail', p)} onDeleteProject={(p) => setProjectToDelete(p)} settings={settings} onSync={setProjects} onGithubImport={() => navigateTo('github-import')} onShowHelp={() => setShowHelpCenter(true)} />}
          {view === 'create' && <CreateProject settings={settings} onSuccess={(p) => { setProjects(prev => [p, ...prev]); navigateTo('dashboard'); }} />}
          {view === 'settings' && <Settings settings={settings} onSave={setSettings} onInstall={handleInstall} isInstallAvailable={!!deferredPrompt && !isInstalled} isInstalled={isInstalled} />}
          {view === 'project-detail' && selectedProject && <ProjectDetail project={selectedProject} settings={settings} onUpdate={(u) => { setProjects(prev => prev.map(p => p.id === u.id ? u : p)); setSelectedProject(u); }} onDeleteProject={(p) => setProjectToDelete(p)} />}
          {view === 'github-import' && <GithubImport settings={settings} projects={projects} onImported={(p) => { setProjects(prev => { const exists = prev.find(x => x.id === p.id); return exists ? prev.map(x => x.id === p.id ? p : x) : [p, ...prev]; }); }} />}
        </AnimatePresence>
      </main>

      <footer className="border-t border-border py-4 px-4 text-center text-muted-foreground text-xs">
        <p>© {new Date().getFullYear()} CloudDeploy — פריסה מהירה לענן</p>
      </footer>

      {/* Install Bottom Sheet */}
      <AnimatePresence>
        {showInstallSheet && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowInstallSheet(false)} className="fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed bottom-0 left-0 right-0 bg-background border-t border-border rounded-t-[2.5rem] z-[101] p-8 pb-12 shadow-2xl">
              <div className="max-w-md mx-auto space-y-6">
                {/* שיפור #5 - אייקון CloudUpload בSheet */}
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shrink-0"><CloudUpload className="w-9 h-9" /></div>
                  <div>
                    <h3 className="text-2xl font-bold">התקינו את CloudDeploy</h3>
                    <p className="text-muted-foreground text-sm">גישה מהירה ממסך הבית, גם בלי אינטרנט</p>
                  </div>
                </div>
                {deferredPrompt ? (
                  <div className="flex gap-3">
                    <button onClick={handleInstall} className="flex-1 bg-primary text-primary-foreground py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
                      <Download className="w-5 h-5" /><span>התקן עכשיו</span>
                    </button>
                    <button onClick={() => setShowInstallSheet(false)} className="px-8 py-4 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-2xl font-bold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-all border border-zinc-300 dark:border-zinc-600">אחר כך</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-sm space-y-2 text-gray-800 dark:text-gray-200">
                      <p className="font-bold text-blue-700 dark:text-blue-300">📱 התקנה ב-iOS / Safari:</p>
                      <p>1. לחץ על כפתור <b>שתף</b> 📤 בתחתית הדפדפן</p>
                      <p>2. גלול ובחר <b>"הוסף למסך הבית"</b> 📲</p>
                      <p>3. לחץ <b>"הוסף"</b> בפינה העליונה</p>
                    </div>
                    <button onClick={() => setShowInstallSheet(false)} className="w-full py-4 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-2xl font-bold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-all border border-zinc-300 dark:border-zinc-600">הבנתי</button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* שיפור #3 - Delete Confirm Modal */}
      <AnimatePresence>
        {projectToDelete && (
          <DeleteConfirmModal
            project={projectToDelete}
            settings={settings}
            onConfirm={handleDeleteConfirmed}
            onCancel={() => setProjectToDelete(null)}
          />
        )}
      </AnimatePresence>

      {/* מרכז הדרכה */}
      <AnimatePresence>
        {showHelpCenter && <HelpCenterModal onClose={() => setShowHelpCenter(false)} />}
      </AnimatePresence>
    </div>
  );
}

// =================================================================
// --- Dashboard (שיפור #1 - Pagination + שיפור #3 + שיפור #6) ---
// =================================================================
function Dashboard({ projects, onNewProject, onSelectProject, onDeleteProject, settings, onSync, onGithubImport, onShowHelp }: {
  projects: Project[], onNewProject: () => void, onSelectProject: (p: Project) => void,
  onDeleteProject: (p: Project) => void, settings: AppSettings, onSync: (p: Project[]) => void,
  onGithubImport: () => void, onShowHelp: () => void
}) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const PER_PAGE = 10;

  // שיפור #1 - Pagination: טעינת עמוד ספציפי
  const loadPage = async (page: number, isMore: boolean) => {
    if (!settings.cloudflareApiKey || !settings.cloudflareAccountId || !settings.githubToken) {
      alert('נא להגדיר מפתחות API בהגדרות'); return;
    }
    if (isMore) setIsLoadingMore(true); else { setIsSyncing(true); setSyncProgress('מתחבר ל-Cloudflare...'); }
    try {
      if (!isMore) setSyncProgress(`טוען פרויקטים (עמוד ${page})...`);
      const res = await fetch(
        `/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects?page=${page}&per_page=${PER_PAGE}`,
        { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } }
      );
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.errors?.[0]?.message || `שגיאת Cloudflare API`);
      const cfProjects = data.result || [];
      const ri = data.result_info;
      const tp = ri?.total_pages || 1;
      const tc = ri?.total_count || cfProjects.length;
      setTotalPages(tp);
      setHasMore(page < tp);
      setCurrentPage(page);

      if (!isMore) setSyncProgress(`נמצאו ${tc} פרויקטים, טוען פריסות...`);
      const synced: Project[] = [];
      for (let i = 0; i < cfProjects.length; i++) {
        const cf = cfProjects[i];
        if (!isMore) setSyncProgress(`טוען: ${cf.name} (${i + 1}/${cfProjects.length})`);
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
      if (isMore) {
        // Merge — avoid duplicates
        onSync([...projects, ...synced.filter(s => !projects.find(p => p.cloudflareProject === s.cloudflareProject))]);
      } else {
        onSync(synced);
        setSyncProgress('');
        alert(`נטענו ${synced.length} פרויקטים (עמוד ${page}/${tp})`);
      }
    } catch (e: any) { alert(`שגיאה: ${e.message}`); }
    finally { setIsSyncing(false); setIsLoadingMore(false); setSyncProgress(''); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-4 w-full">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-md border border-primary/20 shrink-0"><CloudUpload className="w-8 h-8" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-bold tracking-tight">לוח בקרה</h2>
            <p className="text-muted-foreground">נהל את הפרויקטים שלך ופרוס ל-Cloudflare Pages</p>
          </div>
          <button onClick={onShowHelp} className="shrink-0 w-10 h-10 rounded-2xl bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors" title="מרכז הדרכה">
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="action-buttons-row">
          {/* שיפור #6 - Loading state בכפתור סנכרון */}
          <button onClick={() => loadPage(1, false)} disabled={isSyncing || isLoadingMore} className="action-btn inline-flex items-center justify-center gap-2 bg-muted rounded-xl font-semibold hover:bg-muted/80 transition-all disabled:opacity-70">
            {isSyncing ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <RefreshCw className="w-5 h-5 shrink-0" />}
            <span className="truncate">{isSyncing ? 'טוען...' : 'סנכרן מ-Cloudflare'}</span>
          </button>
          <button onClick={onGithubImport} className="action-btn inline-flex items-center justify-center gap-2 bg-zinc-800 dark:bg-zinc-700 text-white rounded-xl font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-all">
            <Github className="w-5 h-5 shrink-0" /><span className="truncate">ייבוא מ-GitHub</span>
          </button>
          <button onClick={onNewProject} className="action-btn inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 transition-all shadow-lg shadow-primary/20">
            <Plus className="w-5 h-5 shrink-0" /><span className="truncate">פרויקט חדש</span>
          </button>
        </div>
      </div>

      {/* שיפור #6 - Progress indicator */}
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
        <>
          <div className="projects-grid">
            {projects.map((project) => (
              <motion.div
                key={project.id}
                layoutId={project.id}
                className="project-card group bg-card border border-border rounded-2xl p-6 hover:shadow-xl transition-all cursor-pointer"
                onClick={() => onSelectProject(project)}
              >
                {/* שורה עליונה: אייקון + כפתורי פעולה — גובה קבוע */}
                <div className="flex items-center justify-between mb-4 shrink-0" style={{height: '40px'}}>
                  <div className="p-2.5 bg-primary/10 rounded-xl text-primary shrink-0"><Github className="w-5 h-5" /></div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {project.productionUrl
                      ? <a href={project.productionUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors rounded-lg hover:bg-muted/50"><Globe className="w-4 h-4" /></a>
                      : <span className="w-8 h-8" />
                    }
                    <a href={`https://dash.cloudflare.com/${settings.cloudflareAccountId}/pages/view/${project.cloudflareProject}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors rounded-lg hover:bg-muted/50"><Cloud className="w-4 h-4" /></a>
                    <button onClick={e => { e.stopPropagation(); onDeleteProject(project); }} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors rounded-lg hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* שם הפרויקט — חתוך אם ארוך */}
                <h4 className="project-card-title text-lg font-bold mb-1 shrink-0">{project.name}</h4>

                {/* שם המאגר — חתוך עם ellipsis */}
                <p className="project-card-repo text-sm text-muted-foreground mb-3 font-mono shrink-0">{project.githubRepo}</p>

                {/* מרווח גמיש */}
                <div className="flex-1" />

                {/* מידע תחתון — גובה קבוע */}
                <div className="shrink-0 space-y-3">
                  {project.deployments && project.deployments.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><History className="w-3.5 h-3.5 shrink-0" /><span>{project.deployments.length} פריסות</span></div>
                  )}
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn("px-2 py-1 rounded-full font-medium shrink-0", project.status === 'success' ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground")}>
                      {project.status === 'success' ? 'פעיל' : 'ממתין'}
                    </span>
                    {project.lastDeployment && <span className="text-muted-foreground truncate">{new Date(project.lastDeployment).toLocaleDateString('he-IL')}</span>}
                  </div>
                  <div className="flex items-center justify-end text-primary font-semibold text-sm group-hover:translate-x-[-4px] transition-transform">
                    <span>נהל פרויקט</span><ArrowLeft className="w-4 h-4 mr-1" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* שיפור #1 - כפתור "טען עוד" */}
          {hasMore && (
            <div className="flex flex-col items-center gap-2 pt-4">
              <p className="text-xs text-muted-foreground">מציג {projects.length} פרויקטים — יש עוד</p>
              <button
                onClick={() => loadPage(currentPage + 1, true)}
                disabled={isLoadingMore || isSyncing}
                className="inline-flex items-center gap-2 bg-card border border-border px-8 py-3 rounded-xl font-semibold hover:bg-muted/50 transition-all disabled:opacity-70 shadow-sm"
              >
                {isLoadingMore ? <><Loader2 className="w-5 h-5 animate-spin" /><span>טוען...</span></> : <><ChevronDown className="w-5 h-5" /><span>טען עוד פרויקטים</span></>}
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

// --- Settings (שיפור #4 + #5) ---
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
      setTestResult({ success: true, message: `✅ מחובר! נמצאו ${d.result?.length || 0} פרויקטים בעמוד הראשון.` });
    } catch (e: any) { setTestResult({ success: false, message: e.message }); }
    finally { setIsTesting(false); }
  };

  const guideData: Record<string, { label: string, icon: React.ReactNode, color: string, steps: React.ReactNode[], note?: string }> = {
    github: {
      label: 'GitHub Token', icon: <Github className="w-5 h-5" />, color: 'from-gray-700 to-gray-900',
      steps: [
        <span>היכנס ל-<b>GitHub.com</b> ← לחץ על תמונת הפרופיל</span>,
        <span>בחר <b>Settings</b> ← גלול למטה ← <b>Developer settings</b></span>,
        <span><b>Personal access tokens</b> ← <b>Tokens (classic)</b></span>,
        <span>לחץ <b>Generate new token (classic)</b></span>,
        <span>שם: "CloudDeploy" | תוקף: "No expiration"</span>,
        <span>סמן <b>repo</b> (+ <b>delete_repo</b> למחיקה)</span>,
        <span>לחץ <b>Generate token</b> — <b>העתק מיד!</b></span>,
      ],
      note: '⚠️ סמן גם delete_repo כדי שמחיקת פרויקטים תעבוד!'
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
      note: '⚠️ העתק את הטוקן מיד — לא יוצג שוב!'
    },
    account: {
      label: 'Account ID', icon: <Key className="w-5 h-5" />, color: 'from-blue-500 to-blue-700',
      steps: [
        <span>היכנס ל-<a href="https://dash.cloudflare.com" target="_blank" className="text-white underline">dash.cloudflare.com</a></span>,
        <span>ה-Account ID נמצא ישירות בכתובת ה-URL:</span>,
        <div className="bg-white/20 rounded-lg px-3 py-2 font-mono text-xs break-all">dash.cloudflare.com/<span className="bg-yellow-300 text-black px-1 rounded font-bold">8a2b3c4d5e6f...</span>/pages</div>,
        <span>העתק את המחרוזת הארוכה שאחרי הלוכסן הראשון</span>,
      ]
    },
    install: {
      label: 'התקנה', icon: <Smartphone className="w-5 h-5" />, color: 'from-green-500 to-green-700',
      steps: [
        <span><b>Android (Chrome):</b> תפריט ⋮ ← "הוסף למסך הבית"</span>,
        <span><b>iPhone (Safari בלבד):</b> כפתור שיתוף ⬆️ ← "הוסף למסך הבית"</span>,
        <span>לחץ <b>הוסף</b> — מופיע כאפליקציה עצמאית!</span>,
      ],
      note: '💡 ב-iPhone חייב Safari (לא Chrome)'
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

      <AnimatePresence>
        {showGuide && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-card border-2 border-primary/20 rounded-[2rem] shadow-2xl overflow-hidden">
              <div className="bg-gradient-to-l from-primary to-primary/80 p-5 text-primary-foreground flex items-center gap-3">
                <div className="p-2.5 bg-white/20 rounded-xl"><BookOpen className="w-5 h-5" /></div>
                <div><h3 className="text-lg font-bold">מדריך שלב-אחרי-שלב</h3><p className="text-primary-foreground/80 text-sm">מיועד לכולם</p></div>
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
                      <div className="flex items-center gap-3"><div className="p-2 bg-white/20 rounded-lg">{guideData[guideTab].icon}</div><h4 className="font-bold text-lg">{guideData[guideTab].label}</h4></div>
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
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300 font-medium">{guideData[guideTab].note}</div>
                    )}
                    {guideTab === 'account' && (
                      <div className="border border-border rounded-xl overflow-hidden bg-background">
                        <div className="bg-muted px-3 py-2 text-[10px] text-muted-foreground font-mono">שורת הכתובת</div>
                        <div className="p-4 font-mono text-xs flex flex-wrap gap-1">
                          <span className="text-muted-foreground">dash.cloudflare.com/</span>
                          <span className="bg-yellow-200 dark:bg-yellow-700 text-black dark:text-white px-2 py-0.5 rounded font-bold animate-pulse">8a2b3c4d5e6f7g8h9i0j</span>
                          <span className="text-muted-foreground">/pages</span>
                        </div>
                      </div>
                    )}
                    {guideTab === 'install' && (
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

      <div className="space-y-6 bg-card border border-border rounded-3xl p-6 sm:p-8">
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

      {/* שיפור #4 - Install Section */}
      {isInstalled ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-green-600 shrink-0"><CheckCircle2 className="w-6 h-6" /></div>
          <div><h4 className="font-bold text-green-700 dark:text-green-400">האפליקציה מותקנת ✓</h4><p className="text-sm text-muted-foreground">פועל כאפליקציה עצמאית</p></div>
        </div>
      ) : isInstallAvailable ? (
        /* שיפור #4 - כפתור התקנה ישיר */
        <button onClick={onInstall} className="w-full bg-green-500 text-white rounded-2xl p-5 flex items-center gap-4 hover:bg-green-600 transition-colors shadow-lg shadow-green-500/20">
          {/* שיפור #5 - אייקון CloudUpload */}
          <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><CloudUpload className="w-8 h-8" /></div>
          <div className="flex-1 text-right">
            <h4 className="font-bold text-xl">התקן את CloudDeploy</h4>
            <p className="text-green-100 text-sm">הוסף למסך הבית — גישה מהירה בלחיצה אחת</p>
          </div>
          <Download className="w-7 h-7 opacity-80" />
        </button>
      ) : isIOS ? (
        <div className="bg-blue-500/5 border-2 border-blue-500/20 rounded-2xl overflow-hidden">
          <div className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600 shrink-0"><Smartphone className="w-6 h-6" /></div>
            <div className="flex-1 text-right"><h4 className="font-bold text-blue-700 dark:text-blue-400 text-lg">התקן על iPhone / iPad</h4><p className="text-sm text-muted-foreground">עקוב אחרי 3 שלבים פשוטים</p></div>
          </div>
          <div className="px-5 pb-5 space-y-3 border-t border-border">
            {[
              { icon: '1️⃣', text: 'פתח את הדף ב-Safari (לא Chrome!)', accent: true },
              { icon: '2️⃣', text: 'לחץ על כפתור השיתוף ⬆️ בתחתית המסך' },
              { icon: '3️⃣', text: 'בחר "הוסף למסך הבית" ← לחץ "הוסף"' },
            ].map((s, i) => (
              <div key={i} className={cn("flex items-center gap-3 rounded-xl px-4 py-3", s.accent ? "bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800" : "bg-muted/50")}>
                <span className="text-xl">{s.icon}</span>
                <span className="text-sm font-medium">{s.text}</span>
              </div>
            ))}
          </div>
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
          if (dr.ok) { const dd = await dr.json(); if (dd.result?.length > 0) { const l = dd.result[0]; const s = l.latest_stage?.status || l.status; if (s === 'success') { deployed = true; if (l.url) finalUrl = l.url; } else if (s === 'failure') throw new Error('הפריסה נכשלה.'); else setDeploymentStatus(`${s}... (${attempts}/30)`); } }
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse"><Loader2 className="w-3 h-3 animate-spin" /><span>אנא המתן...</span></div>
          </div>
        ) : (
          <button onClick={deploy} className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20">התחל פריסה</button>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================
// --- ProjectDetail (שיפור #2 - הערת גרסה + שיפור #3 + #6) ---
// ============================================================
function ProjectDetail({ project, settings, onUpdate, onDeleteProject }: {
  project: Project, settings: AppSettings,
  onUpdate: (p: Project) => void, onDeleteProject: (p: Project) => void
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateFile, setUpdateFile] = useState<File | null>(null);
  const [updateStep, setUpdateStep] = useState('');
  const [deploymentStatus, setDeploymentStatus] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(project.previewUrl || null);
  const [newBranch, setNewBranch] = useState<string | null>(project.previewBranch || null);
  const [deployments, setDeployments] = useState<Deployment[]>(project.deployments || []);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const [activeTab, setActiveTab] = useState<'update' | 'history'>('update');
  // שיפור #2 - הערת גרסה
  const [releaseNote, setReleaseNote] = useState('');

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
        const r = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${project.cloudflareProject}/deployments/${dep.id}/rollback`, { method: 'POST', headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}`, 'Content-Type': 'application/json' } });
        if (!r.ok) { const e = await r.json(); throw new Error(e.errors?.[0]?.message || 'נכשל'); }
        alert('✅ Rollback בוצע!');
      } else {
        if (!dep.branch) throw new Error('לא ניתן לזהות את ה-branch');
        if (!settings.githubToken) throw new Error('חסר GitHub Token');
        const r = await fetch(`/api/github/repos/${project.githubRepo}/merges`, { method: 'POST', headers: { Authorization: `token ${settings.githubToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ base: targetBranch, head: dep.branch, commit_message: `Promote ${dep.branch} to production` }) });
        if (!r.ok && r.status !== 204) { const e = await r.json(); throw new Error(e.message || `שגיאת GitHub`); }
        alert(`✅ מוזג ל-${targetBranch}!`);
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
      // שיפור #2 - הערת גרסה נשלחת כ-commit message
      const commitMsg = releaseNote.trim()
        ? `Update ${branchName}: ${releaseNote.trim()}`
        : `Update ${branchName}`;
      await uploadFilesToGithub(filesToUpload, project.githubRepo, branchName, settings.githubToken, commitMsg);
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
      setReleaseNote('');
      onUpdate({ ...project, previewUrl: finalPreviewUrl, previewBranch: branchName, lastDeployment: new Date().toISOString(), productionBranch });
      await fetchDeployments();
    } catch (e: any) { alert(`עדכון נכשל: ${e.message}`); } finally { setIsUpdating(false); setUpdateStep(''); }
  };

  const mergeToMain = async () => {
    const b = newBranch || project.previewBranch;
    if (!b) { alert('לא נמצא ענף.'); return; }
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
        <div className="flex gap-2 flex-wrap">
          {project.productionUrl && <a href={project.productionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-semibold transition-colors"><Globe className="w-4 h-4" /><span>צפה באתר</span></a>}
          <a href={`https://dash.cloudflare.com/${settings.cloudflareAccountId}/pages/view/${project.cloudflareProject}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-sm font-semibold transition-colors"><Cloud className="w-4 h-4" /><span>Cloudflare</span></a>
          {/* שיפור #3 - כפתור מחיקה בפרויקט */}
          <button onClick={() => onDeleteProject(project)} className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-xl text-sm font-semibold transition-colors"><Trash2 className="w-4 h-4" /><span>מחק פרויקט</span></button>
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

                  {/* שיפור #2 - שדה הערת גרסה */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" /><span>הערת גרסה (אופציונלי)</span></label>
                    <textarea
                      value={releaseNote}
                      onChange={e => setReleaseNote(e.target.value)}
                      disabled={isUpdating}
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20 text-sm resize-none"
                      placeholder="תאר מה השתנה בגרסה זו... (יישמר כ-commit message)"
                    />
                  </div>

                  {/* שיפור #6 - Loading state בכפתור */}
                  <button onClick={handleUpdate} disabled={!updateFile || isUpdating} className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold hover:opacity-90 transition-all disabled:opacity-50">
                    {isUpdating ? (
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /><span>{updateStep}</span></div>
                        {deploymentStatus && <p className="text-[10px] opacity-70">{deploymentStatus}</p>}
                      </div>
                    ) : 'העלה עדכון'}
                  </button>
                </div>
              </div>
              {previewUrl && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-primary/5 border border-primary/20 rounded-3xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-primary flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /><span>תצוגה מקדימה מוכנה!</span></h3>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-sm font-bold flex items-center gap-1 hover:underline"><span>פתח</span><ExternalLink className="w-4 h-4" /></a>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">בדוק את הגרסה לפני מיזוג לייצור.</p>
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
              <div className="bg-muted/50 border border-border rounded-3xl p-6"><h4 className="font-bold mb-2">טיפ: הרשאות GitHub</h4><p className="text-sm text-muted-foreground">לצורך מחיקת פרויקטים, וודא שה-Token שלך כולל הרשאת <b>delete_repo</b>.</p></div>
            </div>
          </motion.div>
        )}
        {activeTab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-primary" />היסטוריית פריסות</h3>
              {/* שיפור #6 - Loading state */}
              <button onClick={fetchDeployments} disabled={isLoadingDeployments} className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50">
                {isLoadingDeployments ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span>{isLoadingDeployments ? 'טוען...' : 'רענן'}</span>
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
                      className={cn("rounded-3xl border overflow-hidden", isProduction ? "border-primary/30 bg-primary/5 ring-1 ring-primary/10" : "bg-card border-border")}>
                      <div className="p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground border border-border">גרסה #{dep.versionNumber}</span>
                            <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5", si.color)}>
                              {dep.status === 'progressing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className={cn("w-1.5 h-1.5 rounded-full", si.dot)} />}
                              {si.label}
                            </span>
                            {isProduction ? <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-yellow-500/10 text-yellow-600 flex items-center gap-1"><Star className="w-3 h-3 fill-current" />ייצור</span> : <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-primary/10 text-primary">תצוגה מקדימה</span>}
                          </div>
                          {dep.url && <a href={dep.url} target="_blank" rel="noopener noreferrer" className="p-2 text-muted-foreground hover:text-primary transition-colors"><ExternalLink className="w-4 h-4" /></a>}
                        </div>
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
                        {dep.status === 'success' && !isProduction && (
                          <button onClick={() => promoteToProduction(dep)} disabled={isUpdating} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-background border border-border hover:border-primary hover:bg-primary/5 rounded-2xl text-sm font-bold transition-all disabled:opacity-50">
                            {isUpdating && updateStep ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4 text-muted-foreground" />}
                            <span>{isUpdating && updateStep ? updateStep : (isMain ? 'שחזר גרסה זו (Rollback)' : `מזג ל-${project.productionBranch || 'main'}`)}</span>
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

// ============================================================
// --- GithubImport — ייבוא מאגרים מ-GitHub לפרויקטים ---
// ============================================================
interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  updated_at: string;
  language: string | null;
  stargazers_count: number;
  default_branch: string;
}

function GithubImport({ settings, projects, onImported }: {
  settings: AppSettings,
  projects: Project[],
  onImported: (p: Project) => void
}) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [deployingRepo, setDeployingRepo] = useState<string | null>(null);
  const [deletingRepo, setDeletingRepo] = useState<string | null>(null);
  const [repoToDelete, setRepoToDelete] = useState<GithubRepo | null>(null);
  const [deployProgress, setDeployProgress] = useState('');
  const [successRepos, setSuccessRepos] = useState<Set<string>>(new Set());

  const PER_PAGE = 20;

  useEffect(() => { loadRepos(1, false); }, []);

  const loadRepos = async (p: number, append: boolean) => {
    if (!settings.githubToken) { setError('נא להגדיר GitHub Token בהגדרות'); return; }
    setIsLoading(true); setError('');
    try {
      const r = await fetch(`/api/github/user/repos?per_page=${PER_PAGE}&page=${p}&sort=updated&type=all`, {
        headers: { Authorization: `token ${settings.githubToken}`, Accept: 'application/vnd.github.v3+json' }
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.message || `שגיאת GitHub: ${r.status}`); }
      const data: GithubRepo[] = await r.json();
      setHasMore(data.length === PER_PAGE);
      setPage(p);
      if (append) setRepos(prev => [...prev, ...data]);
      else setRepos(data);
    } catch (e: any) { setError(e.message); }
    finally { setIsLoading(false); }
  };

  const deployRepo = async (repo: GithubRepo) => {
    if (!settings.cloudflareApiKey || !settings.cloudflareAccountId) {
      alert('נא להגדיר Cloudflare API Token ו-Account ID בהגדרות');
      return;
    }
    const cfName = repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').substring(0, 58);
    if (!confirm(`לחבר את "${repo.full_name}" ל-Cloudflare Pages כ-"${cfName}"?`)) return;

    setDeployingRepo(repo.full_name);
    setDeployProgress('יוצר פרויקט ב-Cloudflare Pages...');
    try {
      // Check if CF project already exists
      const checkRes = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${cfName}`, {
        headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` }
      });

      let actualName = cfName;
      let productionUrl = `https://${cfName}.pages.dev`;

      if (!checkRes.ok) {
        // Create Cloudflare Pages project linked to existing GitHub repo
        const [owner, repoName] = repo.full_name.split('/');
        const cfRes = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cfName,
            build_config: { build_command: "", destination_dir: ".", root_dir: "" },
            deployment_configs: {
              production: { environment_variables: { NODE_VERSION: "18" } },
              preview: { environment_variables: { NODE_VERSION: "18" } }
            },
            source: {
              type: "github",
              config: {
                owner,
                repo_name: repoName,
                production_branch: repo.default_branch || 'main',
                pr_comments_enabled: true,
                deployments_enabled: true
              }
            }
          })
        });
        const cfData = await cfRes.json();
        if (!cfRes.ok || cfData.success === false) throw new Error(`שגיאת Cloudflare: ${cfData.errors?.[0]?.message || cfRes.status}`);
        actualName = cfData.result?.name || cfName;
        productionUrl = cfData.result?.subdomain ? `https://${cfData.result.subdomain}` : `https://${actualName}.pages.dev`;
      } else {
        const cfData = await checkRes.json();
        actualName = cfData.result?.name || cfName;
        productionUrl = cfData.result?.subdomain ? `https://${cfData.result.subdomain}` : productionUrl;
      }

      setDeployProgress('ממתין לפריסה הראשונה...');

      // Wait for deployment
      let attempts = 0, finalUrl = productionUrl;
      while (attempts < 15) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        try {
          const dr = await fetch(`/api/cloudflare/accounts/${settings.cloudflareAccountId}/pages/projects/${actualName}/deployments`, { headers: { 'Authorization': `Bearer ${settings.cloudflareApiKey}` } });
          if (dr.ok) {
            const dd = await dr.json();
            if (dd.result?.length > 0) {
              const l = dd.result[0];
              const s = l.latest_stage?.status || l.status;
              if (s === 'success') { if (l.url) finalUrl = l.url; break; }
              if (s === 'failure') break;
              setDeployProgress(`סטטוס: ${s}... (${attempts}/15)`);
            }
          }
        } catch {}
      }

      const newProject: Project = {
        id: `gh-${repo.id}-${Date.now()}`,
        name: actualName,
        githubRepo: repo.full_name,
        cloudflareProject: actualName,
        lastDeployment: new Date().toISOString(),
        status: 'success',
        productionUrl: finalUrl,
        productionBranch: repo.default_branch || 'main'
      };
      onImported(newProject);
      setSuccessRepos(prev => new Set([...prev, repo.full_name]));
      alert(`✅ "${repo.name}" מחובר ל-Cloudflare Pages בהצלחה!`);
    } catch (e: any) { alert(`שגיאה: ${e.message}`); }
    finally { setDeployingRepo(null); setDeployProgress(''); }
  };

  const deleteRepo = async (repo: GithubRepo) => {
    setDeletingRepo(repo.full_name);
    try {
      const r = await fetch(`/api/github/repos/${repo.full_name}`, {
        method: 'DELETE',
        headers: {
          Authorization: `token ${settings.githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        }
      });
      if (r.ok || r.status === 204 || r.status === 404) {
        setRepos(prev => prev.filter(x => x.full_name !== repo.full_name));
        setRepoToDelete(null);
        alert(`✅ המאגר "${repo.name}" נמחק מ-GitHub`);
      } else {
        const d = await r.json();
        throw new Error(d.message || `שגיאה: ${r.status}`);
      }
    } catch (e: any) { alert(`מחיקה נכשלה: ${e.message}`); }
    finally { setDeletingRepo(null); }
  };

  const filtered = repos.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const isAlreadyDeployed = (repo: GithubRepo) =>
    projects.some(p => p.githubRepo === repo.full_name) || successRepos.has(repo.full_name);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-white shadow-md shrink-0"><Github className="w-8 h-8" /></div>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">ייבוא מ-GitHub</h2>
          <p className="text-muted-foreground">בחר מאגר וחבר אותו אוטומטית ל-Cloudflare Pages</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חפש מאגר..."
          className="w-full px-5 py-3 pr-12 rounded-2xl border border-border bg-card outline-none focus:ring-2 focus:ring-primary/20 text-sm"
        />
        <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 text-red-600 rounded-2xl text-sm flex items-center gap-2 border border-red-500/20">
          <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* Deploy progress overlay */}
      {deployingRepo && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
          <div>
            <p className="text-sm font-bold text-primary">מחבר: {deployingRepo}</p>
            <p className="text-xs text-muted-foreground">{deployProgress}</p>
          </div>
        </motion.div>
      )}

      {/* Repos list */}
      {isLoading && !repos.length ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">טוען מאגרים...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-2xl text-muted-foreground">
              {search ? 'לא נמצאו מאגרים התואמים לחיפוש' : 'לא נמצאו מאגרים'}
            </div>
          )}
          {filtered.map(repo => {
            const deployed = isAlreadyDeployed(repo);
            const isDeployingThis = deployingRepo === repo.full_name;
            const isDeletingThis = deletingRepo === repo.full_name;
            return (
              <motion.div key={repo.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={cn("bg-card border rounded-2xl p-5 transition-all", deployed ? "border-green-500/30 bg-green-500/5" : "border-border hover:border-primary/30 hover:shadow-md")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <a href={repo.html_url} target="_blank" rel="noopener noreferrer" className="font-bold text-base hover:text-primary transition-colors hover:underline truncate">
                        {repo.name}
                      </a>
                      {repo.private && <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full font-medium shrink-0">פרטי</span>}
                      {deployed && <span className="text-[10px] bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 shrink-0"><CheckCircle2 className="w-3 h-3" />מחובר</span>}
                    </div>
                    {repo.description && <p className="text-sm text-muted-foreground mb-2 truncate">{repo.description}</p>}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="font-mono">{repo.full_name}</span>
                      {repo.language && <span className="bg-muted px-2 py-0.5 rounded-full">{repo.language}</span>}
                      <span>{new Date(repo.updated_at).toLocaleDateString('he-IL')}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => deployRepo(repo)}
                      disabled={!!deployingRepo || deployed}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                        deployed ? "bg-green-500/10 text-green-600 cursor-default" :
                        "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      )}
                    >
                      {isDeployingThis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : deployed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CloudUpload className="w-3.5 h-3.5" />}
                      <span>{isDeployingThis ? 'מחבר...' : deployed ? 'מחובר' : 'פרוס ב-CF'}</span>
                    </button>
                    <button
                      onClick={() => setRepoToDelete(repo)}
                      disabled={!!deletingRepo || !!deployingRepo}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      {isDeletingThis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      <span>{isDeletingThis ? 'מוחק...' : 'מחק'}</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && !search && (
        <div className="flex justify-center pt-2">
          <button onClick={() => loadRepos(page + 1, true)} disabled={isLoading} className="inline-flex items-center gap-2 bg-card border border-border px-8 py-3 rounded-xl font-semibold hover:bg-muted/50 transition-all disabled:opacity-70 shadow-sm">
            {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /><span>טוען...</span></> : <><ChevronDown className="w-5 h-5" /><span>טען עוד ({PER_PAGE})</span></>}
          </button>
        </div>
      )}

      {/* Delete repo modal */}
      <AnimatePresence>
        {repoToDelete && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !deletingRepo && setRepoToDelete(null)} className="fixed inset-0 bg-black/80 z-[200]" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="fixed inset-0 z-[201] flex items-center justify-center p-4">
              <div className="bg-white dark:bg-zinc-900 border-2 border-red-200 dark:border-red-900 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.4)] p-6 max-w-sm w-full space-y-5" dir="rtl">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-900/50 flex items-center justify-center shrink-0"><Trash2 className="w-6 h-6 text-red-600" /></div>
                  <div><h3 className="text-lg font-bold">מחיקת מאגר GitHub</h3><p className="text-sm text-muted-foreground">{repoToDelete.name}</p></div>
                </div>
                <div className="bg-red-50 dark:bg-red-950 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4 space-y-2 text-sm">
                  <p className="font-bold text-red-700 dark:text-red-400 text-base">⚠️ פעולה בלתי הפיכה!</p>
                  <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                    <Github className="w-4 h-4 text-red-500 shrink-0" />
                    <span>יימחק: <b className="text-red-700 dark:text-red-400">{repoToDelete.full_name}</b></span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => deleteRepo(repoToDelete)}
                    disabled={!!deletingRepo}
                    className="flex-1 bg-red-600 text-white py-3 rounded-2xl font-bold hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {deletingRepo ? <><Loader2 className="w-4 h-4 animate-spin" /><span>מוחק...</span></> : <><Trash2 className="w-4 h-4" /><span>מחק מאגר</span></>}
                  </button>
                  <button onClick={() => setRepoToDelete(null)} disabled={!!deletingRepo} className="px-6 py-3 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-2xl font-bold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors disabled:opacity-60 border border-zinc-300 dark:border-zinc-600">ביטול</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
