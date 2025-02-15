# Proxy Manager Browser Extension

[中文文档](README-ZH.md)

A simple and easy-to-use browser extension for managing proxy settings, helping you quickly switch between different proxy configurations.

## Features

- Multiple proxy modes:
  - Direct connection
  - System proxy
  - Custom proxy servers
- Smart domain management:
  - Quick toggle proxy status for individual domains
  - Support for domain wildcard rules
  - Batch import/export of bypass domain list
- Real-time proxy logs:
  - View proxied and non-proxied domain records
  - Display domain relationships
  - One-click log clearing
- Convenient interface:
  - Quick proxy switching via popup
  - Detailed configuration in options page
  - Real-time display of current domain proxy status

## Usage

### Basic Operations

1. Click the extension icon to open popup window
2. Select desired proxy mode:
   - Direct Connection: No proxy used
   - System Proxy: Use system configured proxy
   - Custom Proxy: Use configured proxy servers

### Proxy Configuration

1. Open extension options page
2. In "Proxy Servers" tab:
   - Add new proxy configurations
   - Edit existing proxy configurations
   - Delete unwanted proxies

### Domain Management

1. In "Bypass List" tab:
   - Manually add domains to bypass
   - Import/export domain lists
2. In popup window:
   - Click domain icon to quickly toggle proxy status

### Log Viewing

1. In "Proxy Logs" tab:
   - View all proxied and non-proxied domain records
   - Click domains to quickly add to bypass list
   - Use clear button to reset logs

## Installation

1. Download extension source code
2. Open browser extensions management page
3. Enable developer mode
4. Click "Load unpacked extension"
5. Select extension directory

## Tech Stack

- Pure vanilla JavaScript
- Chrome Extensions API
- HTML & CSS

## Contributing

Issues and Pull Requests are welcome to help improve this extension.

## License

This project is licensed under the MIT License.

See [LICENSE](LICENSE) file for full license text.