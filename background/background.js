// 导入共享模块
importScripts('../shared/constants.js', '../shared/bypass-matcher.js');

// 创建画布绘制图标
function createIconCanvas(color) {
  const canvas = new OffscreenCanvas(16, 16);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 16, 16);

  // 绘制外圆
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 根据不同类型绘制不同的内部图案
  switch (color) {
    case CONSTANTS.COLORS.DIRECT:
      ctx.beginPath();
      ctx.moveTo(4, 8);
      ctx.lineTo(12, 8);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;

    case CONSTANTS.COLORS.SYSTEM:
      ctx.beginPath();
      ctx.arc(8, 8, 3, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;

    case CONSTANTS.COLORS.CUSTOM:
      ctx.beginPath();
      ctx.arc(8, 8, 3, 0, 2 * Math.PI);
      ctx.fillStyle = CONSTANTS.COLORS.CUSTOM_FILL;
      ctx.fill();
      break;
  }

  return ctx.getImageData(0, 0, 16, 16);
}

// 全局bypass匹配器实例
const bypassMatcher = new BypassListMatcher();

// 检查域名是否匹配不代理列表中的规则
function isHostnameBypassMatch(hostname, bypassList) {
  if (!hostname || !bypassList) return false;

  if (!bypassMatcher.compiled || Date.now() - bypassMatcher.lastUpdate > CONSTANTS.BYPASS_CACHE_TTL) {
    bypassMatcher.compile(bypassList);
  }

  return bypassMatcher.isMatch(hostname);
}

// 优化存储访问
class StorageManager {
  static instance = null;

  constructor() {
    if (StorageManager.instance) {
      return StorageManager.instance;
    }
    StorageManager.instance = this;
    this.cache = new Map();
    this.expiryTimes = new Map();
    this.pendingRequests = new Map();
    this.stats = { hits: 0, misses: 0, errors: 0 };
  }

  async get(key, ttl = CONSTANTS.CACHE_TTL) {
    const now = Date.now();

    if (this.cache.has(key) && now < this.expiryTimes.get(key)) {
      this.stats.hits++;
      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('storageHits');
      return this.cache.get(key);
    }

    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    const request = chrome.storage.local.get(key).then(result => {
      this.cache.set(key, result[key]);
      this.expiryTimes.set(key, now + ttl);
      this.pendingRequests.delete(key);
      this.stats.misses++;
      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('storageMisses');
      return result[key];
    }).catch(error => {
      this.pendingRequests.delete(key);
      this.stats.errors++;
      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('errors');
      throw error;
    });

    this.pendingRequests.set(key, request);
    return request;
  }

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
    this.cache.set(key, value);
    this.expiryTimes.set(key, Date.now() + CONSTANTS.CACHE_TTL);
  }

  async getMultiple(keys, ttl = CONSTANTS.CACHE_TTL) {
    const now = Date.now();
    const result = {};
    const keysToFetch = [];

    for (const key of keys) {
      if (this.cache.has(key) && now < this.expiryTimes.get(key)) {
        result[key] = this.cache.get(key);
        this.stats.hits++;
      } else {
        keysToFetch.push(key);
      }
    }

    if (keysToFetch.length > 0) {
      const fetched = await chrome.storage.local.get(keysToFetch);
      for (const key of keysToFetch) {
        result[key] = fetched[key];
        this.cache.set(key, fetched[key]);
        this.expiryTimes.set(key, now + ttl);
        this.stats.misses++;
      }
    }

    return result;
  }

  invalidate(key) {
    this.cache.delete(key);
    this.expiryTimes.delete(key);
  }

  clear() {
    this.cache.clear();
    this.expiryTimes.clear();
    this.pendingRequests.clear();
  }
}

const storageManager = new StorageManager();

// 统一错误处理
class ExtensionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.details = details;
  }
}

function errorHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Error in ${fn.name}:`, error);
      throw error;
    }
  };
}

// 包装关键函数
const updateIcon = errorHandler(async function updateIcon(profileName, tabId) {
  let color;
  let title;
  let tab;

  if (tabId && tabId !== -1) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_e) {
      // Tab not found
    }
  }

  if (!tab) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    } catch (_e) {
      // No active tab
    }
  }

  let isInBypassList = false;
  if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
    try {
      const url = new URL(tab.url);
      const hostname = url.hostname;
      const bypassList = await chrome.storage.local.get('globalBypassList');
      isInBypassList = isHostnameBypassMatch(hostname, bypassList.globalBypassList || []);
    } catch (_e) {
      // Error checking bypass list
    }
  }

  if (isInBypassList) {
    color = CONSTANTS.COLORS.DIRECT;
    title = '当前网站不走代理';
  } else {
    switch (profileName) {
      case 'direct':
        color = CONSTANTS.COLORS.DIRECT;
        title = '直接连接';
        break;
      case 'system':
        color = CONSTANTS.COLORS.SYSTEM;
        title = '系统代理';
        break;
      default:
        color = CONSTANTS.COLORS.CUSTOM;
        title = '自定义代理';
        break;
    }
  }

  const imageData = createIconCanvas(color);

  if (tab?.id) {
    try {
      await chrome.action.setIcon({ imageData, tabId: tab.id });
      await chrome.action.setTitle({ title, tabId: tab.id });
    } catch (_e) {
      await chrome.action.setIcon({ imageData });
      await chrome.action.setTitle({ title });
    }
  } else {
    await chrome.action.setIcon({ imageData });
    await chrome.action.setTitle({ title });
  }
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    const result = await storageManager.get('currentProfile');
    const currentProfile = result || 'direct';
    await iconUpdateManager.updateIcon(currentProfile, tabId);
  }
});

// 监听标签页激活
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const result = await storageManager.get('currentProfile');
  const currentProfile = result || 'direct';
  await iconUpdateManager.updateIcon(currentProfile, activeInfo.tabId);
});

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    const result = await storageManager.get('currentProfile');
    const currentProfile = result || 'direct';
    const tabs = await chrome.tabs.query({ active: true, windowId });
    if (tabs[0]) {
      await iconUpdateManager.updateIcon(currentProfile, tabs[0].id);
    }
  }
});

// 监听存储变化
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.currentProfile || changes.globalBypassList) {
      if (changes.currentProfile) {
        storageManager.invalidate('currentProfile');
      }
      if (changes.globalBypassList) {
        storageManager.invalidate('globalBypassList');
        bypassMatcher.compile(changes.globalBypassList.newValue || []);
      }

      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const currentProfile = changes.currentProfile?.newValue ||
          (await storageManager.get('currentProfile')) || 'direct';
        if (tabs[0]) {
          await iconUpdateManager.updateIconNow(currentProfile, tabs[0].id);
        }
      });
    }
  }
});

// 监听代理错误
chrome.proxy.onProxyError.addListener((details) => {
  console.error('Proxy error:', details);
});

// 性能监控（仅开发模式）
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      iconUpdates: 0,
      bypassChecks: 0,
      messageHandling: 0,
      errors: 0,
      storageHits: 0,
      storageMisses: 0,
      logOperations: 0
    };
    this.startTime = Date.now();
    this.reportInterval = null;

    if (CONSTANTS.DEV_MODE) {
      this.startReporting();
    }
  }

  incrementMetric(name, value = 1) {
    if (this.metrics[name] !== undefined) {
      this.metrics[name] += value;
    }
  }

  getReport() {
    const uptime = Date.now() - this.startTime;
    const minutes = Math.floor(uptime / 60000);
    const seconds = Math.floor((uptime % 60000) / 1000);

    return {
      uptime: `${minutes}m ${seconds}s`,
      metrics: { ...this.metrics }
    };
  }

  startReporting() {
    this.reportInterval = setInterval(() => {
      console.log('[Performance]', JSON.stringify(this.getReport(), null, 2));
    }, CONSTANTS.PERFORMANCE_REPORT_INTERVAL);
  }

  stopReporting() {
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }
  }
}

const performanceMonitor = new PerformanceMonitor();

// 日志记录功能
class ProxyLogger {
  constructor() {
    this.proxied = new Set();
    this.bypassed = new Set();
    this.domainRelations = new Map();
    this.timestamps = new Map();
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  recordDomainRelation(mainDomain, relatedDomain) {
    if (mainDomain !== relatedDomain) {
      let relations = this.domainRelations.get(mainDomain) || new Set();
      relations.add(relatedDomain);
      this.domainRelations.set(mainDomain, relations);
      this.timestamps.set(mainDomain, Date.now());
      this.timestamps.set(relatedDomain, Date.now());
      this.checkAndCleanup();
    }
  }

  addProxied(domain) {
    this.proxied.add(domain);
    this.timestamps.set(domain, Date.now());
    this.checkAndCleanup();
    if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('logOperations');
  }

  addBypassed(domain) {
    this.bypassed.add(domain);
    this.timestamps.set(domain, Date.now());
    this.checkAndCleanup();
    if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('logOperations');
  }

  checkAndCleanup() {
    if (this.proxied.size > CONSTANTS.MAX_LOG_SIZE || this.bypassed.size > CONSTANTS.MAX_LOG_SIZE) {
      this.cleanup();
    }
  }

  cleanup() {
    const now = Date.now();

    for (const domain of this.proxied) {
      const timestamp = this.timestamps.get(domain) || 0;
      if (now - timestamp > CONSTANTS.LOG_MAX_AGE) {
        this.proxied.delete(domain);
        this.timestamps.delete(domain);
      }
    }

    for (const domain of this.bypassed) {
      const timestamp = this.timestamps.get(domain) || 0;
      if (now - timestamp > CONSTANTS.LOG_MAX_AGE) {
        this.bypassed.delete(domain);
        this.timestamps.delete(domain);
      }
    }

    for (const [mainDomain, relations] of this.domainRelations) {
      const mainTimestamp = this.timestamps.get(mainDomain) || 0;
      if (now - mainTimestamp > CONSTANTS.LOG_MAX_AGE) {
        this.domainRelations.delete(mainDomain);
        continue;
      }

      for (const relatedDomain of relations) {
        const relatedTimestamp = this.timestamps.get(relatedDomain) || 0;
        if (now - relatedTimestamp > CONSTANTS.LOG_MAX_AGE) {
          relations.delete(relatedDomain);
        }
      }

      if (relations.size === 0) {
        this.domainRelations.delete(mainDomain);
      }
    }
  }

  clear() {
    this.proxied.clear();
    this.bypassed.clear();
    this.domainRelations.clear();
    this.timestamps.clear();
  }

  removeDomain(domain) {
    this.proxied.delete(domain);
    this.bypassed.delete(domain);
    this.timestamps.delete(domain);
    this.domainRelations.delete(domain);

    for (const [mainDomain, relations] of this.domainRelations) {
      relations.delete(domain);
      if (relations.size === 0) {
        this.domainRelations.delete(mainDomain);
      }
    }
  }

  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CONSTANTS.LOG_CLEANUP_INTERVAL);
  }
}

const proxyLogger = new ProxyLogger();

// 消息监听器
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('messageHandling');

  switch (message.type) {
    case 'clearLogs':
      proxyLogger.clear();
      sendResponse({ success: true });
      break;

    case 'getProxyLogs':
      const sortedProxied = Array.from(proxyLogger.proxied)
        .map(domain => ({ domain, timestamp: proxyLogger.timestamps.get(domain) || 0 }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(item => item.domain);

      const sortedBypassed = Array.from(proxyLogger.bypassed)
        .map(domain => ({ domain, timestamp: proxyLogger.timestamps.get(domain) || 0 }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(item => item.domain);

      sendResponse({
        proxied: sortedProxied,
        bypassed: sortedBypassed,
        domainRelations: Array.from(proxyLogger.domainRelations.entries())
      });
      break;

    case 'removeDomainFromLogs':
      proxyLogger.removeDomain(message.domain);
      sendResponse({ success: true });
      break;

    case 'updateTargetPageProxy':
      if (message.tabId) {
        storageManager.get('currentProfile').then(profile => {
          iconUpdateManager.updateIcon(profile || 'direct', message.tabId);
        });
      }
      sendResponse({ success: true });
      break;

    case 'updateIcon':
      if (message.profile && message.tabId) {
        iconUpdateManager.updateIconNow(message.profile, message.tabId);
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      break;
  }
});

// webRequest 监听器
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    try {
      if (details.initiator?.startsWith('chrome-extension://')) return;

      const requestUrl = new URL(details.url);
      const requestHostname = requestUrl.hostname;

      if (requestUrl.protocol === 'chrome:' || requestUrl.protocol === 'chrome-extension:') return;

      if (details.tabId > -1) {
        try {
          const tab = await chrome.tabs.get(details.tabId);
          if (tab?.url) {
            const mainUrl = new URL(tab.url);
            proxyLogger.recordDomainRelation(mainUrl.hostname, requestHostname);
          }
        } catch (_e) {
          // Tab not found
        }
      }

      const config = await storageManager.getMultiple(['currentProfile', 'globalBypassList']);
      const currentProfile = config.currentProfile || 'direct';
      const bypassList = config.globalBypassList || [];

      if (currentProfile === 'direct') {
        proxyLogger.addBypassed(requestHostname);
        return;
      }

      if (currentProfile === 'system') {
        proxyLogger.addProxied(requestHostname);
        return;
      }

      if (isHostnameBypassMatch(requestHostname, bypassList)) {
        proxyLogger.addBypassed(requestHostname);
      } else {
        proxyLogger.addProxied(requestHostname);
      }

      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('bypassChecks');
    } catch (error) {
      console.error('Error logging request:', error);
      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('errors');
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "xmlhttprequest", "other"] }
);

// 图标更新（无缓存，立即更新）
const iconUpdateManager = {
  async updateIcon(profileName, tabId) {
    try {
      await updateIcon(profileName, tabId);
      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('iconUpdates');
    } catch (error) {
      console.error('Error updating icon:', error);
      if (CONSTANTS.DEV_MODE) performanceMonitor.incrementMetric('errors');
    }
  },

  // 保持接口兼容，直接调用 updateIcon
  async updateIconNow(profileName, tabId) {
    await this.updateIcon(profileName, tabId);
  }
};

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  const result = await storageManager.get('currentProfile');
  const currentProfile = result || 'direct';
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await iconUpdateManager.updateIcon(currentProfile, tab.id);
  }
});

// 启动时初始化
(async () => {
  const result = await storageManager.get('currentProfile');
  const currentProfile = result || 'direct';
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await iconUpdateManager.updateIcon(currentProfile, tab.id);
  }
})();
