import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CloudUpload, 
  FileArchive, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Copy, 
  Loader2, 
  Settings,
  X,
  Globe,
  LayoutDashboard,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Home,
  Download,
  GitMerge,
  GitPullRequest,
  Github,
  HelpCircle,
  ArrowLeft,
  Key,
  User,
  Shield
} from 'lucide-react';
import JSZip from 'jszip';

type Step = 'idle' | 'processing' | 'deploying' | 'waiting-cf' | 'success' | 'error';
type View = 'deploy' | 'dashboard';

interface Project {
  name: string;
  subdomain: string;
  created_on: string;
  latest_deployment?: {
    url: string;
  };
}

interface Deployment {
  id: string;
  url: string;
  created_on: string;
  environment: string;
  aliases: string[] | null;
  latest_stage: {
    status: string;
  };
}

export default function App() {
  const [view, setView] = useState<View>('deploy');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [buildOnServer, setBuildOnServer] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showGuide, setShowGuide] = useState<'github' | 'cloudflare' | null>(null);
  const [showCF, setShowCF] = useState(false);
  const [projectPrefix, setProjectPrefix] = useState(() => localStorage.getItem('project_prefix') || '');
  const [theme, setTheme] = useState(() => localStorage.getItem('app_theme') || 'blue');
  const [mode, setMode] = useState(() => localStorage.getItem('app_mode') || 'dark');
  const [autoOpenDashboard, setAutoOpenDashboard] = useState(() => localStorage.getItem('auto_open_dashboard') === 'true');
  const [customBuildCommand, setCustomBuildCommand] = useState(() => localStorage.getItem('build_command') || 'npm run build');
  const [customOutputDir, setCustomOutputDir] = useState(() => localStorage.getItem('output_dir') || 'dist');
  const [frameworkPreset, setFrameworkPreset] = useState(() => localStorage.getItem('framework_preset') || 'auto');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isUpdate, setIsUpdate] = useState(false);
  const [deployedBranch, setDeployedBranch] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [autoMerge, setAutoMerge] = useState(() => localStorage.getItem('auto_merge') !== 'false');
  const [autoDeployCloudflare, setAutoDeployCloudflare] = useState(() => localStorage.getItem('auto_deploy_cloudflare') !== 'false');
  const [cfStatus, setCfStatus] = useState<string | null>(null);
  
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const themes = {
    blue: { color: '#2563eb', glow: 'rgba(37, 99, 235, 0.2)', name: 'כחול' },
    emerald: { color: '#10b981', glow: 'rgba(16, 185, 129, 0.2)', name: 'אזמרגד' },
    violet: { color: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.2)', name: 'סגול' },
    amber: { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.2)', name: 'ענבר' },
    rose: { color: '#f43f5e', glow: 'rgba(244, 63, 94, 0.2)', name: 'ורד' },
    cyan: { color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.2)', name: 'טורקיז' },
    orange: { color: '#f97316', glow: 'rgba(249, 115, 22, 0.2)', name: 'כתום' },
    fuchsia: { color: '#d946ef', glow: 'rgba(217, 70, 239, 0.2)', name: 'פוקסיה' },
  };

  useEffect(() => {
    const currentTheme = themes[theme as keyof typeof themes] || themes.blue;
    document.documentElement.style.setProperty('--accent', currentTheme.color);
    document.documentElement.style.setProperty('--accent-glow', currentTheme.glow);
    localStorage.setItem('app_theme', theme);
    
    if (mode === 'light') {
      document.documentElement.classList.add('light-mode');
      document.body.style.backgroundColor = '#f8fafc';
      document.body.style.color = '#0f172a';
    } else {
      document.documentElement.classList.remove('light-mode');
      document.body.style.backgroundColor = '#050505';
      document.body.style.color = '#f4f4f5';
    }
    localStorage.setItem('app_mode', mode);
  }, [theme, mode]);

  useEffect(() => {
    localStorage.setItem('project_prefix', projectPrefix);
  }, [projectPrefix]);

  useEffect(() => {
    localStorage.setItem('auto_open_dashboard', autoOpenDashboard.toString());
  }, [autoOpenDashboard]);

  useEffect(() => {
    localStorage.setItem('build_command', customBuildCommand);
  }, [customBuildCommand]);

  useEffect(() => {
    localStorage.setItem('output_dir', customOutputDir);
  }, [customOutputDir]);

  useEffect(() => {
    localStorage.setItem('framework_preset', frameworkPreset);
    if (frameworkPreset === 'vite') {
      setCustomBuildCommand('npm run build');
      setCustomOutputDir('dist');
    } else if (frameworkPreset === 'next') {
      setCustomBuildCommand('npm run build');
      setCustomOutputDir('.next/out');
    } else if (frameworkPreset === 'react-app') {
      setCustomBuildCommand('npm run build');
      setCustomOutputDir('build');
    }
  }, [frameworkPreset]);

  useEffect(() => {
    localStorage.setItem('auto_merge', autoMerge.toString());
  }, [autoMerge]);

  useEffect(() => {
    localStorage.setItem('auto_deploy_cloudflare', autoDeployCloudflare.toString());
  }, [autoDeployCloudflare]);
  
  // Cloudflare Config with persistence
  const [cfToken, setCfToken] = useState(() => localStorage.getItem('cf_token') || '');
  const [cfAccountId, setCfAccountId] = useState(() => localStorage.getItem('cf_account_id') || '');
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('github_token') || '');
  const [githubRepo, setGithubRepo] = useState(() => localStorage.getItem('github_repo') || '');
  const [githubConnectedUser, setGithubConnectedUser] = useState(() => localStorage.getItem('github_connected_user') || '');
  const [useGithub, setUseGithub] = useState(() => localStorage.getItem('use_github') === 'true');
  const [showGithub, setShowGithub] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState<string | null>(null);
  const [isTestingGithub, setIsTestingGithub] = useState(false);
  const pollingActiveRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist credentials
  useEffect(() => {
    localStorage.setItem('cf_token', cfToken);
    localStorage.setItem('cf_account_id', cfAccountId);
  }, [cfToken, cfAccountId]);

  useEffect(() => {
    localStorage.setItem('github_token', githubToken);
    localStorage.setItem('github_repo', githubRepo);
    localStorage.setItem('use_github', useGithub.toString());
    if (githubConnectedUser) localStorage.setItem('github_connected_user', githubConnectedUser);
  }, [githubToken, githubRepo, useGithub]);

  const fetchProjects = async () => {
    if (!cfToken || !cfAccountId) return;
    setIsLoadingProjects(true);
    try {
      const res = await fetch(`/api/projects?accountId=${cfAccountId}&apiToken=${cfToken}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProjects(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    if (view === 'dashboard') {
      fetchProjects();
    }
  }, [view]);

  const fetchDeployments = async (projectName: string) => {
    if (!cfToken || !cfAccountId) return;
    setIsLoadingDeployments(true);
    try {
      const res = await fetch(`/api/deployments?accountId=${cfAccountId}&apiToken=${cfToken}&projectName=${projectName}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDeployments(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoadingDeployments(false);
    }
  };

  const handleRollback = async (projectName: string, deploymentId: string) => {
    if (!cfToken || !cfAccountId) return;
    setIsRollingBack(deploymentId);
    try {
      const res = await fetch('/api/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: cfAccountId,
          apiToken: cfToken,
          projectName,
          deploymentId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'החזרה נכשלה');
      
      // Refresh deployments and projects
      await fetchDeployments(projectName);
      await fetchProjects();
      alert('הפריסה הוגדרה כראשית בהצלחה');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsRollingBack(null);
    }
  };

  const sanitizeProjectName = (name: string, isFinal = false) => {
    let sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-'); // Replace non-alphanumeric with dashes
    
    if (isFinal) {
      sanitized = sanitized
        .replace(/-+/g, '-')         // Replace multiple dashes with single dash
        .replace(/^-+|-+$/g, '');    // Trim dashes from start and end
    }
    return sanitized;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      setError('אנא בחר קובץ ZIP תקין');
      setStep('error');
      return;
    }

    setZipFile(file);
    setStep('processing');
    setError(null);

    try {
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(file);
      const fileNames = Object.keys(zipContent.files).map(n => n.toLowerCase());

      const hasPackageJson = fileNames.some(n => n.endsWith('package.json'));
      const hasSrcDir = fileNames.some(n => n.includes('/src/') || n.startsWith('src/'));
      const hasViteConfig = fileNames.some(n => n.includes('vite.config'));
      const hasNextConfig = fileNames.some(n => n.includes('next.config'));
      const hasNodeModules = fileNames.some(n => n.includes('node_modules/'));

      // Source code indicators — if any match, it's a source project needing build
      const isSourceCode = hasPackageJson && (hasSrcDir || hasViteConfig || hasNextConfig) && !hasNodeModules;

      // Check if there's a built index.html at the root level (not inside /src or /public)
      const hasBuiltIndex = fileNames.some(n => {
        const clean = n.replace(/^[^/]+\//, ''); // strip root folder prefix
        return clean === 'index.html' || clean.match(/^[a-z0-9_-]+\/index\.html$/) !== null;
      });

      // Built dist/build folder present?
      const hasDistOrBuild = fileNames.some(n => n.includes('/dist/') || n.includes('/build/') || n.startsWith('dist/') || n.startsWith('build/'));

      if (!hasPackageJson && !hasBuiltIndex) {
        throw new Error('לא נמצא קובץ index.html או package.json בתוך ה-ZIP');
      }

      if (isSourceCode && !hasDistOrBuild) {
        // Definitely source code — auto enable build
        setBuildOnServer(true);

        // Auto-detect framework preset
        if (hasViteConfig) {
          setFrameworkPreset('vite');
          setCustomBuildCommand('npm run build');
          setCustomOutputDir('dist');
        } else if (hasNextConfig) {
          setFrameworkPreset('next');
          setCustomBuildCommand('npm run build');
          setCustomOutputDir('.next/out');
        } else {
          setFrameworkPreset('auto');
        }
      } else {
        // Already built — no need for server build
        setBuildOnServer(false);
      }

      if (!projectName) {
        const baseName = file.name.replace('.zip', '');
        const initialName = projectPrefix ? `${projectPrefix}-${baseName}` : baseName;
        setProjectName(sanitizeProjectName(initialName, true));
      }

      setStep('idle');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
    }
  };

  const handleDeploy = async () => {
    const sanitizedName = sanitizeProjectName(projectName, true);
    if (!zipFile || !sanitizedName) {
      setError('שם הפרויקט לא תקין');
      setStep('error');
      return;
    }
    
    if (!useGithub && (!cfToken || !cfAccountId)) {
      setShowConfig(true);
      return;
    }

    if (useGithub && !githubToken) {
      setShowConfig(true);
      setShowGithub(true);
      return;
    }
    
    setStep('deploying');
    setError(null);

    try {
      // Convert zip file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(zipFile);
      });
      const base64Zip = await base64Promise;

      if (useGithub) {
        const branchName = isUpdate ? `deploy-${Date.now()}` : 'main';
        const repoName = githubRepo || sanitizedName;
        
        setStep('deploying');
        
        // 1. Prepare GitHub Repo (ensure it exists)
        console.log('Preparing GitHub repository...');
        const prepareRes = await fetch('/api/github-prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ githubToken, repoName })
        });
        const prepareData = await prepareRes.json();
        if (!prepareRes.ok) throw new Error(prepareData.error || 'GitHub preparation failed');

        // 2. Push files to GitHub
        setStep('deploying');
        const response = await fetch('/api/github-deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            githubToken,
            repoName,
            projectName: sanitizedName,
            zipFile: base64Zip,
            branch: branchName,
            commitMessage: `Deploy ${sanitizedName} from CloudDeploy`,
            cfAccountId: cfAccountId || undefined,
            cfApiToken: cfToken || undefined,
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'העלאה ל-GitHub נכשלה');
        setGithubUrl(data.repoUrl);

        // Set branch/PR state for UI
        setDeployedBranch(branchName !== 'main' ? branchName : null);
        setPrUrl(data.prUrl || null);

        // 3. Auto merge in background if update + autoMerge
        if (isUpdate && autoMerge && branchName !== 'main') {
          fetch('/api/github-merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              githubToken,
              repoName: githubRepo || sanitizedName,
              head: branchName
            })
          }).then(mergeRes => {
            if (mergeRes.ok) { setDeployedBranch(null); setPrUrl(null); }
          }).catch(err => console.error('Auto-merge error:', err));
        }

        // 4. Cloudflare deployment is handled by GitHub Actions (wrangler pages deploy)
        //    The workflow file was injected into the repo by github-deploy above.
        //    We just set the expected URL and move to success.
        if (autoDeployCloudflare && cfToken && cfAccountId) {
          setStep('waiting-cf');
          setCfStatus('GitHub Actions מריץ את הפריסה ל-Cloudflare...');
          // Give GitHub a moment to queue the action, then move to success
          await new Promise(r => setTimeout(r, 2000));
          setDeployUrl(`https://${sanitizedName}.pages.dev`);
          setPreviewUrl(null);
          setStep('success');
        } else {
          // CF not configured — GitHub only
          setDeployUrl(null);
          setStep('success');
        }
      } else {
        const response = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: sanitizedName,
            accountId: cfAccountId,
            apiToken: cfToken,
            zipFile: base64Zip,
            buildOnServer,
            buildCommand: customBuildCommand,
            outputDir: customOutputDir
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'הפריסה נכשלה');

        await new Promise(resolve => setTimeout(resolve, 2000));
        setDeployUrl(data.url);
        setPreviewUrl(data.previewUrl);
        setStep('success');
        
        if (autoOpenDashboard) {
          setTimeout(() => setView('dashboard'), 3000);
        }
      }
    } catch (err: any) {
      setError(err.message);
      setStep('error');
    }
  };

  const selectProjectForUpdate = (project: Project) => {
    setProjectName(project.name);
    setIsUpdate(true);
    setView('deploy');
  };

  const handleMerge = async () => {
    if (!deployedBranch || !githubToken) return;
    
    setStep('deploying');
    try {
      const response = await fetch('/api/github-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubToken,
          repoName: githubRepo || sanitizeProjectName(projectName, true),
          head: deployedBranch
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'המיזוג נכשל');

      alert('הענף מוזג בהצלחה ל-main! הפריסה תתעדכן ב-Cloudflare באופן אוטומטי.');
      setDeployedBranch(null);
      setPrUrl(null);
      setStep('success');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
    }
  };

  const handleTestGithubConnection = async () => {
    if (!githubToken) {
      alert('אנא הזן טוקן תחילה');
      return;
    }

    setIsTestingGithub(true);
    try {
      const response = await fetch('/api/github-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubToken })
      });

      let data: any = {};
      const text = await response.text();
      try { data = JSON.parse(text); } catch {
        throw new Error(`תגובה לא תקינה מהשרת (${response.status})`);
      }
      if (!response.ok) throw new Error(data.error || 'החיבור נכשל');

      setGithubConnectedUser(data.username);
    } catch (err: any) {
      alert(`שגיאה בחיבור: ${err.message}`);
    } finally {
      setIsTestingGithub(false);
    }
  };

  const reset = () => {
    setStep('idle');
    setZipFile(null);
    setError(null);
    setDeployUrl(null);
    setPreviewUrl(null);
    setGithubUrl(null);
    setIsUpdate(false);
    setDeployedBranch(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── GitHub Guide Steps ────────────────────────────────────────────────────
  const githubGuideSteps = [
    {
      title: 'כנס ל-GitHub ולחץ על תמונת הפרופיל',
      desc: 'באתר github.com, לחץ על תמונת הפרופיל שלך בפינה הימנית העליונה של המסך.',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#0d1117"/>
          <rect x="0" y="0" width="300" height="38" fill="#161b22"/>
          <rect x="10" y="13" width="55" height="12" rx="3" fill="#f0f6fc" opacity="0.9"/>
          <rect x="90" y="13" width="35" height="12" rx="3" fill="#30363d" opacity="0.5"/>
          <rect x="135" y="13" width="35" height="12" rx="3" fill="#30363d" opacity="0.5"/>
          <circle cx="276" cy="19" r="12" fill="#30363d"/>
          <circle cx="276" cy="16" r="5" fill="#8b949e"/>
          <ellipse cx="276" cy="26" rx="8" ry="4" fill="#8b949e"/>
          <rect x="220" y="6" width="44" height="14" rx="4" fill="#f78166" opacity="0.2" stroke="#f78166" strokeWidth="1"/>
          <text x="224" y="16" fill="#f78166" fontSize="7" fontFamily="sans-serif">לחץ כאן</text>
          <path d="M218 12 L222 12" stroke="#f78166" strokeWidth="1.5" markerEnd="url(#a1)"/>
          <defs><marker id="a1" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <rect x="218" y="40" width="76" height="80" rx="6" fill="#161b22" stroke="#30363d" strokeWidth="1"/>
          <circle cx="245" cy="60" r="10" fill="#30363d"/>
          <text x="237" y="64" fill="#8b949e" fontSize="9">👤</text>
          <text x="225" y="80" fill="#f0f6fc" fontSize="7" fontFamily="sans-serif">username</text>
          <line x1="222" y1="86" x2="290" y2="86" stroke="#30363d" strokeWidth="1"/>
          <text x="225" y="97" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Your profile</text>
          <text x="225" y="109" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Repositories</text>
          <line x1="222" y1="114" x2="290" y2="114" stroke="#30363d" strokeWidth="1"/>
          <rect x="222" y="118" width="70" height="14" rx="3" fill="#1f6feb" opacity="0.25" stroke="#1f6feb" strokeWidth="1"/>
          <text x="226" y="128" fill="#58a6ff" fontSize="8" fontFamily="sans-serif" fontWeight="bold">⚙ Settings</text>
        </svg>
      ),
    },
    {
      title: 'גלול לתחתית → "Developer settings"',
      desc: 'בדף ה-Settings, גלול בסרגל הצד השמאלי עד לתחתית ולחץ על "Developer settings".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#0d1117"/>
          <rect x="0" y="0" width="95" height="150" fill="#161b22" stroke="#30363d" strokeWidth="0.5"/>
          <text x="8" y="16" fill="#f0f6fc" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Settings</text>
          <rect x="5" y="22" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <rect x="5" y="35" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <rect x="5" y="48" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <rect x="5" y="61" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <rect x="5" y="74" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <rect x="5" y="87" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <rect x="5" y="100" width="85" height="9" rx="2" fill="#30363d" opacity="0.4"/>
          <line x1="5" y1="116" x2="90" y2="116" stroke="#30363d" strokeWidth="1"/>
          <rect x="5" y="120" width="85" height="18" rx="4" fill="#1f6feb" opacity="0.2" stroke="#1f6feb" strokeWidth="1"/>
          <text x="9" y="132" fill="#58a6ff" fontSize="8" fontFamily="sans-serif" fontWeight="bold">{'</>'} Developer settings</text>
          <path d="M100 129 L96 129" stroke="#f78166" strokeWidth="2" markerEnd="url(#a2)"/>
          <defs><marker id="a2" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="104" y="125" fill="#f78166" fontSize="9" fontFamily="sans-serif">← גלול למטה</text>
          <text x="104" y="137" fill="#f78166" fontSize="9" fontFamily="sans-serif">ולחץ כאן</text>
        </svg>
      ),
    },
    {
      title: 'בחר "Personal access tokens" ← "Tokens (classic)"',
      desc: 'בדף Developer Settings לחץ על "Personal access tokens" ואז על "Tokens (classic)".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#0d1117"/>
          <rect x="0" y="0" width="105" height="150" fill="#161b22" stroke="#30363d" strokeWidth="0.5"/>
          <text x="8" y="16" fill="#f0f6fc" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Developer Settings</text>
          <rect x="5" y="22" width="95" height="11" rx="3" fill="#30363d" opacity="0.4"/>
          <text x="9" y="31" fill="#8b949e" fontSize="7" fontFamily="sans-serif">GitHub Apps</text>
          <rect x="5" y="37" width="95" height="11" rx="3" fill="#30363d" opacity="0.4"/>
          <text x="9" y="46" fill="#8b949e" fontSize="7" fontFamily="sans-serif">OAuth Apps</text>
          <rect x="5" y="52" width="95" height="11" rx="3" fill="#1f6feb" opacity="0.15" stroke="#1f6feb" strokeWidth="1"/>
          <text x="9" y="61" fill="#58a6ff" fontSize="7" fontFamily="sans-serif">Personal access tokens ▾</text>
          <rect x="12" y="67" width="88" height="11" rx="3" fill="#30363d" opacity="0.4"/>
          <text x="16" y="76" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Fine-grained tokens</text>
          <rect x="12" y="82" width="88" height="13" rx="3" fill="#388bfd" opacity="0.2" stroke="#388bfd" strokeWidth="1"/>
          <text x="16" y="92" fill="#79c0ff" fontSize="8" fontFamily="sans-serif" fontWeight="bold">✓ Tokens (classic)</text>
          <path d="M108 88 L104 88" stroke="#f78166" strokeWidth="2" markerEnd="url(#a3)"/>
          <defs><marker id="a3" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="112" y="85" fill="#f78166" fontSize="9" fontFamily="sans-serif">← לחץ כאן</text>
        </svg>
      ),
    },
    {
      title: 'לחץ "Generate new token (classic)"',
      desc: 'בדף ה-Tokens, לחץ על הכפתור "Generate new token" ובחר "classic".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#0d1117"/>
          <rect x="0" y="0" width="300" height="36" fill="#161b22" stroke="#30363d" strokeWidth="0.5"/>
          <text x="10" y="22" fill="#f0f6fc" fontSize="10" fontFamily="sans-serif" fontWeight="bold">Personal access tokens (classic)</text>
          <rect x="190" y="7" width="102" height="22" rx="5" fill="#238636" opacity="0.9"/>
          <text x="198" y="21" fill="white" fontSize="7" fontFamily="sans-serif" fontWeight="bold">Generate new token ▾</text>
          <rect x="228" y="31" width="72" height="28" rx="4" fill="#161b22" stroke="#30363d" strokeWidth="1"/>
          <rect x="232" y="34" width="64" height="11" rx="2" fill="#30363d" opacity="0.5"/>
          <text x="236" y="42" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Fine-grained token</text>
          <rect x="232" y="47" width="64" height="11" rx="2" fill="#1f6feb" opacity="0.2" stroke="#1f6feb" strokeWidth="1"/>
          <text x="236" y="55" fill="#58a6ff" fontSize="8" fontFamily="sans-serif" fontWeight="bold">✓ classic</text>
          <path d="M265 62 L265 59" stroke="#f78166" strokeWidth="2" markerEnd="url(#a4)"/>
          <defs><marker id="a4" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="115" y="80" fill="#f78166" fontSize="9" fontFamily="sans-serif" textAnchor="middle">בחר "classic" ↗</text>
        </svg>
      ),
    },
    {
      title: 'סמן "repo" תחת Scopes ולחץ Generate',
      desc: 'תן שם לטוקן, בחר תפוגה, ותחת "Select scopes" סמן ✅ repo. גלול למטה ולחץ "Generate token".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#0d1117"/>
          <text x="10" y="15" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Note (שם הטוקן)</text>
          <rect x="10" y="18" width="180" height="15" rx="4" fill="#161b22" stroke="#30363d" strokeWidth="1"/>
          <text x="15" y="29" fill="#f0f6fc" fontSize="8" fontFamily="sans-serif">CloudDeploy</text>
          <text x="10" y="47" fill="#f0f6fc" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Select scopes</text>
          <rect x="10" y="53" width="13" height="13" rx="3" fill="#238636"/>
          <text x="12" y="63" fill="white" fontSize="9" fontFamily="sans-serif" fontWeight="bold">✓</text>
          <text x="27" y="63" fill="#f0f6fc" fontSize="8" fontFamily="sans-serif" fontWeight="bold">repo</text>
          <text x="75" y="63" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Full control of private repos</text>
          <rect x="10" y="70" width="13" height="13" rx="3" fill="#21262d" stroke="#30363d" strokeWidth="1"/>
          <text x="27" y="80" fill="#8b949e" fontSize="8" fontFamily="sans-serif">workflow</text>
          <rect x="10" y="87" width="13" height="13" rx="3" fill="#21262d" stroke="#30363d" strokeWidth="1"/>
          <text x="27" y="97" fill="#8b949e" fontSize="8" fontFamily="sans-serif">admin:org</text>
          <rect x="170" y="128" width="120" height="16" rx="5" fill="#238636"/>
          <text x="190" y="139" fill="white" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Generate token ✓</text>
          <path d="M158 136 L168 136" stroke="#f78166" strokeWidth="2" markerEnd="url(#a5)"/>
          <defs><marker id="a5" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
        </svg>
      ),
    },
    {
      title: 'העתק את הטוקן — מוצג פעם אחת בלבד!',
      desc: 'הטוקן מתחיל ב-ghp_ ויוצג רק עכשיו. העתק אותו ושמור. הדבק בשדה "Personal Access Token" בהגדרות.',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#0d1117"/>
          <rect x="10" y="10" width="280" height="40" rx="8" fill="#0d419d" opacity="0.35" stroke="#1f6feb" strokeWidth="1"/>
          <text x="18" y="26" fill="#58a6ff" fontSize="8" fontFamily="sans-serif" fontWeight="bold">⚠ Make sure to copy your token now</text>
          <text x="18" y="40" fill="#8b949e" fontSize="7" fontFamily="sans-serif">You won't be able to see it again!</text>
          <rect x="10" y="62" width="248" height="22" rx="6" fill="#161b22" stroke="#388bfd" strokeWidth="1.5"/>
          <text x="16" y="76" fill="#79c0ff" fontSize="8" fontFamily="monospace">ghp_xxxxxxxxxxxxxxxxxxxxxxxxxx</text>
          <rect x="264" y="62" width="28" height="22" rx="5" fill="#21262d" stroke="#30363d" strokeWidth="1"/>
          <text x="272" y="76" fill="#8b949e" fontSize="11">⎘</text>
          <path d="M256 73 L262 73" stroke="#f78166" strokeWidth="2" markerEnd="url(#a6)"/>
          <defs><marker id="a6" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="148" y="112" fill="#f78166" fontSize="10" fontFamily="sans-serif" textAnchor="middle" fontWeight="bold">העתק עכשיו!</text>
          <text x="148" y="128" fill="#8b949e" fontSize="8" fontFamily="sans-serif" textAnchor="middle">הדבק בשדה Personal Access Token</text>
        </svg>
      ),
    },
  ];

  // ── Cloudflare Guide Steps ────────────────────────────────────────────────
  const cloudflareGuideSteps = [
    {
      title: 'כנס ל-Cloudflare Dashboard',
      desc: 'עבור לאתר dash.cloudflare.com והתחבר לחשבונך.',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <rect x="0" y="0" width="300" height="42" fill="#2a2a2e"/>
          <text x="14" y="26" fill="#f6821f" fontSize="12" fontFamily="sans-serif" fontWeight="bold">☁ Cloudflare</text>
          <rect x="210" y="11" width="80" height="20" rx="5" fill="#f6821f" opacity="0.85"/>
          <text x="226" y="24" fill="white" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Log in →</text>
          <rect x="14" y="55" width="125" height="55" rx="8" fill="#2a2a2e" stroke="#3a3a3e" strokeWidth="1"/>
          <text x="24" y="76" fill="#f0f0f0" fontSize="9" fontFamily="sans-serif" fontWeight="bold">Account Home</text>
          <text x="24" y="90" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Websites · Pages · Workers</text>
          <text x="24" y="102" fill="#f6821f" fontSize="8" fontFamily="sans-serif">→ כנס כאן</text>
          <text x="40" y="130" fill="#8b8b8e" fontSize="8" fontFamily="sans-serif" textAnchor="middle">dash.cloudflare.com</text>
        </svg>
      ),
    },
    {
      title: 'מצא את ה-Account ID בסרגל הצד',
      desc: 'בדף הבית, בסרגל הצד הימני תחת "Account ID" — לחץ לצד המספר להעתקה. שמור אותו!',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <rect x="200" y="0" width="100" height="150" fill="#2a2a2e" stroke="#3a3a3e" strokeWidth="0.5"/>
          <text x="208" y="16" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif" fontWeight="bold">ACCOUNT ID</text>
          <rect x="206" y="20" width="88" height="20" rx="4" fill="#1c1c1e" stroke="#3a3a3e" strokeWidth="1"/>
          <text x="210" y="33" fill="#f0f0f0" fontSize="7" fontFamily="monospace">a1b2c3d4e5f6g7...</text>
          <rect x="272" y="22" width="18" height="16" rx="3" fill="#f6821f" opacity="0.3" stroke="#f6821f" strokeWidth="1"/>
          <text x="276" y="33" fill="#f6821f" fontSize="8">⎘</text>
          <path d="M190 30 L204 30" stroke="#f78166" strokeWidth="2" markerEnd="url(#b1)"/>
          <defs><marker id="b1" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="60" y="24" fill="#f78166" fontSize="9" fontFamily="sans-serif" textAnchor="middle">Account ID כאן →</text>
          <text x="60" y="36" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif" textAnchor="middle">סרגל צד ימני</text>
        </svg>
      ),
    },
    {
      title: 'לחץ על פרופיל → "My Profile"',
      desc: 'לחץ על תמונת הפרופיל בפינה הימנית העליונה ובחר "My Profile".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <rect x="0" y="0" width="300" height="38" fill="#2a2a2e"/>
          <text x="14" y="23" fill="#f6821f" fontSize="11" fontFamily="sans-serif" fontWeight="bold">☁ Cloudflare</text>
          <circle cx="278" cy="19" r="12" fill="#f6821f" opacity="0.6"/>
          <text x="272" y="23" fill="white" fontSize="10" fontFamily="sans-serif">U</text>
          <rect x="216" y="40" width="80" height="70" rx="6" fill="#2a2a2e" stroke="#3a3a3e" strokeWidth="1"/>
          <text x="224" y="56" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">user@email.com</text>
          <line x1="220" y1="62" x2="292" y2="62" stroke="#3a3a3e" strokeWidth="1"/>
          <rect x="220" y="66" width="72" height="14" rx="3" fill="#f6821f" opacity="0.2" stroke="#f6821f" strokeWidth="1"/>
          <text x="224" y="76" fill="#f6821f" fontSize="8" fontFamily="sans-serif" fontWeight="bold">My Profile</text>
          <text x="224" y="93" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Billing</text>
          <text x="224" y="105" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Logout</text>
          <path d="M190 73 L214 73" stroke="#f78166" strokeWidth="2" markerEnd="url(#b2)"/>
          <defs><marker id="b2" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="100" y="77" fill="#f78166" fontSize="9" fontFamily="sans-serif">My Profile →</text>
        </svg>
      ),
    },
    {
      title: 'לחץ על לשונית "API Tokens"',
      desc: 'בדף My Profile, לחץ על הלשונית "API Tokens" ואז על "Create Token".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <rect x="0" y="0" width="300" height="38" fill="#2a2a2e"/>
          <rect x="10" y="10" width="60" height="18" rx="4" fill="#3a3a3e" opacity="0.6"/>
          <text x="18" y="22" fill="#8b8b8e" fontSize="8" fontFamily="sans-serif">Preferences</text>
          <rect x="80" y="10" width="70" height="18" rx="4" fill="#f6821f" opacity="0.15" stroke="#f6821f" strokeWidth="1"/>
          <text x="88" y="22" fill="#f6821f" fontSize="8" fontFamily="sans-serif" fontWeight="bold">API Tokens</text>
          <text x="14" y="58" fill="#f0f0f0" fontSize="10" fontFamily="sans-serif" fontWeight="bold">API Tokens</text>
          <rect x="190" y="46" width="100" height="20" rx="5" fill="#f6821f" opacity="0.85"/>
          <text x="206" y="59" fill="white" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Create Token +</text>
          <path d="M180 56 L188 56" stroke="#f78166" strokeWidth="2" markerEnd="url(#b3)"/>
          <defs><marker id="b3" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="86" y="60" fill="#f78166" fontSize="8" fontFamily="sans-serif">← גם לחץ על הלשונית</text>
        </svg>
      ),
    },
    {
      title: 'בחר תבנית "Edit Cloudflare Workers"',
      desc: 'גלול למטה ומצא "Edit Cloudflare Workers". לחץ "Use template" — זה כולל הרשאות Pages:Edit.',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <text x="12" y="16" fill="#f0f0f0" fontSize="9" fontFamily="sans-serif" fontWeight="bold">API token templates</text>
          <rect x="10" y="22" width="280" height="36" rx="6" fill="#2a2a2e" stroke="#3a3a3e" strokeWidth="1"/>
          <text x="18" y="37" fill="#f0f0f0" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Edit Cloudflare Workers</text>
          <text x="18" y="49" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Workers:Edit · Pages:Edit · Account:Read</text>
          <rect x="236" y="26" width="46" height="18" rx="4" fill="#f6821f" opacity="0.85"/>
          <text x="242" y="37" fill="white" fontSize="7" fontFamily="sans-serif" fontWeight="bold">Use template</text>
          <rect x="10" y="64" width="280" height="36" rx="6" fill="#2a2a2e" stroke="#3a3a3e" strokeWidth="1"/>
          <text x="18" y="79" fill="#8b8b8e" fontSize="8" fontFamily="sans-serif">Read all resources</text>
          <text x="18" y="91" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Read-only access</text>
          <rect x="236" y="68" width="46" height="18" rx="4" fill="#3a3a3e"/>
          <text x="242" y="79" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Use template</text>
          <path d="M228 35 L234 35" stroke="#f78166" strokeWidth="2" markerEnd="url(#b4)"/>
          <defs><marker id="b4" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="60" y="115" fill="#f78166" fontSize="8" fontFamily="sans-serif" textAnchor="middle">לחץ "Use template" ↗ על השורה הראשונה</text>
        </svg>
      ),
    },
    {
      title: 'לחץ "Continue to summary" ← "Create Token"',
      desc: 'ודא שהרשאות כוללות Pages:Edit. לחץ "Continue to summary" ואז "Create Token".',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <text x="12" y="16" fill="#f0f0f0" fontSize="9" fontFamily="sans-serif" fontWeight="bold">Token Summary</text>
          <rect x="10" y="22" width="280" height="72" rx="6" fill="#2a2a2e" stroke="#3a3a3e" strokeWidth="1"/>
          <text x="18" y="38" fill="#8b8b8e" fontSize="7" fontFamily="sans-serif">Permissions</text>
          <text x="18" y="52" fill="#f0f0f0" fontSize="8" fontFamily="sans-serif">✓ Account · Cloudflare Pages · Edit</text>
          <text x="18" y="65" fill="#f0f0f0" fontSize="8" fontFamily="sans-serif">✓ Account · Workers Scripts · Edit</text>
          <text x="18" y="78" fill="#f0f0f0" fontSize="8" fontFamily="sans-serif">✓ User · API Tokens · Edit</text>
          <rect x="160" y="108" width="130" height="22" rx="5" fill="#f6821f" opacity="0.85"/>
          <text x="180" y="122" fill="white" fontSize="8" fontFamily="sans-serif" fontWeight="bold">Create Token →</text>
          <path d="M148 119 L158 119" stroke="#f78166" strokeWidth="2" markerEnd="url(#b5)"/>
          <defs><marker id="b5" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
        </svg>
      ),
    },
    {
      title: 'העתק את ה-API Token — מוצג פעם אחת!',
      desc: 'ה-Token יוצג רק עכשיו. העתק ושמור אותו. הדבק בשדה "API Token" בהגדרות האפליקציה.',
      img: (
        <svg viewBox="0 0 300 150" className="w-full rounded-xl border border-white/10">
          <rect width="300" height="150" fill="#1c1c1e"/>
          <rect x="10" y="10" width="280" height="40" rx="8" fill="#135716" opacity="0.35" stroke="#238636" strokeWidth="1"/>
          <text x="18" y="26" fill="#3fb950" fontSize="8" fontFamily="sans-serif" fontWeight="bold">✓ API Token created successfully</text>
          <text x="18" y="40" fill="#8b949e" fontSize="7" fontFamily="sans-serif">Copy your token — it won't be shown again!</text>
          <rect x="10" y="62" width="252" height="22" rx="6" fill="#2a2a2e" stroke="#f6821f" strokeWidth="1.5"/>
          <text x="16" y="76" fill="#f0f0f0" fontSize="8" fontFamily="monospace">xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</text>
          <rect x="268" y="62" width="24" height="22" rx="5" fill="#f6821f" opacity="0.8"/>
          <text x="275" y="76" fill="white" fontSize="10">⎘</text>
          <path d="M258 73 L266 73" stroke="#f78166" strokeWidth="2" markerEnd="url(#b6)"/>
          <defs><marker id="b6" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#f78166"/></marker></defs>
          <text x="148" y="110" fill="#f78166" fontSize="10" fontFamily="sans-serif" textAnchor="middle" fontWeight="bold">העתק עכשיו!</text>
          <text x="148" y="126" fill="#8b8b8e" fontSize="8" fontFamily="sans-serif" textAnchor="middle">הדבק בשדה "API Token" באפליקציה</text>
        </svg>
      ),
    },
  ];

  // ── Guide Modal State ────────────────────────────────────────────────────
  const [guideStep, setGuideStep] = useState(0);

  const GuideModal = () => {
    const isGithub = showGuide === 'github';
    const steps = isGithub ? githubGuideSteps : cloudflareGuideSteps;
    const totalSteps = steps.length;
    const step = steps[guideStep];
    return (
      <AnimatePresence>
        {showGuide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
            onClick={() => { setShowGuide(null); setGuideStep(0); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="w-full max-w-md bg-zinc-950 rounded-t-[32px] border-t border-x border-white/10 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>
              {/* Header */}
              <div className="px-6 pt-2 pb-3 flex items-center justify-between">
                <button onClick={() => { setShowGuide(null); setGuideStep(0); }} className="p-2 hover:bg-white/10 rounded-full transition-colors text-zinc-400">
                  <X size={18} />
                </button>
                <div className="text-center">
                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: isGithub ? '#58a6ff' : '#fb923c' }}>
                    {isGithub ? 'GitHub' : 'Cloudflare'} — הדרכת חיבור
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">שלב {guideStep + 1} מתוך {totalSteps}</p>
                </div>
                <div className="w-10" />
              </div>
              {/* Progress */}
              <div className="px-6 mb-3">
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: isGithub ? '#3b82f6' : '#f97316' }}
                    animate={{ width: `${((guideStep + 1) / totalSteps) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  {steps.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setGuideStep(i)}
                      className="w-5 h-5 rounded-full text-[9px] font-bold transition-all flex items-center justify-center"
                      style={{
                        background: i <= guideStep ? (isGithub ? '#3b82f6' : '#f97316') : 'rgba(255,255,255,0.08)',
                        color: i <= guideStep ? 'white' : '#666',
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
              {/* Content */}
              <div className="px-6 pb-4" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={guideStep}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    {step.img}
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: isGithub ? 'rgba(59,130,246,0.2)' : 'rgba(249,115,22,0.2)', color: isGithub ? '#60a5fa' : '#fb923c' }}>
                        {guideStep + 1}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-snug">{step.title}</p>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
              {/* Navigation */}
              <div className="px-6 pb-8 flex gap-3">
                <button
                  onClick={() => setGuideStep(s => Math.max(0, s - 1))}
                  disabled={guideStep === 0}
                  className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm font-semibold disabled:opacity-25 flex items-center justify-center gap-1.5 transition-all hover:bg-white/10"
                >
                  <ChevronRight size={15} /> הקודם
                </button>
                {guideStep < totalSteps - 1 ? (
                  <button
                    onClick={() => setGuideStep(s => s + 1)}
                    className="flex-[2] py-3 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                    style={{ background: isGithub ? '#2563eb' : '#ea580c' }}
                  >
                    הבא <ChevronLeft size={15} />
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowGuide(null); setGuideStep(0); }}
                    className="flex-[2] py-3 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                    style={{ background: isGithub ? '#2563eb' : '#ea580c' }}
                  >
                    <CheckCircle2 size={15} /> סיום
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  };

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('deploy')}>
          <div className="w-10 h-10 accent-bg rounded-xl flex items-center justify-center accent-shadow">
            <CloudUpload className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">CloudDeploy <span className="text-xs font-normal text-zinc-500">v12</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              setView('deploy');
              reset();
            }}
            className="p-2 rounded-full hover:bg-white/5 transition-colors text-zinc-400"
            title="מסך הבית"
          >
            <Home size={20} />
          </button>
          <button 
            onClick={() => setView(view === 'deploy' ? 'dashboard' : 'deploy')}
            className="p-2 rounded-full hover:bg-white/5 transition-colors text-zinc-400"
          >
            {view === 'deploy' ? <LayoutDashboard size={20} /> : <Plus size={20} />}
          </button>
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className="p-2 rounded-full hover:bg-white/5 transition-colors text-zinc-400"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {view === 'deploy' ? (
            <motion.div
              key="deploy-view"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 flex flex-col"
            >
              <AnimatePresence mode="wait">
                {step === 'idle' && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="flex flex-col gap-6"
                  >
                    <div className="text-center mb-2 space-y-2">
                      <h2 className="text-4xl font-black text-gradient">העלה אתר ברגע</h2>
                      <p className="text-zinc-400 text-sm">העלה קובץ ZIP — קוד מקור או גרסה בנויה</p>
                    </div>

                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className={`
                        glass rounded-[40px] p-12 flex flex-col items-center justify-center gap-6 cursor-pointer
                        transition-all active:scale-[0.98] hover:border-white/20 group relative overflow-hidden
                        ${zipFile ? 'accent-border bg-white/10' : ''}
                      `}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-accent/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className={`w-24 h-24 rounded-3xl flex items-center justify-center transition-all group-hover:scale-110 ${zipFile ? 'accent-bg text-white accent-shadow' : 'bg-white/5 text-zinc-500'}`}>
                        {zipFile ? <FileArchive size={48} /> : <CloudUpload size={48} />}
                      </div>
                      <div className="text-center relative z-10">
                        <p className="font-bold text-xl">
                          {zipFile ? zipFile.name : 'לחץ לבחירת קובץ ZIP'}
                        </p>
                        <p className="text-xs text-zinc-500 mt-2 font-medium">HTML, CSS, JS בלבד</p>
                      </div>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".zip"
                        className="hidden"
                      />
                    </div>

                    {zipFile && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-4"
                      >
                        {/* Smart detection badge */}
                        <div
                          onClick={() => setBuildOnServer(!buildOnServer)}
                          className={`flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all border ${
                            buildOnServer
                              ? 'bg-violet-500/10 border-violet-500/30'
                              : 'bg-emerald-500/10 border-emerald-500/30'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${buildOnServer ? 'bg-violet-500/20' : 'bg-emerald-500/20'}`}>
                              {buildOnServer ? '⚙️' : '✅'}
                            </div>
                            <div>
                              <p className={`text-sm font-semibold ${buildOnServer ? 'text-violet-300' : 'text-emerald-300'}`}>
                                {buildOnServer ? 'זוהה קוד מקור — Build אוטומטי' : 'זוהו קבצים בנויים — מוכן לפריסה'}
                              </p>
                              <p className="text-[10px] text-zinc-500 mt-0.5">
                                {buildOnServer ? 'השרת יריץ npm install + npm run build' : 'הקבצים יועלו ישירות ל-Cloudflare'}
                              </p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-600 shrink-0">לחץ לשינוי</p>
                        </div>

                        <div>
                          <label className="text-xs uppercase tracking-widest text-zinc-500 font-semibold mb-2 block">שם הפרויקט</label>
                          <input 
                            type="text"
                            value={projectName}
                            onChange={(e) => setProjectName(sanitizeProjectName(e.target.value))}
                            placeholder="my-awesome-site"
                            className="w-full glass rounded-2xl px-4 py-4 focus:outline-none accent-ring transition-all"
                          />
                          <p className="text-[10px] text-zinc-500 mt-1 mr-1">
                            אותיות קטנות, מספרים ומקפים בלבד (ללא רווחים)
                          </p>
                        </div>
                        <button 
                          onClick={handleDeploy}
                          className="w-full accent-bg hover:opacity-90 text-white font-bold py-5 rounded-2xl accent-shadow transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                          <Globe size={20} />
                          פרוס עכשיו
                        </button>
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {(step === 'processing' || step === 'deploying') && (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex-1 flex flex-col items-center justify-center text-center gap-8"
                  >
                    <div className="text-center mb-4 space-y-3">
                      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold tracking-widest uppercase">
                        {step === 'processing' ? 'עיבוד' : (useGithub ? 'GitHub' : 'פריסה')}
                      </div>
                      <h2 className="text-4xl font-black text-gradient">
                        {step === 'processing' ? (buildOnServer ? 'בונה את האתר...' : 'מעבד קבצים...') : (useGithub ? 'מעלה ל-GitHub...' : 'פורס ל-Cloudflare...')}
                      </h2>
                      <p className="text-zinc-400 text-sm font-medium">
                        {buildOnServer && step === 'processing' ? 'זה עשוי לקחת דקה או שתיים' : 'זה ייקח רק כמה שניות'}
                      </p>
                    </div>

                    <div className="w-full glass rounded-[40px] p-12 flex flex-col items-center justify-center gap-8 relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent" />
                      
                      <div className="relative">
                        <div className="w-32 h-32 rounded-full border-4 border-white/5 flex items-center justify-center relative">
                          <div className="absolute inset-0 rounded-full border-4 border-accent border-t-transparent animate-spin" />
                          <div className="w-24 h-24 rounded-full bg-accent/10 flex items-center justify-center accent-shadow">
                            <CloudUpload size={40} className="text-accent animate-pulse" />
                          </div>
                        </div>
                      </div>

                      <div className="w-full max-w-xs space-y-4 relative z-10">
                        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            className="h-full accent-bg accent-shadow"
                            initial={{ width: "0%" }}
                            animate={{ width: "100%" }}
                            transition={{ duration: 15, ease: "linear" }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                          <span>100%</span>
                          <span>בתהליך...</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 'waiting-cf' && (
                  <motion.div
                    key="waiting-cf"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex-1 flex flex-col items-center justify-center text-center gap-8"
                  >
                    <div className="text-center mb-4 space-y-3">
                      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs font-bold tracking-widest uppercase">
                        Cloudflare Deployment
                      </div>
                      <h2 className="text-4xl font-black text-gradient">
                        פורס ל-Cloudflare...
                      </h2>
                      <p className="text-zinc-400 text-sm font-medium">
                        GitHub Actions מריץ את Wrangler — האתר יהיה פעיל תוך כ-2 דקות
                      </p>
                    </div>

                    <div className="w-full glass rounded-[40px] p-12 flex flex-col items-center justify-center gap-8 relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
                      
                      <div className="relative">
                        <div className="w-32 h-32 rounded-full border-4 border-white/5 flex items-center justify-center relative">
                          <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
                          <div className="w-24 h-24 rounded-full bg-blue-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                            <Loader2 size={40} className="text-blue-500 animate-spin" />
                          </div>
                        </div>
                      </div>

                      <div className="w-full max-w-xs space-y-6 relative z-10">
                        <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                            <span>סטטוס:</span>
                            <span className="text-blue-500 font-bold">{cfStatus || 'מעלה קבצים...'}</span>
                          </div>
                          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                              initial={{ width: "0%" }}
                              animate={{ width: "100%" }}
                              transition={{ duration: 30, ease: "linear" }}
                            />
                          </div>
                        </div>

                        {githubUrl && (
                          <div className="pt-4 border-t border-white/5 space-y-3">
                            <p className="text-[10px] text-zinc-500 mb-3 uppercase tracking-widest font-bold">בינתיים תוכל לצפות בקוד ב-GitHub:</p>
                            <div className="flex flex-col gap-2">
                              <a 
                                href={githubUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all border border-white/5 text-sm"
                              >
                                <Github size={16} className="text-zinc-400" />
                                צפה במאגר ב-GitHub
                              </a>
                              
                              {cfAccountId && (
                                <a 
                                  href={`https://dash.cloudflare.com/${cfAccountId}/pages/view/${sanitizeProjectName(projectName)}`}
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 font-bold py-4 rounded-2xl transition-all border border-orange-500/20 text-sm"
                                >
                                  <ExternalLink size={16} />
                                  צפה ביומני הבנייה ב-Cloudflare
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 'success' && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex-1 flex flex-col items-center justify-center text-center gap-8"
                  >
                    <div className="w-24 h-24 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center">
                      <CheckCircle2 size={60} />
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold mb-2">האתר באוויר!</h2>
                      <p className="text-zinc-400">הקבצים הועלו ל-GitHub — Cloudflare יסיים את הפריסה תוך ~2 דקות</p>
                    </div>

                    <div className="w-full glass rounded-[40px] p-8 space-y-6 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 blur-3xl rounded-full -mr-16 -mt-16" />
                      
                      <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold block text-right">כתובת האתר (Cloudflare)</label>
                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group hover:bg-white/10 transition-all">
                          <span className="text-zinc-400 truncate ml-4 text-sm font-medium">{deployUrl}</span>
                          <button onClick={() => {
                            if (deployUrl) {
                              navigator.clipboard.writeText(deployUrl);
                              alert('הועתק!');
                            }
                          }} className="p-2 hover:accent-bg hover:text-white rounded-xl transition-all">
                            <Copy size={16} />
                          </button>
                        </div>
                        <p className="text-[11px] text-zinc-500 text-right px-1">
                          ⏱ GitHub Actions מריץ את הפריסה ברקע — הקישור יהיה פעיל תוך כ-2 דקות
                        </p>
                      </div>

                      {githubUrl && (
                        <div className="space-y-3">
                          <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold block text-right">קישור למאגר (GitHub)</label>
                          <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group hover:bg-white/10 transition-all">
                            <span className="text-zinc-400 truncate ml-4 text-sm font-medium">{githubUrl}</span>
                            <button onClick={() => {
                              if (githubUrl) {
                                navigator.clipboard.writeText(githubUrl);
                                alert('הועתק!');
                              }
                            }} className="p-2 hover:accent-bg hover:text-white rounded-xl transition-all">
                              <Copy size={16} />
                            </button>
                          </div>
                        </div>
                      )}

                      {prUrl && (
                        <div className="space-y-3">
                          <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold block text-right">בקשת מיזוג (Pull Request)</label>
                          <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group hover:bg-white/10 transition-all">
                            <span className="text-zinc-400 truncate ml-4 text-sm font-medium">{prUrl}</span>
                            <button onClick={() => {
                              if (prUrl) {
                                navigator.clipboard.writeText(prUrl);
                                alert('הועתק!');
                              }
                            }} className="p-2 hover:accent-bg hover:text-white rounded-xl transition-all">
                              <Copy size={16} />
                            </button>
                          </div>
                          <a 
                            href={prUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 text-accent text-xs font-bold hover:underline"
                          >
                            <GitPullRequest size={14} />
                            פתח Pull Request ב-GitHub
                          </a>
                        </div>
                      )}

                      <div className={`grid gap-4 pt-4 ${deployUrl ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {deployUrl && (
                          <a 
                            href={deployUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 bg-white text-black font-bold py-5 rounded-2xl hover:bg-zinc-200 transition-all active:scale-95 text-sm shadow-xl"
                          >
                            <ExternalLink size={18} />
                            פתח אתר
                          </a>
                        )}
                        <button 
                          onClick={() => {
                            setView('dashboard');
                            reset();
                          }}
                          className="flex items-center justify-center gap-2 glass font-bold py-5 rounded-2xl hover:bg-white/10 transition-all active:scale-95 text-sm"
                        >
                          <LayoutDashboard size={18} />
                          ניהול פריסות
                        </button>
                      </div>

                      {deployedBranch && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="pt-4 border-t border-white/5"
                        >
                          <button 
                            onClick={handleMerge}
                            className="w-full flex items-center justify-center gap-2 bg-emerald-500 text-white font-bold py-4 rounded-2xl hover:bg-emerald-600 transition-colors text-sm shadow-lg shadow-emerald-500/20"
                          >
                            <GitMerge size={18} />
                            הפוך לפריסה ראשית (Merge to main)
                          </button>
                          <p className="text-[10px] text-zinc-500 mt-2 text-center">
                            פעולה זו תמזג את הענף <code className="bg-white/5 px-1 rounded">{deployedBranch}</code> לענף הראשי
                          </p>
                        </motion.div>
                      )}

                      <button 
                        onClick={reset}
                        className="w-full py-3 text-zinc-500 text-xs hover:text-white transition-colors"
                      >
                        העלה פרויקט נוסף
                      </button>
                    </div>
                  </motion.div>
                )}

                {step === 'error' && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex-1 flex flex-col items-center justify-center text-center gap-6"
                  >
                    <div className="w-20 h-20 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center">
                      <AlertCircle size={48} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold mb-2">אופס, משהו השתבש</h2>
                      <p className="text-red-400/80 max-w-xs mx-auto">{error}</p>
                    </div>
                    <button 
                      onClick={reset}
                      className="px-8 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold transition-colors"
                    >
                      נסה שוב
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="dashboard-view"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">הפרויקטים שלי</h2>
                <button 
                  onClick={fetchProjects}
                  className={`p-2 rounded-full hover:bg-white/5 transition-colors ${isLoadingProjects ? 'animate-spin' : ''}`}
                >
                  <RefreshCw size={18} className="text-zinc-400" />
                </button>
              </div>

              {!cfToken || !cfAccountId ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                  <Settings size={48} className="text-zinc-700" />
                  <p className="text-zinc-500">אנא הגדר את פרטי Cloudflare כדי לראות את הפרויקטים שלך</p>
                  <button 
                    onClick={() => setShowConfig(true)}
                    className="text-blue-500 font-bold"
                  >
                    פתח הגדרות
                  </button>
                </div>
              ) : selectedProject ? (
                <div className="flex-1 flex flex-col gap-6">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setSelectedProject(null)}
                      className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-2"
                    >
                      <ChevronLeft size={20} />
                      <span className="text-xs font-bold">חזור</span>
                    </button>
                    <button 
                      onClick={() => { setView('deploy'); setZipFile(null); setProjectName(''); }}
                      className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-2"
                    >
                      <Home size={16} />
                      <span className="text-xs font-bold">מסך בית</span>
                    </button>
                    <div className="h-8 w-px bg-white/10 mx-2" />
                    <div>
                      <h3 className="text-xl font-bold">{selectedProject.name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <a 
                          href={`https://${selectedProject.subdomain}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 flex items-center gap-1"
                        >
                          {selectedProject.subdomain}
                          <ExternalLink size={10} />
                        </a>
                        <button 
                          onClick={() => selectProjectForUpdate(selectedProject)}
                          className="text-[10px] bg-blue-600/10 text-blue-500 px-2 py-0.5 rounded-full font-bold hover:bg-blue-600/20 transition-colors"
                        >
                          עדכן אתר
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-4">
                    <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider">פריסות קודמות</h4>
                    {isLoadingDeployments ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={32} className="text-blue-500 animate-spin" />
                      </div>
                    ) : deployments.length === 0 ? (
                      <p className="text-center text-zinc-500 py-12">אין פריסות להצגה</p>
                    ) : (
                      deployments.map((deploy) => {
                        const isProduction = deploy.aliases?.some(a => a === selectedProject.subdomain);
                        return (
                          <div key={deploy.id} className="glass rounded-2xl p-4 space-y-3 border-white/5">
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-zinc-400">{deploy.id.substring(0, 8)}</span>
                                  {isProduction && (
                                    <span className="bg-emerald-500/10 text-emerald-500 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">ראשי</span>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-500 mt-1">
                                  {new Date(deploy.created_on).toLocaleString('he-IL')}
                                </p>
                              </div>
                              <a 
                                href={deploy.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                              >
                                <ExternalLink size={14} className="text-zinc-400" />
                              </a>
                            </div>
                            {!isProduction && (
                              <button 
                                onClick={() => handleRollback(selectedProject.name, deploy.id)}
                                disabled={!!isRollingBack}
                                className="w-full py-2 bg-white/5 hover:bg-white/10 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                              >
                                {isRollingBack === deploy.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={12} />
                                )}
                                קבע כראשי
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : isLoadingProjects ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 size={40} className="text-blue-500 animate-spin" />
                </div>
              ) : projects.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                  <Globe size={48} className="text-zinc-700" />
                  <p className="text-zinc-500">עדיין אין פרויקטים בחשבון זה</p>
                  <button 
                    onClick={() => setView('deploy')}
                    className="bg-blue-600 px-6 py-3 rounded-xl font-bold"
                  >
                    צור פרויקט ראשון
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <h2 className="text-xl font-bold">הפרויקטים שלי</h2>
                    <button 
                      onClick={() => setView('deploy')}
                      className="text-xs font-bold text-blue-500 hover:underline flex items-center gap-1"
                    >
                      <Home size={12} />
                      חזרה למסך הבית
                    </button>
                  </div>
                  {projects.map((project) => (
                    <div 
                      key={project.name}
                      className="glass rounded-[32px] p-6 flex flex-col gap-6 hover:border-white/20 transition-all group relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex justify-between items-start relative z-10">
                        <div>
                          <h3 className="font-bold text-xl text-gradient">{project.name}</h3>
                          <p className="text-xs text-zinc-500 mt-1 font-medium">נוצר ב: {new Date(project.created_on).toLocaleDateString('he-IL')}</p>
                        </div>
                        <a 
                          href={`https://${project.subdomain}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="p-3 bg-white/5 rounded-2xl text-zinc-400 hover:accent-bg hover:text-white transition-all accent-shadow"
                        >
                          <ExternalLink size={18} />
                        </a>
                      </div>
                      <div className="flex gap-3 relative z-10">
                        <button 
                          onClick={() => {
                            setSelectedProject(project);
                            fetchDeployments(project.name);
                          }}
                          className="flex-1 glass text-zinc-300 py-3.5 rounded-2xl font-bold text-sm hover:bg-white/10 transition-all active:scale-95"
                        >
                          היסטוריית פריסות
                        </button>
                        <button 
                          onClick={() => selectProjectForUpdate(project)}
                          className="flex-1 accent-bg text-white py-3.5 rounded-2xl font-bold text-sm hover:opacity-90 transition-all active:scale-95 accent-shadow"
                        >
                          עדכן אתר
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Config Modal - redesigned as a single scrollable page, no tabs */}
      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowConfig(false); }}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="w-full max-w-md glass rounded-t-[32px] flex flex-col max-h-[92vh] overflow-hidden"
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="px-6 pt-3 pb-4 flex justify-between items-center">
                <h3 className="text-xl font-bold">הגדרות</h3>
                <button onClick={() => setShowConfig(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-zinc-400">
                  <X size={20} />
                </button>
              </div>

              {/* Scrollable content — single page, sections instead of tabs */}
              <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-8">

                {/* ─── SECTION: פריסה ─── */}
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">פריסה</p>

                  {/* GitHub toggle — most important, top */}
                  <div
                    onClick={() => setUseGithub(!useGithub)}
                    className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border ${useGithub ? 'bg-blue-500/10 border-blue-500/30' : 'bg-white/5 border-white/5 hover:bg-white/8'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${useGithub ? 'bg-blue-500/20' : 'bg-white/5'}`}>
                        <Github size={18} className={useGithub ? 'text-blue-400' : 'text-zinc-500'} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">שמור גיבוי ב-GitHub</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">מעלה את הקוד למאגר לפני הפריסה</p>
                      </div>
                    </div>
                    {/* Toggle pill */}
                    <div className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${useGithub ? 'bg-blue-500' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${useGithub ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </div>

                  {/* Cloudflare auto deploy toggle */}
                  <div
                    onClick={() => setAutoDeployCloudflare(!autoDeployCloudflare)}
                    className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border ${autoDeployCloudflare ? 'bg-orange-500/10 border-orange-500/30' : 'bg-white/5 border-white/5 hover:bg-white/8'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${autoDeployCloudflare ? 'bg-orange-500/20' : 'bg-white/5'}`}>
                        <Globe size={18} className={autoDeployCloudflare ? 'text-orange-400' : 'text-zinc-500'} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">פרוס אוטומטית ל-Cloudflare</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">מעלה ישירות לאחר העלאת הקבצים</p>
                      </div>
                    </div>
                    <div className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${autoDeployCloudflare ? 'bg-orange-500' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${autoDeployCloudflare ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </div>

                  {/* Auto merge toggle — only relevant if GitHub on */}
                  {useGithub && (
                    <div
                      onClick={() => setAutoMerge(!autoMerge)}
                      className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border ${autoMerge ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/5 hover:bg-white/8'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${autoMerge ? 'bg-emerald-500/20' : 'bg-white/5'}`}>
                          <GitMerge size={18} className={autoMerge ? 'text-emerald-400' : 'text-zinc-500'} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Merge אוטומטי ל-main</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">מזג עדכונים אוטומטית בלי אישור ידני</p>
                        </div>
                      </div>
                      <div className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${autoMerge ? 'bg-emerald-500' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${autoMerge ? 'right-0.5' : 'left-0.5'}`} />
                      </div>
                    </div>
                  )}
                </div>

                {/* ─── SECTION: GitHub ─── */}
                {useGithub && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">פרטי GitHub</p>
                      <button
                        onClick={() => { setShowGuide('github'); setGuideStep(0); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold hover:bg-blue-500/20 transition-all"
                      >
                        <HelpCircle size={11} />
                        איך מקבלים טוקן?
                      </button>
                    </div>
                    <div className="space-y-3">

                      {/* Token — show badge when connected, input when not */}
                      {githubConnectedUser ? (
                        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                              <Github size={16} className="text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-emerald-300">מחובר כ-{githubConnectedUser}</p>
                              <p className="text-[10px] text-zinc-500 mt-0.5">הטוקן שמור ומוגן</p>
                            </div>
                          </div>
                          <button
                            onClick={() => { setGithubConnectedUser(''); setGithubToken(''); localStorage.removeItem('github_connected_user'); }}
                            className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-rose-500/10"
                          >
                            החלף
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">Personal Access Token</label>
                          <input
                            type="password"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            placeholder="ghp_..."
                            className="w-full glass rounded-2xl px-4 py-3.5 focus:outline-none accent-ring text-sm"
                          />
                          <button
                            onClick={handleTestGithubConnection}
                            disabled={isTestingGithub || !githubToken}
                            className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 border border-white/5"
                          >
                            {isTestingGithub ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} className="text-zinc-400" />}
                            {isTestingGithub ? 'בודק חיבור...' : 'חבר ל-GitHub'}
                          </button>
                        </div>
                      )}

                      <div className="relative">
                        <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">שם המאגר <span className="text-zinc-600">(ריק = שם הפרויקט)</span></label>
                        <input
                          type="text"
                          value={githubRepo}
                          onChange={(e) => setGithubRepo(e.target.value)}
                          placeholder="my-repo-name"
                          className="w-full glass rounded-2xl px-4 py-3.5 focus:outline-none accent-ring text-sm"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ─── SECTION: Cloudflare ─── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">פרטי Cloudflare</p>
                    <button
                      onClick={() => { setShowGuide('cloudflare'); setGuideStep(0); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-bold hover:bg-orange-500/20 transition-all"
                    >
                      <HelpCircle size={11} />
                      איך מקבלים?
                    </button>
                  </div>
                  <div className="space-y-3">

                    {/* Account ID */}
                    {cfAccountId ? (
                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-orange-500/10 border border-orange-500/25">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-orange-500/20 flex items-center justify-center">
                            <Globe size={15} className="text-orange-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-orange-300">Account ID מוגדר</p>
                            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{'•'.repeat(8)}{cfAccountId.slice(-4)}</p>
                          </div>
                        </div>
                        <button onClick={() => setCfAccountId('')} className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-rose-500/10">
                          החלף
                        </button>
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">Account ID</label>
                        <input
                          type="password"
                          value={cfAccountId}
                          onChange={(e) => setCfAccountId(e.target.value)}
                          placeholder="abc123..."
                          className="w-full glass rounded-2xl px-4 py-3.5 focus:outline-none accent-ring text-sm"
                        />
                      </div>
                    )}

                    {/* API Token */}
                    {cfToken ? (
                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-orange-500/10 border border-orange-500/25">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-orange-500/20 flex items-center justify-center">
                            <CheckCircle2 size={15} className="text-orange-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-orange-300">API Token מוגדר</p>
                            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{'•'.repeat(12)}{cfToken.slice(-4)}</p>
                          </div>
                        </div>
                        <button onClick={() => setCfToken('')} className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-rose-500/10">
                          החלף
                        </button>
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">API Token</label>
                        <input
                          type="password"
                          value={cfToken}
                          onChange={(e) => setCfToken(e.target.value)}
                          placeholder="••••••••"
                          className="w-full glass rounded-2xl px-4 py-3.5 focus:outline-none accent-ring text-sm"
                        />
                      </div>
                    )}

                    <p className="text-[10px] text-zinc-600 px-1">הפרטים נשמרים בדפדפן שלך בלבד</p>
                  </div>
                </div>

                {/* ─── SECTION: Build ─── */}
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">הגדרות Build</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">תבנית פרויקט</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'auto', label: 'זיהוי אוטומטי' },
                          { id: 'vite', label: 'Vite / React' },
                          { id: 'next', label: 'Next.js' },
                          { id: 'react-app', label: 'Create React App' },
                          { id: 'custom', label: 'מותאם אישית' },
                        ].map(f => (
                          <button
                            key={f.id}
                            onClick={() => setFrameworkPreset(f.id)}
                            className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-all text-right ${frameworkPreset === f.id ? 'accent-bg text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(frameworkPreset === 'custom' || frameworkPreset === 'auto') && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">פקודת Build</label>
                          <input
                            type="text"
                            value={customBuildCommand}
                            onChange={(e) => setCustomBuildCommand(e.target.value)}
                            className="w-full glass rounded-xl px-3 py-2.5 focus:outline-none accent-ring text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">תיקיית פלט</label>
                          <input
                            type="text"
                            value={customOutputDir}
                            onChange={(e) => setCustomOutputDir(e.target.value)}
                            className="w-full glass rounded-xl px-3 py-2.5 focus:outline-none accent-ring text-xs font-mono"
                          />
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>

                {/* ─── SECTION: כללי ─── */}
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">כללי</p>

                  {/* Project prefix */}
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-1.5 block font-medium">קידומת לשם פרויקט <span className="text-zinc-600">(אופציונלי)</span></label>
                    <input
                      type="text"
                      value={projectPrefix}
                      onChange={(e) => setProjectPrefix(e.target.value)}
                      placeholder="dev / prod / test"
                      className="w-full glass rounded-2xl px-4 py-3.5 focus:outline-none accent-ring text-sm"
                    />
                  </div>

                  {/* Auto open dashboard */}
                  <div
                    onClick={() => setAutoOpenDashboard(!autoOpenDashboard)}
                    className={`flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border ${autoOpenDashboard ? 'bg-accent/10 border-accent/30' : 'bg-white/5 border-white/5 hover:bg-white/8'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${autoOpenDashboard ? 'bg-accent/20' : 'bg-white/5'}`}>
                        <LayoutDashboard size={18} className={autoOpenDashboard ? 'text-accent' : 'text-zinc-500'} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">פתח Dashboard אחרי פריסה</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">מעבר אוטומטי לרשימת הפרויקטים</p>
                      </div>
                    </div>
                    <div className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${autoOpenDashboard ? 'bg-accent' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${autoOpenDashboard ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </div>

                  {/* Theme */}
                  <div className="space-y-2">
                    <label className="text-[10px] text-zinc-500 font-medium block">צבע דגש</label>
                    <div className="flex gap-2">
                      {Object.entries(themes).map(([key, value]) => (
                        <button
                          key={key}
                          onClick={() => setTheme(key)}
                          title={value.name}
                          className={`flex-1 h-8 rounded-xl border-2 transition-all relative ${theme === key ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: value.color }}
                        >
                          {theme === key && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-2 h-2 bg-white rounded-full" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dark/Light mode */}
                  <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-2xl">
                    <button
                      onClick={() => setMode('dark')}
                      className={`py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${mode === 'dark' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      🌙 כהה
                    </button>
                    <button
                      onClick={() => setMode('light')}
                      className={`py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${mode === 'light' ? 'bg-white text-black shadow-xl' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      ☀️ בהיר
                    </button>
                  </div>
                </div>

                {/* ─── PWA install ─── */}
                {deferredPrompt && (
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/20 rounded-xl">
                        <Download size={18} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">התקן כאפליקציה</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">גישה מהירה מהמסך הבית</p>
                      </div>
                    </div>
                    <button onClick={handleInstallClick} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0">
                      התקן
                    </button>
                  </div>
                )}

                {/* ─── Danger zone ─── */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <button
                    onClick={() => { if (confirm('למחוק את כל ההגדרות?')) { localStorage.clear(); window.location.reload(); } }}
                    className="w-full py-3 rounded-2xl text-rose-500/70 text-xs font-semibold hover:bg-rose-500/5 hover:text-rose-400 transition-colors border border-rose-500/10"
                  >
                    איפוס כל ההגדרות
                  </button>
                </div>

              </div>

              {/* Footer — save button */}
              <div className="p-4 border-t border-white/5">
                <button
                  onClick={() => { setShowConfig(false); if (view === 'dashboard') fetchProjects(); }}
                  className="w-full accent-bg py-4 rounded-2xl font-bold text-white accent-shadow transition-all active:scale-95"
                >
                  שמור וסגור
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guide Modal */}
      <GuideModal />

      {/* Footer */}
      <footer className="mt-8 text-center text-zinc-600 text-xs">
        <p>© 2026 CloudDeploy Mobile v12 • Built with AI</p>
      </footer>
    </div>
  );
}
