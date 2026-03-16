/* ========================================
   WA Resumo Bot Dashboard — Shared JS
   ======================================== */

// Auth
var TOKEN = localStorage.getItem('dashboard_token') || '';

function apiFetch(path, opts) {
  opts = opts || {};
  var h = { 'Authorization': 'Bearer ' + TOKEN };
  if (opts.body) h['Content-Type'] = 'application/json';
  var fetchOpts = Object.assign({}, { headers: h }, opts);
  return fetch(path, fetchOpts).then(function(res) {
    if (res.status === 401 || res.status === 403) {
      window.location.href = '/';
      throw new Error('Unauthorized');
    }
    return res.json();
  });
}

function checkAuth() {
  if (!TOKEN) {
    window.location.href = '/';
    return false;
  }
  return true;
}

// ========================================
// Format Helpers
// ========================================

function formatUptime(seconds) {
  var s = Math.floor(seconds);
  var days = Math.floor(s / 86400);
  s = s % 86400;
  var hours = Math.floor(s / 3600);
  s = s % 3600;
  var minutes = Math.floor(s / 60);
  s = s % 60;

  var parts = [];
  if (days > 0) parts.push(days + 'd');
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0) parts.push(minutes + 'm');
  if (parts.length === 0) parts.push(s + 's');

  return parts.join(' ');
}

function formatCost(cost) {
  if (cost === null || cost === undefined) return '~';
  return '$' + cost.toFixed(4);
}

function formatTokens(n) {
  if (n > 1000) {
    return (n / 1000).toFixed(1) + 'k';
  }
  return String(n);
}

function shortenGroupId(id) {
  if (!id) return '';
  var cleaned = id.replace(/@g\.us$/, '');
  if (cleaned.length > 20) {
    return cleaned.substring(0, 20) + '...';
  }
  return cleaned;
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function formatTime(ts) {
  var d;
  if (typeof ts === 'number') {
    // If timestamp is in seconds (Unix), convert to ms
    d = new Date(ts < 1e12 ? ts * 1000 : ts);
  } else {
    d = new Date(ts);
  }
  var hh = String(d.getHours()).length < 2 ? '0' + d.getHours() : String(d.getHours());
  var mm = String(d.getMinutes()).length < 2 ? '0' + d.getMinutes() : String(d.getMinutes());
  var ss = String(d.getSeconds()).length < 2 ? '0' + d.getSeconds() : String(d.getSeconds());
  return hh + ':' + mm + ':' + ss;
}

// ========================================
// WebSocket
// ========================================

var ws = null;

function connectWebSocket(onMessage) {
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = protocol + '//' + location.host + '/ws?token=' + encodeURIComponent(TOKEN);

  ws = new WebSocket(url);

  ws.onopen = function() {
    var indicator = document.getElementById('ws-indicator');
    if (indicator) {
      indicator.classList.add('connected');
      indicator.title = 'Connected';
    }
  };

  ws.onclose = function() {
    var indicator = document.getElementById('ws-indicator');
    if (indicator) {
      indicator.classList.remove('connected');
      indicator.title = 'Disconnected';
    }
    // Auto-reconnect after 5 seconds
    setTimeout(function() {
      connectWebSocket(onMessage);
    }, 5000);
  };

  ws.onerror = function() {
    var indicator = document.getElementById('ws-indicator');
    if (indicator) {
      indicator.classList.remove('connected');
    }
  };

  ws.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      if (onMessage) {
        onMessage(data);
      }
    } catch (e) {
      // Ignore malformed messages
    }
  };
}

// ========================================
// Nav Active Page Highlight
// ========================================

function initNav() {
  var path = location.pathname;
  var links = document.querySelectorAll('.nav-link');
  links.forEach(function(link) {
    if (link.getAttribute('href') === path) {
      link.classList.add('active');
    }
  });
}
