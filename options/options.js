class OptionsManager {
  constructor() {
    this.proxyManager = null;
    this.currentSection = 'proxy';
    this.editingProfile = null;
    this.logUpdateInterval = null;
    this.init();
  }
  
  async init() {
    this.proxyManager = new ProxyManager();
    await this.proxyManager.init();
    this.attachEventListeners();
    await this.loadProxies();
    await this.loadBypassList();
    this.initSidebar();
  }
  
  initSidebar() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const section = item.dataset.section;
        if (section) this.switchSection(section);
      });
    });
  }
  
  switchSection(section) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
    });
    
    document.querySelectorAll('.section').forEach(el => {
      el.style.display = el.id === `${section}-section` ? 'block' : 'none';
    });
    
    this.currentSection = section;
    
    if (section === 'logs') {
      this.updateLogs();
      this.logUpdateInterval = setInterval(() => this.updateLogs(), 5000);
    } else if (this.logUpdateInterval) {
      clearInterval(this.logUpdateInterval);
      this.logUpdateInterval = null;
    }
  }
  
  attachEventListeners() {
    // 添加代理
    document.getElementById('add-proxy').addEventListener('click', () => this.addProxy());

    // 添加不代理地址
    document.getElementById('add-bypass').addEventListener('click', async () => {
      const domain = document.getElementById('bypass-domain').value.trim();
      if (domain) {
        await this.addBypassDomain(domain);
        document.getElementById('bypass-domain').value = '';
      }
    });

    // 编辑相关
    document.getElementById('save-edit').addEventListener('click', () => this.saveEdit());
    document.getElementById('cancel-edit').addEventListener('click', () => this.closeEditModal());
    document.getElementById('edit-modal').addEventListener('click', (e) => {
      if (e.target.id === 'edit-modal') this.closeEditModal();
    });

    // 清空日志
    const clearLogsButton = document.getElementById('clear-logs');
    if (clearLogsButton) {
      clearLogsButton.addEventListener('click', async () => {
        try {
          const response = await this.sendMessage({ type: 'clearLogs' });
          if (response?.success) await this.updateLogs();
        } catch (error) {
          console.error('Error clearing logs:', error);
        }
      });
    }

    // 导入导出
    document.getElementById('import-bypass').addEventListener('click', () => {
      document.getElementById('import-bypass-input').click();
    });

    document.getElementById('import-bypass-input').addEventListener('change', (e) => this.handleImport(e));
    document.getElementById('export-bypass').addEventListener('click', () => this.handleExport());
  }

  // 统一的消息发送方法
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }
  
  async loadProxies() {
    const stored = await chrome.storage.local.get('profiles');
    const proxyList = document.getElementById('proxy-list');
    proxyList.innerHTML = '';
    
    if (stored.profiles) {
      for (const profile of stored.profiles) {
        this.addProxyToList(profile);
      }
    }
  }
  
  addProxyToList(profile) {
    const proxyList = document.getElementById('proxy-list');
    const proxyItem = document.createElement('div');
    proxyItem.className = 'proxy-item';
    proxyItem.innerHTML = `
      <div>
        <strong>${profile.name}</strong>
        <div>${profile.host}:${profile.port}</div>
      </div>
      <div class="actions">
        <button class="btn btn-edit" data-name="${profile.name}">编辑</button>
        <button class="btn btn-delete" data-name="${profile.name}">删除</button>
      </div>
    `;

    proxyItem.querySelector('.btn-edit').addEventListener('click', () => this.editProxy(profile.name));
    proxyItem.querySelector('.btn-delete').addEventListener('click', async () => {
      const currentProfileResult = await chrome.storage.local.get('currentProfile');
      if (currentProfileResult.currentProfile === profile.name) {
        await this.proxyManager.applyProfile('direct');
      }
      await this.deleteProxy(profile.name);
    });

    proxyList.appendChild(proxyItem);
  }
  
  async addProxy() {
    const name = document.getElementById('proxy-name').value.trim();
    const host = document.getElementById('proxy-host').value.trim();
    const port = document.getElementById('proxy-port').value.trim();
    
    if (!name || !host || !port) {
      alert('请填写完整信息');
      return;
    }

    // 检查重名
    if (this.proxyManager.hasProfile(name) || name === 'direct' || name === 'system') {
      alert('代理名称已存在，请使用其他名称');
      return;
    }
    
    const profile = {
      name,
      type: 'fixed',
      host,
      port: parseInt(port),
    };
    
    const stored = await chrome.storage.local.get('profiles');
    const profiles = stored.profiles || [];
    profiles.push(profile);
    
    await chrome.storage.local.set({ profiles });
    await this.proxyManager.reload();
    this.addProxyToList(profile);
    
    document.getElementById('proxy-name').value = '';
    document.getElementById('proxy-host').value = '';
    document.getElementById('proxy-port').value = '';
  }
  
  async deleteProxy(name) {
    const stored = await chrome.storage.local.get('profiles');
    const profiles = stored.profiles.filter(p => p.name !== name);
    await chrome.storage.local.set({ profiles });
    await this.proxyManager.reload();
    await this.loadProxies();
  }

  async loadBypassList() {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    this.updateBypassListUI(bypassList);
  }

  updateBypassListUI(bypassList) {
    const listElement = document.getElementById('bypass-list');
    listElement.innerHTML = '';

    // 按基础域名分组
    const grouped = this.groupBypassList(bypassList);
    
    for (const [baseDomain, patterns] of grouped) {
      const item = document.createElement('div');
      item.className = 'proxy-item bypass-group';
      item.innerHTML = `
        <div class="bypass-info">
          <strong>${baseDomain}</strong>
          <div class="bypass-patterns">${patterns.join(', ')}</div>
        </div>
        <button class="btn btn-delete" data-domain="${baseDomain}">删除全部</button>
      `;

      item.querySelector('.btn-delete').addEventListener('click', () => {
        this.removeBypassDomainGroup(baseDomain, patterns);
      });

      listElement.appendChild(item);
    }
  }

  // 将 bypass 列表按基础域名分组
  groupBypassList(bypassList) {
    const groups = new Map();
    
    for (const pattern of bypassList) {
      let baseDomain = pattern;
      if (pattern.startsWith('*.')) {
        baseDomain = pattern.substring(2);
      } else if (pattern.endsWith('/*')) {
        baseDomain = pattern.slice(0, -2);
      }
      
      if (!groups.has(baseDomain)) {
        groups.set(baseDomain, []);
      }
      groups.get(baseDomain).push(pattern);
    }
    
    return groups;
  }

  async addBypassDomain(domain) {
    try {
      const result = await chrome.storage.local.get('globalBypassList');
      const bypassList = result.globalBypassList || [];
      
      domain = domain.trim().toLowerCase();
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }

      // 检查是否已存在
      if (bypassList.some(p => p === domain || p === `*.${domain}` || p === `${domain}/*`)) {
        alert('该域名已在不代理列表中');
        return;
      }

      bypassList.push(domain);
      bypassList.push(`*.${domain}`);
      bypassList.push(`${domain}/*`);
      
      await chrome.storage.local.set({ globalBypassList: bypassList });
      this.updateBypassListUI(bypassList);
    } catch (error) {
      console.error('Error adding bypass domain:', error);
    }
  }

  // 批量删除域名组
  async removeBypassDomainGroup(baseDomain, patterns) {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    
    const newList = bypassList.filter(d => !patterns.includes(d));
    await chrome.storage.local.set({ globalBypassList: newList });
    this.updateBypassListUI(newList);
  }

  async editProxy(name) {
    try {
      const stored = await chrome.storage.local.get('profiles');
      const profile = stored.profiles.find(p => p.name === name);
      if (profile) {
        this.editingProfile = profile;
        document.getElementById('edit-proxy-name').value = profile.name;
        document.getElementById('edit-proxy-host').value = profile.host;
        document.getElementById('edit-proxy-port').value = profile.port;
        document.getElementById('edit-modal').style.display = 'block';
      }
    } catch (error) {
      console.error('Error in editProxy:', error);
    }
  }

  async saveEdit() {
    try {
      const name = document.getElementById('edit-proxy-name').value.trim();
      const host = document.getElementById('edit-proxy-host').value.trim();
      const port = document.getElementById('edit-proxy-port').value.trim();
      
      if (!name || !host || !port) {
        alert('请填写完整信息');
        return;
      }

      // 检查重名（排除当前编辑的配置）
      if (name !== this.editingProfile.name && 
          (this.proxyManager.hasProfile(name) || name === 'direct' || name === 'system')) {
        alert('代理名称已存在，请使用其他名称');
        return;
      }
      
      const stored = await chrome.storage.local.get('profiles');
      const profiles = stored.profiles || [];
      
      const index = profiles.findIndex(p => p.name === this.editingProfile.name);
      if (index !== -1) {
        const oldName = this.editingProfile.name;
        
        profiles[index] = { ...this.editingProfile, name, host, port: parseInt(port) };
        await chrome.storage.local.set({ profiles });
        
        const currentProfileResult = await chrome.storage.local.get('currentProfile');
        if (currentProfileResult.currentProfile === oldName) {
          if (oldName !== name) {
            await chrome.storage.local.set({ currentProfile: name });
          }
          await this.proxyManager.reload();
          await this.proxyManager.applyProfile(name);
        } else {
          await this.proxyManager.reload();
        }
        
        await this.loadProxies();
        this.closeEditModal();
      }
    } catch (error) {
      console.error('Error in saveEdit:', error);
    }
  }

  closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
    this.editingProfile = null;
  }

  async handleImport(event) {
    try {
      const file = event.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importData = JSON.parse(e.target.result);
          
          if (!importData.version || !Array.isArray(importData.bypassList)) {
            throw new Error('Invalid file format');
          }
          
          const result = await chrome.storage.local.get('globalBypassList');
          const currentList = result.globalBypassList || [];
          const mergedList = [...new Set([...currentList, ...importData.bypassList])];
          
          await chrome.storage.local.set({ globalBypassList: mergedList });
          await this.loadBypassList();
          
          const currentProfile = await this.proxyManager.getCurrentProfile();
          if (currentProfile) {
            await this.proxyManager.applyProfile(currentProfile.name);
          }
          
          alert('导入成功！');
        } catch (parseError) {
          console.error('Error parsing import file:', parseError);
          alert('导入文件格式错误，请检查文件内容');
        }
      };
      
      reader.readAsText(file);
    } catch (error) {
      console.error('Error importing bypass list:', error);
      alert('导入失败，请重试');
    } finally {
      event.target.value = '';
    }
  }

  async handleExport() {
    try {
      const result = await chrome.storage.local.get('globalBypassList');
      const bypassList = result.globalBypassList || [];
      
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        bypassList: bypassList.sort()
      };
      
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `proxy_bypass_list_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting bypass list:', error);
      alert('导出失败，请重试');
    }
  }

  async updateLogs() {
    try {
      const logs = await this.sendMessage({ type: 'getProxyLogs' });

      const formatDomain = (domain) => {
        if (domain.length > 40) {
          return `${domain.substring(0, 20)}...${domain.substring(domain.length - 20)}`;
        }
        return domain;
      };

      const proxiedList = document.getElementById('proxied-list');
      if (proxiedList) {
        if (logs.proxied.length === 0) {
          proxiedList.innerHTML = `
            <div class="log-item empty-state">
              <div class="log-item-content">
                <div class="domain-info">
                  <span class="domain-text">暂无记录</span>
                </div>
              </div>
            </div>
          `;
        } else {
          proxiedList.innerHTML = logs.proxied.map(domain => `
            <div class="log-item">
              <div class="log-item-content">
                <div class="domain-info">
                  <span class="domain-text" title="${domain}">${formatDomain(domain)}</span>
                </div>
                <button class="btn btn-small btn-bypass" data-domain="${domain}">添加到不代理</button>
              </div>
            </div>
          `).join('');

          proxiedList.querySelectorAll('.btn-bypass').forEach(button => {
            button.addEventListener('click', async () => {
              const domain = button.dataset.domain;
              try {
                await this.addBypassDomain(domain);
                await this.sendMessage({ type: 'removeDomainFromLogs', domain });

                const currentProfile = await this.proxyManager.getCurrentProfile();
                if (currentProfile) {
                  await this.proxyManager.applyProfile(currentProfile.name);
                }

                await this.updateLogs();
                await this.loadBypassList();

                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0]) {
                  this.sendMessage({ type: 'updateTargetPageProxy', tabId: tabs[0].id });
                }
              } catch (error) {
                console.error('Error handling bypass click:', error);
              }
            });
          });
        }
      }

      const bypassedList = document.getElementById('bypassed-list');
      if (bypassedList) {
        if (logs.bypassed.length === 0) {
          bypassedList.innerHTML = `
            <div class="log-item empty-state">
              <div class="log-item-content">
                <div class="domain-info">
                  <span class="domain-text">暂无记录</span>
                </div>
              </div>
            </div>
          `;
        } else {
          bypassedList.innerHTML = logs.bypassed.map(domain => `
            <div class="log-item">
              <div class="log-item-content">
                <div class="domain-info">
                  <span class="domain-text" title="${domain}">${formatDomain(domain)}</span>
                </div>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (error) {
      console.error('Error updating logs:', error);
    }
  }
}

const optionsManager = new OptionsManager();
window.optionsManager = optionsManager;
