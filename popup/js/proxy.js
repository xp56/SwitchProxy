// 共享常量
const CONSTANTS = {
  CACHE_TTL: 30000,
  BYPASS_CACHE_TTL: 10000
};

// 优化的bypass列表匹配器
class BypassListMatcher {
  constructor() {
    this.wildcardDomains = new Set();
    this.exactDomains = new Set();
    this.pathPatterns = new Set();
    this.compiled = false;
    this.lastUpdate = 0;
  }

  compile(bypassList) {
    if (!bypassList || bypassList.length === 0) {
      this.clear();
      return;
    }

    this.wildcardDomains.clear();
    this.exactDomains.clear();
    this.pathPatterns.clear();

    for (const pattern of bypassList) {
      if (pattern.startsWith('*.')) {
        this.wildcardDomains.add(pattern.substring(2));
      } else if (pattern.endsWith('/*')) {
        this.pathPatterns.add(pattern.slice(0, -2));
      } else {
        this.exactDomains.add(pattern);
      }
    }

    this.compiled = true;
    this.lastUpdate = Date.now();
  }

  isMatch(hostname) {
    if (!hostname || !this.compiled) return false;

    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    if (this.exactDomains.has(hostname)) return true;

    for (const domain of this.wildcardDomains) {
      if (hostname === domain || hostname.endsWith('.' + domain)) return true;
    }

    for (const domain of this.pathPatterns) {
      if (hostname === domain || hostname.startsWith(domain + '/')) return true;
    }

    return false;
  }

  clear() {
    this.wildcardDomains.clear();
    this.exactDomains.clear();
    this.pathPatterns.clear();
    this.compiled = false;
  }
}

class ProxyManager {
  constructor() {
    this.profiles = new Map();
    this.currentProfile = null;
    this.bypassMatcher = new BypassListMatcher();
    this._initialized = false;
  }

  #bypassListCache = null;
  #bypassListExpiry = 0;

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    this.profiles.set('direct', { name: 'direct', type: 'direct', title: '直接连接' });
    this.profiles.set('system', { name: 'system', type: 'system', title: '系统代理' });

    try {
      const stored = await chrome.storage.local.get('profiles');
      if (!stored.profiles || stored.profiles.length === 0) {
        const defaultProfile = {
          name: 'proxy',
          type: 'fixed',
          host: '127.0.0.1',
          port: 7890,
          bypassList: []
        };
        await chrome.storage.local.set({ profiles: [defaultProfile] });
        this.profiles.set(defaultProfile.name, defaultProfile);
      } else {
        for (const profile of stored.profiles) {
          this.profiles.set(profile.name, profile);
        }
      }

      const current = await chrome.storage.local.get('currentProfile');
      this.currentProfile = current.currentProfile || 'direct';
    } catch (error) {
      console.error('Failed to initialize profiles:', error);
      this.currentProfile = 'direct';
    }

    await this.updateIcon(this.currentProfile);
  }

  async getCurrentProfile() {
    if (this.currentProfile) {
      return this.profiles.get(this.currentProfile);
    }
    
    const result = await chrome.storage.local.get('currentProfile');
    this.currentProfile = result.currentProfile || 'direct';
    return this.profiles.get(this.currentProfile);
  }

  async applyProfile(profileName) {
    const profile = this.profiles.get(profileName);
    if (!profile) return;

    switch (profile.type) {
      case 'direct':
        await this.setDirectProxy();
        break;
      case 'system':
        await this.setSystemProxy();
        break;
      case 'fixed':
        await this.setFixedProxy(profile);
        break;
    }

    this.currentProfile = profileName;
    await chrome.storage.local.set({ currentProfile: profileName });
    await this.updateIcon(profileName);
  }

  async addToNoProxy(domain) {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    
    if (!bypassList.includes(domain)) {
      bypassList.push(domain);
      await chrome.storage.local.set({ globalBypassList: bypassList });
      this.bypassMatcher.compile(bypassList);
      this.#bypassListCache = null; // 清除缓存
      
      const profile = await this.getCurrentProfile();
      if (profile) {
        profile.bypassList = bypassList;
        await this.saveProfiles();
        await this.applyProfile(this.currentProfile);
      }
    }
  }

  async removeFromNoProxy(domain) {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    
    const newList = bypassList.filter(d => d !== domain);
    await chrome.storage.local.set({ globalBypassList: newList });
    this.bypassMatcher.compile(newList);
    this.#bypassListCache = null; // 清除缓存
    
    const profile = await this.getCurrentProfile();
    if (profile) {
      profile.bypassList = newList;
      await this.saveProfiles();
      await this.applyProfile(this.currentProfile);
    }
  }

  async setDirectProxy() {
    await chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' });
  }

  async setSystemProxy() {
    await chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' });
  }

  isHostnameBypassMatch(hostname, bypassList) {
    if (!hostname || !bypassList) return false;
    
    if (!this.bypassMatcher.compiled || Date.now() - this.bypassMatcher.lastUpdate > CONSTANTS.BYPASS_CACHE_TTL) {
      this.bypassMatcher.compile(bypassList);
    }
    
    return this.bypassMatcher.isMatch(hostname);
  }

  async getBypassList() {
    const now = Date.now();
    if (this.#bypassListCache && now < this.#bypassListExpiry) {
      return this.#bypassListCache;
    }

    const result = await chrome.storage.local.get('globalBypassList');
    this.#bypassListCache = result.globalBypassList || [];
    this.#bypassListExpiry = now + CONSTANTS.CACHE_TTL;
    this.bypassMatcher.compile(this.#bypassListCache);
    
    return this.#bypassListCache;
  }

  async setFixedProxy(profile) {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];

    const expandedBypassList = bypassList.reduce((list, domain) => {
      list.push(domain);
      list.push(`${domain}/*`);
      return list;
    }, []);

    const config = {
      mode: 'fixed_servers',
      rules: {
        proxyForHttp: { scheme: 'http', host: profile.host, port: profile.port },
        proxyForHttps: { scheme: 'http', host: profile.host, port: profile.port },
        proxyForFtp: { scheme: 'http', host: profile.host, port: profile.port },
        fallbackProxy: { scheme: 'http', host: profile.host, port: profile.port },
        bypassList: expandedBypassList
      }
    };

    await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  }

  async saveProfiles() {
    const profilesArray = Array.from(this.profiles.values())
      .filter(p => !['direct', 'system'].includes(p.name));
    await chrome.storage.local.set({ profiles: profilesArray });
  }

  async updateIcon(profileName) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.runtime.sendMessage({
          type: 'updateIcon',
          profile: profileName,
          tabId: tabs[0].id
        }).catch(error => {
          if (!error.message?.includes('Receiving end does not exist')) {
            console.error('Error sending updateIcon message:', error);
          }
        });
      }
    } catch (error) {
      console.error('Error updating icon:', error);
    }
  }

  // 检查代理名称是否已存在
  hasProfile(name) {
    return this.profiles.has(name);
  }

  // 重新加载配置（用于外部更新后刷新）
  async reload() {
    this._initialized = false;
    this.profiles.clear();
    await this.init();
  }
}
