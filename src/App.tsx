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
  Home,
  Download,
  GitMerge,
  GitPullRequest,
  Github
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
            commitMessage: `Deploy ${sanitizedName} from CloudDeploy`
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

        // 4. Deploy to Cloudflare via server-side Worker (handles CORS + correct 3-step upload API)
        if (autoDeployCloudflare && cfToken && cfAccountId) {
          setStep('waiting-cf');
          setCfStatus('מעלה קבצים ל-Cloudflare...');

          const cfDeployRes = await fetch('/api/cf-deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cfToken,
              cfAccountId,
              projectName: sanitizedName,
              zipFile: base64Zip,
              branch: isUpdate ? `deploy-${Date.now()}` : 'main',
            }),
          });

          const cfDeployData = await cfDeployRes.json() as any;
          if (!cfDeployRes.ok) {
            throw new Error(cfDeployData.error || 'פריסה ל-Cloudflare נכשלה');
          }

          setDeployUrl(cfDeployData.deploymentUrl || `https://${sanitizedName}.pages.dev`);
          setPreviewUrl(cfDeployData.deploymentUrl);
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

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('deploy')}>
          <div className="w-10 h-10 accent-bg rounded-xl flex items-center justify-center accent-shadow">
            <CloudUpload className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">CloudDeploy</h1>
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
                        הקבצים הועלו ל-GitHub, עכשיו Cloudflare בונה את האתר שלך
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
                      <p className="text-zinc-400">הפרויקט שלך הועלה בהצלחה</p>
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
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">פרטי GitHub</p>
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">פרטי Cloudflare</p>
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

      {/* Footer */}
      <footer className="mt-8 text-center text-zinc-600 text-xs">
        <p>© 2026 CloudDeploy Mobile • Built with AI</p>
      </footer>
    </div>
  );
}
