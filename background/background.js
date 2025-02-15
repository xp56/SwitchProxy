// 创建画布绘制图标
function createIconCanvas(color) {
  const canvas = new OffscreenCanvas(16, 16);
  const ctx = canvas.getContext('2d');
  
  // 清除画布
  ctx.clearRect(0, 0, 16, 16);
  
  // 绘制外圆
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // 根据不同类型绘制不同的内部图案
  switch (color) {
    case '#757575': // direct
      // 绘制水平线
      ctx.beginPath();
      ctx.moveTo(4, 8);
      ctx.lineTo(12, 8);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
      
    case '#1976d2': // system
      // 绘制内圆
      ctx.beginPath();
      ctx.arc(8, 8, 3, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
      
    case '#4caf50': // custom proxy
      // 绘制填充内圆
      ctx.beginPath();
      ctx.arc(8, 8, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#a5d6a7';
      ctx.fill();
      break;
  }
  
  return ctx.getImageData(0, 0, 16, 16);
}

// 检查域名是否匹配不代理列表中的规则
function isHostnameBypassMatch(hostname, bypassList) {
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

// 统一错误处理
class ExtensionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.details = details;
  }
}

// 错误处理中间件
function errorHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Error in ${fn.name}:`, error);
      if (error instanceof ExtensionError) {
        // 处理已知错误
        handleKnownError(error);
      } else {
        // 处理未知错误
        handleUnknownError(error);
      }
      throw error;
    }
  };
}

// 包装关键函数
const updateIcon = errorHandler(async function updateIcon(profileName, tabId) {
  try {
    let color;
    let title;
    let tab;
    
    // 获取标签页信息
    if (tabId && tabId !== -1) {
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (error) {
        console.debug('Tab not found:', error);
      }
    }
    
    if (!tab) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs[0];
      } catch (error) {
        console.debug('No active tab found:', error);
      }
    }
    
    // 检查是否在不代理列表中
    let isInBypassList = false;
    if (tab?.url && !tab.url.startsWith('chrome://')) {
      try {
        const url = new URL(tab.url);
        const hostname = url.hostname;
        
        const result = await chrome.storage.local.get('globalBypassList');
        const bypassList = result.globalBypassList || [];
        
        isInBypassList = isHostnameBypassMatch(hostname, bypassList);
      } catch (error) {
        console.debug('Error checking bypass list:', error);
      }
    }
    
    // 设置图标颜色和标题
    if (isInBypassList) {
      color = '#757575';
      title = '当前网站不走代理';
    } else {
      switch (profileName) {
        case 'direct':
          color = '#757575';
          title = '直接连接';
          break;
        case 'system':
          color = '#1976d2';
          title = '系统代理';
          break;
        default:
          color = '#4caf50';
          title = '自定义代理';
          break;
      }
    }
    
    // 创建图标
    const imageData = createIconCanvas(color);
    
    // 更新图标和标题
    if (tab?.id) {
      try {
        await chrome.action.setIcon({ imageData, tabId: tab.id });
        await chrome.action.setTitle({ title, tabId: tab.id });
      } catch (error) {
        console.debug('Error setting tab-specific icon:', error);
        // 如果设置特定标签页的图标失败，设置默认图标
        await chrome.action.setIcon({ imageData });
        await chrome.action.setTitle({ title });
      }
    } else {
      // 设置默认图标
      await chrome.action.setIcon({ imageData });
      await chrome.action.setTitle({ title });
    }
  } catch (error) {
    console.error('Error updating icon:', error);
  }
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    const result = await chrome.storage.local.get('currentProfile');
    const currentProfile = result.currentProfile || 'direct';
    await updateIcon(currentProfile, tabId);
  }
});

// 监听标签页激活
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const result = await chrome.storage.local.get('currentProfile');
  const currentProfile = result.currentProfile || 'direct';
  await updateIcon(currentProfile, activeInfo.tabId);
});

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    const result = await chrome.storage.local.get('currentProfile');
    const currentProfile = result.currentProfile || 'direct';
    const tabs = await chrome.tabs.query({ active: true, windowId });
    if (tabs[0]) {
      await updateIcon(currentProfile, tabs[0].id);
    }
  }
});

// 监听存储变化
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.currentProfile || changes.globalBypassList) {
      // 只更新当前活动标签页的图标
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const result = await chrome.storage.local.get('currentProfile');
        const currentProfile = result.currentProfile || 'direct';
        if (tabs[0]) {
          await updateIcon(currentProfile, tabs[0].id);
        }
      });
    }
  }
});

// 监听代理错误
chrome.proxy.onProxyError.addListener((details) => {
  console.error('Proxy error:', details);
});

// 添加性能监控
const performanceMetrics = {
  iconUpdates: 0,
  bypassChecks: 0,
  messageHandling: 0,
  errors: 0
};

// 性能监控装饰器
function measurePerformance(category) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      const start = performance.now();
      try {
        const result = await originalMethod.apply(this, args);
        const duration = performance.now() - start;
        
        performanceMetrics[category] = (performanceMetrics[category] || 0) + 1;
        console.debug(`${propertyKey} took ${duration}ms`);
        
        return result;
      } catch (error) {
        performanceMetrics.errors++;
        throw error;
      }
    };
    
    return descriptor;
  };
}

// 修改日志记录功能
let proxyLogs = {
  proxied: new Set(),
  bypassed: new Set(),
  domainRelations: new Map(),
  // 添加时间戳记录
  timestamps: new Map()
};

// 记录域名关联关系，并添加时间戳
function recordDomainRelation(mainDomain, relatedDomain) {
  if (mainDomain !== relatedDomain) {
    let relations = proxyLogs.domainRelations.get(mainDomain) || new Set();
    relations.add(relatedDomain);
    proxyLogs.domainRelations.set(mainDomain, relations);
    
    // 记录或更新时间戳
    proxyLogs.timestamps.set(mainDomain, Date.now());
    proxyLogs.timestamps.set(relatedDomain, Date.now());
  }
}

// 修改消息监听器中的日志获取逻辑
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'clearLogs':
      // 清空所有日志数据
      proxyLogs.proxied.clear();
      proxyLogs.bypassed.clear();
      proxyLogs.domainRelations.clear();
      proxyLogs.timestamps.clear();
      // 立即发送响应
      sendResponse({ success: true });
      break;

    case 'getProxyLogs':
      // 将日志转换为数组并按时间戳排序
      const sortedProxied = Array.from(proxyLogs.proxied)
        .map(domain => ({
          domain,
          timestamp: proxyLogs.timestamps.get(domain) || 0
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(item => item.domain);

      const sortedBypassed = Array.from(proxyLogs.bypassed)
        .map(domain => ({
          domain,
          timestamp: proxyLogs.timestamps.get(domain) || 0
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(item => item.domain);

      // 立即发送响应
      sendResponse({
        proxied: sortedProxied,
        bypassed: sortedBypassed,
        domainRelations: Array.from(proxyLogs.domainRelations.entries())
      });
      break;

    case 'removeDomainFromLogs':
      const domain = message.domain;
      // 从两个集合中都删除该域名
      proxyLogs.proxied.delete(domain);
      proxyLogs.bypassed.delete(domain);
      // 删除时间戳和关联关系
      proxyLogs.timestamps.delete(domain);
      proxyLogs.domainRelations.delete(domain);
      sendResponse({ success: true });
      break;

    case 'updateTargetPageProxy':
      // 更新目标页面的代理设置，但不刷新页面
      if (message.tabId) {
        updateIcon(currentProfile, message.tabId);
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      break;
  }
  // 不返回 true，因为我们已经同步发送了响应
});

// 在 webRequest API 中记录请求时添加时间戳
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    try {
      // 忽略扩展自身的请求
      if (details.initiator && details.initiator.startsWith('chrome-extension://')) {
        return;
      }

      const requestUrl = new URL(details.url);
      const requestHostname = requestUrl.hostname;
      
      // 忽略 chrome:// 和 chrome-extension:// 请求
      if (requestUrl.protocol === 'chrome:' || requestUrl.protocol === 'chrome-extension:') {
        return;
      }
      
      // 只有在有效的标签页 ID 时才尝试获取主域名
      let mainHostname = null;
      if (details.tabId > -1) {  // 检查是否有有效的标签页 ID
        try {
          const tab = await chrome.tabs.get(details.tabId);
          if (tab?.url) {
            const mainUrl = new URL(tab.url);
            mainHostname = mainUrl.hostname;
            // 记录域名关联关系
            recordDomainRelation(mainHostname, requestHostname);
          }
        } catch (tabError) {
          // 忽略标签页相关错误，继续处理请求
          console.debug('Tab not found:', tabError);
        }
      }
      
      // 获取当前配置和不代理列表
      const result = await chrome.storage.local.get(['currentProfile', 'globalBypassList']);
      const currentProfile = result.currentProfile || 'direct';
      const bypassList = result.globalBypassList || [];

      // 如果是直接连接，所有请求都不走代理
      if (currentProfile === 'direct') {
        proxyLogs.bypassed.add(requestHostname);
        return;
      }

      // 如果是系统代理，所有请求都走系统代理
      if (currentProfile === 'system') {
        proxyLogs.proxied.add(requestHostname);
        return;
      }

      // 检查是否在不代理列表中
      if (isHostnameBypassMatch(requestHostname, bypassList)) {
        proxyLogs.bypassed.add(requestHostname);
      } else {
        proxyLogs.proxied.add(requestHostname);
      }

      // 添加时间戳
      if (proxyLogs.proxied.has(requestHostname)) {
        proxyLogs.timestamps.set(requestHostname, Date.now());
      }
      if (proxyLogs.bypassed.has(requestHostname)) {
        proxyLogs.timestamps.set(requestHostname, Date.now());
      }
      
    } catch (error) {
      console.error('Error logging request:', error);
    }
  },
  { 
    urls: ["<all_urls>"],
    types: ["main_frame", "sub_frame", "xmlhttprequest", "other"] // 只监听主要请求类型
  }
);

// 抽取图标更新逻辑
async function handleUpdateIcon(message, sender) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    await updateIcon(message.profile, tabs[0].id);
  }
  return { success: true };
}

// 初始化时设置所有标签页的图标
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get('currentProfile');
  const currentProfile = result.currentProfile || 'direct';
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await updateIcon(currentProfile, tab.id);
  }
});

// 启动时设置所有标签页的图标
(async () => {
  const result = await chrome.storage.local.get('currentProfile');
  const currentProfile = result.currentProfile || 'direct';
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await updateIcon(currentProfile, tab.id);
  }
})();

// 清理日志时也清理时间戳
function cleanLogs() {
  proxyLogs.proxied.clear();
  proxyLogs.bypassed.clear();
  proxyLogs.domainRelations.clear();
  proxyLogs.timestamps.clear();
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
  }

  async get(key, ttl = 5000) {
    const now = Date.now();
    if (this.cache.has(key) && now < this.expiryTimes.get(key)) {
      return this.cache.get(key);
    }

    const result = await chrome.storage.local.get(key);
    this.cache.set(key, result[key]);
    this.expiryTimes.set(key, now + ttl);
    return result[key];
  }

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
    this.cache.set(key, value);
    this.expiryTimes.set(key, Date.now() + 5000);
  }
}

const storageManager = new StorageManager(); 