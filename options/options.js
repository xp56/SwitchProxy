class OptionsManager {
  constructor() {
    this.proxyManager = null;
    this.currentSection = 'proxy';
    this.editingProfile = null;
    this.init();
  }
  
  async init() {
    this.proxyManager = new ProxyManager();
    this.attachEventListeners();
    await this.loadProxies();
    await this.loadBypassList();
    await this.loadLastNoProxy();
    this.initSidebar();
  }
  
  initSidebar() {
    // 侧边栏导航切换
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const section = item.dataset.section;
        this.switchSection(section);
      });
    });
  }
  
  switchSection(section) {
    // 更新导航项的激活状态
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
    });
    
    // 显示对应的内容区域
    document.querySelectorAll('.section').forEach(el => {
      el.style.display = el.id === `${section}-section` ? 'block' : 'none';
    });
    
    this.currentSection = section;
    
    // 如果切换到日志部分，开始定期更新
    if (section === 'logs') {
      this.updateLogs();
      // 每5秒更新一次日志
      this.logUpdateInterval = setInterval(() => this.updateLogs(), 5000);
    } else {
      // 切换到其他部分时停止更新
      if (this.logUpdateInterval) {
        clearInterval(this.logUpdateInterval);
      }
    }
  }
  
  attachEventListeners() {
    document.getElementById('add-proxy').addEventListener('click', () => {
      this.addProxy();
    });

    // 添加不代理地址的事件监听
    document.getElementById('add-bypass').addEventListener('click', async () => {
      const domain = document.getElementById('bypass-domain').value.trim();
      if (domain) {
        await this.addBypassDomain(domain);
        document.getElementById('bypass-domain').value = '';
      }
    });

    // 添加编辑相关的事件监听器
    document.getElementById('save-edit').addEventListener('click', () => {
      this.saveEdit();
    });

    document.getElementById('cancel-edit').addEventListener('click', () => {
      this.closeEditModal();
    });

    // 点击弹窗外部关闭弹窗
    document.getElementById('edit-modal').addEventListener('click', (e) => {
      if (e.target.id === 'edit-modal') {
        this.closeEditModal();
      }
    });

    // 添加清空日志按钮的事件监听
    const clearLogsButton = document.getElementById('clear-logs');
    if (clearLogsButton) {
      clearLogsButton.addEventListener('click', async () => {
        try {
          // 发送清空日志请求
          const response = await new Promise((resolve, reject) => {
            try {
              chrome.runtime.sendMessage({ type: 'clearLogs' }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(chrome.runtime.lastError);
                } else {
                  resolve(response);
                }
              });
            } catch (error) {
              reject(error);
            }
          });

          if (response?.success) {
            // 立即更新日志显示
            await this.updateLogs();
          } else {
            console.error('Failed to clear logs:', response);
            throw new Error('Failed to clear logs');
          }
        } catch (error) {
          console.error('Error clearing logs:', error);
        }
      });
    }

    // 添加导入按钮事件监听
    document.getElementById('import-bypass').addEventListener('click', () => {
      document.getElementById('import-bypass-input').click();
    });

    // 添加文件输入事件监听
    document.getElementById('import-bypass-input').addEventListener('change', async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const importData = JSON.parse(e.target.result);
            
            // 验证导入数据的格式
            if (!importData.version || !Array.isArray(importData.bypassList)) {
              throw new Error('Invalid file format');
            }
            
            // 获取当前列表
            const result = await chrome.storage.local.get('globalBypassList');
            const currentList = result.globalBypassList || [];
            
            // 合并列表，去重
            const mergedList = [...new Set([...currentList, ...importData.bypassList])];
            
            // 保存合并后的列表
            await chrome.storage.local.set({ globalBypassList: mergedList });
            
            // 更新界面
            await this.loadBypassList();
            
            // 更新当前配置并重新应用
            const proxyManager = new ProxyManager();
            await proxyManager.init();
            const currentProfile = await proxyManager.getCurrentProfile();
            if (currentProfile) {
              await proxyManager.applyProfile(currentProfile.name);
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
        // 清理文件输入，允许重复导入相同文件
        event.target.value = '';
      }
    });

    // 添加导出按钮事件监听
    document.getElementById('export-bypass').addEventListener('click', async () => {
      try {
        const result = await chrome.storage.local.get('globalBypassList');
        const bypassList = result.globalBypassList || [];
        
        // 创建导出数据
        const exportData = {
          version: '1.0',
          timestamp: new Date().toISOString(),
          bypassList: bypassList.sort() // 排序以保持一致性
        };
        
        // 转换为 JSON 字符串，使用 2 空格缩进使导出文件更易读
        const jsonString = JSON.stringify(exportData, null, 2);
        
        // 创建下载链接
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // 创建临时下载链接并点击
        const a = document.createElement('a');
        a.href = url;
        a.download = `proxy_bypass_list_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        
        // 清理
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error exporting bypass list:', error);
        alert('导出失败，请重试');
      }
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

    // 添加编辑按钮的事件监听器
    const editButton = proxyItem.querySelector('.btn-edit');
    editButton.addEventListener('click', () => {
      this.editProxy(profile.name);
    });

    // 添加删除按钮的事件监听器
    const deleteButton = proxyItem.querySelector('.btn-delete');
    deleteButton.addEventListener('click', async () => {
      // 检查是否是当前使用的配置
      const currentProfile = await chrome.storage.local.get('currentProfile');
      if (currentProfile.currentProfile === profile.name) {
        // 如果是当前使用的配置，先切换到直接连接
        const proxyManager = new ProxyManager();
        await proxyManager.init();
        await proxyManager.applyProfile('direct');
      }
      
      // 删除配置
      await this.deleteProxy(profile.name);
    });

    proxyList.appendChild(proxyItem);
  }
  
  async addProxy() {
    const name = document.getElementById('proxy-name').value;
    const host = document.getElementById('proxy-host').value;
    const port = document.getElementById('proxy-port').value;
    
    if (!name || !host || !port) {
      alert('请填写完整信息');
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
    this.addProxyToList(profile);
    
    // 清空表单
    document.getElementById('proxy-name').value = '';
    document.getElementById('proxy-host').value = '';
    document.getElementById('proxy-port').value = '';
  }
  
  async deleteProxy(name) {
    const stored = await chrome.storage.local.get('profiles');
    const profiles = stored.profiles.filter(p => p.name !== name);
    await chrome.storage.local.set({ profiles });
    await this.loadProxies();
  }
  
  async loadLastNoProxy() {
    const result = await chrome.storage.local.get('lastNoProxyDomain');
    if (result.lastNoProxyDomain) {
      document.getElementById('proxy-bypass').value = result.lastNoProxyDomain;
      // 清除保存的不代理域名（防止后续重复加载）
      await chrome.storage.local.remove('lastNoProxyDomain');
    }
  }

  // 加载不代理列表
  async loadBypassList() {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    this.updateBypassListUI(bypassList);
  }

  // 更新不代理列表UI
  updateBypassListUI(bypassList) {
    const listElement = document.getElementById('bypass-list');
    listElement.innerHTML = '';
    
    bypassList.forEach(domain => {
      const item = document.createElement('div');
      item.className = 'proxy-item';
      item.innerHTML = `
        <div>${domain}</div>
        <button class="btn btn-delete" data-domain="${domain}">删除</button>
      `;

      // 添加删除按钮的事件监听器
      const deleteButton = item.querySelector('.btn-delete');
      deleteButton.addEventListener('click', () => {
        this.removeBypassDomain(domain);
      });

      listElement.appendChild(item);
    });
  }

  // 添加不代理域名
  async addBypassDomain(domain) {
    try {
      const result = await chrome.storage.local.get('globalBypassList');
      const bypassList = result.globalBypassList || [];
      
      // 处理域名格式
      domain = domain.trim().toLowerCase();
      
      // 移除开头的 www.
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }

      // 检查是否已存在匹配的规则
      if (!bypassList.some(pattern => {
        if (pattern === domain) return true;
        if (pattern === `*.${domain}`) return true;
        if (pattern === `${domain}/*`) return true;
        return false;
      })) {
        // 添加基本域名
        bypassList.push(domain);
        
        // 可选：自动添加通配符版本
        bypassList.push(`*.${domain}`);
        bypassList.push(`${domain}/*`);
        
        await chrome.storage.local.set({ globalBypassList: bypassList });
        this.updateBypassListUI(bypassList);
      }
    } catch (error) {
      console.error('Error adding bypass domain:', error);
    }
  }

  // 删除不代理域名
  async removeBypassDomain(domain) {
    const result = await chrome.storage.local.get('globalBypassList');
    const bypassList = result.globalBypassList || [];
    
    const newList = bypassList.filter(d => d !== domain);
    await chrome.storage.local.set({ globalBypassList: newList });
    this.updateBypassListUI(newList);
  }

  async editProxy(name) {
    try {
      const stored = await chrome.storage.local.get('profiles');
      const profile = stored.profiles.find(p => p.name === name);
      if (profile) {
        this.editingProfile = profile;
        
        // 填充编辑表单
        document.getElementById('edit-proxy-name').value = profile.name;
        document.getElementById('edit-proxy-host').value = profile.host;
        document.getElementById('edit-proxy-port').value = profile.port;
        
        // 显示弹窗
        const modal = document.getElementById('edit-modal');
        if (modal) {
          modal.style.display = 'block';
        } else {
          console.error('Modal element not found');
        }
      } else {
        console.error('Profile not found:', name);
      }
    } catch (error) {
      console.error('Error in editProxy:', error);
    }
  }

  async saveEdit() {
    try {
      const name = document.getElementById('edit-proxy-name').value;
      const host = document.getElementById('edit-proxy-host').value;
      const port = document.getElementById('edit-proxy-port').value;
      
      if (!name || !host || !port) {
        alert('请填写完整信息');
        return;
      }
      
      const stored = await chrome.storage.local.get('profiles');
      const profiles = stored.profiles || [];
      
      // 更新配置
      const index = profiles.findIndex(p => p.name === this.editingProfile.name);
      if (index !== -1) {
        // 保存旧的配置名称，用于检查是否是当前使用的配置
        const oldName = this.editingProfile.name;
        
        // 更新配置
        const updatedProfile = {
          ...this.editingProfile,
          name,
          host,
          port: parseInt(port)
        };
        
        profiles[index] = updatedProfile;
        await chrome.storage.local.set({ profiles });
        
        // 检查是否是当前使用的配置
        const currentProfile = await chrome.storage.local.get('currentProfile');
        if (currentProfile.currentProfile === oldName) {
          // 如果是当前使用的配置，立即应用新的配置
          const proxyManager = new ProxyManager();
          await proxyManager.init(); // 确保初始化完成
          
          // 使用 applyProfile 而不是 setFixedProxy
          if (oldName !== name) {
            // 如果名称改变了，需要先更新 currentProfile
            await chrome.storage.local.set({ currentProfile: name });
          }
          await proxyManager.applyProfile(name);
        }
        
        await this.loadProxies();
        this.closeEditModal();
      }
    } catch (error) {
      console.error('Error in saveEdit:', error);
    }
  }

  closeEditModal() {
    try {
      const modal = document.getElementById('edit-modal');
      if (modal) {
        modal.style.display = 'none';
        this.editingProfile = null;
      }
    } catch (error) {
      console.error('Error in closeEditModal:', error);
    }
  }

  async updateLogs() {
    try {
      const logs = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ type: 'getProxyLogs' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        } catch (error) {
          reject(error);
        }
      });

      // 辅助函数：格式化域名显示
      const formatDomain = (domain) => {
        if (domain.length > 40) {
          const start = domain.substring(0, 20);
          const end = domain.substring(domain.length - 20);
          return `${start}...${end}`;
        }
        return domain;
      };

      // 更新走代理的域名列表
      const proxiedList = document.getElementById('proxied-list');
      if (proxiedList) {
        if (logs.proxied.length === 0) {
          // 如果没有日志，显示空状态
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
          // 显示日志列表
          proxiedList.innerHTML = logs.proxied.map(domain => `
            <div class="log-item">
              <div class="log-item-content">
                <div class="domain-info">
                  <span class="domain-text" title="${domain}">
                    ${formatDomain(domain)}
                  </span>
                </div>
                <button class="btn btn-small btn-bypass" data-domain="${domain}">
                  添加到不代理
                </button>
              </div>
            </div>
          `).join('');
        }

        // 添加事件监听器
        proxiedList.querySelectorAll('.btn-bypass').forEach(button => {
          button.addEventListener('click', async () => {
            const domain = button.dataset.domain;
            try {
              // 1. 添加到不代理列表
              await this.addBypassDomain(domain);
              
              // 2. 从日志中删除该域名
              await new Promise((resolve) => {
                chrome.runtime.sendMessage({ 
                  type: 'removeDomainFromLogs', 
                  domain: domain 
                }, resolve);
              });

              // 3. 更新当前配置并重新应用
              const proxyManager = new ProxyManager();
              await proxyManager.init();
              const currentProfile = await proxyManager.getCurrentProfile();
              if (currentProfile) {
                await proxyManager.applyProfile(currentProfile.name);
              }

              // 4. 更新日志显示
              await this.updateLogs();
              
              // 5. 更新不代理列表显示
              await this.loadBypassList();

              // 6. 通知后台更新目标页面的代理设置
              chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (tabs[0]) {
                  // 发送消息给后台更新目标页面的代理设置
                  chrome.runtime.sendMessage({
                    type: 'updateTargetPageProxy',
                    tabId: tabs[0].id
                  });
                }
              });
            } catch (error) {
              console.error('Error handling bypass click:', error);
            }
          });
        });
      }

      // 更新不走代理的域名列表
      const bypassedList = document.getElementById('bypassed-list');
      if (bypassedList) {
        if (logs.bypassed.length === 0) {
          // 如果没有日志，显示空状态
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
                  <span class="domain-text" title="${domain}">
                    ${formatDomain(domain)}
                  </span>
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

// 初始化选项管理器
const optionsManager = new OptionsManager();
window.optionsManager = optionsManager; // 导出到全局作用域以供 onclick 使用 