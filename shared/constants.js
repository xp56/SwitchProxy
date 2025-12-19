// 共享常量配置
const CONSTANTS = {
  // 缓存相关
  CACHE_TTL: 30000,              // 缓存过期时间 30秒
  BYPASS_CACHE_TTL: 10000,       // bypass列表缓存过期时间 10秒
  
  // 日志相关
  MAX_LOG_SIZE: 1000,            // 最大日志条目数
  LOG_MAX_AGE: 24 * 60 * 60 * 1000, // 日志最大保留时间 24小时
  LOG_CLEANUP_INTERVAL: 60 * 60 * 1000, // 日志清理间隔 1小时
  
  // 性能监控
  PERFORMANCE_REPORT_INTERVAL: 60000, // 性能报告间隔 1分钟
  
  // 开发模式
  DEV_MODE: false,               // 是否开启开发模式
  
  // 代理类型颜色
  COLORS: {
    DIRECT: '#757575',
    SYSTEM: '#1976d2',
    CUSTOM: '#4caf50',
    CUSTOM_FILL: '#a5d6a7'
  }
};

// 如果在 Service Worker 环境中，导出到全局
if (typeof self !== 'undefined') {
  self.CONSTANTS = CONSTANTS;
}
