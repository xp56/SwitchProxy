let proxyManager;

document.addEventListener('DOMContentLoaded', async () => {
  proxyManager = new ProxyManager();
  await proxyManager.init();
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
  
  ul.innerHTML = '';
  
  // 内置代理选项
  const builtInProxies = [
    { id: 'direct', name: '直接连接', iconClass: 'icon-direct' },
    { id: 'system', name: '系统代理', iconClass: 'icon-system' }
  ];
  
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
    
    li.addEventListener('click', async (e) => {
      e.preventDefault();
      await proxyManager.applyProfile(proxy.id);
      await initializeUI();
      window.close();
    });
    
    fragment.appendChild(li);
  });
  
  // 自定义代理配置
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
      
      li.addEventListener('click', async (e) => {
        e.preventDefault();
        await proxyManager.applyProfile(profile.name);
        await initializeUI();
        window.close();
      });
      
      fragment.appendChild(li);
    }
  }
  
  // 分隔线
  const topDivider = document.createElement('li');
  topDivider.className = 'divider';
  fragment.appendChild(topDivider);
  
  // 当前域名部分
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.url && !tabs[0].url.startsWith('chrome://')) {
    try {
      const url = new URL(tabs[0].url);
      let hostname = url.hostname;
      if (hostname.startsWith('www.')) {
        hostname = hostname.substring(4);
      }
      
      const bypassList = await proxyManager.getBypassList();
      const isBypassed = proxyManager.isHostnameBypassMatch(hostname, bypassList);
      
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

      const domainIcon = li.querySelector('.domain-icon');
      domainIcon.addEventListener('click', async () => {
        if (isBypassed) {
          await proxyManager.removeFromNoProxy(hostname);
        } else {
          await proxyManager.addToNoProxy(hostname);
        }
        await updateDomainStatus(hostname);
      });
    } catch (_e) {
      // Invalid URL
    }
  } else {
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
  
  // 分隔线
  const bottomDivider = document.createElement('li');
  bottomDivider.className = 'divider';
  fragment.appendChild(bottomDivider);
  
  // 选项按钮
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
  
  ul.appendChild(fragment);
  
  const optionsButtonElement = ul.querySelector('#options');
  if (optionsButtonElement) {
    optionsButtonElement.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }
}

async function updateDomainStatus(hostname) {
  const bypassList = await proxyManager.getBypassList();
  const isBypassed = proxyManager.isHostnameBypassMatch(hostname, bypassList);
  
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
    
    const domainIcon = currentDomainEl.querySelector('.domain-icon');
    domainIcon.addEventListener('click', async () => {
      if (isBypassed) {
        await proxyManager.removeFromNoProxy(hostname);
      } else {
        await proxyManager.addToNoProxy(hostname);
      }
      
      const currentProfile = await proxyManager.getCurrentProfile();
      if (currentProfile) {
        await proxyManager.updateIcon(currentProfile.name);
      }
      
      await updateDomainStatus(hostname);
    });
  }
}
