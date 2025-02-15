let proxyManager;

document.addEventListener('DOMContentLoaded', async () => {
  proxyManager = new ProxyManager();
  await initializeUI();
});

async function initializeUI() {
  const ul = document.querySelector('.proxy-list');
  if (!ul) {
    console.error('Proxy list element not found');
    return;
  }

  const fragment = document.createDocumentFragment();
  const currentProfile = await proxyManager.getCurrentProfile();
  
  // 检查 currentProfile 是否存在
  if (currentProfile) {
    // 更新当前选中状态
    ul.querySelectorAll('.proxy-item').forEach(item => {
      item.classList.remove('active');
      if (item.id === currentProfile.name) {
        item.classList.add('active');
      }
    });
  }
  
  // 清除所有现有的分隔线和自定义配置项
  ul.innerHTML = ''; // 清空列表
  
  // 添加内置代理选项
  const builtInProxies = [
    {
      id: 'direct',
      name: '直接连接',
      iconClass: 'icon-direct'
    },
    {
      id: 'system',
      name: '系统代理',
      iconClass: 'icon-system'
    }
  ];
  
  // 添加内置代理选项
  builtInProxies.forEach(proxy => {
    const li = document.createElement('li');
    li.className = `proxy-item${currentProfile?.name === proxy.id ? ' active' : ''}`;
    li.id = proxy.id;
    li.innerHTML = `
      <a href="#" class="proxy-link">
        <span class="${proxy.iconClass}"></span>
        <span class="proxy-name">${proxy.name}</span>
      </a>
    `;
    
    // 直接在创建时添加事件监听器
    li.addEventListener('click', async (e) => {
      e.preventDefault();
      await proxyManager.applyProfile(proxy.id);
      await initializeUI();
      window.close();
    });
    
    fragment.appendChild(li);
  });
  
  // 添加自定义代理配置
  for (const [name, profile] of proxyManager.profiles) {
    if (name !== 'direct' && name !== 'system') {
      const li = document.createElement('li');
      li.className = `proxy-item custom-proxy${currentProfile?.name === profile.name ? ' active' : ''}`;
      li.id = profile.name;
      li.innerHTML = `
        <a href="#" class="proxy-link">
          <span class="icon-custom-proxy"></span>
          <span class="proxy-name">${profile.name}</span>
        </a>
      `;
      
      // 直接在创建时添加事件监听器
      li.addEventListener('click', async (e) => {
        e.preventDefault();
        await proxyManager.applyProfile(profile.name);
        await initializeUI();
        window.close();
      });
      
      fragment.appendChild(li);
    }
  }
  
  // 添加第一条分隔线
  const topDivider = document.createElement('li');
  topDivider.className = 'divider';
  fragment.appendChild(topDivider);
  
  // 添加当前域名部分
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  if (tabs[0] && tabs[0].url && !tabs[0].url.startsWith('chrome://')) {
    try {
      let url = new URL(tabs[0].url);
      let hostname = url.hostname;
      if (hostname.startsWith("www.")) {
        hostname = hostname.substring(4);
      }
      
      // 获取全局不代理列表
      const bypassList = await proxyManager.getBypassList();
      const isBypassed = proxyManager.isHostnameBypassMatch(hostname, bypassList);
      
      // 添加当前域名项
      const li = document.createElement('li');
      li.id = 'current-domain';
      li.className = `proxy-item current-domain${isBypassed ? ' bypassed' : ''}`;
      li.innerHTML = `
        <span class="domain-icon"></span>
        <div class="domain-text">
          <span class="domain-label">${isBypassed ? '不代理' : '代理'}</span>
          <span class="domain-value">${hostname}</span>
        </div>
      `;
      
      fragment.appendChild(li);

      // 添加图标点击事件
      const domainIcon = li.querySelector('.domain-icon');
      domainIcon.addEventListener('click', async () => {
        if (isBypassed) {
          await proxyManager.removeFromNoProxy(hostname);
        } else {
          await proxyManager.addToNoProxy(hostname);
        }
        await updateDomainStatus(hostname);
      });
    } catch (error) {
      console.debug('Invalid URL or chrome internal page:', error);
      // 对于无效 URL 或 chrome:// 页面，不显示域名部分
    }
  } else {
    console.debug('No valid tab or URL found');
    // 可以选择添加一个提示信息
    const li = document.createElement('li');
    li.id = 'current-domain';
    li.className = 'proxy-item current-domain disabled';
    li.innerHTML = `
      <div class="domain-text">
        <span class="domain-label">当前页面不可用</span>
      </div>
    `;
    fragment.appendChild(li);
  }
  
  // 添加第二条分隔线
  const bottomDivider = document.createElement('li');
  bottomDivider.className = 'divider';
  fragment.appendChild(bottomDivider);
  
  // 添加选项按钮
  const optionsButton = document.createElement('li');
  optionsButton.className = 'proxy-item';
  optionsButton.id = 'options';
  optionsButton.innerHTML = `
    <a href="#" class="proxy-link">
      <span class="icon-settings"></span>
      <span class="proxy-name">选项</span>
    </a>
  `;
  fragment.appendChild(optionsButton);
  
  // 一次性更新DOM
  ul.appendChild(fragment);
  
  // 选项按钮事件监听器
  const optionsButtonElement = ul.querySelector('#options');
  if (optionsButtonElement) {
    optionsButtonElement.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }

  // 为当前域名图标添加事件监听器
  const domainIcon = ul.querySelector('#current-domain .domain-icon');
  if (domainIcon) {
    const hostname = ul.querySelector('#current-domain .domain-value')?.textContent;
    if (hostname) {
      domainIcon.addEventListener('click', async () => {
        const bypassList = await proxyManager.getBypassList();
        const isBypassed = proxyManager.isHostnameBypassMatch(hostname, bypassList);
        
        if (isBypassed) {
          await proxyManager.removeFromNoProxy(hostname);
        } else {
          await proxyManager.addToNoProxy(hostname);
        }
        
        // 获取当前配置并更新图标
        const currentProfile = await proxyManager.getCurrentProfile();
        if (currentProfile) {
          try {
            await debouncedUpdateIcon(currentProfile.name);
          } catch (error) {
            console.error('Error updating icon:', error);
          }
        }
        
        await updateDomainStatus(hostname);
      });
    }
  }
}

