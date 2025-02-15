class ProxyManager {
  constructor() {
    this.profiles = new Map();
    this.currentProfile = null;
    this.init();
  }

  // 添加缓存机制
  #profileCache = new Map();
  #bypassListCache = null;
  #bypassListExpiry = 0;

  async init() {
    // 初始化内置配置
    this.profiles.set('direct', {
      name: 'direct',
      type: 'direct',
      title: '直接连接'
    });
    
    this.profiles.set('system', {
      name: 'system',
      type: 'system',
      title: '系统代理'
    });

    try {
      // 从存储中加载自定义配置
      const stored = await chrome.storage.local.get('profiles');
      if (!stored.profiles || stored.profiles.length === 0) {
        // 如果没有配置，添加默认配置
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

      // 加载当前配置
      const current = await chrome.storage.local.get('currentProfile');
      this.currentProfile = current.currentProfile || 'direct';
    } catch (error) {
      console.error('Failed to initialize profiles:', error);
      this.currentProfile = 'direct';
    }

    // 初始化时也更新图标
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

    // 更新图标
    await this.updateIcon(profileName);
  }

  async addToNoProxy(domain) {
    // 获取全局不代理列表
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    
    if (!bypassList.includes(domain)) {
      bypassList.push(domain);
      // 更新全局不代理列表
      await chrome.storage.local.set({ globalBypassList: bypassList });
      
      // 更新当前配置
      const profile = await this.getCurrentProfile();
      if (profile) {
        profile.bypassList = bypassList;
        await this.saveProfiles();
        await this.applyProfile(this.currentProfile);
      }
    }
  }

  async removeFromNoProxy(domain) {
    // 获取全局不代理列表
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    
    const newList = bypassList.filter(d => d !== domain);
    await chrome.storage.local.set({ globalBypassList: newList });
    
    // 更新当前配置
    const profile = await this.getCurrentProfile();
    if (profile) {
      profile.bypassList = newList;
      await this.saveProfiles();
      await this.applyProfile(this.currentProfile);
    }
  }

  async setDirectProxy() {
    await chrome.proxy.settings.set({
      value: { mode: 'direct' },
      scope: 'regular'
    });
  }

  async setSystemProxy() {
    await chrome.proxy.settings.set({
      value: { mode: 'system' },
      scope: 'regular'
    });
  }

  async getBypassList() {
    const now = Date.now();
    if (this.#bypassListCache && now < this.#bypassListExpiry) {
      return this.#bypassListCache;
    }

    const result = await chrome.storage.local.get('globalBypassList');
    this.#bypassListCache = result.globalBypassList || [];
    this.#bypassListExpiry = now + 5000; // 5秒缓存
    return this.#bypassListCache;
  }

  // 检查域名是否匹配不代理列表中的规则
  isHostnameBypassMatch(hostname, bypassList) {
    if (!hostname || !bypassList) return false;

    // 移除开头的 www.
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    for (const pattern of bypassList) {
      // 处理通配符模式
      if (pattern.startsWith('*.')) {
        // *.example.com 匹配 sub.example.com 和 example.com
        const domain = pattern.substring(2);
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return true;
        }
      } 
      // 处理路径通配符模式
      else if (pattern.endsWith('/*')) {
        // example.com/* 匹配 example.com 和所有子路径
        const domain = pattern.slice(0, -2);
        if (hostname === domain || hostname.startsWith(domain + '/')) {
          return true;
        }
      }
      // 精确匹配
      else if (hostname === pattern) {
        return true;
      }
      // 子域名匹配
      else if (hostname.endsWith('.' + pattern)) {
        return true;
      }
    }
    return false;
  }

  async setFixedProxy(profile) {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];

    // 为每个不代理域名添加通配符规则
    const expandedBypassList = bypassList.reduce((list, domain) => {
      list.push(domain);          // 匹配域名本身
      list.push(`${domain}/*`);   // 匹配域名下的所有路径
      return list;
    }, []);

    const config = {
      mode: 'fixed_servers',
      rules: {
        proxyForHttp: {
          scheme: 'http',
          host: profile.host,
          port: profile.port
        },
        proxyForHttps: {
          scheme: 'http',
          host: profile.host,
          port: profile.port
        },
        proxyForFtp: {
          scheme: 'http',
          host: profile.host,
          port: profile.port
        },
        fallbackProxy: {
          scheme: 'http',
          host: profile.host,
          port: profile.port
        },
        bypassList: expandedBypassList
      }
    };

    await chrome.proxy.settings.set({
      value: config,
      scope: 'regular'
    });
  }

  async saveProfiles() {
    const profilesArray = Array.from(this.profiles.values())
      .filter(p => !['direct', 'system'].includes(p.name));
    await chrome.storage.local.set({ profiles: profilesArray });
  }

  async updateIcon(profileName) {
    // 获取扩展图标元素
    const action = await chrome.action;
    
    // 如果是自定义代理，检查当前域名是否在不代理列表中
    if (profileName !== 'direct' && profileName !== 'system') {
      try {
        // 获取当前标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          const url = new URL(tabs[0].url);
          let hostname = url.hostname;
          if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
          }
          
          // 获取全局不代理列表
          const bypassList = await this.getBypassList();
          
          // 如果当前域名在不代理列表中，使用直接连接的图标
          if (this.isHostnameBypassMatch(hostname, bypassList)) {
            await action.setTitle({ title: '当前网站不走代理' });
            document.documentElement.style.setProperty('--extension-icon-color', '#757575');
            return;
          }
        }
      } catch (error) {
        console.error('Error checking bypass list:', error);
      }
    }
    
    // 如果不在不代理列表中，或者出错，则使用正常的图标逻辑
    switch (profileName) {
      case 'direct':
        await action.setTitle({ title: '直接连接' });
        document.documentElement.style.setProperty('--extension-icon-color', '#757575');
        break;
      case 'system':
        await action.setTitle({ title: '系统代理' });
        document.documentElement.style.setProperty('--extension-icon-color', '#1976d2');
        break;
      default:
        await action.setTitle({ title: '自定义代理' });
        document.documentElement.style.setProperty('--extension-icon-color', '#4caf50');
        break;
    }
  }
} 