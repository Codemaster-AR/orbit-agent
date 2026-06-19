import { useState, useRef, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight, RotateCw, Home, X, Shield, Star, Menu, Sparkles, Cpu, Plus, Clock, Bookmark, Globe, Trash2, Send } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
}

interface Tab {
  id: string;
  url: string;
  title: string;
  messages: Message[];
  pageContext: { url: string; text: string } | null;
  isScraping: boolean;
  searchEngine: 'google' | 'duckduckgo' | 'gemini';
  chatInput: string;
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
}

interface HistoryItem {
  id: string;
  title: string;
  url: string;
  timestamp: number;
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([{
    id: 't1',
    url: 'gemini://newtab',
    title: 'New Tab',
    messages: [{ id: '1', role: 'model', content: "Hi! I'm your Gemini Browser AI. I can read the pages you visit and answer questions about them." }],
    pageContext: null,
    isScraping: false,
    searchEngine: 'google',
    chatInput: ''
  }]);
  const [activeTabId, setActiveTabId] = useState<string>('t1');
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [leftNavMode, setLeftNavMode] = useState<'tabs' | 'history' | 'bookmarks'>('tabs');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showAuthNotice, setShowAuthNotice] = useState(false);

  const [urlInput, setUrlInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Load saved data
  useEffect(() => {
    const savedBookmarks = localStorage.getItem('gemini_bookmarks');
    const savedHistory = localStorage.getItem('gemini_history');
    if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    // Check auth status
    if (window.electronAPI?.auth) {
      window.electronAPI.auth.status().then(setIsLoggedIn);
    }

    // Create initial tab in main process
    const initialTab = tabs[0];
    if (window.electronAPI) {
      window.electronAPI.ipcRenderer.send('create-new-tab', { tabId: initialTab.id, url: initialTab.url });
      window.electronAPI.ipcRenderer.send('switch-tab', initialTab.id);
    }
  }, []);

  const handleLogin = async () => {
    if (window.electronAPI?.auth) {
      setShowAuthNotice(true);
      const success = await window.electronAPI.auth.login();
      if (success) {
        setIsLoggedIn(true);
        setShowAuthNotice(false);
      }
    }
  };
  // Sync BrowserView bounds using ResizeObserver for live adaptation
  useEffect(() => {
    if (!viewportRef.current || !window.electronAPI) return;

    const observer = new ResizeObserver(() => {
      if (viewportRef.current && !activeTab?.url.startsWith('gemini://')) {
        const rect = viewportRef.current.getBoundingClientRect();
        window.electronAPI.ipcRenderer.send('update-bounds', {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    });

    observer.observe(viewportRef.current);
    
    // Initial sync
    updateViewBounds();

    window.addEventListener('resize', updateViewBounds);
    
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateViewBounds);
    };
  }, [activeTabId, activeTab?.url]); // Sidebars change size, which triggers observer

  // Sync BrowserView bounds (fallback/manual)
  const updateViewBounds = () => {
    if (viewportRef.current && window.electronAPI && !activeTab?.url.startsWith('gemini://')) {
      const rect = viewportRef.current.getBoundingClientRect();
      window.electronAPI.ipcRenderer.send('update-bounds', {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }
  };

  // Handle IPC from main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleUpdateUrl = (_: any, { tabId, url }: { tabId: string, url: string }) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, url, title: new URL(url).hostname } : t));
    };

    const handleUpdateTitle = (_: any, { tabId, title }: { tabId: string, title: string }) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
    };

    const handleLoadingStatus = (_: any, { tabId, isLoading }: { tabId: string, isLoading: boolean }) => {
      // Could show a loader in the UI
    };

    const handleRequestNewTab = (_: any, url: string) => {
      createTab(url);
    };

    const handleRequestBoundsUpdate = (_: any, tabId: string) => {
      if (tabId === activeTabId) updateViewBounds();
    };

    const handleAutoNavigate = (_: any, url: string) => {
      navigateTab(url);
    };

    window.electronAPI.ipcRenderer.on('update-url', handleUpdateUrl);
    window.electronAPI.ipcRenderer.on('update-title', handleUpdateTitle);
    window.electronAPI.ipcRenderer.on('loading-status', handleLoadingStatus);
    window.electronAPI.ipcRenderer.on('request-new-tab', handleRequestNewTab);
    window.electronAPI.ipcRenderer.on('request-bounds-update', handleRequestBoundsUpdate);
    window.electronAPI.ipcRenderer.on('auto-navigate', handleAutoNavigate);

    return () => {
      window.electronAPI.ipcRenderer.removeAllListeners('update-url');
      window.electronAPI.ipcRenderer.removeAllListeners('update-title');
      window.electronAPI.ipcRenderer.removeAllListeners('loading-status');
      window.electronAPI.ipcRenderer.removeAllListeners('request-new-tab');
      window.electronAPI.ipcRenderer.removeAllListeners('request-bounds-update');
      window.electronAPI.ipcRenderer.removeAllListeners('auto-navigate');
    };
  }, [activeTabId]);

  // Save data
  useEffect(() => {
    localStorage.setItem('gemini_bookmarks', JSON.stringify(bookmarks));
  }, [bookmarks]);
  
  useEffect(() => {
    localStorage.setItem('gemini_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    setUrlInput(activeTab?.url || "");
  }, [activeTab?.url, activeTabId]);

  // Scrape context on URL change
  useEffect(() => {
    if (!activeTab || activeTab.url.startsWith('gemini://')) return;
    
    // Check if we already have context for this URL
    if (activeTab.pageContext?.url === activeTab.url) return;

    const fetchContext = async () => {
      updateTab(activeTab.id, { isScraping: true });
      try {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(activeTab.url)}`);
        const data = await res.json();
        if (data.text) {
          updateTab(activeTab.id, { 
            pageContext: { url: activeTab.url, text: data.text },
            isScraping: false 
          });
        } else {
          updateTab(activeTab.id, { pageContext: null, isScraping: false });
        }
      } catch (err) {
        console.error("Failed to scrape context", err);
         updateTab(activeTab.id, { pageContext: null, isScraping: false });
      }
    };
    fetchContext();
  }, [activeTab?.url]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTab?.messages, isTyping]);


  const updateTab = (id: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const createTab = (url = 'gemini://newtab') => {
    const newId = Date.now().toString();
    const newTab: Tab = {
      id: newId,
      url,
      title: 'New Tab',
      messages: [{ id: '1', role: 'model', content: "Hi! I'm your Gemini Browser AI." }],
      pageContext: null,
      isScraping: false,
      searchEngine: 'google',
      chatInput: ''
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
    
    if (window.electronAPI) {
      window.electronAPI.ipcRenderer.send('create-new-tab', { tabId: newId, url: url.startsWith('gemini://') ? '' : url });
      window.electronAPI.ipcRenderer.send('switch-tab', newId);
    }
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (window.electronAPI) {
      window.electronAPI.ipcRenderer.send('close-tab', id);
    }

    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const newId = Date.now().toString();
        const nt = {
          id: newId,
          url: 'gemini://newtab',
          title: 'New Tab',
          messages: [{ id: '1', role: 'model', content: "Hi! I'm your Gemini Browser AI." }],
          pageContext: null,
          isScraping: false,
          searchEngine: 'google',
          chatInput: ''
        };
        if (window.electronAPI) {
          window.electronAPI.ipcRenderer.send('create-new-tab', { tabId: newId, url: '' });
          window.electronAPI.ipcRenderer.send('switch-tab', newId);
        }
        setActiveTabId(newId);
        return [nt];
      }
      return next;
    });
    
    if (activeTabId === id) {
      setTabs(prev => {
        const last = prev[prev.length - 1];
        setActiveTabId(last.id);
        if (window.electronAPI) window.electronAPI.ipcRenderer.send('switch-tab', last.id);
        return prev;
      });
    }
  };

  const addToHistory = (url: string, title: string) => {
    setHistory(prev => {
      const newHistory = [{ id: Date.now().toString(), url, title, timestamp: Date.now() }, ...prev];
      return newHistory.slice(0, 100); // keep last 100
    });
  };

  const toggleBookmark = () => {
    if (!activeTab) return;
    const existing = bookmarks.find(b => b.url === activeTab.url);
    if (existing) {
      setBookmarks(bookmarks.filter(b => b.url !== activeTab.url));
    } else {
      setBookmarks([...bookmarks, { id: Date.now().toString(), url: activeTab.url, title: activeTab.title }]);
    }
  };

  const navigateTab = (targetUrl: string) => {
    let finalUrl = targetUrl.trim();
    if (!finalUrl) return;

    if (finalUrl.startsWith('gemini://') && activeTab?.url === finalUrl) return;

    const isUrlMode = (() => {
       try { new URL(finalUrl); return true; } 
       catch (_) { return finalUrl.includes('.') && !finalUrl.includes(' '); }
    })();

    if (!isUrlMode) {
      if (activeTab?.searchEngine === 'google') {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
      } else if (activeTab?.searchEngine === 'duckduckgo') {
         finalUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(finalUrl)}`;
      } else {
         finalUrl = `gemini://search?q=${encodeURIComponent(finalUrl)}`;
      }
    } else if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('gemini://')) {
      finalUrl = 'https://' + finalUrl;
    }

    let title = finalUrl.replace(/^https?:\/\//, '');
    try {
      if (!finalUrl.startsWith('gemini://')) {
         title = new URL(finalUrl).hostname;
      } else if (finalUrl === 'gemini://newtab') {
         title = 'New Tab';
      }
    } catch(e) {}

    updateTab(activeTabId, { url: finalUrl, title });
    if (!finalUrl.startsWith('gemini://')) {
      addToHistory(finalUrl, title);
      if (window.electronAPI) window.electronAPI.ipcRenderer.send('load-url', { tabId: activeTabId, url: finalUrl });
    } else {
      if (window.electronAPI) window.electronAPI.ipcRenderer.send('switch-tab', activeTabId); // Show UI
    }
    
    if (finalUrl.startsWith('gemini://search')) {
       const urlParams = new URLSearchParams(finalUrl.split('?')[1]);
       const query = urlParams.get('q');
       if (query) {
         handleSendMessage(undefined, query);
         setIsRightSidebarOpen(true);
       }
    }
  };

  const handleAddressBarSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTab(urlInput);
    if (urlInputRef.current) urlInputRef.current.blur();
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const handleGoBack = () => {
    if (window.electronAPI) window.electronAPI.ipcRenderer.send('navigate-back', activeTabId);
  };

  const handleGoForward = () => {
    if (window.electronAPI) window.electronAPI.ipcRenderer.send('navigate-forward', activeTabId);
  };

  const handleRefresh = () => {
    if (window.electronAPI) window.electronAPI.ipcRenderer.send('refresh-tab', activeTabId);
  };

  const handleSendMessage = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const messageContent = customQuery || activeTab?.chatInput;
    if (!messageContent || !messageContent.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
    };

    updateTab(activeTabId, { 
      messages: [...(activeTab?.messages || []), userMessage],
      chatInput: ''
    });
    
    setIsTyping(true);

    try {
      let currentModelMessage = "";
      const modelMessageId = (Date.now() + 1).toString();

      updateTab(activeTabId, {
        messages: [...(activeTab?.messages || []), userMessage, { id: modelMessageId, role: 'model', content: "" }]
      });

      if (isLoggedIn && window.electronAPI?.auth) {
        // Use authenticated call
        const prompt = activeTab?.pageContext 
          ? `Context from current page: ${activeTab.pageContext.text}\n\nUser Question: ${messageContent}`
          : messageContent;
        
        const textResponse = await window.electronAPI.auth.generateContent(prompt);
        if (textResponse && typeof textResponse === 'string') {
          currentModelMessage = textResponse;
          setTabs(prev => prev.map(t => {
            if (t.id === activeTabId) {
               return {
                  ...t,
                  messages: t.messages.map(msg => msg.id === modelMessageId ? { ...msg, content: currentModelMessage } : msg)
               };
            }
            return t;
          }));
        } else if (textResponse && textResponse.error) {
           currentModelMessage = `[Nexus Error]: ${textResponse.error}`;
           setTabs(prev => prev.map(t => {
            if (t.id === activeTabId) {
               return {
                  ...t,
                  messages: t.messages.map(msg => msg.id === modelMessageId ? { ...msg, content: currentModelMessage } : msg)
               };
            }
            return t;
          }));
        }
      } else {
        // Fallback to existing server API
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...(activeTab?.messages || []), userMessage].map(m => ({ role: m.role, content: m.content })),
            pageContext: activeTab?.pageContext,
          })
        });

        if (!response.ok) throw new Error("Failed to chat");
        
        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        if (!reader) throw new Error("No reader");

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '');
              if (dataStr === '{}') continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.text) {
                  currentModelMessage += data.text;
                  setTabs(prev => prev.map(t => {
                    if (t.id === activeTabId) {
                        return {
                          ...t,
                          messages: t.messages.map(msg => msg.id === modelMessageId ? { ...msg, content: currentModelMessage } : msg)
                        };
                    }
                    return t;
                  }));
                }
              } catch (e) {}
            } else if (line.startsWith('event: end')) {
              setIsTyping(false);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      updateTab(activeTabId, {
        messages: [...(activeTab?.messages || []), userMessage, { id: Date.now().toString(), role: 'model', content: "Sorry, I ran into an error processing that request." }]
      });
    } finally {
      setIsTyping(false);
    }
  };

  const isBookmarked = activeTab && bookmarks.some(b => b.url === activeTab.url);

  const handleClose = () => {
    // @ts-ignore
    if (window.electronAPI) {
      // @ts-ignore
      window.electronAPI.windowControl('close');
    }
  };

  const handleMinimize = () => {
    // @ts-ignore
    if (window.electronAPI) {
      // @ts-ignore
      window.electronAPI.windowControl('minimize');
    }
  };

  const handleMaximize = () => {
    // @ts-ignore
    if (window.electronAPI) {
      // @ts-ignore
      window.electronAPI.windowControl('maximize');
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#050505] text-[#E0E0E0] overflow-hidden font-sans select-none">
      
      {/* Integrated Header Bar (Tabs + Search + Controls) */}
      <div className="h-12 flex items-center px-4 bg-[#0A0A0C] border-b border-[#1A1A1C] z-40 shrink-0 draggable gap-2">
        {/* Window Controls */}
        <div className="flex space-x-2 non-draggable mr-2 shrink-0">
          <div onClick={handleClose} className="w-3 h-3 rounded-full bg-[#FF5F57] hover:opacity-80 cursor-pointer"></div>
          <div onClick={handleMinimize} className="w-3 h-3 rounded-full bg-[#FEBC2E] hover:opacity-80 cursor-pointer"></div>
          <div onClick={handleMaximize} className="w-3 h-3 rounded-full bg-[#28C840] hover:opacity-80 cursor-pointer"></div>
        </div>

        {/* Tab Strip - Takes up most space */}
        <div className="flex-1 flex items-center space-x-1 overflow-x-auto custom-scrollbar non-draggable scrollbar-hide min-w-0">
          {tabs.map((tab) => (
            <div 
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center space-x-2 px-3 h-8 min-w-[120px] max-w-[180px] rounded-lg cursor-pointer transition-all border shrink-0 ${activeTabId === tab.id ? 'bg-[#1A1A1C] border-[#2D2D2F] text-white shadow-sm' : 'border-transparent text-[#88888C] hover:bg-[#121214]'}`}
            >
              <Globe size={13} className="shrink-0 opacity-50" />
              <span className="text-[11px] truncate flex-1 font-medium">{tab.title}</span>
              <button 
                onClick={(e) => closeTab(tab.id, e)}
                className={`p-0.5 rounded hover:bg-[#2D2D2F] transition-opacity ${activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button onClick={() => createTab()} className="p-1.5 text-[#88888C] hover:text-white hover:bg-[#121214] rounded-lg shrink-0">
            <Plus size={16} />
          </button>
        </div>

        {/* Integrated Search Bar - Smaller and Aligned */}
        <div className="w-[320px] h-8 bg-[#121214] border border-[#202022] rounded-lg flex items-center px-2 non-draggable shrink-0 focus-within:border-[#4B90FF]/40 transition-all">
          <div className="flex items-center gap-0.5 mr-1.5 text-[#555558] shrink-0">
            <button className="p-1 rounded hover:text-white" onClick={handleGoBack}><ChevronLeft size={14}/></button>
            <button className="p-1 rounded hover:text-white" onClick={handleGoForward}><ChevronRight size={14}/></button>
          </div>
          <form onSubmit={handleAddressBarSubmit} className="flex-1 flex items-center min-w-0 h-full">
            <input 
              ref={urlInputRef}
              type="text" 
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={handleFocus}
              className="bg-transparent border-none outline-none text-[11px] text-[#E0E0E0] placeholder-[#555558] w-full font-medium select-text overflow-x-auto whitespace-nowrap" 
              placeholder="Search or enter URL"
            />
          </form>
          <div className="flex items-center gap-1 ml-1.5 shrink-0">
            <button onClick={handleRefresh} className="p-1 text-[#555558] hover:text-white transition-colors"><RotateCw size={11}/></button>
            <button onClick={toggleBookmark} className={`p-1 transition-colors ${isBookmarked ? 'text-[#FEBC2E]' : 'text-[#555558] hover:text-white'}`}><Star size={11} fill={isBookmarked ? "currentColor" : "none"} /></button>
          </div>
        </div>

        {/* AI & Auth Status */}
        <div className="flex items-center space-x-2 non-draggable shrink-0">
          <div className="flex items-center space-x-2 px-2 h-8 bg-[#121214] border border-[#202022] rounded-lg">
             <div className={`w-1.5 h-1.5 rounded-full ${isLoggedIn ? 'bg-[#28C840] shadow-[0_0_4px_#28C840]' : 'bg-[#4B90FF] shadow-[0_0_4px_#4B90FF]'}`}></div>
             <span className="text-[9px] font-bold text-[#88888C] uppercase tracking-wider">{isLoggedIn ? 'Synced' : 'Nexus'}</span>
          </div>
          <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className={`p-1.5 h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${isRightSidebarOpen ? 'bg-[#4B90FF]/20 text-[#4B90FF]' : 'text-[#88888C] hover:bg-[#121214]'}`}>
            <Sparkles size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Hover-to-Expand Left Sidebar */}
        <div 
          className="relative z-50 group"
          onMouseEnter={() => setIsLeftSidebarOpen(true)}
          onMouseLeave={() => setIsLeftSidebarOpen(false)}
        >
          {/* Invisible trigger area when collapsed */}
          {!isLeftSidebarOpen && (
            <div className="absolute top-0 left-0 bottom-0 w-2 hover:bg-[#4B90FF]/10 transition-colors cursor-pointer"></div>
          )}

          <AnimatePresence>
            {isLeftSidebarOpen && (
              <motion.div 
                initial={{ x: -256 }}
                animate={{ x: 0 }}
                exit={{ x: -256 }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="absolute top-0 left-0 bottom-0 w-64 bg-[#0A0A0C]/95 backdrop-blur-xl border-r border-[#1A1A1C] flex flex-col p-4 shadow-2xl"
              >
                <div className="flex items-center space-x-3 px-2 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#4B90FF] to-[#8E44AD] flex items-center justify-center text-white">
                    <Sparkles size={16} />
                  </div>
                  <span className="font-semibold text-lg tracking-tight text-white">Nexus</span>
                </div>

                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#555558] font-bold px-2 mb-2">History & Bookmarks</div>
                    <div onClick={() => setLeftNavMode('bookmarks')} className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer ${leftNavMode === 'bookmarks' ? 'bg-[#1A1A1C] text-white' : 'text-[#88888C] hover:bg-[#121214]'}`}>
                      <Bookmark size={14} />
                      <span className="text-xs">Bookmarks</span>
                    </div>
                    <div onClick={() => setLeftNavMode('history')} className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer ${leftNavMode === 'history' ? 'bg-[#1A1A1C] text-white' : 'text-[#88888C] hover:bg-[#121214]'}`}>
                      <Clock size={14} />
                      <span className="text-xs">History</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#1A1A1C]">
                    {leftNavMode === 'bookmarks' && (
                      <div className="space-y-1">
                        {bookmarks.map(b => (
                          <div key={b.id} onClick={() => navigateTab(b.url)} className="p-2 text-xs text-[#88888C] hover:bg-[#121214] rounded-lg cursor-pointer truncate">
                            {b.title}
                          </div>
                        ))}
                      </div>
                    )}
                    {leftNavMode === 'history' && (
                      <div className="space-y-1">
                        {history.slice(0, 20).map(h => (
                          <div key={h.id} onClick={() => navigateTab(h.url)} className="p-2 text-xs text-[#88888C] hover:bg-[#121214] rounded-lg cursor-pointer truncate">
                            {h.title}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Browser Content View */}
        <div className="flex-1 flex flex-col relative z-20 bg-[#050505]">
          
          {/* Main Content Area */}
          <div className="flex-1 relative h-full">
            {/* View Port */}
            <div ref={viewportRef} className="w-full h-full relative bg-[#050505]">
               {activeTab?.url.startsWith('gemini://') && (
                  <div className="w-full h-full bg-[#0A0A0C] flex flex-col items-center justify-center p-8 z-30 relative">
                     {activeTab.url === 'gemini://newtab' ? (
                        <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-in fade-in zoom-in duration-500">
                          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#4B90FF] to-[#8E44AD] flex items-center justify-center shadow-[0_0_40px_rgba(75,144,255,0.3)]">
                            <Sparkles className="text-white w-10 h-10" />
                          </div>
                          
                          <div className="text-center space-y-2">
                            <h1 className="text-3xl font-bold tracking-tight text-white">Gemini Browser</h1>
                            <p className="text-[#88888C] max-w-sm">Integrated AI browsing experience powered by multi-modal reasoning.</p>
                          </div>
                  
                          <div className="grid grid-cols-2 gap-4 w-[600px]">
                            <div onClick={() => navigateTab('https://www.google.com')} className="p-6 bg-[#121214] border border-[#202022] rounded-2xl hover:border-[#4B90FF]/40 transition-colors cursor-pointer group">
                              <div className="text-xl mb-2 text-[#4B90FF]">G</div>
                              <div className="text-sm font-semibold text-white">Google</div>
                            </div>
                            <div onClick={() => navigateTab('https://github.com')} className="p-6 bg-[#121214] border border-[#202022] rounded-2xl hover:border-[#4B90FF]/40 transition-colors cursor-pointer group">
                              <div className="text-xl mb-2 text-white">⌘</div>
                              <div className="text-sm font-semibold text-white">GitHub</div>
                            </div>
                          </div>
                        </div>
                     ) : (
                        <div className="w-full h-full p-8 overflow-y-auto">
                           <div className="text-center text-[#88888C] mt-20">Searching...</div>
                        </div>
                     )}
                  </div>
               )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Gemini AI Chat */}
        <AnimatePresence>
          {isRightSidebarOpen && (
            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="h-full flex flex-col bg-[#0A0A0C] border-l border-[#1A1A1C] z-10 shrink-0 select-text"
            >
              {/* Sidebar Header */}
              <div className="h-12 flex items-center justify-between px-5 border-b border-[#1A1A1C] bg-[#0A0A0C] z-20 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-[#4B90FF]/10 text-[#4B90FF] rounded-lg">
                    <Cpu size={16} />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#E0E0E0]">Gemini Nexus</h2>
                    <p className="text-[10px] text-[#555558] font-mono tracking-wider">SECURE BROWSER AI</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {isLoggedIn && (
                    <div className="px-2 py-1 bg-[#28C840]/10 text-[#28C840] text-[10px] font-bold rounded border border-[#28C840]/20">
                      VERIFIED
                    </div>
                  )}
                  {!isLoggedIn && (
                    <button 
                      onClick={handleLogin}
                      className="px-2 py-1 bg-white text-black text-[10px] font-bold rounded hover:bg-white/90 transition-colors"
                    >
                      LOGIN
                    </button>
                  )}
                  <button 
                    onClick={() => setIsRightSidebarOpen(false)}
                    className="p-1.5 rounded-md hover:bg-[#121214] text-[#88888C] hover:text-[#E0E0E0] transition-colors cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Auth Notice Modal */}
              <AnimatePresence>
                {showAuthNotice && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
                  >
                    <motion.div 
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      className="max-w-md w-full bg-[#0A0A0C] border border-[#202022] rounded-3xl p-8 shadow-2xl"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-[#FEBC2E]/10 flex items-center justify-center mb-6 mx-auto">
                        <Shield className="text-[#FEBC2E] w-8 h-8" />
                      </div>
                      <h2 className="text-xl font-bold text-white text-center mb-4">Verification Notice</h2>
                      <p className="text-[#88888C] text-sm text-center leading-relaxed mb-6">
                        Gemini Nexus is currently in the Google verification process. If you see an <span className="text-white font-semibold">"App not verified"</span> warning:
                      </p>
                      <div className="bg-[#121214] border border-[#202022] rounded-xl p-4 mb-8 space-y-3">
                        <div className="flex items-center gap-3 text-xs text-[#E0E0E0]">
                          <div className="w-5 h-5 rounded-full bg-[#202022] flex items-center justify-center font-mono">1</div>
                          <span>Click <strong className="text-white">Advanced</strong> in the bottom left.</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[#E0E0E0]">
                          <div className="w-5 h-5 rounded-full bg-[#202022] flex items-center justify-center font-mono">2</div>
                          <span>Click <strong className="text-white">Go to Gemini Nexus (unsafe)</strong>.</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowAuthNotice(false)}
                        className="w-full py-3 bg-[#4B90FF] hover:bg-[#3A7EE0] text-white font-bold rounded-xl transition-colors"
                      >
                        I Understand
                      </button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Context Status Indicator */}
              {!activeTab?.url.startsWith('gemini://') && (
                 <div className="px-5 py-2 bg-[#121214] border-b border-[#202022] flex items-center justify-between text-xs font-mono shrink-0">
                    <div className="flex items-center gap-2 text-[#88888C]">
                       <div className={`w-2 h-2 rounded-full ${activeTab?.isScraping ? 'bg-[#4B90FF] animate-pulse' : (activeTab?.pageContext ? 'bg-[#28C840]' : 'bg-[#FF5F57]')}`}></div>
                       {activeTab?.isScraping ? 'ANALYZING PAGE...' : (activeTab?.pageContext ? 'PAGE CONTEXT ACTIVE' : 'NO CONTEXT AVAILABLE')}
                    </div>
                 </div>
              )}

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-5 pb-8 custom-scrollbar relative">
                <div className="space-y-6">
                  {activeTab?.messages.map((msg) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id} 
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[90%] rounded-2xl px-4 py-3 ${
                        msg.role === 'user' 
                          ? 'bg-[#4B90FF] text-white rounded-tr-sm shadow-md shadow-[#4B90FF]/20' 
                          : 'bg-[#121214] text-[#E0E0E0] rounded-tl-sm border border-[#202022] shadow-sm'
                      }`}>
                        {msg.role === 'model' && (
                           <div className="flex items-center gap-2 mb-2 text-[#4B90FF] text-xs font-semibold uppercase tracking-wider">
                             <Sparkles size={12} />
                             Gemini
                           </div>
                        )}
                        
                        <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : 'prose-invert prose-p:leading-relaxed prose-pre:bg-[#0A0A0C] prose-pre:border prose-pre:border-[#1A1A1C]'}`}>
                           {msg.role === 'model' ? (
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                           ) : (
                              <p className="whitespace-pre-wrap m-0 text-[13px]">{msg.content}</p>
                           )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  
                  {isTyping && (
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
                       <div className="bg-[#121214] rounded-2xl rounded-tl-sm border border-[#202022] px-4 py-3.5 flex gap-1.5 w-16">
                          <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-[#4B90FF]/50"></motion.div>
                          <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-[#4B90FF]/50"></motion.div>
                          <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-[#4B90FF]/50"></motion.div>
                       </div>
                    </motion.div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Chat Input */}
              <div className="p-4 bg-[#0A0A0C] border-t border-[#1A1A1C] shrink-0">
                <form onSubmit={handleSendMessage} className="relative flex items-end">
                  <textarea 
                    value={activeTab?.chatInput || ''}
                    onChange={(e) => updateTab(activeTabId, { chatInput: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                    placeholder={activeTab?.url.startsWith('gemini://') ? "Chat with Gemini..." : "Ask Gemini about this page..."}
                    className="w-full bg-[#121214] border border-[#202022] rounded-xl pl-4 pr-12 py-3.5 text-sm text-[#E0E0E0] placeholder-[#555558] focus:outline-none focus:ring-1 focus:ring-[#4B90FF]/40 focus:border-[#4B90FF]/40 resize-none min-h-[52px] max-h-[120px] transition-all custom-scrollbar"
                    rows={1}
                  />
                  <button 
                    type="submit"
                    disabled={!activeTab?.chatInput?.trim() || isTyping}
                    className="absolute right-2 bottom-2 p-1.5 bg-[#4B90FF] hover:bg-[#3A7EE0] disabled:bg-[#1A1A1C] disabled:text-[#555558] text-white rounded-lg transition-colors flex items-center justify-center h-8 w-8 cursor-pointer"
                  >
                    <Send size={14} className={activeTab?.chatInput?.trim() && !isTyping ? "translate-x-0.5 -translate-y-0.5 transition-transform" : ""} />
                  </button>
                </form>
                <div className="text-center mt-3">
                  <p className="text-[10px] text-[#555558] font-mono tracking-wide">AI MAY PRODUCE INACCURATE INFO</p>
                </div>
              </div>
              
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-8 bg-[#0A0A0C] border-t border-[#1A1A1C] flex items-center justify-between px-4 text-[10px] text-[#555558] font-medium shrink-0">
        <div className="flex space-x-4">
          <span className="text-[#4B90FF]">Electron Instance: Active</span>
          <span>Region: US-East (Proxy)</span>
        </div>
        <div className="flex space-x-4">
          <span>Latency: 24ms</span>
          <span>Memory: 1.2 GB</span>
          <span className="text-white">UTC {new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' })}</span>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #2D2D2F;
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #555558;
        }
      `}</style>
    </div>
  );
}
