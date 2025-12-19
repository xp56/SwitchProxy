// 优化的bypass列表匹配器 - 共享模块
class BypassListMatcher {
  constructor() {
    this.wildcardDomains = new Set();
    this.exactDomains = new Set();
    this.pathPatterns = new Set();
    this.compiled = false;
    this.lastUpdate = 0;
  }

  // 编译bypass列表为优化的数据结构
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
        // 通配符域名: *.example.com
        this.wildcardDomains.add(pattern.substring(2));
      } else if (pattern.endsWith('/*')) {
        // 路径模式: example.com/*
        this.pathPatterns.add(pattern.slice(0, -2));
      } else {
        // 精确匹配
        this.exactDomains.add(pattern);
      }
    }

    this.compiled = true;
    this.lastUpdate = Date.now();
  }

  // 快速匹配检查
  isMatch(hostname) {
    if (!hostname || !this.compiled) return false;

    // 移除开头的 www.
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    // 1. 精确匹配 (O(1))
    if (this.exactDomains.has(hostname)) {
      return true;
    }

    // 2. 通配符域名匹配
    for (const domain of this.wildcardDomains) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }

    // 3. 路径模式匹配
    for (const domain of this.pathPatterns) {
      if (hostname === domain || hostname.startsWith(domain + '/')) {
        return true;
      }
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

// 如果在 Service Worker 环境中，导出到全局
if (typeof self !== 'undefined') {
  self.BypassListMatcher = BypassListMatcher;
}