// 修改 updateDomainStatus 函数
async function updateDomainStatus(hostname) {
  const result = await chrome.storage.local.get('globalBypassList');
  const bypassList = result.globalBypassList || [];
  const isBypassed = bypassList.includes(hostname);
  
  // 更新当前域名显示
  const currentDomainEl = document.getElementById('current-domain');
  if (currentDomainEl) {
    currentDomainEl.className = `proxy-item current-domain${isBypassed ? ' bypassed' : ''}`;
    currentDomainEl.innerHTML = `
      <span class="domain-icon"></span>
      <div class="domain-text">
        <span class="domain-label">${isBypassed ? '不代理' : '代理'}</span>
        <span class="domain-value">${hostname}</span>
      </div>
    `;
    
    // 重新绑定图标点击事件
    const domainIcon = currentDomainEl.querySelector('.domain-icon');
    domainIcon.addEventListener('click', async () => {
      if (isBypassed) {
        await proxyManager.removeFromNoProxy(hostname);
      } else {
        await proxyManager.addToNoProxy(hostname);
      }
      
      // 获取当前配置并更新图标
      const currentProfile = await proxyManager.getCurrentProfile();
      if (currentProfile) {
        try {
          // 先更新扩展图标
          await proxyManager.updateIcon(currentProfile.name);
          
          // 发送消息给 background 并等待响应
          chrome.runtime.sendMessage({
            type: 'updateIcon',
            profile: currentProfile.name
          }).catch(error => {
            // 忽略连接错误，这可能是因为 popup 已关闭
            if (!error.message.includes('Receiving end does not exist')) {
              console.error('Error updating icon:', error);
            }
          });
        } catch (error) {
          console.error('Error updating icon:', error);
        }
      }
      
      await updateDomainStatus(hostname);
    });
  }
}

// 使用防抖优化图标更新
const debouncedUpdateIcon = debounce(async (profileName) => {
  try {
    await proxyManager.updateIcon(profileName);
    await chrome.runtime.sendMessage({
      type: 'updateIcon',
      profile: profileName
    });
  } catch (error) {
    console.error('Error updating icon:', error);
  }
}, 100);

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
} 